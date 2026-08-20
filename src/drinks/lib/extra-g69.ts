import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { Rng } from '../../core/rng'
import { makeCanvasTexture } from './canvas'
import { normalMapFromHeight, noiseCanvas } from './noise'
import { glass } from './materials'
import { lastLiquidTint } from './liquid'

/**
 * Shared helpers for tier group g69 (6 mason jar, 9 pitcher). New file —
 * existing lib files are owned by parallel agents and never edited.
 *
 * - citrusWheel: flat cylinder garnish, canvas face (rind ring + pith +
 *   pulp wedges + seeds); caps carry the face texture, side is waxy peel.
 * - tubeHandle: TubeGeometry along a hand-authored CatmullRom path — mug
 *   ears and D-handles that a plain torus arc can't reach (protrusion vs
 *   attach-span geometry fights the footprint radius).
 * - solidGlass: pressed-glass recipe for handles/knobs (solid, not a wall).
 * - ribNormalTexture: vertical knurl ribs → tangent normal map (screw bands).
 * - pinchSpout + weldVertexNormalsByPosition: post-deform a lathe rim into a
 *   pour spout, then rebuild normals WITHOUT the seam crease
 *   (computeVertexNormals splits the lathe seam; the weld averages normals
 *   across position-identical vertices, restoring the smooth wrap).
 */

// ------------------------------------------------------------ citrus wheel --

export interface CitrusWheelOpts {
  /** wheel radius (m) */
  radius: number
  /** disc thickness (m), default radius * 0.3 */
  thickness?: number
  rind?: string
  pith?: string
  pulp?: string
  pulpDeep?: string
  vesicle?: string
  seed?: number
  /** radial segments, default 40 */
  segments?: number
}

/**
 * Lemon/orange wheel. Cylinder axis = local +Y (caller orients). Caps show
 * the painted face; the side shows peel. AgX desaturates — colors authored hot.
 */
