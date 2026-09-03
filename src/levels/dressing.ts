import * as THREE from 'three'
import { TABLE, SURFACE_Y, NEAR_Z, FAR_Z } from '../config/table'
import type { LevelDef } from '../config/levels'

/**
 * Per-level scenery: the parasol (noon obstacle levels), night string lights
 * ("so glass glows"), and the wet-patch decal. Pure visuals — the matching
 * colliders (pole, wet strip) are created by the level scene through
 * PhysicsWorld. update() drives the gust sway so the umbrella fringe and the
 * light strands read the same wind the physics applies.
 *
 * Table-attached pieces (posts, strands, wet decal) live inside a pivot that
 * mirrors the table tilt exactly, so sloped levels keep them glued to the
 * plank. The umbrella stands in the sand and stays vertical.
 */

interface Disposable {
  geo: THREE.BufferGeometry[]
  mats: THREE.Material[]
  tex: THREE.Texture[]
}

export interface Dressing {
  group: THREE.Group
  update(dt: number, time: number, gust01: number, gustDirX: number): void
  dispose(): void
}

// ---- canvas helpers (procedural textures only, per the brief) ----

function stripeTexture(panels: number): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 32
  const g = c.getContext('2d')!
  const colors = ['#f2e2c4', '#e2664a']
  const w = c.width / panels
  for (let i = 0; i < panels; i++) {
    g.fillStyle = colors[i % 2]
    g.fillRect(Math.floor(i * w), 0, Math.ceil(w) + 1, c.height)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = THREE.RepeatWrapping
  return t
}

function wetAlphaTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, 128, 128)
  // soft rounded blob with ragged edge — reads as a spill, not a sticker
  g.translate(64, 64)
  g.fillStyle = '#fff'
  g.filter = 'blur(7px)'
  g.beginPath()
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2
    const r = 46 + 8 * Math.sin(a * 3 + 1.7) + 5 * Math.sin(a * 7 + 0.4)
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r * 0.9
    if (i === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  g.closePath()
  g.fill()
  return new THREE.CanvasTexture(c)
}

// ---- umbrella ----

const PLEATS = 10
// Canopy rim sits ABOVE the game camera's top-edge ray: with the table-fit
// camera at ~42° elevation the frame's top edge passes ~2.1 m over the near
// half of the canopy, so a rim below that eats the top fifth of the screen.
// 2.2 m is also simply how tall a real beach umbrella stands. Radius −12% vs
// the original so the plank is shaded but the sand still shows around it.
// The POLE COLLIDER (world.addPole) is untouched — gameplay-verified.
const CANOPY_R = 0.75
const CANOPY_TOP_Y = 2.54
const CANOPY_BASE_Y = 2.22
const FRINGE_SCALLOPS = 22

function pleatScale(ang: number): number {
  // seams dip inward between panels
  return 1 - 0.05 * (0.5 + 0.5 * Math.cos(PLEATS * ang))
}

function buildCanopy(d: Disposable): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(0.015, CANOPY_R, CANOPY_TOP_Y - CANOPY_BASE_Y, 96, 4, true)
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const s = pleatScale(Math.atan2(x, z))
    pos.setX(i, x * s)
    pos.setZ(i, z * s)
  }
  geo.computeVertexNormals()
  const tex = stripeTexture(PLEATS)
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.85,
    side: THREE.DoubleSide,
  })
  d.geo.push(geo)
  d.mats.push(mat)
  d.tex.push(tex)
  const m = new THREE.Mesh(geo, mat)
  m.castShadow = true
  return m
}

