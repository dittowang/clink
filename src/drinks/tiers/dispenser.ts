import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { DrinkVisual } from '../types'
import { TIERS } from '../../config/tiers'
import {
  latheFromProfile,
  doubleWalledProfile,
  sampleProfile,
  offsetProfile,
  innerRadiusAt,
  type ProfilePoint,
} from '../lib/profiles'
import { glass } from '../lib/materials'
import { buildLiquid } from '../lib/liquid'
import { makeCondensation } from '../lib/condensation'
import {
  applyRadialRibs,
  citrusWheel,
  floatingIce,
  satinSteel,
  woodMaterial,
} from '../lib/extra-g512'

/**
 * Tier 12 — glass drink dispenser. THE BOSS. A fat 16-flute pressed-glass jar
 * (honest 4 mm walls, 14 mm slab floor) on a short turned-leg walnut stand
 * with a ring skirt; steel dome lid + knob; front steel spigot near the jar
 * floor; sunset-orange agua fresca at 70%, citrus wheels pressed flat
 * against the inner wall, ice floating at the surface. Reads HEAVY: wide
 * stance, thick glass, dense liquid.
 *
 * All dimensions in metres. R = 0.130, H = 0.360 (config/tiers.ts).
 * Origin at the stand's feet (base centre), +Y up.
 */
