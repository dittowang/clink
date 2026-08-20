import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { DrinkVisual } from '../types'
import { TIERS } from '../../config/tiers'
import { Rng } from '../../core/rng'
import { latheFromProfile, type ProfilePoint } from '../lib/profiles'
import { makeCanvasTexture } from '../lib/canvas'
import { noiseCanvas, normalMapFromHeight } from '../lib/noise'
import { waxRind } from '../lib/materials'
import { bentStraw, paperUmbrella } from '../lib/parts'
import { sstep } from '../lib/extra-g78'

/**
 * Tier 8 — pineapple cup. Lathe barrel (bulged middle, tucked ends) wearing a
 * procedural diamond-cell skin: two crossing diagonal groove families + a
 * dark "eye" dot per cell, golden-brown with per-cell tone jitter, height →
 * normal map from the same pixel loop. Crown of 14 extruded leaf blades in
 * two rings (+1 center), per-leaf curl/twist/yaw jitter. Cut top: flesh disc,
 * offset bore with a glossy juice disc, straw, paper umbrella tilted 20°.
 *
 * Dimensions are LAW: R = 0.066, H = 0.260 (config/tiers.ts) — fruit body to
 * y=0.1515, crown to ~0.275 (leaves may exceed the collider a little, per
 * the art brief).
 */

const SEED = 808
const BODY_TOP = 0.1515 // top cut plane
const TOP_R = 0.0505 // body radius at the cut

// -------------------------------------------------------- diamond skin ----

const CELLS_U = 12 // diagonal lines per family around the barrel (wraps)
const CELLS_V = 4.8 // diagonal density along the profile (taller diamonds)

