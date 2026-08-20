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
 * corner. Label wraps the perimeter: warm orange body band (>= half height),
 * cream top, orange-slice roundel on the front.
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
      const cream = '#f8ecd9'
      const orange = '#e25a03' // darkened so the bright warm key can't wash it to peach
      const deep = '#a64802'
      const pale = '#ffcf92'
      ctx.fillStyle = cream
      ctx.fillRect(0, 0, w, h)
      // warm orange body band (62% of height) + dark grounding strip
      ctx.fillStyle = orange
      ctx.fillRect(0, 0.38 * h, w, 0.62 * h)
      ctx.fillStyle = deep
      ctx.fillRect(0, 0.955 * h, w, 0.045 * h)
      // playful wavy print edge (seamless: 64 | 512)
      paintWave(ctx, w, 0.38 * h, 6, 64, cream, 10)

      // FRONT (u 0.5): orange-slice roundel, sized to the panel
      const rx = w / 2
      const ry = 0.42 * h
      paintRoundel(ctx, rx, ry, 56, { fill: '#fff4e2', ring: deep, ringWidth: 0.11 })
      ctx.fillStyle = '#ffa42a'
      ctx.beginPath()
      ctx.arc(rx, ry, 37, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#fff4e2'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.arc(rx, ry, 37, 0, Math.PI * 2)
      ctx.stroke()
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        ctx.beginPath()
        ctx.moveTo(rx + Math.cos(a) * 6, ry + Math.sin(a) * 6)
        ctx.lineTo(rx + Math.cos(a) * 32, ry + Math.sin(a) * 32)
        ctx.stroke()
      }
      ctx.fillStyle = '#fff4e2'
      ctx.beginPath()
      ctx.arc(rx, ry, 4, 0, Math.PI * 2)
      ctx.fill()

      paintText(ctx, 'JU!CY', rx, 0.63 * h, 36, { color: '#fff6e8', weight: 900 })
      paintText(ctx, '200 ml', rx, 0.705 * h, 14, { color: pale, weight: 600 })
      paintText(ctx, 'SQUEEZE ME', rx, 0.3 * h, 16, { color: orange, weight: 800 })

      // SIDES (u 0.25 / 0.75): star burst + vitamin note
      for (const sx of [0.25 * w, 0.75 * w]) {
        paintStar(ctx, sx, 0.6 * h, 30, pale)
        paintText(ctx, 'VIT C +', sx, 0.7 * h, 15, { color: '#fff6e8', weight: 700 })
      }
      // BACK (seam at u 0/1): split roundel + maker line drawn twice
      for (const bx of [0, w]) {
        paintRoundel(ctx, bx, 0.42 * h, 42, { fill: '#fff4e2', ring: deep, ringWidth: 0.12, inner: '#ffa42a' })
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
  const straw = bentStraw({
    radius: 0.0016,
    bottom: [0.011, 0.093, 0.0045],
    bendStart: [0.0128, 0.1125, 0.0055],
    tip: [0.023, 0.1235, 0.0055],
    color: 0xffffff,
    stripe: 0xf07301,
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
