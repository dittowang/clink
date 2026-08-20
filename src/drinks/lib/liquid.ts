import * as THREE from 'three'
import type { LiquidSpec } from '../types'
import { offsetProfile, sampleProfile, innerRadiusAt, type ProfilePoint } from './profiles'
import { liquid as liquidMaterial, liquidDepthRamp, type LiquidOpts } from './materials'

/**
 * Liquid rig: volume lathe from the INNER glass profile inset ~0.5 mm at the
 * wall, up to fillY, plus a cap disc lying at the surface. The instance code
 * (instantiateDrink) clones the material and assigns a world-space clipping
 * plane; the game tilts that plane for slosh and orients the cap to lie in
 * it.
 *
 * Wet-read geometry (tuned against the "candle in a vessel" defect):
 * - the volume BOTTOM sits on the inner glass floor (floorGap ≈ 0.2 mm —
 *   not floated up by the wall inset), so no empty ring shows under the body;
 * - the top ~5 mm of the wall flares OUT toward the glass so the gap at the
 *   surface narrows to ~0.2 mm — the meniscus hint; the cap disc reaches
 *   the flared wall.
 *
 * The volume's wall runs OVERHANG (default 4 mm) ABOVE fillY and is closed
 * with a top disc, so the tilted clipping plane always cuts solid wall —
 * never an open edge that would expose a hollow shell.
 *
 * uv.v on the volume is remapped to NORMALIZED HEIGHT (0 = liquid floor,
 * 1 = wall top), and by default the material carries a liquidDepthRamp map
 * (color moves into the map, material color turns white) — dark at depth,
 * saturated body, lifted surface band. Tiers overriding `map` (e.g. the
 * pitcher's custom ramp) keep working: v still runs floor → surface.
 */
export interface BuildLiquidOpts {
  /** gap between glass inner wall and liquid (m), default 0.0005 */
  inset?: number
  /** wall gap AT THE SURFACE after the meniscus flare (m), default 0.0002 */
  surfaceGap?: number
  /** how far the volume wall continues above fillY (m), default 0.004 */
  overhang?: number
  /** radial segments, default 64 */
  segments?: number
  /** lighten the surface cap vs the body (0..1, default 0.12) — sells the
   * "liquid surface" read on opaque-pass liquids */
  capLighten?: number
  /** paint the body with a vertical depth ramp (default true for opaque-pass
   * liquids) — set false to keep the flat single-color recipe */
  depthRamp?: boolean
}

export interface LiquidBuild {
  volumeMesh: THREE.Mesh
  capMesh: THREE.Mesh
  spec: LiquidSpec
}

/**
 * Most-recent liquid tint, recorded by buildLiquid for garnish factories
 * (floating ice) whose call sites don't carry the drink color. Template
 * builds are synchronous and every tier builds its liquid BEFORE the garnish
 * floating in it, so at garnish-build time this IS the current drink.
 * `body` = the authored body color, `surface` = the cap/surface tone.
 */
let lastTintRecord: { body: THREE.Color; surface: THREE.Color } | null = null

export function lastLiquidTint(): { body: THREE.Color; surface: THREE.Color } | null {
  return lastTintRecord
    ? { body: lastTintRecord.body.clone(), surface: lastTintRecord.surface.clone() }
    : null
}

