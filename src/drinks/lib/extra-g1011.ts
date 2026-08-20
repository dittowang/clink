import * as THREE from 'three'
import { noiseCanvas, normalMapFromHeight } from './noise'
import { makeCanvasTexture } from './canvas'

/**
 * Shared helpers for tiers 10–11 (watermelon keg, steel ice bucket).
 * Theme: making metal READ as metal, and heap ice read as ice.
 *
 * Metal has no diffuse term — its entire look is the environment it reflects.
 * CAPTURE-VERIFIED LESSON (this file's first doctrine was wrong): under the
 * game's SOFT envs, dropping roughness toward a mirror does NOT rescue the
 * metal read — a mirror shows the single env feature in the mirror direction,
 * which is one flat tone (flat ochre tap = "gold-painted wood"; a flared
 * bucket wall mirrors the pale sky = "celadon enamel"), and near-white F0
 * ghosts into bright backdrops. What actually reads as machined metal here:
 * MID roughness (≈ .22–.3) integrating the warm env into a broad lobe with a
 * hot key core, F0 dark enough to hold value contrast (gunmetal, deep brass),
 * facet value steps (hex nut), and anisotropy shaping the highlight — the
 * dispenser-lid satinSteel recipe is the house reference.
 */

export interface PolishedMetalOpts {
  color: THREE.ColorRepresentation
  roughness?: number
  envMapIntensity?: number
}

/** Machined bright metal (tap hardware, bucket accents). */
export function polishedMetal(opts: PolishedMetalOpts): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: opts.color,
    metalness: 1,
    roughness: opts.roughness ?? 0.24,
    envMapIntensity: opts.envMapIntensity ?? 1.1,
    specularIntensity: 1,
  })
}

/**
 * Hex nut / faceted collar: non-indexed → per-face normals, so each flat
 * catches its own env tone. The crisp value steps between facets are what
 * read as "machined", where a smooth cylinder shows one smeared gradient.
 * Axis along +Z (matches tap parts built down the local outward axis).
 */
export function hexNutGeometry(acrossCorners: number, thickness: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(acrossCorners, acrossCorners, thickness, 6).toNonIndexed()
  geo.computeVertexNormals() // non-indexed → flat facet normals
  geo.rotateX(Math.PI / 2)
  return geo
}

export interface BrushedSteelWallOpts {
  seed?: number
  /** achromatic steel base F0 (sRGB), default 0x9aa0a6 */
  base?: THREE.ColorRepresentation
  /** cool tone baked onto up-facing curvature (sky pickup), default 0xcfdde8 */
  sky?: THREE.ColorRepresentation
  /** dark tone baked onto down-facing curvature, default 0x3f4246 */
  ground?: THREE.ColorRepresentation
  /** absolute roughness band of the brush streaks, default [0.22, 0.55] */
  roughnessRange?: readonly [number, number]
  anisotropy?: number
  envMapIntensity?: number
}

/**
 * Brushed steel for a LATHE WALL, with the metal read BAKED into the maps.
 * Capture-verified rationale (tier 11): under both game envs the specular
 * alone cannot carry a side-facing wall — the probe env is a warm studio
 * (a warm-F0 satinSteel integrated it into "tan thrown clay") and the lineup
 * stage's hemisphere fill washes metal flat ("cream enamelware"). What DOES
 * survive every light is the color map, so this recipe computes, per profile
 * row of the actual sampled lathe (arc-length rows == texture v), the surface
 * normal's elevation and bakes what real steel would reflect: cool sky on
 * up-facing curvature (bead crests, rolled lip), dark ground on down-facing
 * under-curves, ambient occlusion into the interior and at the base — plus
 * achromatic circumferential brush-streak tone. The result: high-contrast
 * highlight banding that follows curvature (metal) instead of a smooth
 * diffuse ramp (ceramic). Real anisotropic specular streaks ride on top.
 *
 * `rows` must be the sampled profile actually given to LatheGeometry
 * (`geo.parameters.points`) — texture v is uniform across those rows.
 */
