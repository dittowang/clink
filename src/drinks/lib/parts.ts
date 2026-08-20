import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { Rng } from '../../core/rng'
import { makeCanvasTexture } from './canvas'
import { lastLiquidTint } from './liquid'

/**
 * Reusable garnish/hardware parts. Each factory returns a Mesh/Group with
 * origin chosen for easy placement; the caller positions it in drink-local
 * space (drink origin = base centre, +Y up).
 */

// ---------------------------------------------------------------- straw ---

export interface StrawOpts {
  /** tube radius (m), default 0.0024 */
  radius?: number
  /** where the straw starts, deep in the liquid */
  bottom?: readonly [number, number, number]
  /** end of the straight section — the classic elbow sits just above */
  bendStart?: readonly [number, number, number]
  /** straw tip after the bend */
  tip?: readonly [number, number, number]
  color?: THREE.ColorRepresentation
  /** paint a classic candy stripe along the tube instead of a flat color */
  stripe?: THREE.ColorRepresentation
  material?: THREE.Material
}

/** Bent straw: TubeGeometry along a CatmullRom path with the classic elbow. */
export function bentStraw(opts: StrawOpts = {}): THREE.Mesh {
  const radius = opts.radius ?? 0.0024
  const bottom = new THREE.Vector3(...(opts.bottom ?? [0.016, 0.02, -0.006]))
  const bendStart = new THREE.Vector3(...(opts.bendStart ?? [0.024, 0.15, -0.006]))
  const tip = new THREE.Vector3(...(opts.tip ?? [0.038, 0.185, -0.006]))
  // an extra point continuing the straight run keeps the elbow tight and the
  // lower section dead straight
  const preBend = bendStart.clone().lerp(bottom, 0.12)
  const postBend = tip.clone().lerp(bendStart, 0.35)
  const path = new THREE.CatmullRomCurve3(
    [bottom, preBend, bendStart, postBend, tip],
    false,
    'catmullrom',
    0.6
  )
  const geo = new THREE.TubeGeometry(path, 48, radius, 10)
  let material = opts.material
  if (!material) {
    const color = new THREE.Color(opts.color ?? 0xff5a4e)
    if (opts.stripe !== undefined) {
      const stripe = new THREE.Color(opts.stripe)
      const tex = makeCanvasTexture(
        64,
        64,
        (ctx, w, h) => {
          ctx.fillStyle = `#${color.getHexString()}`
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = `#${stripe.getHexString()}`
          // diagonal candy stripes, seamless because slope = 1 and count divides w
          for (let i = -2; i < 10; i++) {
            ctx.save()
            ctx.translate(i * 16, 0)
            ctx.beginPath()
            ctx.moveTo(0, 0)
            ctx.lineTo(8, 0)
            ctx.lineTo(8 + h, h)
            ctx.lineTo(h, h)
            ctx.closePath()
            ctx.fill()
            ctx.restore()
          }
        },
        { repeat: [6, 1] }
      )
      material = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.35, clearcoat: 0.5 })
    } else {
      material = new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 0.5 })
    }
  }
  const mesh = new THREE.Mesh(geo, material)
  mesh.castShadow = true
  return mesh
}

// ------------------------------------------------------------------ ice ---

export interface IceMaterialOpts {
  /**
   * OPT-IN. Real transmission only reads correctly when the ice is NOT
   * behind another transmissive surface (three's transmission buffer holds
   * opaque objects only). Ice inside a glass → leave false (frosted recipe).
   * Ice heaped over a steel bucket rim → true looks far better.
   */
  transmissive?: boolean
  /** cube edge, used as transmission thickness (m) */
  size?: number
  /**
   * Opaque branch only: multiply baked vertex colors (the waterline tint from
   * bakeWaterlineTint) into the shade. Only enable when every mesh wearing
   * this material HAS a color attribute — a missing attribute renders black.
   */
  vertexColors?: boolean
}

