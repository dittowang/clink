import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { DrinkVisual } from '../types'
import { TIERS } from '../../config/tiers'
import { Rng } from '../../core/rng'
import { latheFromProfile, type ProfilePoint } from '../lib/profiles'
import { waxRind } from '../lib/materials'
import { makeCanvasTexture } from '../lib/canvas'
import { noiseCanvas, normalMapFromHeight } from '../lib/noise'
import { polishedMetal, hexNutGeometry } from '../lib/extra-g1011'

/**
 * Tier 10 — watermelon keg. Oblate melon (sphere squashed to 0.72) with
 * 13 wavy meridian stripes under a waxy clearcoat, top cut open (pink flesh
 * annulus + sunken seeded disc), resting in a wooden X-cradle, brass tap
 * with lever at the lower front. R = 0.095, H = 0.200 (config/tiers.ts).
 *
 * Geometry math: horizontal semi-axis A, vertical semi-axis B = 0.72·A.
 * The cut plane sits at CUT_T·B above centre, and the drink's legal top
 * (y = H) IS the cut lip — that pins the melon centre and, from it, the
 * cradle contact line (planks are tangent to the melon cross-section).
 */
export function buildWatermelon(): DrinkVisual {
  const def = TIERS[10]
  const R = def.radius // 0.095
  const H = def.height // 0.200

  const A = 0.0935 // horizontal semi-axis (1.5 mm inside the footprint)
  const B = A * 0.72 // squash per art direction
  const CUT_T = 0.82 // cut plane at 0.82·B above centre
  const YC = H - B * CUT_T // melon centre height → cut lip lands exactly at H
  const CUT_R = A * Math.sqrt(1 - CUT_T * CUT_T) // opening radius ≈ 0.0535

  const template = new THREE.Group()

  // ---- melon body: lathe of the ellipse arc, bottom pole → cut lip --------
  const phi0 = -Math.PI / 2
  const phi1 = Math.asin(CUT_T)
  const melonProfile: ProfilePoint[] = []
  for (let i = 0; i <= 13; i++) {
    const p = phi0 + ((phi1 - phi0) * i) / 13
    melonProfile.push([Math.max(0.0004, Math.cos(p) * A), YC + Math.sin(p) * B])
  }

  const STRIPES = 13
  const rindTex = makeCanvasTexture(1024, 512, (ctx, w, h) => {
    const rng = new Rng(1010)
    // ground: sun-lit yellow-green, mottled (AgX desaturates — stay punchy)
    ctx.fillStyle = '#a9d24f'
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 900; i++) {
      const bx = rng.range(0, w)
      const by = rng.range(0, h)
      const br = rng.range(3, 14)
      ctx.fillStyle = rng.next() < 0.5 ? 'rgba(140,180,60,0.16)' : 'rgba(196,224,120,0.14)'
      ctx.beginPath()
      ctx.ellipse(bx, by, br, br * rng.range(1.4, 3.2), 0, 0, Math.PI * 2)
      ctx.fill()
    }
    // 13 dark meridian stripes with jittered, fingered edges. Stripe centres
    // sit at (s+0.5)/13 so no stripe crosses the tiling seam.
    const stripeW = w / STRIPES
    for (let s = 0; s < STRIPES; s++) {
      const cx = (s + 0.5) * stripeW
      const p1 = rng.range(0, Math.PI * 2)
      const p2 = rng.range(0, Math.PI * 2)
      const p3 = rng.range(0, Math.PI * 2)
      const wob = rng.range(0.85, 1.2)
      const edge = (y: number, sign: number): number => {
        const t = y / h
        // broad meander + mid wobble + fine fingers
        return (
          cx +
          sign * stripeW * 0.24 * wob +
          Math.sin(t * 4.1 + p1) * stripeW * 0.10 +
          Math.sin(t * 9.7 + p2 + sign) * stripeW * 0.065 +
          Math.sin(t * 23 + p3 + sign * 2) * stripeW * 0.035
        )
      }
      ctx.fillStyle = '#2c7031'
      ctx.beginPath()
      ctx.moveTo(edge(0, -1), 0)
      for (let y = 0; y <= h; y += 8) ctx.lineTo(edge(y, -1), y)
      for (let y = h; y >= 0; y -= 8) ctx.lineTo(edge(y, 1), y)
      ctx.closePath()
      ctx.fill()
      // darker veining inside the stripe — long thin runs, not dots
      ctx.fillStyle = 'rgba(20,74,26,0.4)'
      for (let k = 0; k < 20; k++) {
        const vy = rng.range(0, h)
        const vx = cx + rng.range(-0.17, 0.17) * stripeW
        ctx.beginPath()
        ctx.ellipse(vx, vy, rng.range(1.2, 2.6), rng.range(18, 55), 0, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    // pole rows converge to a point — flatten the last rows so the pinch
    // doesn't sparkle
    const g = ctx.createLinearGradient(0, 0, 0, 14)
    g.addColorStop(0, '#5d9440')
    g.addColorStop(1, 'rgba(93,148,64,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, 14)
  })
  // subtle organic bump so the clearcoat highlight doesn't read CG-perfect
  const rindBump = noiseCanvas(256, 256, 4, 77, { cellsX: 18, cellsY: 10, range: [0.2, 0.8] })
  const rindNormal = new THREE.CanvasTexture(normalMapFromHeight(rindBump, 1.6))
  rindNormal.colorSpace = THREE.NoColorSpace
  rindNormal.wrapS = rindNormal.wrapT = THREE.RepeatWrapping
  const rindMat = waxRind({ map: rindTex, normalMap: rindNormal, normalScale: 0.4 })
  const melon = new THREE.Mesh(latheFromProfile(melonProfile, 72, { samples: 36 }), rindMat)

  // ---- cut top: rind ring → flesh annulus → sunken seeded disc ------------
  // v runs outer lip → centre; band positions below follow this profile's
  // arc length (verified against captures).
  const cutProfile: ProfilePoint[] = [
    [CUT_R + 0.0004, H - 0.0001], // kiss the melon lip, no hairline gap
    [0.0510, H - 0.0004],
    [0.0465, H - 0.0009], // white rind ring
    [0.0430, H - 0.0016], // flesh begins
    [0.0409, H - 0.0034],
    [0.0398, H - 0.0058], // sink wall
    [0.0374, H - 0.0072],
    [0.0230, H - 0.0076],
    [0.0004, H - 0.0076], // sunken disc centre
  ]
  const fleshTex = makeCanvasTexture(512, 256, (ctx, w, h) => {
    const rng = new Rng(2020)
    // v-bands: [0, .10) skin edge, [.10, .20) white rind, then flesh
    ctx.fillStyle = '#ff4f58'
    ctx.fillRect(0, 0, w, h)
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0.0, '#679b43')
    grad.addColorStop(0.07, '#9dc474')
    grad.addColorStop(0.105, '#f2f5df') // crisp white inner-rind ring
    grad.addColorStop(0.14, '#fc8f8c')
    grad.addColorStop(0.2, '#ff4753')
    grad.addColorStop(0.4, '#f83442')
    grad.addColorStop(1.0, '#e82c39')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
    // juicy radial streaks (vertical in canvas = radial on the lathe)
    for (let i = 0; i < 70; i++) {
      const x = rng.range(0, w)
      const y0 = rng.range(0.22, 0.6) * h
      ctx.fillStyle = rng.next() < 0.5 ? 'rgba(255,140,145,0.22)' : 'rgba(214,40,52,0.20)'
      ctx.fillRect(x, y0, rng.range(2, 5), rng.range(0.15, 0.35) * h)
    }
    // seeds live on the sunken disc, tips pointing outward
    for (let i = 0; i < 34; i++) {
      const x = rng.range(0, w)
      const y = rng.range(0.42, 0.97) * h
      const sw = rng.range(4, 6)
      const sl = rng.range(9, 13)
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(rng.range(-0.25, 0.25))
      ctx.fillStyle = '#33150d'
      ctx.beginPath()
      ctx.ellipse(0, 0, sw, sl, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,235,210,0.5)' // glint
      ctx.beginPath()
      ctx.ellipse(-sw * 0.25, -sl * 0.3, sw * 0.22, sl * 0.2, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  })
  const fleshMat = new THREE.MeshPhysicalMaterial({
    map: fleshTex,
    // moist but matte: at golden-hour grazing angles a glossier top disc
    // blows out into a white lamp (seen in lineup captures)
    roughness: 0.52,
    clearcoat: 0.18,
    clearcoatRoughness: 0.4,
    specularIntensity: 0.45,
  })
  const cutTop = new THREE.Mesh(latheFromProfile(cutProfile, 64, { samples: 18 }), fleshMat)

  // ---- wooden X-cradle ----------------------------------------------------
  // Planks tilt 30°; their top faces are tangent lines to the melon's XY
  // cross-section (c = YC − √(A²m²+B²)), raised 2 mm so the melon nestles in.
  const TILT = (30 * Math.PI) / 180
  const m = Math.tan(TILT)
  const tangentC = YC - Math.sqrt(A * A * m * m + B * B)
  const PLANK_T = 0.013
  const centerY = tangentC + 0.002 - PLANK_T / 2 / Math.cos(TILT)
  const halfLen = (centerY - (PLANK_T / 2) * Math.cos(TILT)) / Math.sin(TILT)
  const woodTex = makeCanvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#a06a38'
    ctx.fillRect(0, 0, w, h)
    const grain = noiseCanvas(w, h, 4, 909, { cellsX: 3, cellsY: 22, range: [-0.4, 1.6] })
    ctx.globalAlpha = 0.55
    ctx.globalCompositeOperation = 'multiply'
    ctx.drawImage(grain, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    // long grain lines
    const rng = new Rng(4040)
    for (let i = 0; i < 22; i++) {
      const y = rng.range(0, h)
      ctx.strokeStyle = rng.next() < 0.6 ? 'rgba(84,48,20,0.5)' : 'rgba(210,160,105,0.35)'
      ctx.lineWidth = rng.range(0.8, 2)
      ctx.beginPath()
      ctx.moveTo(0, y)
      for (let x = 0; x <= w; x += 16) {
        ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 2.2)
      }
      ctx.stroke()
    }
  })
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping
  const woodMat = new THREE.MeshPhysicalMaterial({
    map: woodTex,
    roughness: 0.72,
    specularIntensity: 0.4,
  })
  const plankGeo = new RoundedBoxGeometry(halfLen * 2, PLANK_T, 0.058, 2, 0.0018)
  const plankA = new THREE.Mesh(plankGeo, woodMat)
  plankA.position.set(0, centerY, 0)
  plankA.rotation.z = TILT
  const plankB = new THREE.Mesh(plankGeo, woodMat)
  plankB.position.set(0, centerY, 0)
  plankB.rotation.z = -TILT

  // ---- brass/steel tap ----------------------------------------------------
  // Azimuth 47° (mostly +X, some +Z): shows in profile at probe/lineup yaw
  // AND pokes the front-view silhouette as the signature nub, while sitting
  // clear of the raised cradle-plank ends so the flange seat stays visible.
  //
  // Seating: on the lower flank the outward ellipse normal tilts ~42° below
  // the horizon. The WHOLE tap is pitched onto that normal so the flange
  // sits flush on the rind over a compressed rubber gasket (the old
  // horizontal-axis tap left the flange floating off the curved surface);
  // nozzle and lever counter-rotate back to world-vertical.
  //
  // Metal read: metal has no diffuse — it IS its reflection. Low roughness +
  // faceted hex nut + mixed brass/nickel are what keep it from rendering as
  // gold-painted wood in a soft env.
  const TAP_AZ = (47 * Math.PI) / 180
  const TAP_Y = 0.108
  const dyE = (TAP_Y - YC) / B
  const surfR = A * Math.sqrt(1 - dyE * dyE)
  // outward ellipse normal ∝ (r/A², (y−yc)/B²)
  const PITCH = Math.atan2((YC - TAP_Y) / (B * B), surfR / (A * A))

  const brass = polishedMetal({ color: 0xe8b64a, roughness: 0.14, envMapIntensity: 1.9 })
  const nickel = polishedMetal({ color: 0xeef1f4, roughness: 0.09, envMapIntensity: 1.7 })
  const gasketMat = new THREE.MeshPhysicalMaterial({ color: 0x1b1b1e, roughness: 0.55 })
  const darkMat = new THREE.MeshPhysicalMaterial({ color: 0x241811, roughness: 0.6 })
  // classic keg-tap accent: lacquered red ball on the lever — reads at
  // game distance where bare metal detail would vanish
  const knobMat = new THREE.MeshPhysicalMaterial({
    color: 0xb32530,
    roughness: 0.25,
    clearcoat: 0.8,
    clearcoatRoughness: 0.15,
  })

  const tap = new THREE.Group()
  // origin 1.5 mm inside the rind; local +Z = outward surface normal
  tap.position.set(Math.sin(TAP_AZ) * (surfR - 0.0015), TAP_Y, Math.cos(TAP_AZ) * (surfR - 0.0015))
  tap.quaternion.multiplyQuaternions(
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), TAP_AZ),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), PITCH)
  )
  // world-down expressed in the pitched tap frame (for the vertical nozzle)
  const downL = new THREE.Vector3(0, -Math.cos(PITCH), Math.sin(PITCH))

  const zAxis = (g: THREE.CylinderGeometry): THREE.CylinderGeometry => {
    g.rotateX(Math.PI / 2)
    return g
  }
  // seat: half-buried gasket ring under a tapered flange + hex nut
  const gasket = new THREE.Mesh(new THREE.TorusGeometry(0.0122, 0.0023, 10, 28), gasketMat)
  gasket.position.z = 0.0008
  const flange = new THREE.Mesh(zAxis(new THREE.CylinderGeometry(0.013, 0.0146, 0.0042, 28)), brass)
  flange.position.z = 0.0032
  const nut = new THREE.Mesh(hexNutGeometry(0.0108, 0.0074), brass)
  nut.position.z = 0.0078
  nut.rotation.z = 0.35 // clock the facets so an edge catches the key light
  const barrel = new THREE.Mesh(zAxis(new THREE.CylinderGeometry(0.0068, 0.0074, 0.011, 20)), brass)
  barrel.position.z = 0.014
  const collar = new THREE.Mesh(zAxis(new THREE.CylinderGeometry(0.0086, 0.0086, 0.0044, 20)), nickel)
  collar.position.z = 0.0195
  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.0072, 18, 14), brass)
  elbow.position.z = 0.0225
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.0054, 0.016, 16), nickel)
  nozzle.position.set(0, 0, 0.0225).addScaledVector(downL, 0.01)
  nozzle.rotation.x = -PITCH // counter-pitch → hangs world-vertical
  const spoutHole = new THREE.Mesh(new THREE.CircleGeometry(0.0034, 14), darkMat)
  spoutHole.position.set(0, 0, 0.0225).addScaledVector(downL, 0.0185)
  spoutHole.rotation.x = Math.PI / 2 - PITCH // face world-down
  // lever: near-vertical in world (net +0.22 rad lean out), red ball on top
  const LEVER_TILT = -PITCH + 0.22
  const leverDir = new THREE.Vector3(0, Math.cos(LEVER_TILT), Math.sin(LEVER_TILT))
  const pivotV = new THREE.Vector3(0, 0.0042, 0.0195)
  const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.0026, 0.0032, 0.026, 12), nickel)
  lever.position.copy(pivotV).addScaledVector(leverDir, 0.012)
  lever.rotation.x = LEVER_TILT
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.0062, 16, 12), knobMat)
  knob.position.copy(pivotV).addScaledVector(leverDir, 0.0275)
  tap.add(gasket, flange, nut, barrel, collar, elbow, nozzle, spoutHole, lever, knob)

  template.add(melon, cutTop, plankA, plankB, tap)
  template.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  return { template, height: H, radius: R, liquid: null }
}