export function buildLiquid(
  innerProfile: readonly ProfilePoint[],
  fillY: number,
  tint: LiquidOpts,
  opts: BuildLiquidOpts = {}
): LiquidBuild {
  const inset = opts.inset ?? 0.0005
  const surfaceGap = Math.min(opts.surfaceGap ?? 0.0002, inset)
  const overhang = opts.overhang ?? 0.004
  const topY = fillY + overhang
  const floorGap = 0.0002 // clearance above the glass inner floor (z-fight)
  const meniscusBand = 0.005 // wall band below fillY that flares out

  // inset the inner wall, sample it, truncate at topY (first upward crossing)
  const insetProfile = offsetProfile(innerProfile, inset)
  const sampled = sampleProfile(insetProfile, 96)
  const pts: THREE.Vector2[] = []
  for (let i = 0; i < sampled.length; i++) {
    const p = sampled[i]
    if (p.y >= topY) {
      if (i > 0) {
        const a = sampled[i - 1]
        const t = Math.abs(p.y - a.y) < 1e-9 ? 0 : (topY - a.y) / (p.y - a.y)
        pts.push(new THREE.Vector2(a.x + (p.x - a.x) * t, topY))
      }
      break
    }
    pts.push(p.clone())
  }
  if (pts.length === 0) {
    throw new Error('buildLiquid: fillY below the inner profile floor')
  }
  const smooth01 = (t: number): number =>
    t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)
  {
    // plant the bottom: the normal offset floats the floor up by `inset`;
    // pull the bottom band back down so the body SITS on the glass floor
    let yMin = Infinity
    for (const p of pts) if (p.y < yMin) yMin = p.y
    const drop = Math.max(0, inset - floorGap)
    const band = 0.008
    for (const p of pts) p.y -= drop * smooth01((yMin + band - p.y) / band)
    // meniscus hint: flare the top of the wall OUT toward the glass so the
    // gap narrows from `inset` to `surfaceGap` at the fill line
    const flare = inset - surfaceGap
    for (const p of pts) {
      if (p.y > fillY - meniscusBand) {
        p.x += flare * smooth01((p.y - (fillY - meniscusBand)) / meniscusBand)
      }
    }
  }
  // ensure the volume starts at the axis so the bottom is closed
  if (pts[0].x > 0.002) pts.unshift(new THREE.Vector2(0.0004, pts[0].y))
  // close the top (clipped away at runtime; exists so the shell is watertight)
  const wallTop = pts[pts.length - 1]
  pts.push(new THREE.Vector2(wallTop.x * 0.55, topY + 0.0002))
  pts.push(new THREE.Vector2(0.0004, topY + 0.0002))

  const geo = new THREE.LatheGeometry(pts, opts.segments ?? 64)
  {
    // uv.v = normalized height (0 = liquid floor, 1 = wall top) so depth
    // ramps are keyed on actual depth, not arc length along the profile
    let yMin = Infinity
    for (const p of pts) if (p.y < yMin) yMin = p.y
    const span = Math.max(1e-6, topY + 0.0002 - yMin)
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) {
      uv.setY(i, Math.min(1, Math.max(0, (pos.getY(i) - yMin) / span)))
    }
    uv.needsUpdate = true
  }
  const mat = liquidMaterial(tint)
  // surface tone for the cap; when the ramp is on, the body color moves into
  // the map and the material color turns white (map × color would double-tint)
  let capColor = new THREE.Color(tint.color)
  if ((opts.depthRamp ?? true) && !tint.transmissive) {
    const ramp = liquidDepthRamp(tint)
    mat.map = ramp.map
    mat.color.set(0xffffff)
    capColor = ramp.surface
  }
  lastTintRecord = { body: new THREE.Color(tint.color), surface: capColor.clone() }

  const capRadius = Math.max(0.001, innerRadiusAt(innerProfile, fillY) - surfaceGap - 0.00005)

  // template-level default plane so the template renders sensibly at origin;
  // instances get a fresh plane from instantiateDrink.
  mat.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), fillY)]

  const volumeMesh = new THREE.Mesh(geo, mat)
  volumeMesh.userData.liquidVolume = true
  volumeMesh.castShadow = true
  volumeMesh.receiveShadow = false

  // Cap = the liquid SURFACE: flat color (the ramp's uv would streak across a
  // disc) + wet gloss — a liquid top always carries sheen, however cloudy the
  // body is. Slight lighten stays (sells the surface against the body).
  const capMat = mat.clone()
  capMat.clippingPlanes = null
  capMat.map = null
  capMat.color.copy(capColor).lerp(new THREE.Color(0xffffff), opts.capLighten ?? 0.12)
  capMat.roughness = Math.min(0.08, tint.roughness ?? 0.08)
  capMat.clearcoat = 1.0
  capMat.clearcoatRoughness = 0.05
  capMat.envMapIntensity = 1.3
  capMat.specularIntensity = 0.5
  capMat.sheen = 0.15
  const capMesh = new THREE.Mesh(new THREE.CircleGeometry(capRadius, opts.segments ?? 64), capMat)
  capMesh.rotation.x = -Math.PI / 2 // face +Y
  capMesh.position.y = fillY
  capMesh.userData.liquidCap = true
  capMesh.castShadow = false
  capMesh.receiveShadow = false

  const spec: LiquidSpec = { fillY, capRadius }
  return { volumeMesh, capMesh, spec }
}
