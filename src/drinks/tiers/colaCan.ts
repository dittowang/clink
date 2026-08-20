import * as THREE from 'three'
import type { DrinkVisual } from '../types'
import { TIERS } from '../../config/tiers'
import { latheFromProfile, type ProfilePoint } from '../lib/profiles'
import { aluminum } from '../lib/materials'
import { makeCanvasTexture, SYSTEM_FONT, paintRoundel, paintStar } from '../lib/canvas'
import { makeCondensation } from '../lib/condensation'
import { pullTab } from '../lib/parts'
import { noiseCanvas } from '../lib/noise'
import { vAtY } from '../lib/extra-g34'

/**
 * Tier 3 — classic 330 ml cola can. R = 0.033, H = 0.116 (config/tiers.ts).
 *
 * Construction: TWO lathes for the bare shell (lower = dome recess + foot +
 * chamfer + wall; upper = neck-in + double seam + recessed lid with a
 * stiffening groove) so arc-length sampling spends its points on the tiny
 * seam/lid features instead of the long straight wall. A third thin lathe
 * 0.15 mm proud of the wall carries the printed lacquer label (crisp band
 * control: its v span IS the print zone). Stay-tab + rivet + score ring on
 * the lid. Cold tier → condensation maps layered on lacquer and bare metal.
 */