function buildFringe(d: Disposable): THREE.Mesh {
  // strip with a scalloped lower edge, hand-rolled so the scallops are real
  const segs = 128
  const verts = new Float32Array((segs + 1) * 2 * 3)
  const uvs = new Float32Array((segs + 1) * 2 * 2)
  const idx: number[] = []
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2
    const r = CANOPY_R * pleatScale(a) * 0.995
    const x = Math.sin(a) * r
    const z = Math.cos(a) * r
    const drop = 0.026 + 0.024 * Math.abs(Math.sin((FRINGE_SCALLOPS / 2) * a))
    const o = i * 6
    verts[o] = x
    verts[o + 1] = 0
    verts[o + 2] = z
    verts[o + 3] = x
    verts[o + 4] = -drop
    verts[o + 5] = z
    uvs[i * 4] = i / segs
    uvs[i * 4 + 1] = 1
    uvs[i * 4 + 2] = i / segs
    uvs[i * 4 + 3] = 0
    if (i < segs) {
      const v = i * 2
      idx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  const mat = new THREE.MeshStandardMaterial({
    color: 0xe2664a,
    roughness: 0.9,
    side: THREE.DoubleSide,
  })
  d.geo.push(geo)
  d.mats.push(mat)
  return new THREE.Mesh(geo, mat)
}

interface Umbrella {
  group: THREE.Group
  /** canopy + fringe pivot (at the pole top) — swayed by the wind */
  head: THREE.Group
  /** world position of the fringe rim base (string-light anchor) */
  topY: number
}

function buildUmbrella(x: number, z: number, d: Disposable): Umbrella {
  const group = new THREE.Group()
  group.position.set(x, 0, z)

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.72 })
  d.mats.push(woodMat)

  const poleGeo = new THREE.CylinderGeometry(0.019, 0.024, 2.06, 12)
  d.geo.push(poleGeo)
  const pole = new THREE.Mesh(poleGeo, woodMat)
  pole.position.y = 1.03
  pole.castShadow = true
  group.add(pole)

  // collar ring sells the hole in the plank the pole runs through
  const collarGeo = new THREE.TorusGeometry(0.031, 0.009, 8, 24)
  d.geo.push(collarGeo)
  const collarMat = new THREE.MeshStandardMaterial({ color: 0x6b5136, roughness: 0.8 })
  d.mats.push(collarMat)
  const collar = new THREE.Mesh(collarGeo, collarMat)
  collar.rotation.x = Math.PI / 2
  collar.position.y = SURFACE_Y + 0.006
  group.add(collar)

  // head pivots at the pole top so gust sway hinges like a real parasol
  const head = new THREE.Group()
  head.position.y = CANOPY_TOP_Y
  group.add(head)

  const canopy = buildCanopy(d)
  canopy.position.y = -(CANOPY_TOP_Y - CANOPY_BASE_Y) / 2
  head.add(canopy)

  const fringe = buildFringe(d)
  fringe.position.y = CANOPY_BASE_Y - CANOPY_TOP_Y
  head.add(fringe)

  const finialGeo = new THREE.SphereGeometry(0.03, 12, 8)
  d.geo.push(finialGeo)
  const finial = new THREE.Mesh(finialGeo, woodMat)
  finial.position.y = 0.02
  head.add(finial)

  return { group, head, topY: CANOPY_BASE_Y }
}

// ---- string lights ----

const BULB_GEO_DETAIL = [8, 6] as const

interface Strand {
  bulbs: THREE.InstancedMesh
  cord: THREE.Line
}

function buildStrand(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  sag: number,
  bulbCount: number,
  bulbMat: THREE.Material,
  cordMat: THREE.LineBasicMaterial,
  d: Disposable
): Strand {
  const pts: THREE.Vector3[] = []
  const N = 24
  for (let i = 0; i <= N; i++) {
    const u = i / N
    const p = new THREE.Vector3().lerpVectors(p0, p1, u)
    p.y -= sag * 4 * u * (1 - u) // parabolic catenary approximation
    pts.push(p)
  }
  const cordGeo = new THREE.BufferGeometry().setFromPoints(pts)
  d.geo.push(cordGeo)
  const cord = new THREE.Line(cordGeo, cordMat)

  const bulbGeo = new THREE.SphereGeometry(0.0095, BULB_GEO_DETAIL[0], BULB_GEO_DETAIL[1])
  d.geo.push(bulbGeo)
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, bulbCount)
  const m = new THREE.Matrix4()
  for (let i = 0; i < bulbCount; i++) {
    const u = (i + 0.5) / bulbCount
    const p = new THREE.Vector3().lerpVectors(p0, p1, u)
    p.y -= sag * 4 * u * (1 - u) + 0.012 // hang just below the cord
    m.setPosition(p)
    bulbs.setMatrixAt(i, m)
  }
  bulbs.instanceMatrix.needsUpdate = true
  return { bulbs, cord }
}

// ---- assembly ----

