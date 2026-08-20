import * as THREE from 'three'
import type { DrinkVisual } from '../types'
import { TIERS } from '../../config/tiers'
import {
  latheFromProfile,
  doubleWalledProfile,
  innerRadiusAt,
  type ProfilePoint,
} from '../lib/profiles'
import { buildLiquid } from '../lib/liquid'
import { makeCondensation } from '../lib/condensation'
import {
  citrusWheel,
  tubeHandle,
  solidGlass,
  pinchSpout,
  floatingIce,
  crispGlass,
  liquidBodyTexture,
} from '../lib/extra-g69'

/**
 * Tier 9 — glass pitcher of iced tea. Big-bellied lathe (widest at ~44% of
 * height), real waist, flared mouth with the rim pinched into a pour spout on
 * -X, chunky pressed-glass D-handle on +X, amber tea with a depth ramp +
 * grazing-angle glow, 5 mostly-submerged ice lumps, two lemon wheels leaning
 * on the inside wall at the tea line, condensation.
 *
 * Sharpness discipline (A/B verified on this tier): the transmission mip
 * LOD is log2(bufferSize) · roughness · clamp(ior·2−2, 0, 1) with a 0.0525
 * roughness FLOOR baked into the shader — even roughness 0 leaves the whole
 * interior a smear. crispGlass() zeroes the ior term instead (ior 1) and
 * hands speculars + condensation droplets to a clearcoat layer, so the only
 * remaining softness is the 0.6× buffer upscale. Droplet detail lives in the
 * clearcoat NORMAL map; the base stays fog-free.
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
    outPush: 0.019, // pushed harder than the probe needs: the spout must
    lift: -0.0055, // survive the 0.6× transmission buffer at trio distance
    pinch: 0.52,
  })

  const condensation = makeCondensation(512, 1024, 9, {
    baseRoughness: 0.03, // roughness map goes UNUSED (see crispGlass) —
    dropletRoughness: 0.02, // only the droplet normals ride the clearcoat
    density: 0.3, // a cold hint — 0.6 @ strength 2.2 painted a soft white
    normalStrength: 1.7, // smear across the whole vessel (crit2-t9)
  })
  condensation.normalMap.repeat.set(2, 1)
  const glassMat = crispGlass({
    wallThickness: WALL,
    envMapIntensity: 0.9, // 1.5 laid a milky sky-reflection veil over the tea
    // and pushed rim speculars past the 1.0 bloom threshold — the trio-shot
    // "fuzzy soft-edged tumbler" was mostly this veil + bloom
    condensationNormalMap: condensation.normalMap,
    normalScale: 0.32,
  })
  const glassMesh = new THREE.Mesh(glassGeo, glassMat)
  glassMesh.castShadow = false // transmission-lit; the tea casts instead
  glassMesh.receiveShadow = false

  // ---- iced tea: hot amber depth ramp + submerged lemon ghosts ------------
  // Opaque-pass tea (the transmission gotcha) fakes light transmission with a
  // PAINTED read: near-black steeped floor → dark amber belly → a hot backlit
  // glow band right under the surface. The previous ramp topped out too early
  // (body color from v0.8 up) and the glass's 1.5 env veil washed it to milky
  // salmon; this ramp keeps the belly dark + saturated and saves the glow for
  // the last 15%. The two lemon wheels get painted GHOSTS below the fill line
  // at their exact azimuths — a wheel seen THROUGH the tea — aligning with
  // the real meshes poking above it.
  const wheelR = 0.025
  const wheelSpecs: ReadonlyArray<{ az: number; y: number }> = [
    { az: 0.7, y: 0.188 }, // front-right through the glass in lineup
    { az: -2.4, y: 0.1865 }, // back-left, catches the probe turntable
  ]
  const tea = buildLiquid(
    inner,
    FILL_Y,
    {
      color: 0xc25708,
      attenuationColor: 0x2e0f02, // ramp floor: dark steeped-tea brown
      roughness: 0.04,
    },
    { segments: 56 }
  )
  const teaSurface = new THREE.Color(0xe88c2a)
  {
    const geo = tea.volumeMesh.geometry
    geo.computeBoundingBox()
    const yMin = geo.boundingBox!.min.y
    const span = Math.max(1e-6, geo.boundingBox!.max.y - yMin)
    const vOf = (y: number): number => (y - yMin) / span
    const rWall = innerRadiusAt(inner, FILL_Y) - 0.0005
    const teaMat = tea.volumeMesh.material as THREE.MeshPhysicalMaterial
    teaMat.map = liquidBodyTexture({
      stops: [
        // authored PAST amber toward orange-brown: AgX + the warm key pull
        // the render back toward salmon-pink; these land on iced-tea amber
        { v: 0.0, color: '#1c0801' },
        { v: 0.3, color: '#521803' },
        { v: 0.62, color: '#8f3005' },
        { v: 0.85, color: '#bd5407' },
        { v: 0.965, color: '#e2841a' },
        { v: 1.0, color: '#eb9226' },
      ],
      vFill: vOf(FILL_Y),
      veil: '#7c2e05',
      rind: '#f0d060',
      pith: '#f7ecc0',
      pulp: '#ecc84e',
      wheels: wheelSpecs.map((s) => ({
        u: ((s.az % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2),
        v: vOf(s.y),
        ru: wheelR / rWall / (Math.PI * 2),
        rv: wheelR / span,
      })),
    })
    teaMat.color.set(0xffffff)
    // the lib's broad sheen reads as a pink-white wash over a dark body —
    // keep only a sliver of grazing lift
    teaMat.sheen = 0.18
    // the cap must meet the wall's surface stop at the meniscus or it bands
    const capMat = tea.capMesh.material as THREE.MeshPhysicalMaterial
    capMat.color.copy(teaSurface).lerp(new THREE.Color(0xffffff), 0.08)
    capMat.envMapIntensity = 1.0 // 1.3 skimmed past the bloom threshold
  }

  // ---- ice: 5 lumps riding ~80% submerged, wet band at the waterline ------
  const ice = floatingIce({
    count: 5,
    size: 0.024,
    fillY: FILL_Y,
    spreadRadius: 0.033, // spread toward the walls — a centred clump reads
    freeboard: 0.18, // as one blob at game distance
    seed: 99,
    waterline: teaSurface.clone().multiplyScalar(0.72),
  })

  // ---- two lemon wheels leaning on the inside wall ------------------------
  // Coin-against-the-wall pose: a modest crescent above the tea line, the
  // painted ghost continuing it below — one wheel crossing the surface.
  const wheelProto = citrusWheel({ radius: wheelR, thickness: 0.0065, seed: 21 })
  const wheels = new THREE.Group()
  const lean = 0.3 // rad from vertical, top edge outward
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
  // Smoky sea-glass tint at env 1.0: the default pale mint @ 1.8 rendered the
  // whole handle frosted bone-white (crit2 probe) and it melted into the sky
  // at trio distance — a darker body keeps silhouette contrast, the clearcoat
  // rim highlights keep it reading as glass.
  const handleMat = solidGlass({
    thickness: 0.012,
    tint: 0x9bb8ab,
    roughness: 0.12,
    envMapIntensity: 1.0,
  })
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
