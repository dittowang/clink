import * as THREE from 'three'
import type { DrinkVisual } from '../types'
import { TIERS } from '../../config/tiers'
import { makeCanvasTexture } from '../lib/canvas'
import { noiseCanvas, normalMapFromHeight } from '../lib/noise'
import { bentStraw } from '../lib/parts'
import { fbm3, weldVertexNormals, sstep } from '../lib/extra-g78'

/**
 * Tier 7 — drinking coconut. Husk ovoid: displaced sphere shell (3-band fBm,
 * ±8% radial clamp per spec), three raised pole-to-pole ridge bands (crest +
 * flanking grooves in geometry, faint groove-line paint phase-locked via the
 * UV u channel), fibrous streak color/normal/roughness maps, flattened
 * contact patch. Top sliced flat: husk-fiber cross-section
 * ring → dark shell ring → white flesh annulus → recessed dark glossy
 * coconut-water disc, one straw. No umbrella (that is the pineapple's).
 *
 * Dimensions are LAW: R = 0.058, H = 0.140 (config/tiers.ts). The art brief's
 * "squash 0.78" is resolved in favor of the collider dims — the body fills
 * the footprint exactly (post-displacement renormalize) and the cut lands
 * just under H.
 */

const SEED = 707
const RIDGE_U = [0.1167, 0.45, 0.7833] // 3 evenly spaced bands, off the seam;
// phase puts one band 48° left of the probe camera axis (clear read) and one
// hugging the right silhouette edge (reads as an edge crest)
const RIDGE_SIGMA = 0.038 // band half-width in u — tight seam, not a smear

/** shortest wrapped distance between two u values */
function wrapDist(a: number, b: number): number {
  const d = Math.abs(a - b)
  return Math.min(d, 1 - d)
}

/**
 * Ridge cross-section: raised crest with shallow flanking grooves. The
 * groove→crest→groove light break is what makes a band read as a RIDGE from
 * any yaw (paint alone reads as dirt). Bands are far apart → sum ≈ max.
 */
function ridgeAmount(u: number): number {
  let m = 0
  for (const ru of RIDGE_U) {
    const d2 = (wrapDist(u, ru) / RIDGE_SIGMA) ** 2
    m += Math.exp(-d2) - 0.32 * Math.exp(-d2 / 4.8)
  }
  return m
}

// ---------------------------------------------------------------- body ----

interface BodyBuild {
  mesh: THREE.Mesh
  cutR: number
  cutY: number
}

