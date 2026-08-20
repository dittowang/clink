import * as THREE from 'three'
import type { DrinkVisual } from '../types'
import { TIERS } from '../../config/tiers'
import { latheFromProfile, doubleWalledProfile, type ProfilePoint } from '../lib/profiles'
import { glass, steel } from '../lib/materials'
import { buildLiquid } from '../lib/liquid'
import { makeCondensation } from '../lib/condensation'
import { bentStraw } from '../lib/parts'
import { citrusWheel, tubeHandle, solidGlass, ribNormalTexture, floatingIce } from '../lib/extra-g69'

/**
 * Tier 6 — mason-jar lemonade. Classic canning-jar silhouette: straight
 * barrel, fast shoulder, wide threaded neck, matte steel screw BAND (open —
 * no lid: the glass rim rises clear ABOVE the band top, so the sky reads
 * through the naked lip), pressed-glass C mug ear on +X, cloudy pale
 * lemonade, 3 mostly-submerged ice lumps, straw, a lemon wheel on the rim.
 *
 * Band truth: the skirt hugs the neck (0.8 mm clearance), its bottom edge
 * meets the top thread ridge — engaged, not hovering. R = 0.048, H = 0.170.
 */
export function buildMasonJar(): DrinkVisual {
  const def = TIERS[6]
  const R = def.radius // 0.048
  const H = def.height // 0.170
  const WALL = 0.0025
  const FLOOR_Y = 0.010
  const FILL_Y = 0.112 // lemonade level — meniscus just under the shoulder

  // ---- glass: outer profile, doubleWalledProfile derives the rest ---------
  // Straight barrel → fast mason shoulder → WIDE straight neck running up
  // through the band zone → rim bead → naked lip at H (the tallest glass).
  const outer: ProfilePoint[] = [
    [0.0004, 0.0020], // recess centre
    [0.0190, 0.0020],
    [0.0270, 0.0016], // recess curls down
    [0.0310, 0.0000], // foot ring
    [0.0342, 0.0004],
    [0.0364, 0.0038], // base round-over
    [0.0374, 0.0105],
    [0.0376, 0.0200],
    [0.0378, 0.0450],
    [0.0378, 0.0750],
    [0.0378, 0.1080], // barrel top
    [0.0369, 0.1150], // fast shoulder
    [0.0342, 0.1225],
    [0.0316, 0.1280],
    [0.0309, 0.1310], // neck base — threads live 0.131..0.146
    [0.0308, 0.1420],
    [0.0308, 0.1560], // neck inside the band zone
    [0.0310, 0.1640], // neck exits the band
    [0.0319, 0.1662], // rim bead flares…
    [0.0321, 0.1678], //   …to its widest
    [0.0320, 0.1691], // bead top edge (lip apex lands at ≈H)
  ]
  const { full, inner } = doubleWalledProfile(outer, WALL, FLOOR_Y)
  const glassGeo = latheFromProfile(full, 72, { samples: 96 })

  const condensation = makeCondensation(512, 1024, 6, {
    baseRoughness: 0.05, // fog feeds the 0.6× transmission buffer's blur —
    dropletRoughness: 0.025, // keep the wall clear, droplets carry the cold
    normalStrength: 2.6,
  })
  condensation.roughnessMap.repeat.set(2, 1)
  condensation.normalMap.repeat.set(2, 1)
  const glassMat = glass({
    wallThickness: WALL,
    roughnessMap: condensation.roughnessMap,
    normalMap: condensation.normalMap,
    normalScale: 0.7,
    envMapIntensity: 1.5,
  })
  const glassMesh = new THREE.Mesh(glassGeo, glassMat)
  glassMesh.castShadow = false // transmission-lit; the liquid casts instead
  glassMesh.receiveShadow = false

  // ---- lemonade: cloudy — soft gloss, hot sunny yellow for AgX ------------
  const lemonade = buildLiquid(
    inner,
    FILL_Y,
    {
      color: 0xe4ad1c, // AgX + warm env lighten ~2 stops — author deep gold
      attenuationColor: 0xbd8408,
      attenuationDistance: 0.015,
      roughness: 0.22, // cloudier than clear juice, not chalk
    },
    { capLighten: 0.15, segments: 48 }
  )

  // ---- ice: 3 lumps riding ~80% submerged ---------------------------------
  const ice = floatingIce({
    count: 3,
    size: 0.019,
    fillY: FILL_Y,
    spreadRadius: 0.016,
    freeboard: 0.24,
    seed: 66,
  })

  // ---- thread ridges: 3 clear-glass tori on the neck ----------------------
  // Same material as the jar wall: they read as pressed ridges via their
  // highlight arcs (opaque-ish recipes here read as white plastic rings).
  const threadGeo = new THREE.TorusGeometry(0.0316, 0.0016, 8, 48)
  threadGeo.rotateX(Math.PI / 2)
  const threads = new THREE.Group()
  for (const y of [0.1330, 0.1395, 0.1458]) {
    const t = new THREE.Mesh(threadGeo, glassMat)
    t.position.y = y
    t.castShadow = false
    t.receiveShadow = false
    threads.add(t)
  }

  // ---- screw band: open steel ring ENGAGING the neck ----------------------
  // Skirt inner r 0.0316 over the 0.0308 neck; bottom edge lands on the top
  // thread ridge (y 0.1458 + tube ≈ 0.147). Rolled top curls in only to the
  // neck — the glass lip continues up PAST it, reading unmistakably open.
  const bandProfile: ProfilePoint[] = [
    [0.0318, 0.1468], // bottom edge, on the top thread
    [0.0334, 0.1471], // bottom curl
    [0.0341, 0.1488],
    [0.0342, 0.1530], // knurled skirt wall
    [0.0342, 0.1592],
    [0.0338, 0.1626],
    [0.0327, 0.1648], // rolled shoulder
    [0.0319, 0.1655], // top flat — 1.5 mm PROUD of it the glass bead flares
    [0.0315, 0.1648], // curls down the inside…
    [0.0314, 0.1620], //   …into the neck clearance gap
  ]
  const bandGeo = latheFromProfile(bandProfile, 72, { samples: 30 })
  const bandMat = steel({ anisotropy: 0.5, seed: 61 })
  bandMat.normalMap = ribNormalTexture(96, 2.4)
  bandMat.normalScale.set(0.55, 0.55)
  const band = new THREE.Mesh(bandGeo, bandMat)
  band.castShadow = true
  band.receiveShadow = true

  // ---- C mug ear on +X: pressed glass -------------------------------------
  // Path bulges to x+tube = 0.048 exactly; both open ends buried in the wall.
  const earMat = solidGlass({ thickness: 0.0072 })
  const ear = tubeHandle({
    points: [
      [0.0310, 0.1170, 0],
      [0.0410, 0.1155, 0],
      [0.0442, 0.1040, 0],
      [0.0444, 0.0860, 0],
      [0.0426, 0.0690, 0],
      [0.0380, 0.0570, 0],
      [0.0305, 0.0525, 0],
    ],
    tubeRadius: 0.0036,
    material: earMat,
  })
  ear.castShadow = false
  ear.receiveShadow = false

  // ---- straw: teal candy stripe, elbow above the rim ----------------------
  const straw = bentStraw({
    radius: 0.0023,
    bottom: [0.013, 0.02, -0.006],
    bendStart: [0.002, 0.179, -0.016],
    tip: [0.015, 0.207, -0.028],
    color: 0x1fb5a6,
    stripe: 0xfffbe8,
  })

  // ---- lemon wheel slotted over the naked rim on -X -----------------------
  const wheel = citrusWheel({ radius: 0.021, thickness: 0.006, seed: 12 })
  wheel.rotation.set(Math.PI / 2, 0, 0.1) // face → ±Z, slight jaunty lean
  wheel.position.set(-0.0295, 0.1690, 0)

  const template = new THREE.Group()
  template.add(
    lemonade.volumeMesh,
    lemonade.capMesh,
    ice,
    straw,
    wheel,
    band,
    threads,
    ear,
    glassMesh
  )
  return { template, height: H, radius: R, liquid: lemonade.spec }
}
