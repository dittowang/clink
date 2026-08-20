import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { Rng } from '../../core/rng'
import { makeCanvasTexture } from './canvas'
import { noiseCanvas } from './noise'

/**
 * Group-512 extras: helpers tiers 5 + 12 need that the shared lib does not
 * provide. New file — existing lib files are owned by other agents.
 *
 *  - applyRadialRibs: real vertical flutes on a lathe's OUTER wall (radius
 *    modulated by cos(ribs·θ)), with recomputed normals and a seam fix.
 *  - citrusWheel: orange/lime wheel (cylinder, painted pulp caps + rind side)
 *    for pressing flat against a jar's inner wall.
 *  - woodMaterial: varnished-walnut canvas grain for stands/cradles.
 *  - floatingIce: honest floating ice — cubes ~2/3 SUBMERGED (the opaque
 *    liquid hides the underwater part, exactly like real juice does), melted
 *    irregular silhouettes, mottled translucent-looking (but opaque-pass)
 *    material. Replaces the marshmallow read of flat-white cubes sitting ON
 *    the surface.
 *  - satinSteel: bloom-safe brushed metal — roughness floor high enough that
 *    the sun's mirror lobe never crosses the bloom threshold (the lib steel()
 *    at envMapIntensity 1 flares into a white halo on domes/lids).
 */

// ------------------------------------------------------------- radial ribs --

export interface RadialRibOpts {
  /** flute count around the circumference */
  ribs: number
  /** peak radial displacement (m) — crests bulge OUT from the base surface */
  amplitude: number
  /** y band [y0, y1] the ribs occupy (full strength inside, feathered ends) */
  yRange: readonly [number, number]
  /** feather distance (m) at each end of the band, default 0.012 */
  feather?: number
  /** sampled OUTER-wall curve — used to pick outer-wall vertices only, so a
   * double-walled lathe keeps its inner wall smooth (honest pressed glass:
   * wall thickness varies, interior stays true) */
  outerPoints: readonly THREE.Vector2[]
  /** vertices within this radial distance of the outer wall move, default
   * 0.0018 (must stay below the glass wall thickness) */
  tolerance?: number
  /**
   * groove sharpening exponent applied to the wave (0..1 of a rib period).
   * 1 = pure cos (soft). < 1 fattens the convex flutes and creases the
   * grooves — pressed-glass look, and the creases are what catch highlights.
   */
  grooveSharpness?: number
}

function radiusAtY(pts: readonly THREE.Vector2[], y: number): number {
  let best = -1
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if ((a.y <= y && b.y >= y) || (a.y >= y && b.y <= y)) {
      const t = Math.abs(b.y - a.y) < 1e-9 ? 0 : (y - a.y) / (b.y - a.y)
      const r = a.x + (b.x - a.x) * t
      if (r > best) best = r
    }
  }
  return best
}

function smooth01(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return t * t * (3 - 2 * t)
}

/**
 * Displace a lathe's outer-wall vertices radially by a cos flute wave and
 * recompute normals. computeVertexNormals() creases the wrap seam (the two
 * seam columns each average only their own faces), so when `grid` is given
 * the seam columns' normals are averaged back together — displacement is
 * 2π-periodic, so seam POSITIONS already match.
 */
export function applyRadialRibs(geo: THREE.LatheGeometry, opts: RadialRibOpts): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const tol = opts.tolerance ?? 0.0018
  const feather = opts.feather ?? 0.012
  const sharp = opts.grooveSharpness ?? 1
  const [y0, y1] = opts.yRange
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const env = smooth01((y - y0) / feather) * smooth01((y1 - y) / feather)
    if (env <= 0) continue
    const r = Math.hypot(x, z)
    if (r < 1e-5) continue
    const rOut = radiusAtY(opts.outerPoints, y)
    if (rOut < 0 || Math.abs(r - rOut) > tol) continue
    const theta = Math.atan2(z, x)
    const w = 0.5 + 0.5 * Math.cos(opts.ribs * theta) // 0 groove … 1 crest
    const dr = opts.amplitude * env * Math.pow(w, sharp)
    const s = (r + dr) / r
    pos.setX(i, x * s)
    pos.setZ(i, z * s)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  // seam repair: the two seam columns each averaged only their own faces
  const { points, segments } = geo.parameters
  const rows = points.length
  if (pos.count === (segments + 1) * rows) {
    const nor = geo.getAttribute('normal') as THREE.BufferAttribute
    const v = new THREE.Vector3()
    for (let j = 0; j < rows; j++) {
      const a = j
      const b = segments * rows + j
      v.set(nor.getX(a) + nor.getX(b), nor.getY(a) + nor.getY(b), nor.getZ(a) + nor.getZ(b))
      if (v.lengthSq() < 1e-12) continue
      v.normalize()
      nor.setXYZ(a, v.x, v.y, v.z)
      nor.setXYZ(b, v.x, v.y, v.z)
    }
    nor.needsUpdate = true
  }
}