export function citrusWheel(opts: CitrusWheelOpts): THREE.Mesh {
  const R = opts.radius
  const T = opts.thickness ?? R * 0.3
  const rind = opts.rind ?? '#f6c81c'
  const pith = opts.pith ?? '#fbf3cf'
  const pulp = opts.pulp ?? '#fadd52'
  const pulpDeep = opts.pulpDeep ?? '#eec02a'
  const vesicle = opts.vesicle ?? '#fdf2a6'
  const rng = new Rng(opts.seed ?? 11)

  const faceTex = makeCanvasTexture(256, 256, (ctx, w, h) => {
    const cx = w / 2
    const cy = h / 2
    const r = w / 2
    const disc = (color: string, frac: number): void => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(cx, cy, r * frac, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = rind
    ctx.fillRect(0, 0, w, h)
    disc(pith, 0.9)
    disc(pulpDeep, 0.82)

    const SEGS = 9
    const gap = 0.075 // radians between wedges — the white pith web
    const jitter: number[] = []
    for (let i = 0; i < SEGS; i++) jitter.push(rng.range(-0.05, 0.05))
    for (let i = 0; i < SEGS; i++) {
      const a0 = (i / SEGS) * Math.PI * 2 + gap / 2 + jitter[i]
      const a1 = ((i + 1) / SEGS) * Math.PI * 2 - gap / 2 + jitter[(i + 1) % SEGS]
      const r0 = r * 0.1
      const r1 = r * 0.79
      const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1)
      g.addColorStop(0, pulp)
      g.addColorStop(1, pulpDeep)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0)
      ctx.arc(cx, cy, r1, a0, a1)
      ctx.arc(cx, cy, r0, a1, a0, true)
      ctx.closePath()
      ctx.fill()
      // juice vesicles: faint radial streaks inside the wedge
      ctx.strokeStyle = vesicle
      ctx.globalAlpha = 0.4
      ctx.lineWidth = 2
      const streaks = 6
      for (let s = 0; s < streaks; s++) {
        const a = a0 + ((s + 0.5) / streaks) * (a1 - a0) + rng.range(-0.02, 0.02)
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(a) * r * 0.2, cy + Math.sin(a) * r * 0.2)
        ctx.lineTo(cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
    // membrane ring between pith and wedges
    ctx.strokeStyle = pith
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2)
    ctx.stroke()
    // seeds
    for (let s = 0; s < 2; s++) {
      const a = rng.range(0, Math.PI * 2)
      const d = r * rng.range(0.3, 0.45)
      ctx.save()
      ctx.translate(cx + Math.cos(a) * d, cy + Math.sin(a) * d)
      ctx.rotate(a)
      ctx.fillStyle = '#f2ecca'
      ctx.beginPath()
      ctx.ellipse(0, 0, r * 0.06, r * 0.035, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    disc(pith, 0.07)
  })

  const capMat = new THREE.MeshPhysicalMaterial({
    map: faceTex,
    roughness: 0.42,
    clearcoat: 0.4, // wet cut face
    clearcoatRoughness: 0.25,
    specularIntensity: 0.6,
  })
  const sideMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(rind),
    roughness: 0.5,
    clearcoat: 0.5, // waxy peel
    clearcoatRoughness: 0.3,
  })
  const geo = new THREE.CylinderGeometry(R, R, T, opts.segments ?? 40, 1, false)
  const mesh = new THREE.Mesh(geo, [sideMat, capMat, capMat])
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

// ------------------------------------------------------------- tube handle --

export interface TubeHandleOpts {
  /** centre-line points in drink-local metres */
  points: ReadonlyArray<readonly [number, number, number]>
  tubeRadius: number
  material: THREE.Material
  tubularSegments?: number
  radialSegments?: number
  /** CatmullRom tension, default 0.5 */
  tension?: number
}

/** Open-ended tube along a CatmullRom path. Bury both ends inside the vessel
 * wall/liquid so the open bores never face the camera. */
export function tubeHandle(opts: TubeHandleOpts): THREE.Mesh {
  const path = new THREE.CatmullRomCurve3(
    opts.points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    false,
    'catmullrom',
    opts.tension ?? 0.5
  )
  const geo = new THREE.TubeGeometry(
    path,
    opts.tubularSegments ?? 40,
    opts.tubeRadius,
    opts.radialSegments ?? 12
  )
  const mesh = new THREE.Mesh(geo, opts.material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

// ------------------------------------------------------------- crisp glass --

export interface CrispGlassOpts {
  /** REAL wall thickness in metres (kept for the recipe's refraction depth) */
  wallThickness: number
  envMapIntensity?: number
  /** condensation droplet normal map — layered on the CLEARCOAT, see below */
  condensationNormalMap?: THREE.Texture
  /** clearcoat normal strength, default 0.6 */
  normalScale?: number
  /** clearcoat gloss, default 0.06 */
  clearcoatRoughness?: number
  /** clearcoat strength, default 0.55 — A/B verified on the pitcher: at 1.0
   * the coat mirrors the env's bright sky patch as a big soft white smear
   * across the liquid (the "milky salmon" defect was mostly this reflection,
   * not the liquid color); 0.5–0.6 keeps the fresnel rim + sun glint that
   * sell the glass while the body behind stays readable */
  clearcoat?: number
}

/**
 * Transmissive glass that stays CRISP at game distance. A/B verified on the
 * pitcher probe: the transmission sample's mip LOD is
 * log2(bufferSize) · roughness · clamp(ior·2−2, 0, 1), and the shader FLOORS
 * roughness at 0.0525 — so even `roughness: 0` leaves everything behind the
 * wall a smear (LOD ≈ 0.5+ of an already 0.6×-res buffer). Setting ior = 1
 * zeroes the ior term instead: LOD 0 always, straight-through refraction, and
 * the only remaining softness is the 0.6× buffer upscale.
 *
 * ior 1 also collapses the base layer's F0 to 0 (no speculars), so a
 * clearcoat (fixed internal ior 1.5) takes over the glass read: fresnel rim
 * light, env streak, sun glint. Condensation droplets go on the CLEARCOAT
 * normal slot — they catch the key light in the coat WITHOUT perturbing the
 * view through the wall (the base refraction at ior 1 ignores normals).
 * Never pass a roughnessMap here: with F0 = 0 it does nothing but reinstate
 * the fog.
 */
export function crispGlass(opts: CrispGlassOpts): THREE.MeshPhysicalMaterial {
  const mat = glass({
    wallThickness: opts.wallThickness,
    roughness: 0,
    envMapIntensity: opts.envMapIntensity ?? 1.5,
  })
  mat.ior = 1.0
  mat.clearcoat = opts.clearcoat ?? 0.55
  mat.clearcoatRoughness = opts.clearcoatRoughness ?? 0.06
  if (opts.condensationNormalMap) {
    mat.clearcoatNormalMap = opts.condensationNormalMap
    const s = opts.normalScale ?? 0.6
    mat.clearcoatNormalScale.set(s, s)
  }
  return mat
}

// ------------------------------------------------------------- solid glass --

export interface SolidGlassOpts {
  /** kept for API stability; the recipe is opaque-pass (see below) */
  thickness: number
  tint?: THREE.ColorRepresentation
  roughness?: number
  /** env response, default 1.8 — drop toward 1.0 when the rod reads frosted
   * bone-white instead of glass (bright body + hot env = white plastic) */
  envMapIntensity?: number
}

/**
 * Pressed-glass handle recipe — OPAQUE-pass on purpose. A/B verified on the
 * mason-jar ear: any transmission > 0 puts the rod in the transmissive pass,
 * so it VANISHES whenever the turntable swings it behind the vessel's own
 * glass wall (three's transmission buffer holds opaque objects only). The
 * sea-glass read comes from a pale green body under a hard clearcoat +
 * hot env highlights instead. Keep castShadow=false on meshes using it —
 * a glass rod throwing a solid black bar is a lie.
 */
export function solidGlass(opts: SolidGlassOpts): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(opts.tint ?? 0xdcf0e8),
    metalness: 0,
    roughness: opts.roughness ?? 0.16,
    ior: 1.5,
    specularIntensity: 1,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    envMapIntensity: opts.envMapIntensity ?? 1.8, // edge highlights sell the rod
    side: THREE.FrontSide,
  })
}