function cellHash(ia: number, ib: number, salt: number): number {
  const wa = ((ia % CELLS_U) + CELLS_U) % CELLS_U // u-wrap invariant cell id
  const wb = ib - ia
  let h = (wa * 374761393 + wb * 668265263 + (SEED + salt) * 2246822519) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

interface SkinMaps {
  map: THREE.CanvasTexture
  normalMap: THREE.CanvasTexture
}

function paintSkin(): SkinMaps {
  const W = 768
  const H = 512
  const height = document.createElement('canvas')
  height.width = W
  height.height = H
  const hctx = height.getContext('2d')!
  const himg = hctx.createImageData(W, H)

  const map = makeCanvasTexture(
    W,
    H,
    (ctx, w, h) => {
      const img = ctx.createImageData(w, h)
      const cd = img.data
      const hd = himg.data
      for (let y = 0; y < h; y++) {
        const v = 1 - y / h // texture space (v=1 at the cut, v=0 at the base)
        for (let x = 0; x < w; x++) {
          const u = x / w
          const a = CELLS_U * u + CELLS_V * v
          const b = CELLS_U * u - CELLS_V * v
          const ia = Math.floor(a)
          const ib = Math.floor(b)
          const fa = a - ia
          const fb = b - ib
          const da = Math.min(fa, 1 - fa)
          const db = Math.min(fb, 1 - fb)
          const d = Math.min(da, db) // 0 at a groove, 0.5 at cell centre
          // pattern fades out over the tucked base (lathe v < ~0.3)
          const fade = sstep(0.17, 0.3, v)
          // height: thin sharp grooves, near-flat plates, small eye spike
          // (a fat dome per cell read as quilted upholstery in capture)
          const plate = sstep(0.02, 0.09, d) // color groove: narrow
          const plateN = sstep(0.03, 0.16, d) // shading groove: a bit wider
          const dome = sstep(0.14, 0.5, d)
          // eye centre jittered per cell so the dots do not sit on a
          // mechanical lattice
          const jx = (cellHash(ia, ib, 3) - 0.5) * 0.16
          const jy = (cellHash(ia, ib, 4) - 0.5) * 0.16
          const dcx = fa - 0.5 - jx
          const dcy = fb - 0.5 - jy
          const dc = Math.hypot(dcx, dcy)
          const eyeR = 0.12 + cellHash(ia, ib, 5) * 0.05
          const eye = 1 - sstep(0.035, eyeR, dc)
          // gentle dome (0.18): enough curvature that every plate takes a
          // light gradient that MOVES with the key as the drink turns, still
          // well under the fat dome that read as quilted upholstery
          let hgt = 0.2 + plateN * 0.42 + dome * 0.18 + eye * 0.26
          hgt = 0.4 + (hgt - 0.4) * fade
          const hi = (y * w + x) * 4
          const hg = Math.max(0, Math.min(255, Math.round(hgt * 255)))
          hd[hi] = hg
          hd[hi + 1] = hg
          hd[hi + 2] = hg
          hd[hi + 3] = 255

          // color: golden-brown ramp + per-cell jitter + dark grooves + eye
          // dot. Ramp: deep amber at the base, golden-brown in the middle, a
          // green breath at the very top under the crown. Authored ~15%
          // deeper/more saturated than the target render — AgX + the warm
          // key + the clearcoat wash lifted the old gold ramp to pale
          // cream-peach (critic), so the pigment goes on darker here.
          let r: number, g2: number, bl: number
          if (v < 0.45) {
            const t = v / 0.45
            r = 158 + (206 - 158) * t
            g2 = 88 + (132 - 88) * t
            bl = 8 + (14 - 8) * t
          } else if (v < 0.88) {
            const t = (v - 0.45) / 0.43
            r = 206 + (192 - 206) * t
            g2 = 132 + (124 - 132) * t
            bl = 14 + (20 - 14) * t
          } else {
            const t = (v - 0.88) / 0.12
            r = 192 + (146 - 192) * t
            g2 = 124 + (116 - 124) * t
            bl = 20 + (30 - 20) * t
          }
          // per-cell tone jitter: brightness ±9%, some cells lean orange,
          // some lean olive
          const j = cellHash(ia, ib, 1)
          const j2 = cellHash(ia, ib, 2)
          const bright = (0.91 + j * 0.17) * fade + (1 - fade)
          r *= bright
          g2 *= bright
          bl *= bright
          if (j2 < 0.25) {
            // orange-leaning cell (kept mild — stronger lean read salmon
            // under the warm key + specular wash)
            r *= 1.04
            g2 *= 0.97
          } else if (j2 > 0.75) {
            // olive-leaning cell
            r *= 0.94
            g2 *= 1.03
            bl *= 0.85
          }
          // grooves darken hard, eye dot darkens the centre
          const grooveK = 1 - (1 - plate) * 0.55 * fade
          const eyeK = 1 - eye * 0.52 * fade
          r *= grooveK * eyeK
          g2 *= grooveK * eyeK
          bl *= grooveK * (1 - eye * 0.35 * fade)
          const ci = (y * w + x) * 4
          cd[ci] = Math.max(0, Math.min(255, Math.round(r)))
          cd[ci + 1] = Math.max(0, Math.min(255, Math.round(g2)))
          cd[ci + 2] = Math.max(0, Math.min(255, Math.round(bl)))
          cd[ci + 3] = 255
        }
      }
      ctx.putImageData(img, 0, 0)
      // organic breakup so the lattice does not read CG-perfect
      const mottle = noiseCanvas(512, 512, 3, SEED + 3, {
        cellsX: 6,
        cellsY: 4,
        range: [-0.2, 1.2],
      })
      ctx.globalCompositeOperation = 'overlay'
      ctx.globalAlpha = 0.18
      ctx.drawImage(mottle, 0, 0, w, h)
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
    },
    { repeat: [1, 1], anisotropy: 8 }
  )
  hctx.putImageData(himg, 0, 0)
  // 5.0 conversion strength: at 2.6 the groove bevels were too shallow to
  // re-shade as the barrel turns and the cells read painted-on (critic)
  const normalMap = makeCanvasTexture(
    W,
    H,
    (ctx) => ctx.drawImage(normalMapFromHeight(height, 5.0), 0, 0),
    { srgb: false, repeat: [1, 1] }
  )
  return { map, normalMap }
}

// --------------------------------------------------------------- leaves ---

/**
 * One crown blade: extruded tapered Shape, UVs remapped to (across, along),
 * indexed via mergeVertices, then curled/twisted per-vertex. Faces stay
 * smooth after computeVertexNormals; the face↔side seam stays crisp.
 */
function bladeGeometry(
  L: number,
  w0: number,
  curl: number,
  twist: number,
  sway: number
): THREE.BufferGeometry {
  const halfW = (t: number): number =>
    0.5 * w0 * (0.35 + 0.65 * Math.sin(Math.PI * Math.pow(t, 0.6))) * (1 - Math.pow(t, 4))
  const shape = new THREE.Shape()
  const N = 11
  shape.moveTo(-halfW(0), 0)
  for (let i = 1; i <= N; i++) {
    const t = i / N
    shape.lineTo(-halfW(t), t * L)
  }
  for (let i = N - 1; i >= 0; i--) {
    const t = i / N
    shape.lineTo(halfW(t), t * L)
  }
  shape.closePath()
  let geo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.0015,
    bevelEnabled: false,
  })
  // remap UVs before bending: across the blade / along the blade
  {
    const pos = geo.getAttribute('position')
    const uv = geo.getAttribute('uv')
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, pos.getX(i) / w0 + 0.5, pos.getY(i) / L)
    }
  }
  geo = mergeVertices(geo, 1e-5)
  const pos = geo.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / L
    let x = pos.getX(i)
    let z = pos.getZ(i)
    // lengthwise twist (rotate the cross-section progressively)
    const beta = twist * t
    const cx = x * Math.cos(beta) - z * Math.sin(beta)
    const cz = x * Math.sin(beta) + z * Math.cos(beta)
    x = cx
    z = cz
    // outward curl + a little sideways sway, both quadratic toward the tip
    z += curl * t * t * L
    x += sway * t * t * L
    pos.setX(i, x)
    pos.setZ(i, z)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