// ------------------------------------------------------------ floating ice --

export interface FloatingIceOpts {
  count: number
  /** cube edge (m) */
  size: number
  /** liquid surface height (world/drink-local y of the fill plane) */
  surfaceY: number
  /** max radial distance of cube centres from the axis */
  spreadRadius: number
  seed?: number
  /** submerged fraction of the cube height, default 0.5–0.68 randomized */
  submerge?: readonly [number, number]
}

/** continuous low-frequency warp field — same value for coincident verts */
function warp(x: number, y: number, z: number, k: number, seed: number): number {
  return (
    Math.sin(x * k + seed * 1.7) +
    Math.sin(y * k * 1.31 + seed * 3.1) +
    Math.sin(z * k * 0.83 + seed * 5.3)
  )
}

/**
 * One irregular "melted" ice-cube geometry: RoundedBox warped by a smooth
 * position-based field (radial displacement → coincident seam verts move
 * together, no cracks). Original normals are kept: the warp is gentle, and
 * recomputing would crease the box's unwelded face seams.
 */
function iceLumpGeometry(size: number, seed: number): RoundedBoxGeometry {
  const geo = new RoundedBoxGeometry(size, size * 0.94, size, 3, size * 0.15)
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const k = (Math.PI * 2) / (size * 1.15)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const r = Math.hypot(x, y, z)
    if (r < 1e-6) continue
    const w = warp(x, y, z, k, seed) / 3 // [-1, 1]
    const s = 1 + w * 0.055
    pos.setXYZ(i, x * s, y * s, z * s)
  }
  pos.needsUpdate = true
  return geo
}

/**
 * Shared ice material — opaque-pass (safe behind transmissive glass) but
 * NOT flat white: a mottled cool map with darker internal patches fakes
 * depth, a patchy roughness map alternates wet-glassy and frosted zones, and
 * a strong clearcoat carries the glints. Tuned against the marshmallow read.
 */
function iceLumpMaterial(seed: number): THREE.MeshPhysicalMaterial {
  const map = makeCanvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#f3f8fc'
    ctx.fillRect(0, 0, w, h)
    // internal depth: soft darker blue-gray blobs (reads as seeing INTO the cube)
    const rng = new Rng(seed + 40)
    for (let i = 0; i < 7; i++) {
      const x = rng.next() * w
      const y = rng.next() * h
      const r = rng.range(0.12, 0.28) * w
      const g = ctx.createRadialGradient(x, y, r * 0.15, x, y, r)
      g.addColorStop(0, 'rgba(150,180,202,0.26)')
      g.addColorStop(1, 'rgba(150,180,202,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    // fine grain
    ctx.globalAlpha = 0.08
    ctx.globalCompositeOperation = 'multiply'
    ctx.drawImage(noiseCanvas(w, h, 3, seed, { range: [0.35, 1.35] }), 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    // fracture glints: short bright hairlines
    ctx.globalAlpha = 1
    ctx.strokeStyle = 'rgba(255,255,255,0.65)'
    ctx.lineWidth = 1.2
    for (let i = 0; i < 9; i++) {
      const x = rng.next() * w
      const y = rng.next() * h
      const a = rng.range(0, Math.PI)
      const l = rng.range(0.1, 0.3) * w
      ctx.beginPath()
      ctx.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l)
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
      ctx.stroke()
    }
  })
  const roughnessMap = makeCanvasTexture(
    128,
    128,
    (ctx, w, h) => {
      // wet-glassy patches (dark = smooth) over a frosted base
      ctx.drawImage(noiseCanvas(w, h, 3, seed + 9, { range: [-0.35, 1.55] }), 0, 0)
    },
    { srgb: false }
  )
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map,
    metalness: 0,
    roughness: 0.34, // scales the map: absolute range ≈ 0.06–0.34
    roughnessMap,
    ior: 1.31,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    specularIntensity: 1,
    envMapIntensity: 1.35,
  })
  return mat
}

/**
 * Floating ice, honest: cube centres sit BELOW the liquid surface so each
 * lump rides ~2/3 submerged with one shoulder and a couple of corners proud —
 * the opaque liquid body swallows the rest, which is exactly what real ice in
 * juice looks like. Three shared geometry variants + one shared material.
 */
