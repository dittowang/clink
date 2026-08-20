import * as THREE from 'three'
import type { DrinkVisual } from '../types'
import { TIERS } from '../../config/tiers'
import { latheFromProfile, doubleWalledProfile, type ProfilePoint } from '../lib/profiles'
import { glass } from '../lib/materials'
import { buildLiquid } from '../lib/liquid'
import { makeCondensation } from '../lib/condensation'
import {
  citrusWheel,
  tubeHandle,
  solidGlass,
  pinchSpout,
  floatingIce,
  liquidDepthGradient,
} from '../lib/extra-g69'

/**
 * Tier 9 — glass pitcher of iced tea. Big-bellied lathe (widest at ~44% of
 * height), real waist, flared mouth with the rim pinched into a pour spout on
 * -X, chunky pressed-glass D-handle on +X, amber tea with a depth ramp +
 * grazing-angle glow, 5 mostly-submerged ice lumps, two lemon wheels leaning
 * on the inside wall at the tea line, condensation.
 *
 * Sharpness discipline: everything inside is seen through the transmissive
 * wall, whose transmission buffer runs at 0.6× resolution — roughness
 * multiplies that blur (LOD ∝ roughness). Fog stays ≤ 0.035 on a glass this
 * big or the whole tier smears at game distance; droplet NORMALS carry the
 * cold story instead.
 *
 * Spout on -X / handle on +X so BOTH silhouette signatures read in the
 * front-facing lineup + silhouette strip. R = 0.075, H = 0.240.
 */