// -------------------------------------------------------- knurl rib normal --

/**
 * Vertical knurl ribs (screw bands, ribbed grips) as a tiling tangent-space
 * normal map. `ribs` = ridge count around one texture repeat.
 */
export function ribNormalTexture(ribs: number, strength = 2.4, w = 512, h = 64): THREE.CanvasTexture {
  const height = document.createElement('canvas')
  height.width = w
  height.height = h
  const ctx = height.getContext('2d')!
  for (let x = 0; x < w; x++) {
    const v = 0.5 - 0.5 * Math.cos((x / w) * ribs * Math.PI * 2)
    const g = Math.round(v * 255)
    ctx.fillStyle = `rgb(${g},${g},${g})`
    ctx.fillRect(x, 0, 1, h)
  }
  const tex = new THREE.CanvasTexture(normalMapFromHeight(height, strength))
  tex.colorSpace = THREE.NoColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}

// ---------------------------------------------------------------- spout ----

export interface SpoutOpts {
  /** spout azimuth in LatheGeometry convention (atan2(x, z)) */
  azimuth: number
  /** deformation ramps in from this height... */
  startY: number
  /** ...to full strength at the rim */
  topY: number
  /** angular half-width of the affected arc (rad), default 0.62 (~35°) */
  halfAngle?: number
  /** radial displacement at the spout centre (m) */
  outPush: number
  /** vertical displacement at the spout centre (m) — negative = classic
   * outward+down pressed-glass pour lip */
  lift?: number
  /** 0..1 tangential crowding toward the spout plane (the pinch), default 0.35 */
  pinch?: number
}

/**
 * Deform a lathe's rim into a pinched pour spout. Both walls of a
 * double-walled profile move together (same y/azimuth → same weight), so the
 * wall thickness survives. Rebuilds normals afterwards and welds the seam.
 */
