import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { DrinkVisual } from '../types'
import { TIERS } from '../../config/tiers'
import { paperboard } from '../lib/materials'
import { makeCanvasTexture, paintRoundel, paintStar, paintText, paintWave } from '../lib/canvas'
import { bentStraw } from '../lib/parts'

/**
 * Tier 1 — paper juice box. Tetra-brick lofted from rounded-square cross
 * sections that pinch into a gable seam at the top (fin ridge + two folded
 * side ears), glossy bent straw rising through the sloped panel near a
 * corner. Label wraps the perimeter: deep GRAPE-purple body band (>= half
 * height), cream top, grape-bunch roundel on the front.
 *
 * Why grape: at game distance (40–60 px) the old warm-orange band collapsed
 * into the tier-3 cola can's red — the two most common table neighbours
 * read as one colour. Purple sits ~80° of hue away from cola red AND a full
 * value step darker, so the pair separates on hue OR value alone.
 *
 * All dimensions in metres. R = 0.026, H = 0.105 (config/tiers.ts) — the
 * 0.037 x 0.037 square footprint's half-diagonal is 0.0262 ~= R.
 */

const HW = 0.0185 // half width of the square section
const CR = 0.0026 // corner radius of the section
const H = 0.105

interface OutlinePt {
  x: number
  z: number
}

/**
 * Closed rounded-rect outline in the XZ plane (first point NOT repeated).
 * Starts at back-center (0, -hz) and walks -X first, so the FRONT (+Z) face
 * center lands at u = 0.5 and the texture seam hides at the back. Point
 * counts are fixed so every ring of the loft matches vertex-for-vertex.
 */
function outline(hx: number, hz: number, cr: number): OutlinePt[] {
  const pts: OutlinePt[] = []
  const seg = (x0: number, z0: number, x1: number, z1: number, n: number, skipLast = false) => {
    const last = skipLast ? n - 1 : n
    for (let i = 1; i <= last; i++) {
      const t = i / n
      pts.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t })
    }
  }
  const arc = (cx: number, cz: number, a0: number, a1: number, n: number) => {
    for (let i = 1; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n
      pts.push({ x: cx + cr * Math.cos(a), z: cz + cr * Math.sin(a) })
    }
  }
  const q = Math.PI / 2
  pts.push({ x: 0, z: -hz })
  seg(0, -hz, -(hx - cr), -hz, 3)
  arc(-(hx - cr), -(hz - cr), -q, -2 * q, 4)
  seg(-hx, -(hz - cr), -hx, hz - cr, 5)
  arc(-(hx - cr), hz - cr, 2 * q, q, 4)
  seg(-(hx - cr), hz, hx - cr, hz, 6)
  arc(hx - cr, hz - cr, q, 0, 4)
  seg(hx, hz - cr, hx, -(hz - cr), 5)
  arc(hx - cr, -(hz - cr), 0, -q, 4)
  seg(hx - cr, -hz, 0, -hz, 3, true) // closes back to the start point
  return pts
}

interface Ring {
  y: number
  hx: number
  hz: number
  cr: number
}