export function buildPitcher(): DrinkVisual {
  const def = TIERS[9]
  const R = def.radius // 0.075
  const H = def.height // 0.240
  const WALL = 0.003
  const FLOOR_Y = 0.012
  const FILL_Y = 0.185 // tea level, at the waist run-in

  // ---- glass: belly → waist → flared mouth --------------------------------
  const outer: ProfilePoint[] = [
    [0.0004, 0.0020], // recess centre
    [0.0300, 0.0020],
    [0.0400, 0.0016], // recess curls down
    [0.0450, 0.0000], // foot ring
    [0.0500, 0.0004],
    [0.0548, 0.0042], // base round-over
    [0.0585, 0.0125],
    [0.0648, 0.0420],
    [0.0678, 0.0760],
    [0.0685, 0.1060], // belly max — 44% of H
    [0.0668, 0.1380],
    [0.0615, 0.1700],
    [0.0540, 0.1950],
    [0.0500, 0.2100],
    [0.0492, 0.2180], // waist min
    [0.0500, 0.2260],
    [0.0530, 0.2340], // flare out
    [0.0558, 0.2390],
    [0.0560, 0.2400], // rim
  ]
  const { full, inner } = doubleWalledProfile(outer, WALL, FLOOR_Y)
  const glassGeo = latheFromProfile(full, 80, { samples: 104 })
  // pour spout: pinch the front rim arc outward + down (pressed-glass lip)
  pinchSpout(glassGeo, {
    azimuth: -Math.PI / 2, // -X
    startY: 0.200,
    topY: H,
    halfAngle: 0.68,
    outPush: 0.016,
    lift: -0.0045,
    pinch: 0.45,
  })

  const condensation = makeCondensation(512, 1024, 9, {
    baseRoughness: 0.03, // see header — fog on THIS tier is game-distance blur
    dropletRoughness: 0.02,
    density: 0.85,
    normalStrength: 2.2,
  })
  condensation.roughnessMap.repeat.set(2, 1)
  condensation.normalMap.repeat.set(2, 1)
  const glassMat = glass({
    wallThickness: WALL,
    roughness: 0.02,
    envMapIntensity: 1.5,
  })
  const glassMesh = new THREE.Mesh(glassGeo, glassMat)
  glassMesh.castShadow = false // transmission-lit; the tea casts instead
  glassMesh.receiveShadow = false

  // ---- iced tea: amber with a depth ramp + warm rim glow ------------------
  // Opaque-pass (transmission gotcha), so the translucency is FAKED: a
  // vertical ramp (near-black floor → hot amber at the surface) plays the
  // attenuation depth, sheen plays the sun bleeding through the grazing
  // edges. Colors authored hot — AgX pulls them back toward brick.
  const tea = buildLiquid(
    inner,
    FILL_Y,
    {
      color: 0xffffff, // the read lives in the ramp map below
      attenuationColor: 0x4a2002,
      attenuationDistance: 0.02,
      roughness: 0.04,
    },
    { segments: 56 }
  )
  {
    const ramp = liquidDepthGradient([
      { v: 0.0, color: '#3a1401' }, // floor: reads nearly black through glass
      { v: 0.3, color: '#642803' },
      { v: 0.62, color: '#9c4306' },
      { v: 0.85, color: '#c65f0a' },
      { v: 1.0, color: '#e07c12' }, // meniscus: sunlit hot amber
    ])
    const vm = tea.volumeMesh.material as THREE.MeshPhysicalMaterial
    vm.map = ramp
    vm.sheen = 0.85 // grazing-angle warm bleed = fake edge translucency
    vm.sheenColor = new THREE.Color(0xff9226)
    vm.sheenRoughness = 0.38
    vm.clearcoat = 0.5
    vm.clearcoatRoughness = 0.08
    vm.specularIntensity = 0.55
    const cm = tea.capMesh.material as THREE.MeshPhysicalMaterial
    cm.color.set(0xd8720f) // surface disc: the ramp's hot end, lifted a touch
    cm.sheen = 0.5
    cm.sheenColor = new THREE.Color(0xffa03a)
    cm.sheenRoughness = 0.4
    cm.clearcoat = 0.5
    cm.clearcoatRoughness = 0.08
  }

  // ---- ice: 5 lumps riding ~80% submerged ---------------------------------
  const ice = floatingIce({
    count: 5,
    size: 0.024,
    fillY: FILL_Y,
    spreadRadius: 0.03,
    freeboard: 0.2,
    seed: 99,
  })

  // ---- two lemon wheels leaning on the inside wall ------------------------
  // Coin-against-the-wall pose: top edge kisses the inner wall above the tea
  // line, bottom edge submerged (the opaque-pass tea hides it — the visible
  // half reads pressed against the glass, which is the story).
  const wheelProto = citrusWheel({ radius: 0.025, thickness: 0.0065, seed: 21 })
  const wheels = new THREE.Group()
  const lean = 0.3 // rad from vertical, top edge outward
  const wheelSpecs: ReadonlyArray<{ az: number; y: number }> = [
    { az: 0.7, y: 0.192 }, // front-right through the glass in lineup
    { az: -2.4, y: 0.189 }, // back-left, catches the probe turntable
  ]
  const up = new THREE.Vector3(0, 1, 0)
  for (const s of wheelSpecs) {
    const w = wheelProto.clone()
    const c = 0.0395
    w.position.set(Math.sin(s.az) * c, s.y, Math.cos(s.az) * c)
    // face normal = radial, tilted down by `lean` (top edge leans outward)
    const dir = new THREE.Vector3(
      Math.sin(s.az) * Math.cos(lean),
      -Math.sin(lean),
      Math.cos(s.az) * Math.cos(lean)
    )
    w.quaternion.setFromUnitVectors(up, dir)
    wheels.add(w)
  }

  // ---- D-handle on +X: chunky pressed glass -------------------------------
  // Bulges to x+tube = 0.0748; both open tube ends buried inside the wall.
  const handleMat = solidGlass({ thickness: 0.012 })
  const handle = tubeHandle({
    points: [
      [0.0440, 0.2140, 0],
      [0.0600, 0.2130, 0],
      [0.0672, 0.2020, 0],
      [0.0690, 0.1800, 0],
      [0.0685, 0.1500, 0],
      [0.0645, 0.1230, 0],
      [0.0550, 0.1040, 0],
    ],
    tubeRadius: 0.0058,
    material: handleMat,
    tubularSegments: 44,
  })
  handle.castShadow = false
  handle.receiveShadow = false

  const template = new THREE.Group()
  template.add(tea.volumeMesh, tea.capMesh, ice, wheels, handle, glassMesh)
  return { template, height: H, radius: R, liquid: tea.spec }
}
