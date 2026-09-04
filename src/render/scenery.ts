import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { getQuality } from './quality'

/**
 * Edge decor that makes the sand read as a beach without touching the
 * table: two leaning coconut palms at the top corners, a striped lounger
 * with a folded towel at the left edge, an upright surfboard + beach ball at
 * the right edge, a driftwood log by the water, a few shells by the legs.
 *
 * Everything is procedural (canvas textures, constructed geometry), low-poly,
 * muted, and merged per material — 9 meshes total. The frame's middle third
 * above the table stays clean sand + water: every piece sits at a frame edge
 * or corner, and nothing crosses the table's silhouette from the game camera.
 *
 * With the table-fit camera nothing above ~0.7 m at z ≈ -2 is in frame, so
 * the palm crowns are out of shot by design; what sells them is the trunk
 * entering the corner and the frond shadows on the sand (noon: beside the
 * palms; night: near the table sides; morning/golden: long trunk streaks).
 *
 * Placement rules (verified against every preset's sun):
 *  - the right palm leans seaward/outward: an inward lean would swing its
 *    moon shadow across the plank's near end at night
 *  - the surfboard stands at (2.3, -2.05): the morning sun (17°, from +x)
 *    throws its shadow 3.3× its height toward -x, and any nearer to the
 *    table it would cross the far rail; further right than the palm so the
 *    trunk is not hidden behind it
 *  - shells stay > 0.75 m from the table axis so the elevated camera never
 *    sees one through the plank's near edge
 *
 * Low tier: decor casts no shadows and palms drop to 5 fronds.
 */

export interface Scenery {
  group: THREE.Group
  dispose(): void
}

/** mulberry32 — deterministic so captures are stable */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  return [c, c.getContext('2d')!]
}

function tex(c: HTMLCanvasElement, aniso: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = aniso
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

// ---- textures ----------------------------------------------------------------

/** ring bark: canvas x runs ALONG the trunk (TubeGeometry u), y around it.
 *  Leaf-scar bands every ~12 cm, darker fissures, fine grain. */
function barkTexture(aniso: number): THREE.CanvasTexture {
  const W = 512, H = 128
  const [c, ctx] = canvas(W, H)
  const r = rng(31337)
  ctx.fillStyle = '#8d7a62'
  ctx.fillRect(0, 0, W, H)
  // ring bands: one tile = 1 m of trunk → 8 bands
  const bands = 8
  for (let i = 0; i < bands; i++) {
    const x0 = (i / bands) * W + r() * 6
    const bw = W / bands
    ctx.fillStyle = `rgba(60,46,32,${0.35 + r() * 0.25})`
    ctx.fillRect(x0, 0, 5 + r() * 4, H)
    ctx.fillStyle = `rgba(190,170,140,${0.18 + r() * 0.15})`
    ctx.fillRect(x0 + 9, 0, 6, H)
    // lighter mid-band
    ctx.fillStyle = `rgba(160,140,112,${0.15 + r() * 0.15})`
    ctx.fillRect(x0 + bw * 0.35, 0, bw * 0.3, H)
  }
  // vertical fissures (around the trunk = y): short dark dashes
  for (let k = 0; k < 160; k++) {
    ctx.fillStyle = `rgba(55,40,28,${0.15 + r() * 0.3})`
    ctx.fillRect(r() * W, r() * H, 2 + r() * 5, 1 + r() * 2)
  }
  const img = ctx.getImageData(0, 0, W, H)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 22
    d[i] += n; d[i + 1] += n; d[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)
  return tex(c, aniso)
}

/** two-tone stripes along canvas x */
function stripeTexture(a: string, b: string, stripes: number, aniso: number): THREE.CanvasTexture {
  const W = 256, H = 32
  const [c, ctx] = canvas(W, H)
  const w = W / stripes
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? b : a
    ctx.fillRect(Math.floor(i * w), 0, Math.ceil(w) + 1, H)
  }
  // woven look: faint cross hatch
  ctx.fillStyle = 'rgba(0,0,0,0.06)'
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1)
  return tex(c, aniso)
}

/** surfboard deck: cream, bold coral band across, thin centre stringer.
 *  canvas x = board width, y = board length (nose at the top) */