function buildCrown(): THREE.Group {
  const group = new THREE.Group()
  const leafTex = (stops: ReadonlyArray<readonly [number, string]>, salt: number) =>
    makeCanvasTexture(128, 512, (ctx, w, h) => {
      // v=0 (canvas bottom) is the blade base, v=1 the tip
      const g = ctx.createLinearGradient(0, h, 0, 0)
      for (const [o, c] of stops) g.addColorStop(o, c)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      // faint lengthwise striations
      const rand = (() => {
        let t = SEED + salt
        return () => {
          t = (t * 1103515245 + 12345) & 0x7fffffff
          return t / 0x7fffffff
        }
      })()
      for (let i = 0; i < 26; i++) {
        const x = rand() * w
        ctx.strokeStyle = rand() < 0.5 ? 'rgba(10,50,20,0.2)' : 'rgba(190,230,140,0.14)'
        ctx.lineWidth = 1 + rand() * 1.5
        ctx.beginPath()
        ctx.moveTo(x, h)
        ctx.lineTo(x + (rand() - 0.5) * 10, 0)
        ctx.stroke()
      }
    })
  const leafMat = (tex: THREE.Texture) =>
    new THREE.MeshPhysicalMaterial({
      map: tex,
      metalness: 0,
      roughness: 0.42,
      clearcoat: 0.35,
      clearcoatRoughness: 0.25,
      specularIntensity: 0.7,
    })
  // two leaf tones — a flat single green read as plastic aloe in capture
  const mats = [
    leafMat(
      leafTex(
        [
          [0, '#0f4220'],
          [0.4, '#1c6b2e'],
          [0.78, '#2f8f3c'],
          [1, '#71b043'],
        ],
        40
      )
    ),
    leafMat(
      leafTex(
        [
          [0, '#174d24'],
          [0.4, '#2b7d38'],
          [0.78, '#4da24a'],
          [1, '#93c355'],
        ],
        41
      )
    ),
  ]

  // four base blades, reused with scale/rotation jitter — variety without
  // fourteen unique geometries
  const blades = [
    bladeGeometry(0.125, 0.016, 0.22, 0.2, 0.03),
    bladeGeometry(0.105, 0.015, 0.3, -0.25, -0.05),
    bladeGeometry(0.085, 0.0145, 0.38, 0.15, 0.04),
    bladeGeometry(0.07, 0.014, 0.45, -0.2, -0.03),
  ]

  const rng = new Rng(SEED + 5)
  const plant = (
    geoIdx: number,
    azimuth: number,
    plantR: number,
    pitch: number,
    scale: number
  ): void => {
    const m = new THREE.Mesh(blades[geoIdx], mats[rng.next() < 0.5 ? 0 : 1])
    m.position.set(Math.sin(azimuth) * plantR, 0, Math.cos(azimuth) * plantR)
    m.rotation.order = 'YXZ'
    m.rotation.y = azimuth
    m.rotation.x = pitch
    m.scale.setScalar(scale)
    m.castShadow = true
    m.receiveShadow = true
    group.add(m)
  }
  // inner ring: 5 tall, near vertical
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng.range(-0.25, 0.25)
    plant(i % 2, a, 0.008, rng.range(0.1, 0.26), rng.range(0.9, 1.1))
  }
  // outer ring: 8 shorter, splayed
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2 + rng.range(-0.2, 0.2)
    plant(2 + (i % 2), a, 0.017, rng.range(0.55, 0.85), rng.range(0.85, 1.1))
  }
  // one centre spike
  plant(1, rng.range(0, Math.PI * 2), 0.0, rng.range(0.0, 0.06), 1.1)

  // small mound hides the blade bases
  const mound = new THREE.Mesh(
    new THREE.SphereGeometry(0.014, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshPhysicalMaterial({ color: 0x1d5c2a, roughness: 0.6 })
  )
  mound.scale.y = 0.5
  mound.castShadow = true
  mound.receiveShadow = true
  group.add(mound)
  return group
}