export function createDressing(def: LevelDef, halfW: number): Dressing {
  const d: Disposable = { geo: [], mats: [], tex: [] }
  const group = new THREE.Group()
  group.name = 'dressing'
  const mods = def.mods ?? {}
  const slopeRad = ((mods.slopeDeg ?? 0) * Math.PI) / 180

  // pivot mirroring the table tilt — everything attached to the plank goes here
  const tabled = new THREE.Group()
  tabled.position.y = SURFACE_Y
  tabled.rotation.x = slopeRad
  const tabledInner = new THREE.Group()
  tabledInner.position.y = -SURFACE_Y
  tabled.add(tabledInner)
  group.add(tabled)

  let umbrella: Umbrella | null = null
  if (mods.umbrella) {
    umbrella = buildUmbrella(mods.umbrella.x, mods.umbrella.z, d)
    group.add(umbrella.group)
  }

  if (mods.wetPatch) {
    const wp = mods.wetPatch
    const geo = new THREE.PlaneGeometry(wp.w, wp.l)
    const alpha = wetAlphaTexture()
    // wet wood: darkened albedo, tight specular, a little env sheen
    const mat = new THREE.MeshStandardMaterial({
      color: 0x54402c,
      roughness: 0.14,
      metalness: 0,
      envMapIntensity: 0.9,
      transparent: true,
      opacity: 0.88,
      alphaMap: alpha,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
    d.geo.push(geo)
    d.mats.push(mat)
    d.tex.push(alpha)
    const decal = new THREE.Mesh(geo, mat)
    decal.rotation.x = -Math.PI / 2
    decal.position.set(wp.x, SURFACE_Y + 0.0015, wp.z)
    decal.receiveShadow = true
    tabledInner.add(decal)
  }

  // night: warm string lights so the glass glows. With an umbrella they run
  // fringe → rail posts; without one they run along catenaries over the rails.
  const lights = new THREE.Group()
  const strands: Strand[] = []
  if (def.preset === 'night') {
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0x3a2a18,
      emissive: 0xffbe66,
      emissiveIntensity: 2.5, // blooms gently at the post chain's 1.0 threshold
      roughness: 0.4,
    })
    const cordMat = new THREE.LineBasicMaterial({ color: 0x241a10 })
    d.mats.push(bulbMat, cordMat)

    const postMat = new THREE.MeshStandardMaterial({ color: 0x6e5335, roughness: 0.8 })
    d.mats.push(postMat)
    const postGeo = new THREE.CylinderGeometry(0.011, 0.013, 0.72, 8)
    d.geo.push(postGeo)
    const postTop = SURFACE_Y + 0.55
    const removed = mods.removeRails ?? []
    const postX = halfW + TABLE.RAIL_T + 0.015
    const corners: THREE.Vector3[] = []
    const addPost = (x: number, z: number): void => {
      const p = new THREE.Mesh(postGeo, postMat)
      p.position.set(x, postTop - 0.36, z)
      p.castShadow = true
      tabledInner.add(p)
      corners.push(new THREE.Vector3(x, postTop, z))
    }
    // clamped outside the rails so drinks can never reach them; sides with a
    // removed rail get no posts (the open side stays truly open)
    const sides: Array<{ sign: 1 | -1; name: 'left' | 'right' }> = [
      { sign: -1, name: 'left' },
      { sign: 1, name: 'right' },
    ]
    for (const s of sides) {
      if (removed.includes(s.name)) continue
      addPost(s.sign * postX, NEAR_Z - 0.04)
      addPost(s.sign * postX, FAR_Z + 0.02)
    }
    const strand = (a: THREE.Vector3, b: THREE.Vector3, sag: number, n: number): void => {
      const s = buildStrand(a, b, sag, n, bulbMat, cordMat, d)
      lights.add(s.cord, s.bulbs)
      strands.push(s)
    }
    if (umbrella) {
      // fringe rim → each post
      for (const c of corners) {
        const rim = new THREE.Vector3(mods.umbrella!.x, umbrella.topY, mods.umbrella!.z)
        const dir = new THREE.Vector3().subVectors(c, rim).setY(0).normalize()
        rim.addScaledVector(dir, CANOPY_R * 0.92)
        strand(rim, c, 0.1, 12)
      }
    } else {
      // along the side rails (post to post) + across the far rail
      const pairs: Array<[THREE.Vector3, THREE.Vector3]> = []
      for (let i = 0; i + 1 < corners.length; i += 2) pairs.push([corners[i], corners[i + 1]])
      // far cross-strand between the two far posts when both sides stand
      const far = corners.filter((c) => c.z < 0)
      if (far.length === 2) pairs.push([far[0], far[1]])
      for (const [a, b] of pairs) strand(a, b, 0.13, 16)
    }
    tabledInner.add(lights)
  }

  return {
    group,
    update(_dt, time, gust01, gustDirX) {
      if (umbrella) {
        // hinge at the pole top: lean away from the gust + a slow bob
        const lean = gust01 * 0.055
        umbrella.head.rotation.z = -gustDirX * lean + Math.sin(time * 2.1) * 0.008 * (0.3 + gust01)
        umbrella.head.rotation.x = Math.sin(time * 1.3) * 0.006 * (0.3 + gust01)
      }
      if (strands.length > 0) {
        // strands breathe with the gust — small lateral shift, cheap and legible
        lights.position.x = gustDirX * gust01 * 0.022 + Math.sin(time * 1.7) * 0.004 * gust01
        lights.rotation.z = -gustDirX * gust01 * 0.012
      }
    },
    dispose() {
      group.removeFromParent()
      for (const g of d.geo) g.dispose()
      for (const m of d.mats) m.dispose()
      for (const t of d.tex) t.dispose()
    },
  }
}