function boardTexture(aniso: number): THREE.CanvasTexture {
  const W = 128, H = 512
  const [c, ctx] = canvas(W, H)
  ctx.fillStyle = '#efe6d2'
  ctx.fillRect(0, 0, W, H)
  // band in the lower half: the nose is cropped by the frame top in play
  ctx.fillStyle = '#d9694f'
  ctx.fillRect(0, H * 0.5, W, H * 0.17)
  ctx.fillStyle = '#2f5d6e'
  ctx.fillRect(0, H * 0.67, W, H * 0.04)
  ctx.fillStyle = 'rgba(60,45,30,0.55)'
  ctx.fillRect(W / 2 - 1.5, 0, 3, H)
  return tex(c, aniso)
}

/** beach ball: six longitude panels (canvas x = u around) */
function ballTexture(aniso: number): THREE.CanvasTexture {
  const W = 384, H = 64
  const [c, ctx] = canvas(W, H)
  const cols = ['#e9e2d2', '#d95f4b', '#e9e2d2', '#2f7fa3', '#e9e2d2', '#e3b23c']
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = cols[i]
    ctx.fillRect(i * (W / 6), 0, W / 6 + 1, H)
  }
  return tex(c, aniso)
}

// ---- geometry helpers ------------------------------------------------------------

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3(1, 1, 1)

function placed(g: THREE.BufferGeometry, pos: THREE.Vector3, rot: THREE.Euler): THREE.BufferGeometry {
  _m.compose(pos, _q.setFromEuler(rot), _s)
  g.applyMatrix4(_m)
  return g
}

/** merged mesh from a list of geometries; the parts are disposed */
function merged(parts: THREE.BufferGeometry[], mat: THREE.Material, name: string): THREE.Mesh {
  const g = mergeGeometries(parts, false)!
  for (const p of parts) p.dispose()
  const m = new THREE.Mesh(g, mat)
  m.name = name
  return m
}

// ---- palm --------------------------------------------------------------------

interface PalmSpec {
  base: THREE.Vector3
  /** horizontal lean direction (unit-ish) and how far the crown ends up
   *  from the base as a fraction of height */
  lean: THREE.Vector2
  leanAmt: number
  height: number
  fronds: number
  /** crown centre direction (radians about +Y, 0 = +X): the fronds fan over
   *  a 190° arc around it. Lopsided AWAY from the table because the golden
   *  sun stands behind the palms: a frond hanging at 2–2.6 m over
   *  |x| < 0.9 would lay its shadow across the plank */
  crownDir: number
  seed: number
}

/** trunk: curved tube, radius tapering base→top with a flared foot */
function trunkGeometry(spec: PalmSpec): { geo: THREE.BufferGeometry; top: THREE.Vector3; tangent: THREE.Vector3 } {
  const r = rng(spec.seed)
  const pts: THREE.Vector3[] = []
  const N = 6
  const side = new THREE.Vector2(-spec.lean.y, spec.lean.x)
  for (let i = 0; i <= N; i++) {
    const s = i / N
    const off = spec.leanAmt * spec.height * Math.pow(s, 1.5)
    const wob = 0.06 * Math.sin(s * Math.PI * 1.3 + r() * 0.4)
    pts.push(new THREE.Vector3(
      spec.base.x + spec.lean.x * off + side.x * wob,
      spec.base.y + spec.height * s,
      spec.base.z + spec.lean.y * off + side.y * wob
    ))
  }
  const curve = new THREE.CatmullRomCurve3(pts)
  const TUB = 14, RAD = 8, R0 = 0.13
  const geo = new THREE.TubeGeometry(curve, TUB, R0, RAD, false)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const c = new THREE.Vector3()
  const v = new THREE.Vector3()
  for (let i = 0; i <= TUB; i++) {
    const s = i / TUB
    curve.getPointAt(s, c)
    // 1.0 → 0.62 taper, flared foot in the bottom 10%
    const k = THREE.MathUtils.lerp(1.0, 0.62, s) * (1 + 0.7 * Math.max(0, 1 - s / 0.1))
    for (let j = 0; j <= RAD; j++) {
      const idx = i * (RAD + 1) + j
      v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(k).add(c)
      pos.setXYZ(idx, v.x, v.y, v.z)
    }
  }
  // bark tile = 1 m along the trunk (u), once around (v)
  const uv = geo.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * spec.height)
  geo.computeVertexNormals()
  const top = curve.getPointAt(1)
  const tangent = curve.getTangentAt(1)
  return { geo, top, tangent }
}

