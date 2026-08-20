import * as THREE from 'three'
import type { LiquidSpec } from '../types'
import { offsetProfile, sampleProfile, innerRadiusAt, type ProfilePoint } from './profiles'
import { liquid as liquidMaterial, type LiquidOpts } from './materials'

/**
 * Liquid rig: volume lathe from the INNER glass profile inset ~0.5 mm, up to
 * fillY, plus a cap disc lying at the surface. The instance code
 * (instantiateDrink) clones the material and assigns a world-space clipping
 * plane; the game tilts that plane for slosh and orients the cap to lie in
 * it.
 *
 * The volume's wall runs OVERHANG (default 4 mm) ABOVE fillY and is closed
 * with a top disc, so the tilted clipping plane always cuts solid wall —
 * never an open edge that would expose a hollow shell.
 */
export interface BuildLiquidOpts {
  /** gap between glass inner wall and liquid (m), default 0.0005 */
  inset?: number
  /** how far the volume wall continues above fillY (m), default 0.004 */
  overhang?: number
  /** radial segments, default 64 */
  segments?: number
  /** lighten the surface cap vs the body (0..1, default 0.12) — sells the
   * "liquid surface" read on opaque-pass liquids */
  capLighten?: number
}

export interface LiquidBuild {
  volumeMesh: THREE.Mesh
  capMesh: THREE.Mesh
  spec: LiquidSpec
}

export function buildLiquid(
  innerProfile: readonly ProfilePoint[],
  fillY: number,
  tint: LiquidOpts,
  opts: BuildLiquidOpts = {}
): LiquidBuild {
  const inset = opts.inset ?? 0.0005
  const overhang = opts.overhang ?? 0.004
  const topY = fillY + overhang

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
  // ensure the volume starts at the axis so the bottom is closed
  if (pts[0].x > 0.002) pts.unshift(new THREE.Vector2(0.0004, pts[0].y))
  // close the top (clipped away at runtime; exists so the shell is watertight)
  const wallTop = pts[pts.length - 1]
  pts.push(new THREE.Vector2(wallTop.x * 0.55, topY + 0.0002))
  pts.push(new THREE.Vector2(0.0004, topY + 0.0002))

  const geo = new THREE.LatheGeometry(pts, opts.segments ?? 64)
  const mat = liquidMaterial(tint)

  const capRadius = Math.max(0.001, innerRadiusAt(innerProfile, fillY) - inset - 0.0003)

  // template-level default plane so the template renders sensibly at origin;
  // instances get a fresh plane from instantiateDrink.
  mat.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), fillY)]

  const volumeMesh = new THREE.Mesh(geo, mat)
  volumeMesh.userData.liquidVolume = true
  volumeMesh.castShadow = true
  volumeMesh.receiveShadow = false

  const capMat = mat.clone()
  capMat.clippingPlanes = null
  capMat.color.lerp(new THREE.Color(0xffffff), opts.capLighten ?? 0.12)
  const capMesh = new THREE.Mesh(new THREE.CircleGeometry(capRadius, opts.segments ?? 64), capMat)
  capMesh.rotation.x = -Math.PI / 2 // face +Y
  capMesh.position.y = fillY
  capMesh.userData.liquidCap = true
  capMesh.castShadow = false
  capMesh.receiveShadow = false

  const spec: LiquidSpec = { fillY, capRadius }
  return { volumeMesh, capMesh, spec }
}