export function floatingIce(opts: FloatingIceOpts): THREE.Group {
  const rng = new Rng(opts.seed ?? 7)
  const size = opts.size
  const [sub0, sub1] = opts.submerge ?? [0.5, 0.68]
  const geos = [
    iceLumpGeometry(size, (opts.seed ?? 7) * 13 + 1),
    iceLumpGeometry(size, (opts.seed ?? 7) * 13 + 2),
    iceLumpGeometry(size, (opts.seed ?? 7) * 13 + 3),
  ]
  const mat = iceLumpMaterial(opts.seed ?? 7)
  const group = new THREE.Group()
  for (let i = 0; i < opts.count; i++) {
    const mesh = new THREE.Mesh(geos[i % geos.length], mat)
    const a = (i / opts.count) * Math.PI * 2 + rng.range(-0.55, 0.55)
    const rad = opts.spreadRadius * Math.sqrt(rng.range(0.15, 1))
    const submerge = rng.range(sub0, sub1)
    mesh.position.set(
      Math.cos(a) * rad,
      opts.surfaceY + size * (0.5 - submerge),
      Math.sin(a) * rad
    )
    mesh.rotation.set(rng.range(-0.45, 0.45), rng.range(0, Math.PI * 2), rng.range(-0.45, 0.45))
    mesh.scale.set(rng.range(0.86, 1.12), rng.range(0.9, 1.05), rng.range(0.86, 1.12))
    mesh.castShadow = true
    group.add(mesh)
  }
  return group
}

// ------------------------------------------------------------- satin steel --

export interface SatinSteelOpts {
  seed?: number
  /** base metal tone, default 0xb4bac1 */
  color?: THREE.ColorRepresentation
  /** absolute roughness band [lo, hi], default [0.34, 0.6] — the lo floor is
   * what keeps the sun's mirror lobe under the bloom threshold */
  roughnessRange?: readonly [number, number]
  anisotropy?: number
  envMapIntensity?: number
}

/**
 * Brushed metal that cannot bloom-flare: the lib steel() lets roughness dip
 * to ~0.26 at envMapIntensity 1, and on a sun-facing dome that mirror lobe
 * reads as a glowing lamp through UnrealBloom. This recipe floors roughness
 * at 0.34 and pulls env response down, keeping the satin streak read.
 */
export function satinSteel(opts: SatinSteelOpts = {}): THREE.MeshPhysicalMaterial {
  const [lo, hi] = opts.roughnessRange ?? [0.34, 0.6]
  // noiseCanvas range: output = (n - a) / (b - a); choose a,b so the noise
  // body [0,1] lands inside [lo, hi] of absolute roughness
  const a = -lo / (hi - lo)
  const b = (1 - lo) / (hi - lo)
  const streaks = noiseCanvas(256, 256, 3, opts.seed ?? 5, {
    cellsX: 3,
    cellsY: 96,
    range: [a, b],
  })
  const tex = new THREE.CanvasTexture(streaks)
  tex.colorSpace = THREE.NoColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(opts.color ?? 0xb4bac1),
    metalness: 1,
    roughness: 1, // absolute values live in the map
    roughnessMap: tex,
    envMapIntensity: opts.envMapIntensity ?? 0.7,
  })
  mat.anisotropy = opts.anisotropy ?? 0.5
  mat.anisotropyRotation = 0
  return mat
}

// ------------------------------------------------------------ citrus wheel --

export interface CitrusWheelOpts {
  /** wheel radius (m) */
  radius: number
  /** wheel thickness (m) */
  thickness: number
  /** rind skin color (css) */
  rind: string
  /** membrane / pith color (css) */
  pith: string
  /** pulp wedge color (css) */
  pulp: string
  /** deeper pulp tone for variation (css) */
  pulpDeep: string
  /** wedge count, default 9 */
  wedges?: number
  seed?: number
}

/**
 * Citrus wheel: cylinder with painted pulp cross-section caps and a rind
 * side band. Axis +Y; rotate so a cap faces radially outward to press it
 * flat against a jar's inner wall (opaque — stays visible through glass).
 */