/** one frond: tapered blade with notched leaflet edges (Shape), then bent
 *  down along its length and folded across the midrib. Local frame: +X
 *  along the frond, +Y up, Z across. Vertex colour = base→tip gradient. */
function frondGeometry(len: number, width: number, droop: number, r: () => number): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  const M = 14 // notches per side
  const half = (x: number): number => width * Math.pow(Math.sin(Math.PI * Math.pow(x / len, 0.75)), 0.9)
  shape.moveTo(0, 0)
  for (let i = 1; i <= M; i++) {
    const x = (i / M) * len
    const notch = i % 2 ? 1 : 0.5
    shape.lineTo(x, half(x) * notch * (0.9 + r() * 0.2))
  }
  shape.lineTo(len, 0)
  for (let i = M - 1; i >= 1; i--) {
    const x = (i / M) * len
    const notch = i % 2 ? 1 : 0.5
    shape.lineTo(x, -half(x) * notch * (0.9 + r() * 0.2))
  }
  shape.closePath()
  const g = new THREE.ShapeGeometry(shape, 1)
  const pos = g.attributes.position as THREE.BufferAttribute
  const col = new Float32Array(pos.count * 3)
  const cBase = new THREE.Color(0x4a6f34)
  const cTip = new THREE.Color(0x8fae5a)
  const tmp = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getY(i)
    const t = x / len
    // droop: quadratic sag along the length; leaflets hang off the midrib
    const y = -droop * t * t * len - Math.abs(z) * 0.5
    pos.setXYZ(i, x, y, z)
    tmp.copy(cBase).lerp(cTip, t)
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.computeVertexNormals()
  return g
}

function buildPalm(
  spec: PalmSpec,
  out: { bark: THREE.BufferGeometry[]; fronds: THREE.BufferGeometry[] }
): void {
  const r = rng(spec.seed * 7 + 1)
  const { geo, top, tangent } = trunkGeometry(spec)
  out.bark.push(geo)
  // crown pivot: a little past the trunk top along its tangent
  const crown = top.clone().addScaledVector(tangent, 0.1)
  const up = new THREE.Vector3()
  const rot = new THREE.Euler()
  // 190°: the extreme fronds point ±z with no component toward the table
  const ARC = THREE.MathUtils.degToRad(190)
  for (let k = 0; k < spec.fronds; k++) {
    const yaw = spec.crownDir - ARC / 2 + ((k + 0.5) / spec.fronds) * ARC + (r() - 0.5) * 0.3
    // three tiers: upper fronds rise, lower ones hang
    const tier = k % 3
    const pitch = -0.1 - tier * 0.32 - r() * 0.2
    const len = 1.7 + r() * 0.5
    const f = frondGeometry(len, 0.19 + r() * 0.05, 0.35 + tier * 0.12, r)
    rot.set(0, yaw, pitch, 'YXZ')
    placed(f, crown, rot)
    out.fronds.push(f)
  }
  // coconuts tucked under the crown (their shadow is a dot; cheap spheres)
  for (let k = 0; k < 3; k++) {
    const a = r() * Math.PI * 2
    const nut = new THREE.SphereGeometry(0.09, 7, 5)
    up.set(Math.cos(a) * 0.16, -0.14 - r() * 0.06, Math.sin(a) * 0.16).add(crown)
    placed(nut, up, rot.set(0, 0, 0))
    out.bark.push(nut)
  }
}

// ---- surfboard --------------------------------------------------------------------

function boardOutline(len: number, w: number): THREE.Shape {
  const shape = new THREE.Shape()
  const N = 36
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2
    const y = Math.sin(a) * len * 0.5
    let hw = Math.cos(a) * w * 0.5
    // pointed nose (top), squash tail (bottom)
    const t = y / (len * 0.5)
    if (t > 0) hw *= 1 - 0.55 * THREE.MathUtils.smoothstep(t, 0.25, 1)
    else hw *= 1 - 0.12 * THREE.MathUtils.smoothstep(-t, 0.6, 1)
    pts.push(new THREE.Vector2(hw, y))
  }
  shape.setFromPoints(pts)
  return shape
}

// ---- starfish / shell -------------------------------------------------------------