export function iceMaterial(opts: IceMaterialOpts = {}): THREE.MeshPhysicalMaterial {
  if (opts.transmissive) {
    return new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.16,
      transmission: 0.95,
      ior: 1.31,
      thickness: opts.size ?? 0.02,
      attenuationColor: new THREE.Color(0xd8eeff),
      attenuationDistance: 0.06,
      clearcoat: 0.5,
      clearcoatRoughness: 0.2,
    })
  }
  // Translucent-LOOKING while staying fully opaque-pass. transparent:true was
  // A/B tested and is a trap: alpha-blended meshes are absent from the
  // transmission buffer AND depth-occluded by the glass wall, so the ice
  // simply vanishes at game camera angles. The translucency is faked instead:
  // a mottled cool map (deep blue-gray internal patches = seeing INTO the
  // cube, bright fracture hairlines = internal cracks) under a wet sharp
  // clearcoat, low roughness so facets catch hard glints. Blue-white, never
  // pure white — pure white + matte is the marshmallow.
  const seed = 1337
  const map = makeCanvasTexture(128, 128, (ctx, w, h) => {
    const rng = new Rng(seed)
    // Cool blue-white base, authored deeper than looks right raw: the warm
    // key + AgX pull it back toward white, and the transmission-buffer blur
    // (in-glass ice is always seen THROUGH the wall) averages fine detail
    // away — only value/color structure survives. The old #eaf3f9 base with
    // 0.24-alpha patches rendered as flat chalk (crit2-t5-zoom).
    ctx.fillStyle = '#e0ecf6'
    ctx.fillRect(0, 0, w, h)
    // internal depth: darker blue-gray patches = seeing INTO the cube
    for (let i = 0; i < 9; i++) {
      const x = rng.next() * w
      const y = rng.next() * h
      const r = rng.range(0.14, 0.32) * w
      const g = ctx.createRadialGradient(x, y, r * 0.12, x, y, r)
      g.addColorStop(0, 'rgba(138,168,193,0.42)')
      g.addColorStop(1, 'rgba(138,168,193,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    // fracture glints: short bright hairlines
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'
    ctx.lineWidth = 1.4
    for (let i = 0; i < 10; i++) {
      const x = rng.next() * w
      const y = rng.next() * h
      const a = rng.range(0, Math.PI)
      const l = rng.range(0.08, 0.26) * w
      ctx.beginPath()
      ctx.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l)
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
      ctx.stroke()
    }
  })
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, // the tint lives in the map
    map,
    metalness: 0,
    roughness: 0.15,
    ior: 1.31,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    specularIntensity: 1,
    // 1.6 mirrored the golden-hour SKY on the dome tops — at game distance
    // the cubes read as blue candy; 1.2 keeps the glint, drops the sky wash
    envMapIntensity: 1.2,
    vertexColors: opts.vertexColors ?? false,
  })
}

// ------------------------------------------------------ waterline tinting ---

export interface WaterlineTintOpts {
  /** GEOMETRY-space y of the waterline plane through the lump */
  waterlineY: number
  /** lump edge (m) — scales the blend band */
  size: number
  /** liquid color at/below the waterline (the drink's body color) */
  tint: THREE.ColorRepresentation
  /** blend band above the waterline as a fraction of size, default 0.45 */
  band?: number
  /** tint strength at the waterline 0..1, default 0.9 */
  strength?: number
}

/**
 * Bakes the "floating IN the drink" read into ice geometry as vertex colors:
 * at/below the waterline the lump carries the liquid color (wet ice is a
 * lightpipe — its base reads as the drink shining through), fading to clean
 * cold blue-white above. This is the piece a mottled map cannot deliver
 * through the transmission-buffer blur: a bold value/color gradient anchored
 * to the surface survives the smear where texture detail does not, and it is
 * what visually interlocks the lump with the liquid instead of leaving a
 * white marshmallow perched ON an orange disc. Works on SHARED geometry:
 * every cube of a batch floats at (nearly) the same geometry-space waterline
 * and the blend band swallows the per-mesh submerge jitter.
 *
 * Vertex colors multiply map × color, so the paired material needs
 * `vertexColors: true` and a near-white base.
 */