export function pinchSpout(geo: THREE.BufferGeometry, opts: SpoutOpts): void {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const ha = opts.halfAngle ?? 0.62
  const pinch = opts.pinch ?? 0.35
  const lift = opts.lift ?? 0
  const span = Math.max(1e-6, opts.topY - opts.startY)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    if (y <= opts.startY) continue
    const r = Math.hypot(x, z)
    if (r < 1e-4) continue
    const az = Math.atan2(x, z)
    let d = az - opts.azimuth
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    if (Math.abs(d) >= ha) continue
    const wA = 0.5 + 0.5 * Math.cos((Math.PI * d) / ha)
    const tY = Math.min(1, (y - opts.startY) / span)
    const w = wA * tY * tY
    const newAz = opts.azimuth + d * (1 - pinch * w)
    const newR = r + opts.outPush * w
    pos.setXYZ(i, newR * Math.sin(newAz), y + lift * w, newR * Math.cos(newAz))
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  weldVertexNormalsByPosition(geo)
}

// ------------------------------------------------------------ floating ice --

/**
 * Ice cube geometry with melt: RoundedBox displaced along its normals by a
 * smooth trig field (±amp of the edge), normals rebuilt + seam-welded. The
 * lumps kill the perfect-marshmallow read that a bare RoundedBox has.
 */
export function lumpyIceGeometry(size: number, seed = 1, amp = 0.05): THREE.BufferGeometry {
  const geo = new RoundedBoxGeometry(size, size, size, 4, size * 0.1)
  const rng = new Rng(seed)
  const p1 = rng.range(0, Math.PI * 2)
  const p2 = rng.range(0, Math.PI * 2)
  const p3 = rng.range(0, Math.PI * 2)
  const f = (2.2 * Math.PI * 2) / size // ~2 lump cycles across the cube
  const pos = geo.attributes.position as THREE.BufferAttribute
  const nor = geo.attributes.normal as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const n =
      Math.sin(x * f + p1) * Math.sin(y * f * 0.83 + p2) +
      0.6 * Math.sin((x + z) * f * 0.61 + p3) * Math.sin(y * f * 0.47 + p1)
    const d = n * amp * size * 0.5
    pos.setXYZ(i, x + nor.getX(i) * d, y + nor.getY(i) * d, z + nor.getZ(i) * d)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  weldVertexNormalsByPosition(geo)
  return geo
}

export interface WetIceOpts {
  seed?: number
  /** body roughness range painted into the noise map, default [0.07, 0.3] */
  roughnessRange?: readonly [number, number]
}

/**
 * Wet floating ice — OPAQUE-pass on purpose (ice behind a transmissive glass
 * wall must stay in the opaque pass; see materials.ts gotcha). The ice read
 * comes from: cool BLUE-GRAY body (matched to the tier-11 bucket heap, the
 * roster's reference ice — pure white + matte is the marshmallow), a cool
 * mottled map (darker internal patches = seeing INTO the cube), semi-gloss
 * facets, and a hard wet clearcoat. envMapIntensity stays ≤ 1.2: the old 1.6
 * blew sun-facing facets past the 1.0 bloom threshold into chalk-white puffs.
 */