// -------------------------------------------------------------- builder ---

export function buildPineapple(): DrinkVisual {
  const def = TIERS[8]
  const R = def.radius // 0.066
  const skin = paintSkin()

  // barrel: bulged middle, both ends tucked, flat contact patch
  const prof: ProfilePoint[] = [
    [0.0005, 0.0008],
    [0.022, 0.0008],
    [0.036, 0.002],
    [0.049, 0.01],
    [0.059, 0.028],
    [0.0648, 0.052],
    [R, 0.08], // widest — exactly the physics footprint
    [0.0645, 0.104],
    [0.06, 0.126],
    [0.054, 0.143],
    [0.0512, 0.1495],
    [TOP_R, BODY_TOP],
  ]
  const bodyGeo = latheFromProfile(prof, 64, { samples: 44 })
  const bodyMat = waxRind({ map: skin.map, normalMap: skin.normalMap, normalScale: 1.5 })
  // THE relight fix: waxRind's clearcoat (0.9) reflects off the CLEARCOAT
  // normal, which defaults to the smooth lathe — so the waxy sheen ignored
  // the cells entirely and laid a uniform wash over the paint (the
  // "painted-on, no light response" read). Give the coat the same cell
  // normals and the sheen breaks per-plate and travels as the drink turns.
  bodyMat.clearcoatNormalMap = skin.normalMap
  bodyMat.clearcoatNormalScale = new THREE.Vector2(1.5, 1.5)
  const body = new THREE.Mesh(bodyGeo, bodyMat)
  body.castShadow = true
  body.receiveShadow = true

  // ---- cut top: flesh disc with a fibrous radial read -------------------
  const faceTex = makeCanvasTexture(512, 512, (ctx, w, h) => {
    const cx = w / 2
    const cy = h / 2
    const rOut = w / 2
    const fg = ctx.createRadialGradient(cx, cy, rOut * 0.05, cx, cy, rOut)
    fg.addColorStop(0, '#e8bd55')
    fg.addColorStop(0.25, '#f2cf6e')
    fg.addColorStop(0.86, '#efc65e')
    fg.addColorStop(0.9, '#c08a2e')
    fg.addColorStop(1, '#8a5a1d')
    ctx.fillStyle = fg
    ctx.beginPath()
    ctx.arc(cx, cy, rOut, 0, Math.PI * 2)
    ctx.fill()
    // radial flesh fibres
    const rand = (() => {
      let t = SEED + 60
      return () => {
        t = (t * 1103515245 + 12345) & 0x7fffffff
        return t / 0x7fffffff
      }
    })()
    for (let i = 0; i < 260; i++) {
      const a = rand() * Math.PI * 2
      const r0 = rOut * (0.12 + rand() * 0.2)
      const r1 = rOut * (0.55 + rand() * 0.32)
      ctx.strokeStyle = rand() < 0.5 ? 'rgba(196,146,50,0.35)' : 'rgba(250,228,150,0.4)'
      ctx.lineWidth = 1 + rand() * 2
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
      ctx.stroke()
    }
    // pale core
    ctx.fillStyle = 'rgba(244,222,160,0.8)'
    ctx.beginPath()
    ctx.arc(cx, cy, rOut * 0.13, 0, Math.PI * 2)
    ctx.fill()
  })
  const faceMat = new THREE.MeshPhysicalMaterial({
    map: faceTex,
    metalness: 0,
    roughness: 0.5,
    specularIntensity: 0.6,
    clearcoat: 0.2,
    clearcoatRoughness: 0.3,
  })
  const face = new THREE.Mesh(new THREE.CircleGeometry(TOP_R, 64), faceMat)
  face.rotation.x = -Math.PI / 2
  face.position.y = BODY_TOP
  face.castShadow = true
  face.receiveShadow = true

  // ---- offset bore with juice, straw, umbrella --------------------------
  const bore = new THREE.Group()
  const boreX = 0.015
  const boreZ = 0.021
  const boreR = 0.013
  const rimMat = new THREE.MeshPhysicalMaterial({
    color: 0x6a4212,
    roughness: 0.55,
    specularIntensity: 0.4,
  })
  const rim = new THREE.Mesh(new THREE.RingGeometry(boreR, boreR + 0.0025, 40), rimMat)
  rim.rotation.x = -Math.PI / 2
  rim.position.set(boreX, BODY_TOP + 0.0004, boreZ)
  const wallMat = new THREE.MeshPhysicalMaterial({
    color: 0xe8c25c,
    roughness: 0.5,
    specularIntensity: 0.5,
  })
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(boreR, boreR - 0.0005, 0.0062, 32, 1, true),
    wallMat
  )
  wall.position.set(boreX, BODY_TOP - 0.0028, boreZ)
  const juiceMat = new THREE.MeshPhysicalMaterial({
    color: 0xef9c15,
    metalness: 0,
    roughness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    specularIntensity: 1,
    envMapIntensity: 1.3,
  })
  const juice = new THREE.Mesh(new THREE.CircleGeometry(boreR - 0.0004, 32), juiceMat)
  juice.rotation.x = -Math.PI / 2
  juice.position.set(boreX, BODY_TOP - 0.0052, boreZ)
  for (const m of [rim, wall, juice]) {
    m.castShadow = true
    m.receiveShadow = true
  }
  bore.add(rim, wall, juice)

  const straw = bentStraw({
    radius: 0.0024,
    bottom: [boreX + 0.002, BODY_TOP - 0.012, boreZ + 0.003],
    bendStart: [boreX + 0.007, 0.205, boreZ + 0.013],
    tip: [boreX + 0.019, 0.228, boreZ + 0.03],
    color: 0xff4fa3,
    stripe: 0xfff4ec,
  })
  straw.receiveShadow = true

  const umbrella = paperUmbrella({
    radius: 0.034,
    pleats: 12,
    stickLength: 0.092,
    colors: ['#ff5f6d', '#ffd166', '#4ecdc4', '#fff3e0'],
  })
  umbrella.position.set(boreX - 0.001, BODY_TOP - 0.005, boreZ)
  // 20° lean AWAY from the crown (out of the leaf cluster); the canopy
  // overhangs the footprint a little — soft visual overlap, per the brief
  umbrella.rotation.z = -0.35
  umbrella.rotation.x = 0.1
  umbrella.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })

  // ---- crown ------------------------------------------------------------
  const crown = buildCrown()
  crown.position.set(0, BODY_TOP - 0.004, -0.006)

  const template = new THREE.Group()
  template.add(body, face, bore, straw, umbrella, crown)
  return { template, height: def.height, radius: def.radius, liquid: null }
}