export function bakeWaterlineTint(geo: THREE.BufferGeometry, opts: WaterlineTintOpts): void {
  const band = (opts.band ?? 0.45) * opts.size
  const strength = opts.strength ?? 0.9
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  const white = new THREE.Color(1, 1, 1)
  // thin ice lightens + slightly milks what shows through it
  const wet = new THREE.Color(opts.tint).lerp(white, 0.15)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const hRel = (pos.getY(i) - opts.waterlineY) / band
    const s = hRel <= 0 ? 0 : hRel >= 1 ? 1 : hRel * hRel * (3 - 2 * hRel)
    c.copy(white).lerp(wet, (1 - s) * strength)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

/** shared rounded-cube geometry for a batch of ice — flat faces, soft edges */
export function iceCubeGeometry(size = 0.02): RoundedBoxGeometry {
  return new RoundedBoxGeometry(size, size, size, 4, size * 0.16)
}

export interface ScatterIceOpts {
  count: number
  /** cube edge (m), default 0.02 */
  size?: number
  /** liquid surface height the cubes float at (cube centres sit just under) */
  surfaceY: number
  /** max radial distance of cube centres from the axis */
  spreadRadius: number
  seed?: number
  material?: THREE.Material
  geometry?: THREE.BufferGeometry
  /** submerged fraction range of the cube edge, default [0.6, 0.78] */
  submerge?: readonly [number, number]
  /**
   * liquid color the cube bases pick up at the waterline. Default: the body
   * color of the most recent buildLiquid() call (tiers build the liquid
   * before its ice), else a neutral wet gray-blue.
   */
  liquidTint?: THREE.ColorRepresentation
}

/**
 * Floating ice: cubes share ONE geometry + ONE material; variance comes from
 * per-mesh scale (0.85–1.15, slightly squashed) and rotation. Buoyancy-honest:
 * centres sit WELL under surfaceY so each cube rides ~60–78% submerged — the
 * opaque liquid body swallows the underwater part and only a low tilted dome
 * breaks the surface (cubes perched ON the fill plane read as marshmallows).
 * Tilts stay small: floating ice levels itself. The waterline read itself is
 * baked vertex color (bakeWaterlineTint): base of each visible lump carries
 * the liquid tint, fading to blue-white — without it the cubes read as white
 * puffs sitting ON the surface no matter how deep they actually sit.
 */
export function scatterIce(opts: ScatterIceOpts): THREE.Group {
  const rng = new Rng(opts.seed ?? 42)
  const size = opts.size ?? 0.02
  const geo = opts.geometry ?? iceCubeGeometry(size)
  const [sub0, sub1] = opts.submerge ?? [0.6, 0.78]
  // waterline in geometry space: mean submerge, un-scaled by the mean scaleY
  const meanScaleY = 0.925
  const tint = opts.liquidTint ?? lastLiquidTint()?.body ?? 0xb9c7d2
  bakeWaterlineTint(geo, {
    waterlineY: (size * ((sub0 + sub1) / 2 - 0.5)) / meanScaleY,
    size,
    tint,
  })
  const mat = opts.material ?? iceMaterial({ size, vertexColors: true })
  const group = new THREE.Group()
  for (let i = 0; i < opts.count; i++) {
    const mesh = new THREE.Mesh(geo, mat)
    const a = (i / opts.count) * Math.PI * 2 + rng.range(-0.5, 0.5)
    const rad = opts.spreadRadius * Math.sqrt(rng.range(0.15, 1))
    const submerge = rng.range(sub0, sub1) // fraction of the cube below the fill plane
    mesh.position.set(
      Math.cos(a) * rad,
      opts.surfaceY - size * (submerge - 0.5),
      Math.sin(a) * rad
    )
    mesh.rotation.set(rng.range(-0.18, 0.18), rng.range(0, Math.PI * 2), rng.range(-0.18, 0.18))
    mesh.scale.set(rng.range(0.85, 1.15), rng.range(0.8, 1.05), rng.range(0.85, 1.15))
    mesh.castShadow = true
    group.add(mesh)
  }
  return group
}

// ------------------------------------------------------------- umbrella ---

export interface UmbrellaOpts {
  /** canopy radius (m), default 0.045 */
  radius?: number
  /** pleat count (wedges), default 12 */
  pleats?: number
  /** alternating wedge colors */
  colors?: readonly string[]
  /** stick length below the canopy apex (m), default 0.09 */
  stickLength?: number
}

/**
 * Paper cocktail umbrella: pleated cone (faceted — non-indexed triangles) +
 * bamboo stick. Origin at the BOTTOM of the stick so it can be planted;
 * canopy apex at y = stickLength.
 */
export function paperUmbrella(opts: UmbrellaOpts = {}): THREE.Group {
  const R = opts.radius ?? 0.045
  const pleats = opts.pleats ?? 12
  const colors = opts.colors ?? ['#ff5f6d', '#ffd166', '#4ecdc4', '#ffe8d6']
  const stickLength = opts.stickLength ?? 0.09
  const drop = R * 0.38 // rim sits below the apex by this much

  // faceted pleated canopy: wedge rims alternate radius/depth
  const positions: number[] = []
  const uvs: number[] = []
  const rim: THREE.Vector3[] = []
  const steps = pleats * 2
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2
    const ridge = i % 2 === 0
    const rr = ridge ? R : R * 0.93
    const dy = ridge ? -drop : -drop * 1.12
    rim.push(new THREE.Vector3(Math.cos(a) * rr, dy, Math.sin(a) * rr))
  }
  const apex = new THREE.Vector3(0, 0, 0)
  const uvOf = (p: THREE.Vector3): [number, number] => [
    0.5 + (p.x / R) * 0.48,
    0.5 + (p.z / R) * 0.48,
  ]
  for (let i = 0; i < steps; i++) {
    const a = rim[i]
    const b = rim[i + 1]
    positions.push(apex.x, apex.y, apex.z, b.x, b.y, b.z, a.x, a.y, a.z)
    const ua = uvOf(a)
    const ub = uvOf(b)
    uvs.push(0.5, 0.5, ub[0], ub[1], ua[0], ua[1])
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.computeVertexNormals() // non-indexed → per-face normals → crisp pleats

  const tex = makeCanvasTexture(256, 256, (ctx, w, h) => {
    const cx = w / 2
    const cy = h / 2
    // wedge pie in alternating colors
    for (let i = 0; i < pleats; i++) {
      const a0 = (i / pleats) * Math.PI * 2
      const a1 = ((i + 1) / pleats) * Math.PI * 2
      ctx.fillStyle = colors[i % colors.length]
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, w * 0.5, a0, a1)
      ctx.closePath()
      ctx.fill()
    }
    // concentric paper rings
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 3
    for (const rr of [0.18, 0.34]) {
      ctx.beginPath()
      ctx.arc(cx, cy, w * rr, 0, Math.PI * 2)
      ctx.stroke()
    }
  })
  const canopyMat = new THREE.MeshPhysicalMaterial({
    map: tex,
    roughness: 0.8,
    specularIntensity: 0.3,
    side: THREE.DoubleSide,
  })
  const canopy = new THREE.Mesh(geo, canopyMat)
  canopy.position.y = stickLength
  canopy.castShadow = true

  const stickMat = new THREE.MeshPhysicalMaterial({ color: 0xc9a06a, roughness: 0.7 })
  const stickH = stickLength + 0.004 // pokes just past the apex
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, stickH, 8), stickMat)
  stick.position.y = stickH / 2 // bottom of the stick at the group origin
  stick.castShadow = true

  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 6), stickMat)
  tip.position.y = stickLength + 0.004

  const group = new THREE.Group()
  group.add(canopy, stick, tip)
  return group
}