function buildBody(): BodyBuild {
  const R = TIERS[7].radius // 0.058
  const A = R // equatorial semi-axis (renormalized to R after displacement)
  const B = 0.0798 // vertical semi-axis
  const CY = 0.0758 // ellipsoid centre height — widest at ~54% of H
  const CUT_Y = 0.1385 // flat cut just under the collider top (0.140)
  const cosTop = (CUT_Y - CY) / B
  const thetaTop = Math.acos(cosTop)

  // 84×54 so the mid-frequency lumps are not vertex-starved (still ~9k tris)
  const geo = new THREE.SphereGeometry(1, 84, 54, 0, Math.PI * 2, thetaTop, Math.PI - thetaTop)
  const pos = geo.getAttribute('position')
  const uv = geo.getAttribute('uv')

  let yMin = Infinity
  for (let i = 0; i < pos.count; i++) {
    const nx = pos.getX(i)
    const ny = pos.getY(i)
    const nz = pos.getZ(i)
    const theta = Math.acos(Math.min(1, Math.max(-1, ny)))
    const u = uv.getX(i)
    // displacement fades to zero at the cut rim so the rim stays a clean
    // circle that the top assembly can meet exactly
    const rimFade = sstep(thetaTop, thetaTop + 0.3, theta)
    // three fBm bands: coarse shape warp, MID lumps (this is the band the
    // silhouette edge actually shows at 128 px), fine knots. fbm3 output
    // clusters near 0.5 — expand ×3 before scaling or the lumps vanish
    // (verified flat silhouette in capture without it)
    const nC = (fbm3(nx * 1.9, ny * 1.9, nz * 1.9, 3, SEED) - 0.5) * 3
    const nM = (fbm3(nx * 5.0 + 7.3, ny * 5.0, nz * 5.0, 3, SEED + 41) - 0.5) * 3
    const nF = (fbm3(nx * 10.5, ny * 10.5 + 3.1, nz * 10.5, 2, SEED + 83) - 0.5) * 3
    // spec: fBm ±8% — the clamp IS the spec amplitude (±4.6 mm at r=0.058)
    const lump = Math.max(-0.085, Math.min(0.085, nC * 0.055 + nM * 0.045 + nF * 0.016))
    // three-lobe cross-section (rounded triangle, phase-locked to RIDGE_U):
    // real drinking coconuts are three gentle FACES meeting at seams. The
    // lobe puts the bands into the FORM — each face takes a different key
    // angle so all three seams read (paint alone gave one smeared band), and
    // the silhouette stays organic at every yaw of the turntable.
    const lobe = 0.03 * Math.cos((u - RIDGE_U[0]) * Math.PI * 6) * Math.pow(Math.sin(theta), 0.55)
    // sharper crest ON the lobe corner; sin(theta) zeroes both at the bottom
    // pole so coincident pole verts agree, rimFade keeps the cut rim a circle
    const ridge = ridgeAmount(u) * 0.065 * Math.pow(Math.sin(theta), 0.7)
    const d = 1 + rimFade * (lump + lobe + ridge)
    let x = nx * d * A
    let y = CY + ny * d * B
    let z = nz * d * A
    // flatten the contact patch: smooth remap below y = k → sits dead flat
    const k = 0.012
    const ymin0 = CY - B * 1.1 // conservative lowest possible point (±8.5% clamp)
    if (y < k) {
      const f = (y - ymin0) / (k - ymin0)
      y = k * f * f * (3 - 2 * f)
    }
    pos.setXYZ(i, x, y, z)
    if (y < yMin) yMin = y
  }
  // renormalize so the widest point lands EXACTLY on the physics footprint
  let maxR = 0
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i))
    if (r > maxR) maxR = r
  }
  const s = R / maxR
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, pos.getX(i) * s)
    pos.setZ(i, pos.getZ(i) * s)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  weldVertexNormals(geo)

  const cutR = A * Math.sin(thetaTop) * s

  // ---- husk maps ----------------------------------------------------------
  const colorTex = makeCanvasTexture(
    1024,
    512,
    (ctx, w, h) => {
      // base ramp: canvas top = cut rim, bottom = base pole
      const g = ctx.createLinearGradient(0, 0, 0, h)
      // authored light: golden-hour + the multiply passes pull it two stops
      // down in the lineup — a "correct" ramp reads near-black there
      g.addColorStop(0, '#8d5424')
      g.addColorStop(0.32, '#bd8049')
      g.addColorStop(0.68, '#a56732')
      g.addColorStop(1, '#683a1a')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      // fibrous streaks (fine, pole-to-pole) — multiply
      const fibers = noiseCanvas(1024, 512, 4, SEED + 1, {
        cellsX: 170,
        cellsY: 5,
        range: [-0.55, 1.55],
      })
      ctx.globalCompositeOperation = 'multiply'
      ctx.globalAlpha = 0.45
      ctx.drawImage(fibers, 0, 0)
      // coarse mottle — overlay for big tonal patches
      const mottle = noiseCanvas(512, 256, 3, SEED + 2, {
        cellsX: 7,
        cellsY: 4,
        range: [-0.25, 1.25],
      })
      ctx.globalCompositeOperation = 'overlay'
      ctx.globalAlpha = 0.55
      ctx.drawImage(mottle, 0, 0, w, h)
      // pale dry-fiber patches (sun-bleached husk)
      const dry = noiseCanvas(512, 256, 3, SEED + 8, {
        cellsX: 5,
        cellsY: 3,
        range: [0.45, 1.6],
      })
      ctx.globalCompositeOperation = 'screen'
      ctx.globalAlpha = 0.24
      ctx.drawImage(dry, 0, 0, w, h)
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      // three FAINT ridge bands (wrap-aware), phase-locked with the raised
      // geometry crests. Paint must NOT darken the crest itself — the lit
      // crest and a dark core CANCEL (capture-verified: bands vanished).
      // Instead: dark seam lines in the two flanking GROOVES + a whisper of
      // light on the crest, reinforcing the geometry's own shading.
      // (A single 0.72-alpha core once read as ONE dark smear — critic.)
      for (const ru of RIDGE_U) {
        for (const off of [-1, 0, 1]) {
          const cx = (ru + off) * w
          const span = RIDGE_SIGMA * 2.5 * w
          if (cx + span < 0 || cx - span > w) continue
          for (const side of [-1, 1]) {
            const gx = cx + side * RIDGE_SIGMA * 1.4 * w
            const gw = RIDGE_SIGMA * 0.8 * w
            const gg = ctx.createLinearGradient(gx - gw, 0, gx + gw, 0)
            gg.addColorStop(0, 'rgba(38,20,7,0)')
            gg.addColorStop(0.5, 'rgba(38,20,7,0.5)')
            gg.addColorStop(1, 'rgba(38,20,7,0)')
            ctx.fillStyle = gg
            ctx.fillRect(gx - gw, 0, gw * 2, h)
          }
          const cw = RIDGE_SIGMA * 0.7 * w
          ctx.globalCompositeOperation = 'screen'
          const cg = ctx.createLinearGradient(cx - cw, 0, cx + cw, 0)
          cg.addColorStop(0, 'rgba(228,190,140,0)')
          cg.addColorStop(0.5, 'rgba(228,190,140,0.22)')
          cg.addColorStop(1, 'rgba(228,190,140,0)')
          ctx.fillStyle = cg
          ctx.fillRect(cx - cw, 0, cw * 2, h)
          ctx.globalCompositeOperation = 'source-over'
        }
      }
      // sparse fiber highlights + dark nicks (short vertical strokes)
      const rand = (() => {
        let t = SEED + 9
        return () => {
          t = (t * 1103515245 + 12345) & 0x7fffffff
          return t / 0x7fffffff
        }
      })()
      for (let i = 0; i < 320; i++) {
        const x = rand() * w
        const y = rand() * h
        const len = 10 + rand() * 36
        const light = rand() < 0.55
        ctx.strokeStyle = light ? 'rgba(230,192,138,0.22)' : 'rgba(26,13,5,0.28)'
        ctx.lineWidth = 1 + rand() * 1.8
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + (rand() - 0.5) * 7, y + len)
        ctx.stroke()
      }
    },
    { repeat: [1, 1] }
  )

  // height for the normal map: STRAND-scale fiber bundles over mid knots
  // over coarse lumps. The old 200-cell fiber lattice was sub-pixel on a
  // 5.8 cm body and mip-filtered to nothing (critic: "fiber normal map
  // produces no light response") — real husk strands clump ~3 mm wide, which
  // is ~110 around the circumference. Contrast expanded ([0.28,0.72] remap)
  // + a strong conversion so the key light actually breaks on the strands.
  const heightCanvas = document.createElement('canvas')
  heightCanvas.width = 512
  heightCanvas.height = 512
  {
    const ctx = heightCanvas.getContext('2d')!
    ctx.drawImage(
      noiseCanvas(512, 512, 3, SEED + 3, { cellsX: 110, cellsY: 4, range: [0.28, 0.72] }),
      0,
      0
    )
    ctx.globalAlpha = 0.45
    ctx.drawImage(noiseCanvas(512, 512, 3, SEED + 7, { cellsX: 26, cellsY: 9 }), 0, 0)
    ctx.globalAlpha = 0.35
    ctx.drawImage(noiseCanvas(512, 512, 3, SEED + 4, { cellsX: 9, cellsY: 5 }), 0, 0)
    ctx.globalAlpha = 1
  }
  const normalTex = makeCanvasTexture(
    512,
    512,
    (ctx) => ctx.drawImage(normalMapFromHeight(heightCanvas, 7.0), 0, 0),
    { srgb: false, repeat: [1, 1] }
  )

  // streaky roughness: smooth (dark) fiber strands glint under the key while
  // the pith between them stays matte — THIS is the fibrous light response
  const roughTex = makeCanvasTexture(
    512,
    512,
    (ctx) => {
      ctx.drawImage(
        noiseCanvas(512, 512, 4, SEED + 5, { cellsX: 170, cellsY: 5, range: [-0.6, 1.15] }),
        0,
        0
      )
    },
    { srgb: false, repeat: [1, 1] }
  )

  const mat = new THREE.MeshPhysicalMaterial({
    map: colorTex,
    normalMap: normalTex,
    normalScale: new THREE.Vector2(1.6, 1.6),
    metalness: 0,
    roughness: 1.0, // roughnessMap carries absolute values (green channel)
    roughnessMap: roughTex,
    specularIntensity: 0.7,
    // lift the ambient response: the lineup's golden hour backlights the
    // drinks and the camera side lives on env light alone
    envMapIntensity: 1.4,
    sheen: 0.3,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color(0xc09a70),
  })
  // highlight stretched ALONG the strands (rotation π/2 = along v): the key
  // draws elongated fiber glints instead of a broad dielectric smear
  mat.anisotropy = 0.55
  mat.anisotropyRotation = Math.PI / 2
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return { mesh, cutR, cutY: CUT_Y }
}

