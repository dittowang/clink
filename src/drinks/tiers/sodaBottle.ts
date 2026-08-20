import * as THREE from 'three'
import type { DrinkVisual } from '../types'
import { TIERS } from '../../config/tiers'
import { doubleWalledProfile, latheFromProfile, type ProfilePoint } from '../lib/profiles'
import { glass } from '../lib/materials'
import { buildLiquid } from '../lib/liquid'
import { makeCondensation } from '../lib/condensation'
import { makeCanvasTexture, SYSTEM_FONT, paintRoundel } from '../lib/canvas'
import { paperboard } from '../lib/materials'
import { crownCap } from '../lib/extra-g34'

/**
 * Tier 4 — stubby 70s amber soda bottle. R = 0.037, H = 0.185
 * (config/tiers.ts). Wide low body (~60% of height), fast shoulder, short
 * neck, 21-flute crown cap. Amber glass via the double-walled profile
 * (honest 3.2 mm wall, tint through attenuation), dark cola inside built
 * from the inner profile (opaque-pass — the transmission buffer only sees
 * opaque objects), cream paper band label with red roundel + gold
 * pinstripes, condensation on the cold glass.
 */
export function buildSodaBottle(): DrinkVisual {
  const def = TIERS[4]
  const R = def.radius // 0.037
  const H = def.height // 0.185
  const WALL = 0.0032
  const FLOOR_Y = 0.010
  const FILL_Y = 0.15 // into the shoulder, headspace in the neck
  const GLASS_TOP = 0.177 // lip hides inside the crown cap
  const BODY_R = 0.0366 // glass body; the paper label on top reaches R exactly

  // ---- amber glass: outer wall, doubled by the lib -------------------------
  const outer: ProfilePoint[] = [
    [0.0004, 0.0016], // base recess (push-up hinted)
    [0.018, 0.0016],
    [0.0262, 0.001],
    [0.0296, 0.0], // foot contact ring
    [0.0332, 0.0006],
    [0.0354, 0.004], // base round-over
    [0.0364, 0.011],
    [BODY_R, 0.025],
    [BODY_R, 0.06],
    [BODY_R, 0.095], // wide low body
    [0.036, 0.11], // shoulder begins…
    [0.0331, 0.124],
    [0.0267, 0.139], //   …fast 70s shoulder
    [0.0193, 0.151],
    [0.0149, 0.16],
    [0.0134, 0.168], // short neck
    [0.013, 0.174],
    [0.0129, GLASS_TOP],
  ]
  const { full, inner } = doubleWalledProfile(outer, WALL, FLOOR_Y)

  const cond = makeCondensation(512, 1024, 41, {
    baseRoughness: 0.1,
    dropletRoughness: 0.03,
    normalStrength: 2.6,
  })
  cond.roughnessMap.repeat.set(1, 2)
  cond.normalMap.repeat.set(1, 2)

  const glassMat = glass({
    wallThickness: WALL,
    tint: 0x84400a, // amber — reads through attenuation, not color
    attenuationDistance: 0.0032,
    roughnessMap: cond.roughnessMap,
    normalMap: cond.normalMap,
    normalScale: 0.8,
    envMapIntensity: 1.1, // beach sky is bright — more washes the amber out
  })
  const glassMesh = new THREE.Mesh(latheFromProfile(full, 64, { samples: 60 }), glassMat)
  glassMesh.castShadow = false // transmission-lit; the liquid casts instead
  glassMesh.receiveShadow = false

  // ---- dark cola: near-black body, warm edges come from the amber wall -----
  const cola = buildLiquid(
    inner,
    FILL_Y,
    {
      color: 0x240a05, // deep brown-black with a red bias (ruby under the sun)
      attenuationColor: 0x4a0d04,
      attenuationDistance: 0.012, // honest if ever run transmissive
      roughness: 0.05,
    },
    { segments: 40, capLighten: 0.2 }
  )

  // ---- cream paper band label ---------------------------------------------
  const LABEL_Y0 = 0.05
  const LABEL_Y1 = 0.102 // 0.052 tall ≥ H/4
  const labelTexture = makeCanvasTexture(1024, 384, (ctx, w, h) => {
    // aged cream paper with the faintest vertical grain
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, '#f7ecc8')
    g.addColorStop(0.5, '#f3e4b8')
    g.addColorStop(1, '#eeddab')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)

    // gold pinstripe pairs at both edges
    ctx.fillStyle = '#c69a2e'
    for (const y of [0.055, 0.105, 0.895, 0.945]) ctx.fillRect(0, y * h - 2, w, 4)
    ctx.fillStyle = '#a97f1f'
    for (const y of [0.08, 0.92]) ctx.fillRect(0, y * h - 1, w, 2)

    // thin red rules with diamonds at the label's quarter seams
    ctx.fillStyle = '#c8271d'
    for (const x of [0, 0.5 * w, w]) {
      ctx.fillRect(x - 1.5, 0.16 * h, 3, 0.68 * h)
      ctx.save()
      ctx.translate(x, 0.5 * h)
      ctx.rotate(Math.PI / 4)
      ctx.fillRect(-7, -7, 14, 14)
      ctx.restore()
    }

    // front (u 0.25 after mesh yaw): red roundel over a gold halo
    const fx = 0.25 * w
    const fy = 0.5 * h
    const rr = 0.31 * h
    paintRoundel(ctx, fx, fy, rr + 5, { fill: '#c69a2e' })
    paintRoundel(ctx, fx, fy, rr, { fill: '#c9170b', ring: '#f7ecc8', ringWidth: 0.09 })
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#f7ecc8'
    ctx.font = `700 ${Math.round(0.09 * h)}px ${SYSTEM_FONT}`
    ctx.fillText('CLINK', fx, fy - 0.155 * h)
    ctx.font = `italic 900 ${Math.round(0.17 * h)}px ${SYSTEM_FONT}`
    ctx.fillText('Cola', fx, fy + 0.01 * h)
    ctx.font = `700 ${Math.round(0.055 * h)}px ${SYSTEM_FONT}`
    ctx.fillText('SODA WORKS', fx, fy + 0.16 * h)
    // wing text either side of the roundel
    ctx.fillStyle = '#8a6a20'
    ctx.font = `700 ${Math.round(0.062 * h)}px ${SYSTEM_FONT}`
    ctx.fillText('SINCE', fx - 0.115 * w, fy)
    ctx.fillText('1971', fx + 0.115 * w, fy)

    // back (u 0.75): fake ingredient block — decorative
    const bx = 0.75 * w
    ctx.fillStyle = '#7a5c1e'
    ctx.font = `700 ${Math.round(0.07 * h)}px ${SYSTEM_FONT}`
    ctx.fillText('CONTENTS 355 mL', bx, 0.26 * h)
    ctx.fillStyle = 'rgba(122,92,30,0.55)'
    for (let i = 0; i < 5; i++) {
      const lw = (0.16 - 0.02 * (i % 3)) * w
      ctx.fillRect(bx - lw / 2, (0.38 + i * 0.09) * h, lw, 0.028 * h)
    }
  })
  const labelMat = paperboard({ labelTexture })
  const label = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, LABEL_Y1 - LABEL_Y0, 64, 1, true),
    labelMat
  )
  label.position.y = (LABEL_Y0 + LABEL_Y1) / 2
  label.rotation.y = -Math.PI / 2 // roundel (u 0.25) faces the camera
  label.castShadow = true
  label.receiveShadow = true

  // ---- crown cap: red lacquered steel, 21 flutes, printed lid --------------
  const capTopTexture = makeCanvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#c9170b'
    ctx.fillRect(0, 0, w, h)
    paintRoundel(ctx, w / 2, h / 2, w * 0.42, { fill: '#c9170b', ring: '#f7ecc8', ringWidth: 0.1 })
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#f7ecc8'
    ctx.font = `italic 900 ${Math.round(0.3 * h)}px ${SYSTEM_FONT}`
    ctx.fillText('Clink', w / 2, h / 2)
  })
  // Lithographed PAINT, not tinted chrome: high metalness mirrored the golden
  // sun disc off the cap top at ~HDR sky radiance and crossed the bloom
  // threshold (white-hot flare + halo in lineup trios). Dielectric red albedo
  // with a restrained clearcoat keeps the enamel gloss while the specular
  // peak stays under the bloom cut.
  const capMat = new THREE.MeshPhysicalMaterial({
    color: 0xc41708,
    metalness: 0.18,
    roughness: 0.42,
    specularIntensity: 0.45,
    clearcoat: 0.3,
    clearcoatRoughness: 0.32,
    envMapIntensity: 0.7,
    side: THREE.DoubleSide, // skirt underside shows at game angles
  })
  const capTopMat = new THREE.MeshPhysicalMaterial({
    map: capTopTexture,
    metalness: 0.15,
    roughness: 0.44,
    specularIntensity: 0.35, // the up-facing disc sees the whole golden sky —
    clearcoat: 0.22, //          keep its sheen below a desaturating wash
    clearcoatRoughness: 0.34,
    envMapIntensity: 0.6,
  })
  const cap = crownCap({
    radius: 0.0165,
    height: 0.0112,
    scallop: 0.0014,
    material: capMat,
    topMaterial: capTopMat,
  })
  cap.position.y = H - 0.0112 // cap top lands exactly at H

  const template = new THREE.Group()
  template.add(cola.volumeMesh, cola.capMesh, label, cap, glassMesh)
  return { template, height: H, radius: R, liquid: cola.spec }
}