export function citrusWheel(opts: CitrusWheelOpts): THREE.Mesh {
  const wedges = opts.wedges ?? 9
  const rng = new Rng(opts.seed ?? 3)
  const face = makeCanvasTexture(256, 256, (ctx, w, h) => {
    const cx = w / 2
    const cy = h / 2
    const R = w * 0.495
    ctx.fillStyle = opts.rind
    ctx.fillRect(0, 0, w, h)
    // pith ring (membrane)
    ctx.fillStyle = opts.pith
    ctx.beginPath()
    ctx.arc(cx, cy, R * 0.9, 0, Math.PI * 2)
    ctx.fill()
    // pulp wedges with pale membrane gaps
    const gap = 0.035
    for (let i = 0; i < wedges; i++) {
      const a0 = (i / wedges) * Math.PI * 2 + gap
      const a1 = ((i + 1) / wedges) * Math.PI * 2 - gap
      const c0 = new THREE.Color(opts.pulp)
      const c1 = new THREE.Color(opts.pulpDeep)
      c0.lerp(c1, rng.range(0, 0.55))
      ctx.fillStyle = `#${c0.getHexString()}`
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, R * 0.83, a0, a1)
      ctx.closePath()
      ctx.fill()
      // vesicle streaks: lighter radial lines inside the wedge
      ctx.strokeStyle = 'rgba(255,255,255,0.20)'
      ctx.lineWidth = 2
      for (let k = 0; k < 3; k++) {
        const a = a0 + ((k + 0.5) / 3) * (a1 - a0)
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(a) * R * 0.18, cy + Math.sin(a) * R * 0.18)
        ctx.lineTo(cx + Math.cos(a) * R * 0.78, cy + Math.sin(a) * R * 0.78)
        ctx.stroke()
      }
    }
    // core dot
    ctx.fillStyle = opts.pith
    ctx.beginPath()
    ctx.arc(cx, cy, R * 0.07, 0, Math.PI * 2)
    ctx.fill()
  })
  const faceMat = new THREE.MeshPhysicalMaterial({
    map: face,
    roughness: 0.38,
    clearcoat: 0.55, // wet-cut gloss
    clearcoatRoughness: 0.2,
    specularIntensity: 0.7,
  })
  const rindMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(opts.rind),
    roughness: 0.5,
    clearcoat: 0.4,
    clearcoatRoughness: 0.3,
  })
  const geo = new THREE.CylinderGeometry(opts.radius, opts.radius, opts.thickness, 40, 1, false)
  // group order: side, top cap, bottom cap
  const mesh = new THREE.Mesh(geo, [rindMat, faceMat, faceMat])
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

// ------------------------------------------------------------------- wood --

export interface WoodOpts {
  seed?: number
  /** base tone (css), default warm walnut */
  base?: string
  /** grain line tone (css) */
  dark?: string
  roughness?: number
}

/** Varnished walnut: fBm streak grain + wavy grain lines under a clearcoat. */
export function woodMaterial(opts: WoodOpts = {}): THREE.MeshPhysicalMaterial {
  const seed = opts.seed ?? 21
  const base = opts.base ?? '#8a5a33'
  const dark = opts.dark ?? '#553317'
  const tex = makeCanvasTexture(
    512,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = base
      ctx.fillRect(0, 0, w, h)
      // streaky tone variation: few cells along the grain, many across
      const grain = noiseCanvas(w, h, 4, seed, { cellsX: 3, cellsY: 40, range: [0.1, 0.9] })
      ctx.globalAlpha = 0.4
      ctx.globalCompositeOperation = 'multiply'
      ctx.drawImage(grain, 0, 0)
      ctx.globalCompositeOperation = 'overlay'
      ctx.globalAlpha = 0.22
      ctx.drawImage(grain, 0, 0)
      // sparse wavy grain lines (integer wave counts → tiles horizontally;
      // drawn with ±h copies → tiles vertically)
      ctx.globalCompositeOperation = 'source-over'
      const rng = new Rng(seed + 5)
      for (let i = 0; i < 13; i++) {
        const yBase = rng.next() * h
        const amp = rng.range(1.2, 4)
        const waves = 1 + Math.floor(rng.range(0, 3))
        const phase = rng.range(0, Math.PI * 2)
        ctx.strokeStyle = dark
        ctx.globalAlpha = rng.range(0.14, 0.34)
        ctx.lineWidth = rng.range(0.8, 2.4)
        for (const dy of [-h, 0, h]) {
          ctx.beginPath()
          for (let x = 0; x <= w; x += 4) {
            const yy = yBase + dy + Math.sin((x / w) * Math.PI * 2 * waves + phase) * amp
            if (x === 0) ctx.moveTo(x, yy)
            else ctx.lineTo(x, yy)
          }
          ctx.stroke()
        }
      }
      ctx.globalAlpha = 1
    },
    { repeat: [2, 1] }
  )
  return new THREE.MeshPhysicalMaterial({
    map: tex,
    metalness: 0,
    roughness: opts.roughness ?? 0.5,
    clearcoat: 0.35,
    clearcoatRoughness: 0.28,
    specularIntensity: 0.55,
  })
}