export function wetIce(opts: WetIceOpts = {}): THREE.MeshPhysicalMaterial {
  const range = opts.roughnessRange ?? ([0.07, 0.3] as const)
  const swirl = noiseCanvas(128, 128, 3, opts.seed ?? 19, {
    cellsX: 5,
    cellsY: 5,
    range: [range[0], range[1]],
  })
  const roughnessMap = new THREE.CanvasTexture(swirl)
  roughnessMap.colorSpace = THREE.NoColorSpace
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping
  // internal-depth mottle: blue-gray patches over a cool base — the cheap
  // stand-in for subsurface light; keyed cooler than the sky so AgX + the warm
  // key can't launder it back to white
  const rng = new Rng((opts.seed ?? 19) + 3)
  const map = makeCanvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#d4e2ec'
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 9; i++) {
      const x = rng.next() * w
      const y = rng.next() * h
      const r = rng.range(0.15, 0.32) * w
      const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r)
      g.addColorStop(0, 'rgba(136,160,180,0.3)')
      g.addColorStop(1, 'rgba(136,160,180,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    // fracture glints: short bright hairlines
    ctx.strokeStyle = 'rgba(244,251,255,0.75)'
    ctx.lineWidth = 1.3
    for (let i = 0; i < 8; i++) {
      const x = rng.next() * w
      const y = rng.next() * h
      const a = rng.range(0, Math.PI)
      const l = rng.range(0.08, 0.24) * w
      ctx.beginPath()
      ctx.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l)
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
      ctx.stroke()
    }
  })
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, // tint lives in the map (× vertex waterline tint)
    map,
    metalness: 0,
    roughness: 1, // absolute values live in the map
    roughnessMap,
    ior: 1.31,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    specularIntensity: 1,
    envMapIntensity: 1.15,
  })
}

export interface FloatingIceOpts {
  count: number
  /** cube edge (m) */
  size: number
  /** liquid surface height (the cap plane) */
  fillY: number
  /** max radial distance of cube centres from the axis */
  spreadRadius: number
  /** fraction of the cube edge left ABOVE the waterline, default 0.22 —
   * real ice floats ~90% submerged; 0.15–0.3 reads honest through glass */
  freeboard?: number
  seed?: number
  material?: THREE.Material
  /** liquid surface color — bakes a wet meniscus band into vertex colors
   * just above the waterline, so the lump visibly sits IN the liquid instead
   * of ON it (the placed-marshmallow defect). Pass the tier's liquid surface
   * tone, slightly darkened. Default: the surface tone of the most recent
   * buildLiquid() call × 0.72 (builders create the liquid before its ice),
   * so untinted call sites still get the waterline read. */
  waterline?: THREE.ColorRepresentation
}

const smoothT = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

/**
 * Buoyancy-honest ice: cubes ride ~80% SUBMERGED — the opaque liquid volume
 * hides everything under the cap plane, so only a low lump breaks the
 * surface, exactly like real floating ice (cubes sitting proud ON the liquid
 * read as marshmallows). One shared lumpy geometry + one wet material; per
 * mesh: scale/rotation variance and — when `waterline` is given — a baked
 * vertex-color band that tints the lump toward the liquid right at the
 * surface (the wet climb real ice shows). Tilts moderate: floating ice
 * levels itself, but a cocked edge breaking the surface is what kills the
 * flat-tile read from the game's top-down camera.
 */