export function buildColaCan(): DrinkVisual {
  const def = TIERS[3]
  const R = def.radius // 0.033
  const H = def.height // 0.116

  const WALL_R = 0.03285 // bare shell wall; the label wrap on top reaches R exactly
  const LID_Y = 0.1096 // recessed lid panel

  // ---- bare shell: lower lathe (dome recess → foot ring → chamfer → wall) --
  const lowerProfile: ProfilePoint[] = [
    [0.0004, 0.0058], // bottom dome apex (inside the recess)
    [0.009, 0.0052],
    [0.017, 0.0032],
    [0.0225, 0.0008], // dome runs out…
    [0.0242, 0.0], //    …to the foot contact ring
    [0.026, 0.0],
    [0.0272, 0.001], // chime round-over
    [0.0305, 0.0066], // 45° bottom chamfer
    [0.0324, 0.0105],
    [0.03285, 0.014], // wall begins
    [0.03285, 0.04],
    [0.03285, 0.07],
    [0.03285, 0.094],
    [0.03285, 0.0978], // wall ends (upper lathe continues with matching tangent)
  ]

  // ---- bare shell: upper lathe (neck-in → seam → recess wall) --------------
  const upperProfile: ProfilePoint[] = [
    [0.03285, 0.0942], // vertical stub so the junction tangent matches lower
    [0.03285, 0.0978],
    [0.0321, 0.101], // neck-in
    [0.03, 0.1063],
    [0.0289, 0.1103],
    [0.0294, 0.1123], // double seam bulge
    [0.0296, 0.1139],
    [0.0293, 0.1154],
    [0.0286, 0.116], // seam apex — exactly H
    [0.0277, 0.1152], // curl inward-down
    [0.0271, 0.1128],
    [0.0267, 0.1106], // into the lid recess
  ]

  // ---- lid panel: own lathe + matte material — a glossy flat lid catches
  // ---- the whole sky and blooms to a white blob on the beach stage ---------
  const lidProfile: ProfilePoint[] = [
    [0.0267, 0.1106],
    [0.0246, LID_Y], // lid panel outer
    [0.0208, 0.1094],
    [0.0193, 0.1086], // stiffening groove (down…)
    [0.018, 0.1094], //                    …and up)
    [0.012, LID_Y],
    [0.0004, LID_Y], // lid centre
  ]

  // ---- printed label wrap: wall + neck, 0.15 mm proud of the shell ---------
  const wrapProfile: ProfilePoint[] = [
    [0.0318, 0.009],
    [0.0327, 0.0116],
    [0.033, 0.0145],
    [0.033, 0.04],
    [0.033, 0.07],
    [0.033, 0.0945],
    [0.033, 0.0978],
    [0.0323, 0.101],
    [0.0302, 0.1062],
    [0.0291, 0.1098], // ends just under the seam
  ]

  // exact v (arc fraction along the wrap) for each label feature height
  const v = (y: number): number => vAtY(wrapProfile, y)
  const vSilverBot = v(0.0122)
  const vRibbon = v(0.044)
  const vScript = v(0.068)
  const vCola = v(0.09)
  const vFine = v(0.017)
  const vRoundel = v(0.058)
  const vSilverTop = v(0.1082)

  const labelTexture = makeCanvasTexture(1024, 512, (ctx, w, h) => {
    const yOf = (vv: number): number => (1 - vv) * h
    // signature red, slightly graded darker toward the base (print depth).
    // AgX desaturates — authored hotter than the target read.
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, '#e5000f')
    g.addColorStop(0.62, '#d3000d')
    g.addColorStop(1, '#ac020e')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)

    // ---- bold white ribbon swash: one sine period → seamless around the can.
    // phase π/2 puts the zero-crossing (steepest sweep) at the front (u 0.25)
    const yr = yOf(vRibbon)
    const th = 0.12 * h
    const amp = 0.105 * h
    const wave = (x: number): number => yr - Math.sin((x / w) * Math.PI * 2 + Math.PI / 2) * amp
    const edge = (x: number, sgn: number): number => {
      const ph = (x / w) * Math.PI * 2
      const k = 1 + 0.24 * Math.cos(ph + 2.2) // thickness tapers around the wrap
      return wave(x) + sgn * (th / 2) * k
    }
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    for (let x = 0; x <= w; x += 4) ctx.lineTo(x, edge(x, -1))
    for (let x = w; x >= 0; x -= 4) ctx.lineTo(x, edge(x, +1))
    ctx.closePath()
    ctx.fill()
    // thin echo pinstripe riding under the swash
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 0.014 * h
    ctx.beginPath()
    for (let x = -8; x <= w + 8; x += 4) {
      const y = wave(x) + th * 0.82
      if (x <= -8) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // ---- wordmark (front = u 0.25 after the mesh yaw) -----------------------
    const fx = 0.25 * w
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `italic 900 ${Math.round(0.185 * h)}px ${SYSTEM_FONT}`
    ctx.fillStyle = '#8f0a14' // offset shadow gives the script some print depth
    ctx.fillText('Clink', fx + 0.006 * w, yOf(vScript) + 0.008 * h)
    ctx.fillStyle = '#ffffff'
    ctx.fillText('Clink', fx, yOf(vScript))
    // tracked COLA under the script
    ctx.font = `800 ${Math.round(0.072 * h)}px ${SYSTEM_FONT}`
    const word = 'COLA'
    const track = 0.032 * w
    for (let i = 0; i < word.length; i++) {
      ctx.fillText(word[i], fx + (i - (word.length - 1) / 2) * track, yOf(vCola))
    }
    // fine print near the base — decorative only
    ctx.font = `600 ${Math.round(0.028 * h)}px ${SYSTEM_FONT}`
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillText('330 mL · SERVE ICE COLD', fx, yOf(vFine))

    // ---- white roundel on the back side (u 0.75) ---------------------------
    const bx = 0.75 * w
    const by = yOf(vRoundel)
    paintRoundel(ctx, bx, by, 0.155 * h, { fill: '#ffffff', ring: '#d3000d', ringWidth: 0.1 })
    paintStar(ctx, bx, by, 0.075 * h, '#d3000d')
    ctx.font = `800 ${Math.round(0.034 * h)}px ${SYSTEM_FONT}`
    ctx.fillStyle = '#d3000d'
    ctx.fillText('EST. 1971', bx, by + 0.105 * h)

    // ---- bare-metal margins at the print borders ---------------------------
    ctx.fillStyle = '#c9cdd2'
    ctx.fillRect(0, yOf(vSilverBot), w, h - yOf(vSilverBot))
    ctx.fillRect(0, 0, w, yOf(vSilverTop))
    ctx.strokeStyle = 'rgba(120,20,26,0.5)' // knockout line where ink meets metal
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, yOf(vSilverBot))
    ctx.lineTo(w, yOf(vSilverBot))
    ctx.moveTo(0, yOf(vSilverTop))
    ctx.lineTo(w, yOf(vSilverTop))
    ctx.stroke()
  })

  // ---- materials: lacquer print + bare aluminum, both wearing droplets -----
  const cond = makeCondensation(512, 512, 33, {
    baseRoughness: 0.24,
    dropletRoughness: 0.05,
    normalStrength: 2.0,
    density: 0.85,
  })
  cond.roughnessMap.repeat.set(2, 1)
  cond.normalMap.repeat.set(2, 1)

  const wrapMat = aluminum({ labelTexture })
  wrapMat.envMapIntensity = 0.85 // keep the warm env from washing the red out
  wrapMat.roughness = 1 // absolute values live in the map
  wrapMat.roughnessMap = cond.roughnessMap
  wrapMat.normalMap = cond.normalMap
  wrapMat.normalScale.set(0.8, 0.8)
  wrapMat.clearcoatNormalMap = cond.normalMap // droplets bump the lacquer coat

  const bareMat = aluminum()
  bareMat.color.set(0xd7dade)
  bareMat.roughness = 1
  bareMat.roughnessMap = cond.roughnessMap
  bareMat.normalMap = cond.normalMap
  bareMat.normalScale.set(0.6, 0.6)

  // matte lid: spun metal, no clearcoat — the flat top must not mirror the
  // sky. Uniform roughness still integrated the whole golden sky into one
  // washed near-white disc, so concentric lathe-v rings (spun-finish tooling
  // marks) break the reflection into bands and the env is pulled down until
  // the lid reads grey metal, never emissive, under the bloom threshold.
  const lidRings = new THREE.CanvasTexture(
    noiseCanvas(256, 256, 2, 34, { cellsX: 2, cellsY: 64, range: [-1.29, 1.57] })
  )
  lidRings.colorSpace = THREE.NoColorSpace
  lidRings.wrapS = lidRings.wrapT = THREE.RepeatWrapping
  const lidMat = new THREE.MeshPhysicalMaterial({
    color: 0x9aa1a9,
    metalness: 1,
    roughness: 1, // absolute values live in the ring map (~0.45–0.8)
    roughnessMap: lidRings,
    envMapIntensity: 0.32,
  })

  // ---- meshes --------------------------------------------------------------
  const lower = new THREE.Mesh(latheFromProfile(lowerProfile, 64, { samples: 36 }), bareMat)
  const upper = new THREE.Mesh(latheFromProfile(upperProfile, 64, { samples: 32 }), bareMat)
  const lid = new THREE.Mesh(latheFromProfile(lidProfile, 64, { samples: 24 }), lidMat)
  const wrap = new THREE.Mesh(latheFromProfile(wrapProfile, 64, { samples: 16 }), wrapMat)
  wrap.rotation.y = -Math.PI / 2 // label u 0.25 (wordmark) faces the camera
  for (const m of [lower, upper, lid, wrap]) {
    m.castShadow = true
    m.receiveShadow = true
  }

  // ---- stay-tab + rivet + score ring on the lid ----------------------------
  const tab = pullTab({ length: 0.019, width: 0.0105, material: lidMat })
  const tabMat = tab.material as THREE.Material
  tab.position.set(0, LID_Y + 0.0005, 0)
  tab.receiveShadow = true

  const rivet = new THREE.Mesh(new THREE.CylinderGeometry(0.0014, 0.0016, 0.0013, 16), tabMat)
  rivet.position.set(0, LID_Y + 0.0009, 0.0045) // in the tab's rivet hole
  rivet.castShadow = true
  rivet.receiveShadow = true

  // scored mouth panel outline: a stadium ring opposite the tab's finger end
  const scoreShape = new THREE.Shape()
  const hw = 0.0045
  const L = 0.014
  scoreShape.moveTo(-hw, hw)
  scoreShape.lineTo(-hw, L - hw)
  scoreShape.absarc(0, L - hw, hw, Math.PI, 0, true)
  scoreShape.lineTo(hw, hw)
  scoreShape.absarc(0, hw, hw, 0, Math.PI, true)
  const inner = new THREE.Path()
  const iw = hw - 0.0006
  inner.moveTo(-iw, hw)
  inner.lineTo(-iw, L - hw)
  inner.absarc(0, L - hw, iw, Math.PI, 0, true)
  inner.lineTo(iw, hw)
  inner.absarc(0, hw, iw, 0, Math.PI, true)
  scoreShape.holes.push(inner)
  const scoreGeo = new THREE.ExtrudeGeometry(scoreShape, {
    depth: 0.00015,
    bevelEnabled: false,
    curveSegments: 12,
  })
  scoreGeo.rotateX(-Math.PI / 2)
  scoreGeo.rotateY(Math.PI) // mouth extends opposite the tab
  scoreGeo.translate(0, 0, -0.0032)
  const score = new THREE.Mesh(scoreGeo, tabMat)
  score.position.set(0, LID_Y + 0.0002, 0)
  score.castShadow = true
  score.receiveShadow = true

  const lidGroup = new THREE.Group()
  lidGroup.add(tab, rivet, score)
  lidGroup.rotation.y = 2.1 // casual yaw so the lid never reads axis-aligned

  const template = new THREE.Group()
  template.add(lower, upper, lid, wrap, lidGroup)
  return { template, height: H, radius: R, liquid: null }
}