/** Loft the rings into an indexed grid with perimeter-u / height-v UVs. */
function brickGeometry(rings: readonly Ring[]): THREE.BufferGeometry {
  const base = outline(rings[1].hx, rings[1].hz, rings[1].cr)
  const P = base.length
  // perimeter u from the base ring's arc length; reused for every ring so
  // panel edges stay vertical through the pinch
  const u: number[] = [0]
  let total = 0
  for (let i = 1; i <= P; i++) {
    const a = base[i - 1]
    const b = base[i % P]
    total += Math.hypot(b.x - a.x, b.z - a.z)
    u.push(total)
  }
  for (let i = 0; i <= P; i++) u[i] /= total

  const positions: number[] = []
  const uvs: number[] = []
  for (const ring of rings) {
    const o = outline(ring.hx, ring.hz, ring.cr)
    for (let j = 0; j <= P; j++) {
      const p = o[j % P]
      positions.push(p.x, ring.y, p.z)
      uvs.push(u[j], ring.y / H)
    }
  }
  const idx: number[] = []
  const W = P + 1
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < P; j++) {
      const a = i * W + j
      const b = a + 1
      const c = b + W
      const d = a + W
      idx.push(a, b, c, a, c, d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

/** Bottom cap fan (faces -Y; sampled from the label's dark base strip). */
function bottomCap(hx: number, hz: number, cr: number): THREE.BufferGeometry {
  const o = outline(hx, hz, cr)
  const P = o.length
  const positions: number[] = [0, 0, 0]
  const uvs: number[] = [0.5, 0.02]
  for (const p of o) {
    positions.push(p.x, 0, p.z)
    uvs.push(0.5, 0.02)
  }
  const idx: number[] = []
  for (let j = 1; j <= P; j++) idx.push(0, j, (j % P) + 1)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

/**
 * Grape-bunch motif: a 3-2-1 pyramid of berries with a specular dot each,
 * a leaf + stem above. Sized for the 112 px roundel; at game distance it
 * reads as a purple blob on cream — which is the point.
 */
function paintGrapes(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)
  // stem + leaf first so berries overlap them
  ctx.strokeStyle = '#6b4a2b'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, -18)
  ctx.lineTo(3, -36)
  ctx.stroke()
  ctx.fillStyle = '#5cbf3a'
  ctx.beginPath()
  ctx.ellipse(13, -30, 15, 7.5, -0.45, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#3f8f27'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(1, -25)
  ctx.lineTo(25, -36)
  ctx.stroke()
  const rows: ReadonlyArray<readonly [number, number[]]> = [
    [-10, [-18, 0, 18]],
    [6, [-9, 9]],
    [22, [0]],
  ]
  for (const [y, xs] of rows) {
    for (const x of xs) {
      ctx.fillStyle = '#7b3fc4'
      ctx.strokeStyle = '#3b1470'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, 9.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#c9a8f0'
      ctx.beginPath()
      ctx.arc(x - 3, y - 3.5, 2.6, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** Pin every UV of a geometry to one texel — flat-color parts share the label. */
function pinUVs(geo: THREE.BufferGeometry, uu: number, vv: number): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uu, vv)
  uv.needsUpdate = true
}

export function buildJuiceBox(): DrinkVisual {
  const def = TIERS[1]

  // ---- body loft: chamfered base -> straight walls -> gable pinch ---------
  const shoulderY = 0.0905
  const pinchTopY = 0.1032 // the seam fin carries the last 1.8 mm to H
  const rings: Ring[] = [
    { y: 0, hx: HW - 0.0009, hz: HW - 0.0009, cr: CR }, // base chamfer
    { y: 0.002, hx: HW, hz: HW, cr: CR },
    { y: 0.052, hx: HW, hz: HW, cr: CR },
    { y: 0.0895, hx: HW, hz: HW, cr: CR }, // crease pair keeps the
    { y: shoulderY, hx: HW, hz: HW, cr: CR }, //   shoulder fold crisp
  ]
  for (const t of [0.18, 0.42, 0.66, 0.88, 1.0]) {
    rings.push({
      y: shoulderY + t * (pinchTopY - shoulderY),
      hx: HW + (0.0176 - HW) * t,
      hz: HW + (0.0011 - HW) * t,
      cr: CR + (0.0008 - CR) * t,
    })
  }
  const bodyGeo = brickGeometry(rings)
  const capGeo = bottomCap(HW - 0.0009, HW - 0.0009, CR)

  // ---- label: perimeter wrap, front panel centered at u = 0.5 -------------
  const label = makeCanvasTexture(
    512,
    512,
    (ctx, w, h) => {
      // one face panel is only 1/4 of the canvas width (128 px) — every
      // front element must fit inside x 192..320 or it wraps the corner
      const cream = '#f7efe2'
      // deep grape: authored dark AND saturated — the golden-hour key pushes
      // purples toward warm mauve and AgX drains chroma, so the band must
      // start well into violet to still render as unmistakable purple
      const grape = '#46178f'
      const deep = '#250a52'
      const pale = '#d9c4f5'
      ctx.fillStyle = cream
      ctx.fillRect(0, 0, w, h)
      // grape body band (62% of height) + darker grounding strip
      ctx.fillStyle = grape
      ctx.fillRect(0, 0.38 * h, w, 0.62 * h)
      ctx.fillStyle = deep
      ctx.fillRect(0, 0.955 * h, w, 0.045 * h)
      // playful wavy print edge (seamless: 64 | 512)
      paintWave(ctx, w, 0.38 * h, 6, 64, cream, 10)

      // FRONT (u 0.5): grape-bunch roundel, sized to the panel
      const rx = w / 2
      const ry = 0.42 * h
      paintRoundel(ctx, rx, ry, 56, { fill: '#f9f3ff', ring: deep, ringWidth: 0.11 })
      paintGrapes(ctx, rx, ry + 5, 1)

      paintText(ctx, 'GRAPE', rx, 0.63 * h, 34, { color: '#f9f3ff', weight: 900 })
      paintText(ctx, '200 ml', rx, 0.705 * h, 14, { color: pale, weight: 600 })
      paintText(ctx, 'SQUEEZE ME', rx, 0.3 * h, 16, { color: grape, weight: 800 })

      // SIDES (u 0.25 / 0.75): star burst + vitamin note
      for (const sx of [0.25 * w, 0.75 * w]) {
        paintStar(ctx, sx, 0.6 * h, 30, pale)
        paintText(ctx, 'VIT C +', sx, 0.7 * h, 15, { color: '#fff6e8', weight: 700 })
      }
      // BACK (seam at u 0/1): split roundel + maker line drawn twice
      for (const bx of [0, w]) {
        paintRoundel(ctx, bx, 0.42 * h, 42, { fill: '#f9f3ff', ring: deep, ringWidth: 0.12 })
        paintGrapes(ctx, bx, 0.42 * h + 4, 0.75)
        paintText(ctx, 'SUN JUICE CO.', bx, 0.6 * h, 15, { color: '#fff6e8', weight: 700 })
      }
    },
    { repeat: [1, 1] }
  )

  const cardMat = paperboard({ labelTexture: label })

  const body = new THREE.Mesh(bodyGeo, cardMat)
  const cap = new THREE.Mesh(capGeo, cardMat)

  // ---- pinched top seam fin ----------------------------------------------
  const finGeo = new RoundedBoxGeometry(0.0368, 0.0046, 0.0026, 2, 0.0009)
  pinUVs(finGeo, 0.55, 0.975) // plain cream strip at the canvas top
  const fin = new THREE.Mesh(finGeo, cardMat)
  fin.position.y = H - 0.0023 // rises out of the pinch; apex exactly at H

  // ---- folded side ears ---------------------------------------------------
  const earShape = new THREE.Shape()
  earShape.moveTo(0, 0)
  earShape.lineTo(0.0044, -0.003)
  earShape.lineTo(0.0006, -0.0095)
  earShape.closePath()
  const earGeo = new THREE.ExtrudeGeometry(earShape, {
    depth: 0.0016,
    bevelEnabled: true,
    bevelThickness: 0.0003,
    bevelSize: 0.0003,
    bevelSegments: 1,
  })
  earGeo.translate(0, 0, -0.0008)
  pinUVs(earGeo, 0.55, 0.975)
  const earR = new THREE.Mesh(earGeo, cardMat)
  earR.position.set(0.0174, 0.1029, 0)
  earR.rotation.z = -0.16 // folded slightly down-and-out
  const earL = new THREE.Mesh(earGeo, cardMat)
  earL.position.set(-0.0174, 0.1029, 0)
  earL.rotation.y = Math.PI
  earL.rotation.z = -0.16

  // ---- glossy bent straw through the sloped top panel ---------------------
  // Pierces the +X CORNER of the front sloped panel (spec: "rising from a
  // corner"). Emergence x ~0.015 vs panel edge ~0.0178 there — as far out as
  // the punch hole can sit while the 1.6 mm tube stays on the panel and clear
  // of the folded ear at x = 0.0174. Tip stays inside footprint r = 0.026.
  const straw = bentStraw({
    radius: 0.0016,
    bottom: [0.0146, 0.093, 0.0046],
    bendStart: [0.0154, 0.1125, 0.0054],
    tip: [0.0235, 0.1235, 0.008],
    color: 0xffffff,
    stripe: 0x6a2fbf,
  })

  const template = new THREE.Group()
  template.add(body, cap, fin, earR, earL, straw)
  template.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  return { template, height: H, radius: def.radius, liquid: null }
}