function starfishGeometry(rad: number): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const rr = i % 2 ? rad * 0.42 : rad
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y)
  }
  shape.closePath()
  const g = new THREE.ExtrudeGeometry(shape, { depth: rad * 0.28, bevelEnabled: false })
  g.rotateX(-Math.PI / 2)
  return g
}

function shellGeometry(rad: number): THREE.BufferGeometry {
  // a fan: half sphere squashed flat, slight ridge pattern via the segments
  const g = new THREE.SphereGeometry(rad, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2)
  g.scale(1, 0.32, 0.85)
  return g
}

// ---- build --------------------------------------------------------------------------

export function createScenery(maxAniso: number): Scenery {
  const q = getQuality()
  const low = q.tier === 'low'
  const group = new THREE.Group()
  group.name = 'scenery'
  const geos: THREE.BufferGeometry[] = []
  const mats: THREE.Material[] = []
  const texs: THREE.Texture[] = []

  const add = (m: THREE.Mesh): THREE.Mesh => {
    m.castShadow = !low
    m.receiveShadow = true
    group.add(m)
    geos.push(m.geometry)
    return m
  }

  // --- materials (shared) ---
  const bark = barkTexture(maxAniso)
  texs.push(bark)
  const barkMat = new THREE.MeshStandardMaterial({ map: bark, roughness: 0.92, metalness: 0 })
  const frondMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide,
  })
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xd9cdb4, roughness: 0.7, metalness: 0 })
  const canvasTex = stripeTexture('#e8dcc3', '#3d7f8c', 8, maxAniso)
  const towelTex = stripeTexture('#f0e3c9', '#d5735a', 6, maxAniso)
  texs.push(canvasTex, towelTex)
  const canvasMat = new THREE.MeshStandardMaterial({ map: canvasTex, roughness: 0.9, side: THREE.DoubleSide })
  const towelMat = new THREE.MeshStandardMaterial({ map: towelTex, roughness: 0.95 })
  const boardTex = boardTexture(maxAniso)
  texs.push(boardTex)
  const boardMat = new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.35, metalness: 0 })
  const ballTex = ballTexture(maxAniso)
  texs.push(ballTex)
  const ballMat = new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.45, metalness: 0 })
  // shells + starfish share one vertex-coloured material (one mesh)
  const shellMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })
  mats.push(barkMat, frondMat, frameMat, canvasMat, towelMat, boardMat, ballMat, shellMat)

  // --- palms + driftwood → one bark mesh, one frond mesh ---
  const palmParts = { bark: [] as THREE.BufferGeometry[], fronds: [] as THREE.BufferGeometry[] }
  const fronds = low ? 5 : 8
  buildPalm({
    base: new THREE.Vector3(-1.75, 0, -2.0),
    lean: new THREE.Vector2(0.55, -0.85).normalize(), // inward + seaward
    leanAmt: 0.28, height: 3.6, fronds, crownDir: Math.PI, seed: 11,
  }, palmParts)
  buildPalm({
    base: new THREE.Vector3(1.9, 0, -2.25),
    lean: new THREE.Vector2(0.35, -0.95).normalize(), // seaward, a touch outward
    leanAmt: 0.24, height: 3.9, fronds: fronds + (low ? 0 : 1), crownDir: 0, seed: 23,
  }, palmParts)
  {
    // driftwood: bent log by the water at the left edge, half sunk
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-3.1, 0.02, -2.15),
      new THREE.Vector3(-2.6, 0.06, -2.28),
      new THREE.Vector3(-2.1, 0.03, -2.3),
      new THREE.Vector3(-1.75, -0.02, -2.42),
    ])
    const log = new THREE.TubeGeometry(c, 10, 0.075, 7, false)
    const uv = log.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 1.6)
    palmParts.bark.push(log)
  }
  add(merged(palmParts.bark, barkMat, 'bark'))
  add(merged(palmParts.fronds, frondMat, 'fronds'))

  // --- lounger + towel at the left edge (cropped by the frame) ---
  {
    const cx = -1.85, cz = -0.35
    const yaw = 0.18
    const rot = new THREE.Euler(0, yaw, 0)
    const frame: THREE.BufferGeometry[] = []
    const local = (x: number, y: number, z: number): THREE.Vector3 =>
      new THREE.Vector3(x, y, z).applyEuler(rot).add(new THREE.Vector3(cx, 0, cz))
    const place = (g: THREE.BufferGeometry, x: number, y: number, z: number, extra?: THREE.Euler): THREE.BufferGeometry => {
      const e = extra ? new THREE.Euler(extra.x, yaw + extra.y, extra.z, 'YXZ') : rot
      return placed(g, local(x, y, z), e)
    }
    // legs, side rails, a cross bar, back rest posts
    for (const sx of [-1, 1]) {
      for (const sz of [-0.55, 0.55]) frame.push(place(new THREE.BoxGeometry(0.035, 0.3, 0.035), sx * 0.3, 0.15, sz))
      frame.push(place(new THREE.BoxGeometry(0.035, 0.045, 1.3), sx * 0.3, 0.32, 0))
      frame.push(place(new THREE.BoxGeometry(0.035, 0.035, 0.62), sx * 0.3, 0.55, 0.78, new THREE.Euler(-0.95, 0, 0)))
    }
    frame.push(place(new THREE.BoxGeometry(0.6, 0.03, 0.035), 0, 0.3, -0.6))
    add(merged(frame, frameMat, 'lounger-frame'))
    // fabric: seat + reclined back, stripes running across
    const seat = place(new THREE.PlaneGeometry(0.58, 1.15), 0, 0.345, 0.03, new THREE.Euler(-Math.PI / 2, 0, 0))
    // back: same 54° slope as the posts (Rx(θ)·+Y = (0, cos θ, sin θ) → θ = 0.62)
    const back = place(new THREE.PlaneGeometry(0.58, 0.6), 0, 0.56, 0.77, new THREE.Euler(0.62, 0, 0))
    add(merged([seat, back], canvasMat, 'lounger-canvas'))
    // folded towel on the seat
    add(new THREE.Mesh(place(new THREE.BoxGeometry(0.3, 0.07, 0.22), 0.02, 0.385, -0.15, new THREE.Euler(0, 0.25, 0)), towelMat)).name = 'towel'
  }

  // --- surfboard upright at the right edge, tail buried ---
  {
    const shape = boardOutline(1.95, 0.5)
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 0.055, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1,
    })
    // extrude UVs are shape-space (x, y): map the deck canvas onto them
    boardTex.repeat.set(1 / 0.5, 1 / 1.95)
    boardTex.offset.set(0.5, 0.5)
    // angled toward the camera, leaning back a little; 15 cm in the sand
    placed(g, new THREE.Vector3(2.3, 0.975 - 0.15, -2.05), new THREE.Euler(-0.12, 0.45, 0.06, 'YXZ'))
    add(new THREE.Mesh(g, boardMat)).name = 'surfboard'
  }

  // --- beach ball, slightly sunk ---
  {
    const g = new THREE.SphereGeometry(0.16, 16, 12)
    placed(g, new THREE.Vector3(2.05, 0.145, -1.3), new THREE.Euler(0.3, 0.9, 0.2))
    add(new THREE.Mesh(g, ballMat)).name = 'ball'
  }

  // --- shells + starfish by the legs (tiny; outside the plank's silhouette) ---
  {
    const r = rng(99)
    const shells: THREE.BufferGeometry[] = []
    const tint = (g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry => {
      const n = g.attributes.position.count
      const c = new THREE.Color(hex)
      const arr = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
      return g
    }
    const spots: Array<[number, number]> = [[-0.82, 0.5], [0.88, 0.22], [-0.8, -0.58], [0.92, -0.72], [-0.72, -1.18]]
    for (const [x, z] of spots) {
      shells.push(tint(placed(shellGeometry(0.03 + r() * 0.012), new THREE.Vector3(x, 0.004, z), new THREE.Euler(0, r() * Math.PI * 2, 0)), 0xe6d9c4))
    }
    // the starfish is non-indexed (Extrude); convert so the merge stays uniform
    const star = tint(placed(starfishGeometry(0.045), new THREE.Vector3(0.78, 0.004, -1.28), new THREE.Euler(0, 0.6, 0)), 0xc9704e)
    shells.push(star)
    for (let i = 0; i < shells.length; i++) if (shells[i].index) shells[i] = shells[i].toNonIndexed()
    add(merged(shells, shellMat, 'shells'))
  }

  return {
    group,
    dispose() {
      group.removeFromParent()
      for (const g of geos) g.dispose()
      for (const m of mats) m.dispose()
      for (const t of texs) t.dispose()
    },
  }
}
