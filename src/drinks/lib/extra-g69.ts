import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { Rng } from '../../core/rng'
import { makeCanvasTexture } from './canvas'
import { normalMapFromHeight, noiseCanvas } from './noise'

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

// ------------------------------------------------------------- solid glass --

export interface SolidGlassOpts {
  /** kept for API stability; the recipe is opaque-pass (see below) */
  thickness: number
  tint?: THREE.ColorRepresentation
  roughness?: number
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
    envMapIntensity: 1.8, // edge highlights are what sell the rod
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
  /** body roughness range painted into the noise map, default [0.14, 0.42] */
  roughnessRange?: readonly [number, number]
}

/**
 * Wet floating ice — OPAQUE-pass on purpose (ice behind a transmissive glass
 * wall must stay in the opaque pass; see materials.ts gotcha). The ice read
 * comes from: cold blue-white body, swirly internal roughness variation
 * (frozen inclusions), and a hard wet clearcoat with hot env glints — NOT
 * from the matte chalk-white that reads marshmallow.
 */
export function wetIce(opts: WetIceOpts = {}): THREE.MeshPhysicalMaterial {
  const range = opts.roughnessRange ?? ([0.14, 0.42] as const)
  const swirl = noiseCanvas(128, 128, 3, opts.seed ?? 19, {
    cellsX: 5,
    cellsY: 5,
    range: [range[0], range[1]],
  })
  const roughnessMap = new THREE.CanvasTexture(swirl)
  roughnessMap.colorSpace = THREE.NoColorSpace
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping
  return new THREE.MeshPhysicalMaterial({
    color: 0xe8f4fb,
    metalness: 0,
    roughness: 1, // absolute values live in the map
    roughnessMap,
    ior: 1.31,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    specularIntensity: 1,
    envMapIntensity: 1.6,
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
}

/**
 * Buoyancy-honest ice: cubes ride ~80% SUBMERGED — the opaque liquid volume
 * hides everything under the cap plane, so only a low lump breaks the
 * surface, exactly like real floating ice (cubes sitting proud ON the liquid
 * read as marshmallows). One shared lumpy geometry + one wet material;
 * variance is per-mesh scale/rotation. Tilts stay small: floating ice levels
 * itself flat-side-up.
 */
export function floatingIce(opts: FloatingIceOpts): THREE.Group {
  const rng = new Rng(opts.seed ?? 42)
  const size = opts.size
  const freeboard = opts.freeboard ?? 0.22
  const geo = lumpyIceGeometry(size, (opts.seed ?? 42) + 7)
  const mat = opts.material ?? wetIce({ seed: (opts.seed ?? 42) + 13 })
  const group = new THREE.Group()
  for (let i = 0; i < opts.count; i++) {
    const mesh = new THREE.Mesh(geo, mat)
    const a = (i / opts.count) * Math.PI * 2 + rng.range(-0.5, 0.5)
    const rad = opts.spreadRadius * Math.sqrt(rng.range(0.15, 1))
    const fb = freeboard * rng.range(0.75, 1.25)
    mesh.position.set(
      Math.cos(a) * rad,
      opts.fillY - size * (0.5 - fb),
      Math.sin(a) * rad
    )
    mesh.rotation.set(rng.range(-0.22, 0.22), rng.range(0, Math.PI * 2), rng.range(-0.22, 0.22))
    mesh.scale.set(rng.range(0.85, 1.12), rng.range(0.82, 1.0), rng.range(0.85, 1.12))
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