export function brushedSteelWall(
  rows: readonly THREE.Vector2[],
  opts: BrushedSteelWallOpts = {}
): THREE.MeshPhysicalMaterial {
  const seed = opts.seed ?? 11
  const base = new THREE.Color(opts.base ?? 0x9aa0a6)
  const sky = new THREE.Color(opts.sky ?? 0xcfdde8)
  const ground = new THREE.Color(opts.ground ?? 0x3f4246)
  const n = rows.length
  // per-row outward normal elevation: profile traversed bottom→up the outer
  // wall → over the lip → down the inside, so n = (dy, -dr) points at the
  // VISIBLE side the whole way (outward on the outer wall, up at the lip
  // crest, inward-up on the inner wall, up on the floor)
  const elev: number[] = []
  for (let j = 0; j < n; j++) {
    const a = rows[Math.max(0, j - 1)]
    const b = rows[Math.min(n - 1, j + 1)]
    const dr = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dr, dy)
    elev.push(len < 1e-9 ? 0 : -dr / len)
  }
  // rim = highest row; rows after it are the interior (inner wall + floor)
  let rimJ = 0
  for (let j = 1; j < n; j++) if (rows[j].y > rows[rimJ].y) rimJ = j
  const rimY = rows[rimJ].y
  const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

  const W = 256
  const H = 1024
  const c0 = new THREE.Color()
  const map = makeCanvasTexture(W, H, (ctx, w, h) => {
    for (let py = 0; py < h; py++) {
      const v = 1 - (py + 0.5) / h // canvas top row = v 1
      const f = v * (n - 1)
      const j = Math.min(n - 2, Math.floor(f))
      const t = f - j
      const e = elev[j] + (elev[j + 1] - elev[j]) * t
      const y = rows[j].y + (rows[j + 1].y - rows[j].y) * t
      c0.copy(base)
      if (j < rimJ) {
        // vertical graze ramp on the outer wall: rough-metal Fresnel picks up
        // sky at the top limb and dark ground low — the probe env is a warm
        // studio whose horizon band would otherwise be the wall's only
        // reflection (that flat warm integral is precisely the clay read)
        const th = y / rimY
        c0.lerp(sky, smooth((th - 0.5) / 0.5) * 0.42)
        c0.lerp(ground, smooth((0.3 - th) / 0.3) * 0.34)
      }
      if (e > 0) {
        c0.lerp(sky, smooth(e / 0.5) * 0.95) // sky pickup on up-facing curvature
      } else {
        // -0.14 dead zone: the overall flare tilts ~-0.19 and must stay near
        // base — only genuine under-curves (beads, lip tuck, base round) darken
        c0.lerp(ground, smooth((-e - 0.14) / 0.5) * 0.85)
      }
      if (j >= rimJ) {
        // interior AO: darker with depth below the rim
        const ao = smooth((rimY - y) / 0.06)
        c0.multiplyScalar(1 - 0.45 * ao)
      } else {
        // contact AO at the very base
        c0.multiplyScalar(1 - 0.3 * smooth((0.016 - y) / 0.016))
      }
      ctx.fillStyle = `#${c0.getHexString()}`
      ctx.fillRect(0, py, w, 1)
    }
    // achromatic circumferential brush streaks — tonal, survive any lighting
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = 0.38
    ctx.drawImage(noiseCanvas(w, h, 3, seed, { cellsX: 3, cellsY: 128, range: [0.3, 1.25] }), 0, 0)
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = 0.22
    ctx.drawImage(noiseCanvas(w, h, 3, seed + 1, { cellsX: 3, cellsY: 128, range: [-0.2, 0.85] }), 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  })

  // streaked roughness (absolute values; see satinSteel for the range math)
  const [lo, hi] = opts.roughnessRange ?? [0.22, 0.55]
  const ra = -lo / (hi - lo)
  const rb = (1 - lo) / (hi - lo)
  const roughTex = makeCanvasTexture(
    256,
    512,
    (ctx) => {
      ctx.drawImage(noiseCanvas(256, 512, 3, seed + 2, { cellsX: 3, cellsY: 128, range: [ra, rb] }), 0, 0)
    },
    { srgb: false }
  )
  roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping

  const mat = new THREE.MeshPhysicalMaterial({
    map,
    metalness: 1,
    roughness: 1, // absolute values live in the map
    roughnessMap: roughTex,
    envMapIntensity: opts.envMapIntensity ?? 1.1,
  })
  mat.anisotropy = opts.anisotropy ?? 0.65
  mat.anisotropyRotation = 0
  return mat
}

/** Tiling crinkle normal map (ice facet waviness, crushed-ice beds). */
export function crinkleNormal(seed: number, cells: number, strength: number): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(
    normalMapFromHeight(noiseCanvas(128, 128, 3, seed, { cellsX: cells, cellsY: cells }), strength)
  )
  tex.colorSpace = THREE.NoColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

/**
 * Display ice for an OPEN-AIR heap (never behind glass — transmission is
 * single-layer). Bright glassy transmissive cubes; slight internal waviness
 * so refraction glints break up instead of reading plastic.
 *
 * PAIR WITH AN OPAQUE BRIGHT BED BEHIND THEM: the transmission buffer holds
 * opaque objects only, so whatever is behind a cube IS its body. Over a dark
 * bucket interior the same cubes render as gray stones; over a frosted white
 * ice bed they render as ice.
 */
export function heapIceMaterial(size: number): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xf3faff,
    metalness: 0,
    roughness: 0.07,
    transmission: 0.9,
    ior: 1.31,
    thickness: size,
    attenuationColor: new THREE.Color(0xd4ecff),
    attenuationDistance: 0.055,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    specularIntensity: 1,
    envMapIntensity: 2.0,
  })
  m.normalMap = crinkleNormal(202, 9, 1.6)
  m.normalScale.set(0.3, 0.3)
  return m
}