export function buildDispenser(): DrinkVisual {
  const def = TIERS[12]
  const R = def.radius // 0.130
  const H = def.height // 0.360
  const WALL = 0.004 // thick pressed glass
  const STAND_H = 0.05 // the jar sits raised ~5 cm
  const FLOOR_Y = STAND_H + 0.014 // 14 mm glass slab floor — the heavy read
  const FILL_Y = 0.245 // 70% of the jar interior
  const RIBS = 24 // per spec — and 24 divides both lathes' radial segments,
  // so every rib is sampled crest→mid→groove→mid identically (no aliasing)
  const RIB_AMP = 0.0055 // flute depth; crests (0.1287) stay inside the footprint
  const RIB_Y: readonly [number, number] = [0.064, 0.282]
  const RIB_SHARP = 1.0 // pure cosine: even flutes with grooves WIDE enough to
  // scallop the silhouette. The old 0.4 fattened the crests so much that the
  // outline became the crest envelope — a clean arc, i.e. "smooth glass".

  const template = new THREE.Group()

  // ---- wooden stand: 4 turned legs + ring skirt --------------------------
  const wood = woodMaterial({ seed: 31, base: '#96653a', dark: '#5a3517' })

  const legProfile: ProfilePoint[] = [
    [0.0075, 0.0], // foot pad
    [0.011, 0.0012],
    [0.0112, 0.006],
    [0.0085, 0.011], // waist
    [0.0128, 0.02], // bead
    [0.009, 0.029],
    [0.01, 0.038],
    [0.0108, 0.047],
    [0.0108, 0.0498],
    [0.004, 0.0502],
    [0.0004, 0.0502], // capped top (hides under the jar's bottom edge)
  ]
  const legGeo = latheFromProfile(legProfile, 12, { samples: 18 })
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2 // 45° azimuths — front stays clear for the spigot
    const leg = new THREE.Mesh(legGeo, wood)
    leg.position.set(Math.sin(a) * 0.102, 0, Math.cos(a) * 0.102)
    leg.castShadow = true
    leg.receiveShadow = true
    template.add(leg)
  }

  const skirtProfile: ProfilePoint[] = [
    [0.095, 0.05], // top inner
    [0.095, 0.043],
    [0.0958, 0.027],
    [0.102, 0.024], // bottom face
    [0.1055, 0.025],
    [0.1068, 0.033],
    [0.1075, 0.042],
    [0.1102, 0.048], // flared lip cradling the jar base
    [0.1108, 0.0505],
    [0.101, 0.0512], // top face
    [0.095, 0.0505],
  ]
  const skirt = new THREE.Mesh(latheFromProfile(skirtProfile, 40, { samples: 20 }), wood)
  skirt.castShadow = true
  skirt.receiveShadow = true
  template.add(skirt)

  // ---- jar: double-walled fluted glass -----------------------------------
  const outer: ProfilePoint[] = [
    [0.012, 0.0504], // bottom face, slight recess
    [0.07, 0.0502],
    [0.096, 0.0508],
    [0.106, 0.053], // bottom round-over
    [0.1128, 0.062],
    [0.117, 0.08], // lower wall
    [0.1215, 0.115], // belly swell
    [0.1232, 0.16], // max girth (+ rib crests = 0.1287 < R)
    [0.1228, 0.205],
    [0.12, 0.245],
    [0.115, 0.27], // pre-shoulder
    [0.104, 0.288], // shoulder
    [0.089, 0.303],
    [0.0842, 0.311], // mouth band
    [0.084, 0.318], // mouth top (lip closed by doubleWalledProfile)
  ]
  const { full, inner } = doubleWalledProfile(outer, WALL, FLOOR_Y)
  // 144 radial segments = 6 verts per rib (flutes resolve); 44 profile rows
  // claw back most of the triangle cost (flutes are vertical — vertical
  // resolution is cheap to give up on a big smooth jar)
  const glassGeo = latheFromProfile(full, 144, { samples: 44 })
  applyRadialRibs(glassGeo, {
    ribs: RIBS,
    amplitude: RIB_AMP,
    yRange: RIB_Y,
    feather: 0.014,
    outerPoints: sampleProfile(outer, 160),
    grooveSharpness: RIB_SHARP,
  })

  const condensation = makeCondensation(1024, 1024, 12, {
    baseRoughness: 0.05, // low: fog on a jar this big lays a white wash over everything
    density: 0.7,
    normalStrength: 2.4,
  })
  condensation.roughnessMap.repeat.set(2, 1)
  condensation.normalMap.repeat.set(2, 1)
  const glassMat = glass({
    wallThickness: WALL,
    roughnessMap: condensation.roughnessMap,
    normalMap: condensation.normalMap,
    normalScale: 0.55,
    envMapIntensity: 1.05, // 1.4 sheeted the whole front face white at game angle
  })
  const glassMesh = new THREE.Mesh(glassGeo, glassMat)
  glassMesh.castShadow = false // transmission-lit; the liquid casts instead
  glassMesh.receiveShadow = false

  // ---- agua fresca --------------------------------------------------------
  const brew = buildLiquid(
    inner,
    FILL_Y,
    {
      // sunset orange, deeper than the highball's OJ. The old 0xbb2e00
      // (hue 15) rendered PINK — AgX + warm key + white speculars eat ~8° of
      // hue and the chroma, so the authored color sits a step greener and
      // brighter than the target render.
      color: 0xd85102,
      attenuationColor: 0x9a3a00,
      attenuationDistance: 0.03,
      roughness: 0.05,
    },
    { segments: 96, capLighten: 0.03 } // 96 = 4 verts per rib, phase-aligned
  )
  {
    // cut the broad white specular wash (same fix as the highball); the cap
    // is a big sky-facing disc, so it gets cut hardest and roughened — a
    // mirror-tight lobe there sheets the whole surface white at game angle
    const vm = brew.volumeMesh.material as THREE.MeshPhysicalMaterial
    vm.specularIntensity = 0.32
    vm.clearcoat = 0.22
    const cm = brew.capMesh.material as THREE.MeshPhysicalMaterial
    cm.specularIntensity = 0.22
    cm.clearcoat = 0.12
    cm.roughness = 0.16
  }
  // the liquid takes the fluted interior shape — this is what makes the ribs
  // READ: diffuse shading on the orange body, not just glass highlights
  applyRadialRibs(brew.volumeMesh.geometry as THREE.LatheGeometry, {
    ribs: RIBS,
    amplitude: RIB_AMP,
    yRange: RIB_Y,
    feather: 0.014,
    outerPoints: sampleProfile(offsetProfile(inner, 0.0005), 160),
    grooveSharpness: RIB_SHARP,
  })
  // widen the cap disc so the surface still meets the (now fluted) wall
  const capScale = (brew.spec.capRadius + RIB_AMP) / brew.spec.capRadius
  brew.capMesh.scale.set(capScale, capScale, 1)

  // ---- citrus wheels pressed flat against the inner wall ------------------
  // Opaque discs living between the liquid volume and the glass — the disc
  // face stays visible through the wall, the submerged rim hides in the
  // (opaque-pass) liquid. Depth does the work; no transparency involved.
  const orangeWheel = citrusWheel({
    radius: 0.034,
    thickness: 0.005,
    rind: '#e87613',
    pith: '#ffe9c2',
    pulp: '#ffa227',
    pulpDeep: '#f07c00',
    wedges: 9,
    seed: 8,
  })
  const up = new THREE.Vector3(0, 1, 0)
  const placeWheel = (m: THREE.Mesh, azimuth: number, y: number, spin: number): void => {
    // face sits just proud of the liquid's rib crests; at the grooves it digs
    // into (never through) the 4 mm wall — reads as fruit pressed on glass
    const face = innerRadiusAt(inner, y) + RIB_AMP + 0.0002
    const halfT = (m.geometry as THREE.CylinderGeometry).parameters.height / 2
    const dir = new THREE.Vector3(Math.sin(azimuth), 0, Math.cos(azimuth))
    m.quaternion.setFromUnitVectors(up, dir)
    m.rotateY(spin)
    m.position.copy(dir).multiplyScalar(face - halfT)
    m.position.y = y
    template.add(m)
  }
  placeWheel(orangeWheel, 0.55, 0.128, 0.4)
  placeWheel(orangeWheel.clone(), -0.95, 0.19, 1.9)
  placeWheel(
    citrusWheel({
      radius: 0.0255,
      thickness: 0.0045,
      rind: '#3d7a14',
      pith: '#e9f5c0',
      pulp: '#a9cc3e',
      pulpDeep: '#7fa622',
      wedges: 8,
      seed: 11,
    }),
    2.35,
    0.152,
    0.9
  )

  // ---- ice at the surface -------------------------------------------------
  // centres BELOW the fill plane: lumps ride ~2/3 submerged in the opaque
  // brew with shoulders proud — the old proud float read as marshmallows
  const ice = floatingIce({
    count: 7,
    size: 0.031,
    surfaceY: FILL_Y,
    spreadRadius: 0.07,
    seed: 121,
  })

  // ---- steel lid: shallow dome + knob ------------------------------------
  // satinSteel, NOT lib steel(): the dome faces the sun, and the lib recipe's
  // smoother streaks turned its mirror lobe into a bloom lamp (worst at
  // night). Roughness floored at 0.36 + env pulled to 0.62 keeps the metal
  // read without ever crossing the bloom threshold.
  const steelMat = satinSteel({
    anisotropy: 0.4,
    seed: 9,
    color: 0xaab0b8,
    roughnessRange: [0.36, 0.62],
    envMapIntensity: 0.62,
  })
  const lidProfile: ProfilePoint[] = [
    [0.079, 0.3125], // under-edge
    [0.09, 0.3128], // skirt outer bottom
    [0.0918, 0.315], // rolled edge
    [0.0906, 0.319],
    [0.085, 0.3245], // dome start — fuller curve than a cone
    [0.073, 0.3325],
    [0.056, 0.339],
    [0.037, 0.3435],
    [0.021, 0.346],
    [0.0125, 0.347], // dome → knob
    [0.0085, 0.3485],
    [0.008, 0.3515], // knob neck
    [0.0152, 0.3552], // knob bulge
    [0.0138, 0.358],
    [0.006, 0.3597],
    [0.0004, H],
  ]
  const lid = new THREE.Mesh(latheFromProfile(lidProfile, 72, { samples: 32 }), steelMat)
  lid.castShadow = true
  lid.receiveShadow = true

  // ---- spigot: flange, valve body, down-turned nozzle, lever --------------
  // Low on the jar (just above the slab floor) and on a rib crest at +Z.
  const SPIG_Y = 0.07
  const spigotWallR = innerRadiusAt(outer, SPIG_Y) + ribAmpAt(SPIG_Y, RIB_AMP)
  const spigot = new THREE.Group()
  // darker gunmetal than the lid: chrome-white vanishes against the bright
  // liquid; the tap must read as hardware at a glance
  const spigotMat = steelMat.clone()
  spigotMat.color.setHex(0x848b93)
  const addSteel = (geo: THREE.BufferGeometry, x: number, y: number, z: number): void => {
    const m = new THREE.Mesh(geo, spigotMat)
    m.position.set(x, y, z)
    m.castShadow = true
    m.receiveShadow = true
    spigot.add(m)
  }
  const flangeGeo = new THREE.CylinderGeometry(0.016, 0.0175, 0.005, 28)
  flangeGeo.rotateX(Math.PI / 2)
  addSteel(flangeGeo, 0, 0, 0.002)
  const bodyGeo = new THREE.CylinderGeometry(0.0098, 0.0106, 0.0115, 24)
  bodyGeo.rotateX(Math.PI / 2)
  addSteel(bodyGeo, 0, 0, 0.0088)
  const nozzleGeo = new THREE.CylinderGeometry(0.0072, 0.0055, 0.016, 20)
  addSteel(nozzleGeo, 0, -0.0115, 0.0118)
  const pinGeo = new THREE.CylinderGeometry(0.0032, 0.0032, 0.01, 12)
  addSteel(pinGeo, 0, 0.011, 0.0088)
  const paddleGeo = new RoundedBoxGeometry(0.0125, 0.0042, 0.026, 2, 0.0016)
  const paddle = new THREE.Mesh(paddleGeo, spigotMat)
  paddle.position.set(0, 0.0165, 0.011)
  paddle.rotation.x = -0.12 // slight tilt, reads as a lever not a slab
  paddle.castShadow = true
  paddle.receiveShadow = true
  spigot.add(paddle)
  // seat the flange into the rib crest so the tap hugs the wall; keeps the
  // nozzle tip within ~3 mm of the physics footprint (soft visual overlap)
  spigot.position.set(0, SPIG_Y, spigotWallR - 0.003)

  // template order mirrors the highball reference: opaque + liquid first,
  // transmissive glass last
  template.add(brew.volumeMesh, brew.capMesh, ice, lid, spigot, glassMesh)
  return { template, height: H, radius: R, liquid: brew.spec }

  // -- local helpers --------------------------------------------------------
  function ribAmpAt(y: number, amp: number): number {
    // matches applyRadialRibs' envelope (feather 0.014 from y0 = 0.064)
    const t = (y - 0.064) / 0.014
    const s = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)
    return amp * s // +Z sits on a crest (cos(24·π/2) = cos 12π = 1)
  }
}