// ----------------------------------------------------------------- top ----

function buildTop(cutR: number, cutY: number): THREE.Group {
  const group = new THREE.Group()
  const fleshInnerR = 0.019 // recess radius (flesh wall)
  const waterY = cutY - 0.004

  // cut face: planar-UV ring painted with concentric zones —
  // fibrous husk cross-section → thin dark shell → white flesh
  const shellFrac = 0.79 // of outer radius
  const fleshFrac = 0.75
  const faceTex = makeCanvasTexture(512, 512, (ctx, w, h) => {
    const cx = w / 2
    const cy = h / 2
    const rOut = w / 2
    // fiber zone base
    ctx.fillStyle = '#b98d5c'
    ctx.beginPath()
    ctx.arc(cx, cy, rOut, 0, Math.PI * 2)
    ctx.fill()
    // radial fiber strokes with tonal jitter
    const rand = (() => {
      let t = SEED + 21
      return () => {
        t = (t * 1103515245 + 12345) & 0x7fffffff
        return t / 0x7fffffff
      }
    })()
    for (let i = 0; i < 340; i++) {
      const a = rand() * Math.PI * 2
      const r0 = rOut * (shellFrac + 0.01 + rand() * 0.04)
      const r1 = rOut * (0.985 + rand() * 0.015)
      const tone = rand()
      ctx.strokeStyle =
        tone < 0.35
          ? 'rgba(120,80,42,0.6)'
          : tone < 0.7
            ? 'rgba(160,116,66,0.55)'
            : 'rgba(214,178,126,0.5)'
      ctx.lineWidth = 1 + rand() * 2.2
      const ja = a + (rand() - 0.5) * 0.03
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
      ctx.lineTo(cx + Math.cos(ja) * r1, cy + Math.sin(ja) * r1)
      ctx.stroke()
    }
    // dark hard shell ring
    ctx.fillStyle = '#33200f'
    ctx.beginPath()
    ctx.arc(cx, cy, rOut * shellFrac, 0, Math.PI * 2)
    ctx.fill()
    // white flesh
    const fg = ctx.createRadialGradient(cx, cy, rOut * 0.1, cx, cy, rOut * fleshFrac)
    fg.addColorStop(0, '#f7f2e6')
    fg.addColorStop(0.85, '#f2ead9')
    fg.addColorStop(1, '#e3d5bc')
    ctx.fillStyle = fg
    ctx.beginPath()
    ctx.arc(cx, cy, rOut * fleshFrac, 0, Math.PI * 2)
    ctx.fill()
  })
  const faceMat = new THREE.MeshPhysicalMaterial({
    map: faceTex,
    metalness: 0,
    roughness: 0.62,
    specularIntensity: 0.5,
    clearcoat: 0.12,
    clearcoatRoughness: 0.4,
  })
  const face = new THREE.Mesh(new THREE.RingGeometry(fleshInnerR, cutR + 0.0006, 72, 1), faceMat)
  face.rotation.x = -Math.PI / 2
  face.position.y = cutY
  face.castShadow = true
  face.receiveShadow = true

  // recess wall down to the water — plain flesh
  const fleshMat = new THREE.MeshPhysicalMaterial({
    color: 0xefe7d6,
    metalness: 0,
    roughness: 0.55,
    specularIntensity: 0.5,
  })
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(fleshInnerR, fleshInnerR - 0.0006, cutY - waterY + 0.001, 48, 1, true),
    fleshMat
  )
  wall.position.y = (cutY + waterY) / 2
  wall.castShadow = true
  wall.receiveShadow = true

  // coconut water: plain dark glossy disc (deep-attenuation look)
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0x2b1307,
    metalness: 0,
    roughness: 0.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    specularIntensity: 1,
    envMapIntensity: 1.3,
  })
  const water = new THREE.Mesh(new THREE.CircleGeometry(fleshInnerR - 0.0005, 48), waterMat)
  water.rotation.x = -Math.PI / 2
  water.position.y = waterY
  water.castShadow = true
  water.receiveShadow = true

  group.add(face, wall, water)
  return group
}

// -------------------------------------------------------------- builder ---

export function buildCoconut(): DrinkVisual {
  const def = TIERS[7]
  const body = buildBody()
  const top = buildTop(body.cutR, body.cutY)

  const straw = bentStraw({
    radius: 0.0024,
    bottom: [0.008, 0.118, -0.004],
    bendStart: [0.013, 0.186, -0.004],
    tip: [0.031, 0.213, -0.004],
    color: 0xf7f3ea,
    stripe: 0x18a5a0,
  })
  straw.receiveShadow = true

  const template = new THREE.Group()
  template.add(body.mesh, top, straw)
  return { template, height: def.height, radius: def.radius, liquid: null }
}