// -------------------------------------------------------------- pull tab ---

export interface PullTabOpts {
  /** overall length (m), default 0.024 */
  length?: number
  /** overall width (m), default 0.013 */
  width?: number
  material?: THREE.Material
}

/**
 * Can pull-tab: extruded stadium outline with the finger hole + rivet hole.
 * Lies flat in the XZ plane, rivet end at the origin, tab extending +Z.
 */
export function pullTab(opts: PullTabOpts = {}): THREE.Mesh {
  const L = opts.length ?? 0.024
  const W = opts.width ?? 0.013
  const r = W / 2
  const shape = new THREE.Shape()
  // stadium: straight sides, semicircle ends (rivet end at y=0..r, finger end at L)
  shape.moveTo(-r, r)
  shape.lineTo(-r, L - r)
  shape.absarc(0, L - r, r, Math.PI, 0, true)
  shape.lineTo(r, r)
  shape.absarc(0, r, r, 0, Math.PI, true)
  const rivet = new THREE.Path()
  rivet.absarc(0, r * 0.85, r * 0.32, 0, Math.PI * 2, false)
  const finger = new THREE.Path()
  finger.absarc(0, L - r * 1.15, r * 0.62, 0, Math.PI * 2, false)
  shape.holes.push(rivet, finger)
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.0008,
    bevelEnabled: true,
    bevelThickness: 0.0002,
    bevelSize: 0.0002,
    bevelSegments: 2,
    curveSegments: 16,
  })
  geo.rotateX(-Math.PI / 2) // flat, facing up, extending +Z
  const mat =
    opts.material ??
    new THREE.MeshPhysicalMaterial({ color: 0xd6d9dc, metalness: 1, roughness: 0.35 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  return mesh
}

// ---------------------------------------------------------------- handle ---

export interface HandleOpts {
  /** arc radius (m) */
  radius: number
  /** tube radius (m), default radius * 0.16 */
  tube?: number
  /** arc sweep in radians, default π (half circle) */
  arc?: number
  material?: THREE.Material
}

/**
 * Simple handle: torus arc in the XY plane, arc centred on the +X side
 * (sweep from -arc/2 to +arc/2 around the ring's own centre). Attach with
 * position + rotation; mugs/pitchers want rotation.z ≈ ±π/2.
 */
export function handle(opts: HandleOpts): THREE.Mesh {
  const tube = opts.tube ?? opts.radius * 0.16
  const arc = opts.arc ?? Math.PI
  const geo = new THREE.TorusGeometry(opts.radius, tube, 12, 32, arc)
  geo.rotateZ(-arc / 2) // centre the sweep about +X
  const mat =
    opts.material ?? new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  return mesh
}
