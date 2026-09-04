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
 * Tier 6 — mason-jar LIMEADE. Classic canning-jar silhouette: straight
 * barrel, fast shoulder, wide threaded neck, matte steel screw BAND riding
 * the threads LOW on the neck (the lowest ridge peeks below its skirt), a
 * full centimetre of naked glass rim standing proud ABOVE the band — the jar
 * is unmistakably OPEN: lemonade fills to the SHOULDER, so the surface + ice
 * read through the shoulder glass from game angles (a neck-high fill hid
 * both behind the band — critic). Pressed-glass C mug ear on +X,
 * cloudy saturated lime-green limeade, 3 mostly-submerged ice lumps, LIME
 * wheel on the rim, green/white straw.
 *
 * Why limeade: pale-yellow lemonade in clear glass collapsed into the tier-5
 * OJ highball at game distance ("two transparent containers with similar
 * juice"). Green is ~80° of hue from orange and reads through the wall even
 * at 40 px; the lime wheel + green straw repeat the cue above the rim where
 * the band would otherwise hide it.
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
  const FILL_Y = 0.122 // fill line ON the shoulder (barrel tops out at .108,
  // band skirt starts at .1368): the surface + ice stay visible through the
  // shoulder glass at game angles — the old neck-high .147 hid both behind
  // the steel band, and the jar read as factory-sealed

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

  // ---- limeade: cloudy saturated lime on the lib depth-ramp recipe --------
  // Authored at hue ~114° (green, not chartreuse): the recipe's +7° shift and
  // the warm key's pull toward yellow (measured: 102° authored rendered 87°
  // at the game camera) land the render near 95–100°. Mid
  // value so it stays a GREEN body against the amber plank rather than a
  // bright yellow-green wash; the ramp floor drops to bottle-green so depth
  // still shows. Moderate roughness = the cloud of fresh-pressed limeade.
  const lemonade = buildLiquid(
    inner,
    FILL_Y,
    {
      color: 0x4fc447,
      attenuationColor: 0x1b5c1c, // ramp floor: bottle green, not olive mud
      roughness: 0.16,
    },
    // overhang 8 mm: the fill line sits on the r ≈ .032 shoulder, so a 12°
    // tilted clip plane needs r·tan(12°) ≈ 7 mm of headroom
    { capLighten: 0.18, segments: 48, overhang: 0.008 }
  )

  // ---- ice: 3 lumps riding ~75% submerged, on the shoulder surface --------
  const ice = floatingIce({
    count: 3,
    size: 0.019,
    fillY: FILL_Y,
    spreadRadius: 0.016, // inner r ≈ .032 at the shoulder fill line
    freeboard: 0.28, // a touch prouder than the neck fill had: the lumps must
    // break the surface visibly through the shoulder glass
    seed: 66,
    waterline: 0x4a9a32, // limeade surface tone, darkened — wet band at the line
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
  const bandMat = steel({ anisotropy: 0.5, seed: 61, envMapIntensity: 0.55 })
  // MID-GRAY base albedo: 0xc2c7cc still integrated the golden-hour sun into
  // a near-white drum that read as white plastic at lineup distance (critic,
  // rgb ≈ 224,221,216 sunlit). Metal F0 must hold value contrast — the gray
  // base keeps the sunlit face a step below the highlight, while env 0.55
  // (up from 0.35) keeps a real anisotropic specular streak on the knurl so
  // the band stays METAL in full sun instead of matte putty
  bandMat.color.set(0x878d94)
  bandMat.normalMap = ribNormalTexture(96, 2.4)
  bandMat.normalScale.set(0.55, 0.55)
  const band = new THREE.Mesh(bandGeo, bandMat)
  band.castShadow = true
  band.receiveShadow = true

  // ---- C mug ear on +X: pressed glass -------------------------------------
  // Path bulges to x+tube = 0.048 exactly; both open ends buried in the wall.
  // Tube fattened 3.6 → 4.2 mm (path pulled in to keep the footprint) and
  // tinted a shade cooler/darker than the jar wall so the loop holds a
  // visible edge against the sunlit plank at game distance — the old thin
  // clear rod vanished into the background at 50 px.
  const earMat = solidGlass({ thickness: 0.0084, tint: 0xc4e2d4, roughness: 0.12 })
  const ear = tubeHandle({
    points: [
      [0.0310, 0.1170, 0],
      [0.0406, 0.1158, 0],
      [0.0436, 0.1040, 0],
      [0.0438, 0.0860, 0],
      [0.0420, 0.0690, 0],
      [0.0376, 0.0570, 0],
      [0.0305, 0.0525, 0],
    ],
    tubeRadius: 0.0042,
    material: earMat,
  })
  ear.castShadow = false
  ear.receiveShadow = false

  // ---- straw: green/white candy stripe, elbow above the rim ---------------
  const straw = bentStraw({
    radius: 0.0023,
    bottom: [0.013, 0.02, -0.006],
    bendStart: [0.002, 0.179, -0.016],
    tip: [0.015, 0.207, -0.028],
    color: 0x1e9e3a,
    stripe: 0xfffbe8,
  })

  // ---- LIME wheel slotted over the naked rim on -X ------------------------
  // Green rind, pale-green pulp: the garnish is the second green cue above
  // the rim, where the steel band would otherwise hide the liquid colour.
  const wheel = citrusWheel({
    radius: 0.021,
    thickness: 0.006,
    seed: 12,
    rind: '#2f8f1c',
    pith: '#eef8d6',
    pulp: '#c4ec7a',
    pulpDeep: '#86cf3f',
    vesicle: '#e6f8b4',
  })
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
