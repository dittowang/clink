import * as THREE from 'three'
import type { DrinkVisual } from '../types'
import { TIERS } from '../../config/tiers'
import { latheFromProfile, doubleWalledProfile, type ProfilePoint } from '../lib/profiles'
import { steel } from '../lib/materials'
import { buildLiquid } from '../lib/liquid'
import { makeCondensation } from '../lib/condensation'
import { bentStraw } from '../lib/parts'
import {
  citrusWheel,
  tubeHandle,
  solidGlass,
  ribNormalTexture,
  floatingIce,
  crispGlass,
} from '../lib/extra-g69'

/**
 * Tier 6 — mason-jar lemonade. Classic canning-jar silhouette: straight
 * barrel, fast shoulder, wide threaded neck, matte steel screw BAND riding
 * the threads LOW on the neck (the lowest ridge peeks below its skirt), a
 * full centimetre of naked glass rim standing proud ABOVE the band — the jar
 * is unmistakably OPEN: lemonade fills into the neck, so the mouth shows the
 * surface + ice + straw from the game camera. Pressed-glass C mug ear on +X,
 * cloudy pale lemonade, 3 mostly-submerged ice lumps, lemon wheel on the rim.
 *
 * Band truth: skirt bottom at y .1368 overlaps the thread zone (.133–.146) —
 * screwed ON, not hovering; the rolled top curls in at .157 and the glass
 * bead + lip run .166–.170 clear above it. R = 0.048, H = 0.170.
 */
export function buildMasonJar(): DrinkVisual {
  const def = TIERS[6]
  const R = def.radius // 0.048
  const H = def.height // 0.170
  const WALL = 0.0025
  const FLOOR_Y = 0.010
  const FILL_Y = 0.147 // filled INTO the neck: the open mouth shows lemonade
  // 2.3 cm below the rim (surface line at the side hides behind the band —
  // exactly how a full drink jar photographs)

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
    baseRoughness: 0.05, // roughness map goes UNUSED (see crispGlass) —
    dropletRoughness: 0.025, // only the droplet normals ride the clearcoat
    density: 0.6, // sparse: cold hint, not frost
    normalStrength: 2.6,
  })
  condensation.normalMap.repeat.set(2, 1)
  const glassMat = crispGlass({
    wallThickness: WALL,
    envMapIntensity: 1.5,
    condensationNormalMap: condensation.normalMap,
    normalScale: 0.55,
  })
  const glassMesh = new THREE.Mesh(glassGeo, glassMat)
  glassMesh.castShadow = false // transmission-lit; the liquid casts instead
  glassMesh.receiveShadow = false

  // ---- lemonade: cloudy PALE yellow on the lib depth-ramp recipe ----------
  // The old deep-gold 0xe4ad1c + roughness 0.22 read as opaque custard. Pale
  // high-value base (the ramp still drops the floor to an olive-dark deep, so
  // light visibly penetrates), moderate roughness for cloud — the lib's
  // hue-locked sheen + clearcoat keep it wet rather than chalky.
  const lemonade = buildLiquid(
    inner,
    FILL_Y,
    {
      color: 0xe2c685, // authored at hue ~43° — the lib recipe's +7° hue
      // shift lands it on sunny lemon ~50°, not chartreuse-olive
      attenuationColor: 0x9c741c, // ramp floor: steeped-lemon olive, not mud
      roughness: 0.15,
    },
    // overhang 6 mm: the fill line sits in the r ≈ .028 neck, so a tilted
    // clip plane needs less headroom than the barrel — 6 mm covers 12°
    { capLighten: 0.18, segments: 48, overhang: 0.006 }
  )

  // ---- ice: 3 lumps riding ~80% submerged, inside the neck bore -----------
  const ice = floatingIce({
    count: 3,
    size: 0.019,
    fillY: FILL_Y,
    spreadRadius: 0.013, // bore r ≈ .028 at the fill line — keep lumps clear
    freeboard: 0.24,
    seed: 66,
    waterline: 0xbf9c4a, // lemonade surface tone, darkened — wet band at the line
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

  // ---- screw band: short steel ring SCREWED ONTO the threads --------------
  // The old band sat 0.147–0.166: a tall bright drum ABOVE the thread zone
  // that read as a sealing cap over exposed threads. Now the skirt spans the
  // threads themselves (.1368–.156): the lowest ridge peeks below the bottom
  // edge (screwed on), the rolled top curls in at .157, and ~1.3 cm of naked
  // glass neck + rim bead rise clear above — open jar.
  const bandProfile: ProfilePoint[] = [
    [0.0322, 0.1368], // bottom edge, riding the lowest thread ridge
    [0.0336, 0.1373], // bottom curl
    [0.0342, 0.1392],
    [0.0343, 0.1440], // knurled skirt wall
    [0.0343, 0.1500],
    [0.0339, 0.1535],
    [0.0329, 0.1560], // rolled shoulder
    [0.0320, 0.1572], // narrow top roll — a band edge, not a lid face
    [0.0314, 0.1566], // curls down the inside…
    [0.0313, 0.1540], //   …into the neck clearance gap
  ]
  const bandGeo = latheFromProfile(bandProfile, 72, { samples: 30 })
  const bandMat = steel({ anisotropy: 0.5, seed: 61, envMapIntensity: 0.35 })
  // matte band: the default 0.85 env under the hot beach sky blew the drum
  // to enamel-white (and specular peaks past the 1.0 bloom threshold); the
  // darker base tone pulls the read from cream plastic to satin steel
  bandMat.color.set(0xc2c7cc)
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