export function floatingIce(opts: FloatingIceOpts): THREE.Group {
  const rng = new Rng(opts.seed ?? 42)
  const size = opts.size
  const freeboard = opts.freeboard ?? 0.22
  const geo = lumpyIceGeometry(size, (opts.seed ?? 42) + 7, 0.032)
  const mat = opts.material ?? wetIce({ seed: (opts.seed ?? 42) + 13 })
  // No explicit waterline → fall back to the drink the tier just built
  // (surface tone, darkened like the pitcher's hand-tuned value): builders
  // create the liquid BEFORE its ice, so the registry holds the right color.
  const waterline: THREE.ColorRepresentation | undefined =
    opts.waterline ?? lastLiquidTint()?.surface.multiplyScalar(0.72)
  if (waterline !== undefined && mat instanceof THREE.Material) {
    mat.vertexColors = true
  }
  const tint = new THREE.Color(waterline ?? 0xffffff)
  const white = new THREE.Color(0xffffff)
  const scratch = new THREE.Vector3()
  const euler = new THREE.Euler()
  const group = new THREE.Group()
  for (let i = 0; i < opts.count; i++) {
    const a = (i / opts.count) * Math.PI * 2 + rng.range(-0.5, 0.5)
    const rad = opts.spreadRadius * Math.sqrt(rng.range(0.15, 1))
    const fb = freeboard * rng.range(0.6, 1.45)
    const px = Math.cos(a) * rad
    const py = opts.fillY - size * (0.5 - fb)
    const pz = Math.sin(a) * rad
    euler.set(rng.range(-0.34, 0.34), rng.range(0, Math.PI * 2), rng.range(-0.34, 0.34))
    const sx = rng.range(0.85, 1.12)
    const sy = rng.range(0.82, 1.0)
    const sz = rng.range(0.85, 1.12)

    let meshGeo: THREE.BufferGeometry = geo
    if (waterline !== undefined) {
      // bake the wet band per mesh in GROUP space: full liquid tint at the
      // waterline (hidden below it by the cap anyway), fading to clean ice
      // over ~0.35 of the cube edge above it
      meshGeo = geo.clone()
      const pos = meshGeo.attributes.position as THREE.BufferAttribute
      const colors = new Float32Array(pos.count * 3)
      const band = size * 0.35
      for (let vi = 0; vi < pos.count; vi++) {
        scratch.set(pos.getX(vi) * sx, pos.getY(vi) * sy, pos.getZ(vi) * sz)
        scratch.applyEuler(euler)
        const y = scratch.y + py
        const t = smoothT((opts.fillY + band - y) / band) * 0.8
        const c = white.clone().lerp(tint, t)
        colors[vi * 3] = c.r
        colors[vi * 3 + 1] = c.g
        colors[vi * 3 + 2] = c.b
      }
      meshGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    }

    const mesh = new THREE.Mesh(meshGeo, mat)
    mesh.position.set(px, py, pz)
    mesh.rotation.copy(euler)
    mesh.scale.set(sx, sy, sz)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  return group
}

// ------------------------------------------------------- liquid depth ramp --

export interface DepthGradientStop {
  /** position along the liquid volume's lathe v (0 = floor centre, 1 = top) */
  v: number
  color: string
}

/**
 * Vertical color ramp for opaque-pass liquids: maps onto the liquid volume
 * lathe (v runs floor → surface), faking the depth attenuation a transmissive
 * liquid would have — deep and dark at the floor, hot and bright near the
 * surface. Author colors 10–20% hotter than target (AgX desaturates).
 */
export function liquidDepthGradient(stops: readonly DepthGradientStop[]): THREE.CanvasTexture {
  return makeCanvasTexture(4, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, h, 0, 0) // canvas bottom = v0 (floor)
    for (const s of stops) g.addColorStop(Math.min(1, Math.max(0, s.v)), s.color)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  })
}

// ----------------------------------------------- submerged garnish ghosts --

export interface SubmergedWheelGhost {
  /** texture u of the wheel centre = lathe azimuth (atan2(x,z), wrapped to
   * 0..2π) / 2π — LatheGeometry puts u 0 at +Z and runs toward +X first */
  u: number
  /** v of the wheel centre in normalized volume height (see buildLiquid) */
  v: number
  /** wheel radius in u units (wheelRadius / wallRadius / 2π) */
  ru: number
  /** wheel radius in v units (wheelRadius / volumeHeightSpan) */
  rv: number
}

export interface LiquidBodyTextureOpts {
  /** vertical depth ramp — v0 floor (dark) → v1 surface (bright). Author
   * 10–20% hotter than target: AgX desaturates. */
  stops: readonly DepthGradientStop[]
  /** fill line in v — ghosts are only painted below it (above it the wall is
   * clipped away at runtime anyway) and the depth veil is keyed from it */
  vFill: number
  /** citrus wheels pressed against the inside wall, seen THROUGH the liquid */
  wheels?: readonly SubmergedWheelGhost[]
  /** liquid veil color laid over the ghosts, deepening away from the surface */
  veil?: string
  rind?: string
  pith?: string
  pulp?: string
  width?: number
  height?: number
}

/**
 * Body texture for an opaque-pass liquid: the depth ramp PLUS painted
 * "submerged garnish" ghosts. Real translucent tea shows a lemon wheel
 * pressed against the wall through centimetres of liquid — with transmission
 * off that read must be painted: a soft-edged two-tone citrus disc at the
 * wheel's azimuth, dimming and losing contrast with depth under a veil of
 * the liquid color. Align each ghost with the real wheel mesh poking above
 * the fill line and the pair reads as ONE wheel crossing the surface.
 */
