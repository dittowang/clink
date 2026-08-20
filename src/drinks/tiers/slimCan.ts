import * as THREE from 'three'
import type { DrinkVisual } from '../types'
import { TIERS } from '../../config/tiers'
import { latheFromProfile, type ProfilePoint } from '../lib/profiles'
import { aluminum } from '../lib/materials'
import { makeCanvasTexture, paintRoundel, paintText, paintWave } from '../lib/canvas'
import { makeCondensation } from '../lib/condensation'
import { noiseCanvas } from '../lib/noise'
import { pullTab } from '../lib/parts'

/**
 * Tier 2 — 250 ml slim can, cold. Three lathes: printed body (flat bottom
 * with rim chamfer, straight wall, neck-in at 88% height), bare-aluminum
 * rolled top rim + recessed lid, concave bottom dome. Extruded pull tab on a
 * center rivet. Print: white upper third with a tiny roundel + wordmark over
 * a deep teal band with thin wave stripes; bare brushed-aluminum margins top
 * and bottom. Condensation (roughness + normal) rides on the lacquer.
 *
 * All dimensions in metres. R = 0.029, H = 0.134 (config/tiers.ts).
 */
export function buildSlimCan(): DrinkVisual {
  const def = TIERS[2]
  const R = def.radius // 0.029
  const H = def.height // 0.134

  // ---- printed body: ground contact ring -> chamfer -> wall -> neck-in ----
  // v runs bottom -> top along this path (arc-length spaced), so the label
  // canvas maps almost linearly onto the wall. Neck begins at 0.1185 (88% H).
  const bodyProfile: ProfilePoint[] = [
    [0.025, 0.0004], // ground contact ring
    [0.0262, 0.0007],
    [0.0278, 0.0026], // rim chamfer
    [0.0288, 0.006],
    [0.029, 0.0105], // full radius
    [0.029, 0.046],
    [0.029, 0.088],
    [0.029, 0.115], // straight wall ends
    [0.0287, 0.1195], // gentle neck-in
    [0.0276, 0.124],
    [0.0263, 0.1282],
    [0.0258, 0.13], // hands off to the rolled rim
  ]
  const bodyGeo = latheFromProfile(bodyProfile, 64, { samples: 42 })

  // ---- rolled top rim (torus read, in-profile) + recessed lid ------------
  const rimProfile: ProfilePoint[] = [
    [0.0257, 0.1296], // tucks under the body's top edge
    [0.0261, 0.1308],
    [0.0264, 0.132], // bead outer
    [0.0262, 0.1332],
    [0.0254, 0.134], // bead apex — exactly H
    [0.0245, 0.1337],
    [0.0239, 0.1327],
    [0.0236, 0.1315], // bead inner
    [0.0233, 0.1302],
    [0.0229, 0.1295],
    [0.0222, 0.1291],
    [0.018, 0.1289], // recessed lid plane
    [0.01, 0.1291],
    [0.0035, 0.1295], // slight center rise toward the rivet
    [0.0004, 0.1296],
  ]
  const rimGeo = latheFromProfile(rimProfile, 64, { samples: 34 })

  // ---- concave bottom dome (bare aluminum, barely visible) ----------------
  const bottomProfile: ProfilePoint[] = [
    [0.0004, 0.0026],
    [0.009, 0.0022],
    [0.017, 0.0012],
    [0.0225, 0.0005],
    [0.0248, 0.0004],
  ]
  const bottomGeo = latheFromProfile(bottomProfile, 48, { samples: 10 })

  // ---- print ---------------------------------------------------------------
  // v fractions along the body path (total ~0.131 m): chamfer 0–0.09,
  // wall 0.09–0.88, neck 0.88–1. Canvas y = (1 - v) * h.
  const label = makeCanvasTexture(
    512,
    1024,
    (ctx, w, h) => {
      // bare-aluminum base + circumferential brushed streaks (visible only in
      // the margins after the print zones paint over it)
      ctx.fillStyle = '#d3d7da'
      ctx.fillRect(0, 0, w, h)
      const streaks = noiseCanvas(128, 256, 3, 9, { cellsX: 3, cellsY: 96, range: [-0.5, 1.7] })
      ctx.globalAlpha = 0.32
      ctx.drawImage(streaks, 0, 0, w, h)
      ctx.globalAlpha = 1

      const whiteTop = 0.115 * h // v 0.885 — neck stays bare above this
      const tealTop = 0.425 * h // v 0.575
      const tealBot = 0.905 * h // v 0.095 — bare margin below
      const teal = '#0a92b4' // authored hot + blue-biased — warm light + AgX pull it green

      // white upper third
      ctx.fillStyle = '#f3f7f7'
      ctx.fillRect(0, whiteTop, w, tealTop - whiteTop)
      // deep teal band
      ctx.fillStyle = teal
      ctx.fillRect(0, tealTop, w, tealBot - tealTop)
      // wavy print edge where white meets teal (4 periods -> seamless wrap)
      ctx.fillStyle = '#f3f7f7'
      ctx.beginPath()
      ctx.moveTo(0, tealTop - 30)
      for (let x = 0; x <= w; x += 2) {
        ctx.lineTo(x, tealTop + Math.sin((x / w) * Math.PI * 8) * 10)
      }
      ctx.lineTo(w, tealTop - 30)
      ctx.closePath()
      ctx.fill()

      // wave stripes across the teal (wavelengths divide w -> seamless).
      // Contrast authored HOT: the old mid-teal set (#5cc9d6/#0c7b8d, 4–9 px)
      // sat within a stop of the band and vanished at probe range — these
      // push both ways (near-white lights, deep-ink darks) and widen a touch
      // so the lacquered wave print survives AgX + condensation at 1–2 px
      paintWave(ctx, w, 0.5 * h, 10, 128, '#a7ecf4', 11)
      paintWave(ctx, w, 0.55 * h, 10, 128, '#054b5c', 10)
      paintWave(ctx, w, 0.6 * h, 9, 128, '#eefcfd', 6)
      paintWave(ctx, w, 0.72 * h, 8, w / 3, '#8fdfe9', 9)
      paintWave(ctx, w, 0.77 * h, 8, w / 3, '#054b5c', 8)

      // tiny roundel + wordmark on the white field
      paintRoundel(ctx, w / 2, 0.18 * h, 42, {
        fill: teal,
        ring: '#7edbe6',
        ringWidth: 0.18,
        inner: '#ffb43a',
      })
      paintText(ctx, 'RIPTIDE', w / 2, 0.28 * h, 60, { color: '#087787', weight: 900 })
      paintText(ctx, 'sparkling yuzu', w / 2, 0.335 * h, 25, { color: '#3fadbb', weight: 600 })
      ctx.fillStyle = '#ffb43a'
      ctx.fillRect(w / 2 - 72, 0.357 * h, 144, 5)
      paintText(ctx, '250 mL SLIM', w / 2, 0.862 * h, 19, { color: '#d8f2f5', weight: 700 })

      // hairline seams where lacquer ends and bare metal begins
      ctx.fillStyle = '#9fa5a9'
      ctx.fillRect(0, whiteTop - 1, w, 2)
      ctx.fillRect(0, tealBot - 1, w, 2)
    },
    { repeat: [1, 1] }
  )
  label.offset.x = 0.5 // lathe u=0 faces +Z — swing the canvas center to the front

  const condensation = makeCondensation(512, 1024, 22, {
    baseRoughness: 0.22, // the lacquer's own satin; droplets cut through it
    dropletRoughness: 0.05,
    normalStrength: 2.6,
    density: 0.9,
  })
  condensation.roughnessMap.repeat.set(2, 1)
  condensation.normalMap.repeat.set(2, 1)

  const bodyMat = aluminum({ labelTexture: label })
  bodyMat.roughness = 1 // absolute values live in the condensation map
  bodyMat.roughnessMap = condensation.roughnessMap
  bodyMat.normalMap = condensation.normalMap
  bodyMat.normalScale.set(0.8, 0.8)
  bodyMat.envMapIntensity = 1.2

  // Matte brushed bare metal for lid/rim/bottom/tab. NOT lib steel(): its
  // streak map's range [-0.9, 2.6] clamps whole streaks to roughness 0, and
  // the flat sky-facing lid then mirrors the golden sky straight over the
  // bloom threshold (the lid read as a lit candle in lineups). A bounded
  // streak map still fails twice over: circumferential streaks wrap the lid
  // disc's radial UVs into a latte-art swirl, and mid-gloss white metal stays
  // over threshold under the golden sun. Flat matte is the cola can's proven
  // lid recipe — the brushed read comes from the rim bead's geometry lighting.
  const bareMat = new THREE.MeshPhysicalMaterial({
    color: 0xa2a8ae,
    metalness: 1,
    roughness: 0.58,
    envMapIntensity: 0.35,
  })

  const body = new THREE.Mesh(bodyGeo, bodyMat)
  const rim = new THREE.Mesh(rimGeo, bareMat)
  const bottom = new THREE.Mesh(bottomGeo, bareMat)

  // ---- pull tab on its center rivet ---------------------------------------
  const tabGroup = new THREE.Group()
  const tab = pullTab({ length: 0.021, width: 0.0115, material: bareMat })
  // pullTab extends -Z from its origin; shift +Z so the rivet HOLE (at 0.85
  // of the half-width from the rivet end) lands on the group origin
  tab.position.set(0, 0.0012, 0.0049)
  const rivet = new THREE.Mesh(new THREE.CylinderGeometry(0.0019, 0.0019, 0.0016, 12), bareMat)
  rivet.position.y = 0.0008
  tabGroup.add(tab, rivet)
  tabGroup.position.set(0, 0.129, 0)
  tabGroup.rotation.y = 0.35 // a casually-angled tab reads hand-touched

  const template = new THREE.Group()
  template.add(body, rim, bottom, tabGroup)
  template.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  return { template, height: H, radius: R, liquid: null }
}