export function liquidBodyTexture(opts: LiquidBodyTextureOpts): THREE.CanvasTexture {
  const W = opts.width ?? 512
  const H = opts.height ?? 512
  const veil = opts.veil ?? '#8a3305'
  const rind = opts.rind ?? '#e9c95e'
  const pith = opts.pith ?? '#f2e5b4'
  const pulp = opts.pulp ?? '#dfba4c'
  return makeCanvasTexture(W, H, (ctx, w, h) => {
    const vToY = (v: number): number => (1 - v) * h // canvas top = v1
    const g = ctx.createLinearGradient(0, h, 0, 0)
    for (const s of opts.stops) g.addColorStop(Math.min(1, Math.max(0, s.v)), s.color)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)

    for (const wheel of opts.wheels ?? []) {
      const cx = wheel.u * w
      const cy = vToY(wheel.v)
      const rx = wheel.ru * w
      const ry = wheel.rv * h
      ctx.save()
      // soft edges: the wheel is behind liquid, never crisp
      ctx.filter = `blur(${Math.max(2, w * 0.006)}px)`
      const ell = (fr: number, fill: string): void => {
        ctx.fillStyle = fill
        ctx.beginPath()
        ctx.ellipse(cx, cy, rx * fr, ry * fr, 0, 0, Math.PI * 2)
        ctx.fill()
      }
      ell(1, rind)
      ell(0.86, pith)
      ell(0.78, pulp)
      // wedge membranes: faint spokes
      ctx.strokeStyle = pith
      ctx.globalAlpha = 0.55
      ctx.lineWidth = Math.max(1.5, w * 0.006)
      for (let s = 0; s < 8; s++) {
        const a = (s / 8) * Math.PI * 2 + 0.35
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(a) * rx * 0.12, cy + Math.sin(a) * ry * 0.12)
        ctx.lineTo(cx + Math.cos(a) * rx * 0.74, cy + Math.sin(a) * ry * 0.74)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      ctx.filter = 'none'
      // depth veil: liquid swallows the ghost as it goes down — light haze at
      // the fill line, nearly opaque at the wheel's bottom edge
      const vg = ctx.createLinearGradient(0, vToY(opts.vFill), 0, cy + ry)
      const veilC = new THREE.Color(veil)
      const rgba = (a: number): string =>
        `rgba(${Math.round(veilC.r * 255)},${Math.round(veilC.g * 255)},${Math.round(veilC.b * 255)},${a})`
      vg.addColorStop(0, rgba(0.1))
      vg.addColorStop(0.5, rgba(0.38))
      vg.addColorStop(1, rgba(0.75))
      ctx.fillStyle = vg
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx * 1.04, ry * 1.04, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  })
}

/**
 * Average normals across position-identical vertices (the lathe seam, cap
 * centres). computeVertexNormals() treats the duplicated seam column as two
 * boundaries and creases it; this restores the smooth wrap.
 */
export function weldVertexNormalsByPosition(geo: THREE.BufferGeometry, epsilon = 1e-6): void {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const nor = geo.attributes.normal as THREE.BufferAttribute
  const buckets = new Map<string, number[]>()
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) / epsilon)},${Math.round(pos.getY(i) / epsilon)},${Math.round(pos.getZ(i) / epsilon)}`
    const list = buckets.get(k)
    if (list) list.push(i)
    else buckets.set(k, [i])
  }
  const n = new THREE.Vector3()
  for (const list of buckets.values()) {
    if (list.length < 2) continue
    n.set(0, 0, 0)
    for (const i of list) n.add(new THREE.Vector3(nor.getX(i), nor.getY(i), nor.getZ(i)))
    if (n.lengthSq() < 1e-12) continue
    n.normalize()
    for (const i of list) nor.setXYZ(i, n.x, n.y, n.z)
  }
  nor.needsUpdate = true
}
