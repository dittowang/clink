import * as THREE from 'three'
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
import { polishedMetal, hexNutGeometry } from '../lib/extra-g1011'

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
  const RIB_AMP = 0.0065 // rib relief; belly crests (0.1297) stay inside R
  // Band runs over the WHOLE shoulder (termination tucks under the lid
  // skirt: mouth crests 0.0907 < skirt 0.0918) and down the base round-over.
  // On a vertical wall the limb azimuth is constant per height, so vertical
  // ribs can NEVER scallop the vertical silhouette — the outline only
  // scallops where the wall turns. Ending the flutes at 0.282 was why the
  // outline stayed a clean arc: the shoulder, the one region that CAN
  // scallop, was left smooth.
  const RIB_Y: readonly [number, number] = [0.058, 0.316]
  // Glass ribs must be NARROW PROUD RIDGES (sharpness > 1), not wide cosine
  // flutes: the silhouette of a lathe is its support function, so with 24
  // wide flutes the neighbouring crest always rules the limb and the outline
  // dip caps at R·(1 − cos 7.5°) ≈ 1 mm no matter the amplitude — a clean
  // arc (both 0.4 and 1.0 were tried; both read as smooth glass). With
  // narrow ridges over a smooth base the outline drops to the BASE radius
  // between ridges: the full 6.5 mm relief, read at the shoulder turn.
  const GLASS_RIB_SHARP = 2.2
  const LIQUID_RIB_SHARP = 1.0 // the liquid keeps wide cosine flutes — its
  // job is the broad diffuse rib shading on the orange body, not the outline

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
  // partial lathe: a 26° notch centred on +Z (lathe phi 0 = +Z) so the stand
  // never crowds the spigot — the boss's tap must read at trio distance, not
  // vanish behind the skirt lip. The profile is a closed loop, so the two cut
  // ends are capped with thin wood slabs to hide the hollow cross-section.
  const NOTCH = THREE.MathUtils.degToRad(26)
  const skirtGeo = new THREE.LatheGeometry(
    sampleProfile(skirtProfile, 20),
    40,
    NOTCH / 2,
    Math.PI * 2 - NOTCH
  )
  const skirt = new THREE.Mesh(skirtGeo, wood)
  skirt.castShadow = true
  skirt.receiveShadow = true
  template.add(skirt)
  const capGeo = new THREE.BoxGeometry(0.0022, 0.028, 0.017)
  for (const side of [-1, 1]) {
    const cap = new THREE.Mesh(capGeo, wood)
    const a = (side * NOTCH) / 2 // cut-plane azimuth off +Z
    const rMid = 0.1025
    cap.position.set(Math.sin(a) * rMid, 0.0376, Math.cos(a) * rMid)
    cap.rotation.y = a
    cap.castShadow = true
    cap.receiveShadow = true
    template.add(cap)
  }

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
  // 168 radial segments = 7 verts per rib, crest-aligned — a sharpness-2.2
  // ridge is only ~2.6° wide at half height and 144 segs (2.5° spacing)
  // aliased it to facets; 44 rows keep the shoulder band (where the flutes
  // now terminate and the outline scallops) resolved vertically
  const glassGeo = latheFromProfile(full, 168, { samples: 44 })
  applyRadialRibs(glassGeo, {
    ribs: RIBS,
    amplitude: RIB_AMP,
    yRange: RIB_Y,
    feather: 0.014,
    outerPoints: sampleProfile(outer, 160),
    grooveSharpness: GLASS_RIB_SHARP,
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
      // sunset orange-RED, target RENDERED hue ≈ 15–18 — a full step redder
      // than the highball's OJ (renders ≈ 30+) so the two never rhyme.
      // AgX compresses authored hue moves ~3:1 (authored 22 → rendered 24.5,
      // authored 12 → rendered 21 measured on the probe), so landing under
      // 18 takes an authored hue ~8. Value sits LOW (0.72): AgX drags
      // bright saturates toward white, so the dense sunset read must be
      // authored as pigment depth.
      color: 0xb81f06,
      attenuationColor: 0x741d02,
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
    vm.envMapIntensity = 0.8 // sharp env mirror of the bright warm sky is an
    // additive white wash — the main desaturator pulling sunset red to salmon
    vm.color.setScalar(0.88) // multiplies the depth ramp: AgX's chroma
    // compression grows with luminance, so −12% luminance buys the rendered
    // body ~+0.05 saturation (measured slope ≈ −1 sat/val on the probe)
    const cm = brew.capMesh.material as THREE.MeshPhysicalMaterial
    cm.specularIntensity = 0.22
    cm.clearcoat = 0.12
    cm.roughness = 0.16
    cm.envMapIntensity = 0.7
    cm.color.setHex(0x7e1c04) // the sky-facing disc catches 2–4× the wall's
    // irradiance — the ramp's lightened surface tone rendered it salmon-PINK
    // (the critic's read), and even 0xa82706 came back at sat 0.35. The
    // sunset surface must be authored near-maroon to RENDER sunset.
  }
  // the liquid takes the fluted interior shape — this is what makes the ribs
  // READ: diffuse shading on the orange body, not just glass highlights
  applyRadialRibs(brew.volumeMesh.geometry as THREE.LatheGeometry, {
    ribs: RIBS,
    amplitude: RIB_AMP,
    yRange: RIB_Y,
    feather: 0.014,
    outerPoints: sampleProfile(offsetProfile(inner, 0.0005), 160),
    grooveSharpness: LIQUID_RIB_SHARP,
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
  // brew with shoulders proud — the old proud float read as marshmallows.
  // liquidTint bakes a vertex-color waterline (wet sunset film climbing the
  // lump) — without it the lumps rendered as white foam puffs at trio range.
  const ice = floatingIce({
    count: 7,
    size: 0.031,
    surfaceY: FILL_Y,
    spreadRadius: 0.07,
    seed: 121,
    submerge: [0.66, 0.8], // big lumps ride LOW — the less white crown shows
    // through the streaky ribbed glass, the less foam-puff the cluster reads
    liquidTint: 0xb63812, // a step lighter than the near-maroon cap: the
    liquidDeep: 0x84230a, // waterline must read as the DRINK's color
  })

  // ---- steel lid: shallow dome + knob ------------------------------------
  // satinSteel, NOT lib steel(): the dome faces the sun, and the lib recipe's
  // smoother streaks turned its mirror lobe into a bloom lamp (worst at
  // night). [0.36, 0.62] @ env 0.62 still left a soft halo spilling onto the
  // sand at golden hour (sun specular, not env, crossing 1.0): floor 0.44 +
  // env 0.5 kills the last of it — anisotropic streaks + metalness 1 carry
  // the steel read, not the mirror lobe.
  const steelMat = satinSteel({
    anisotropy: 0.4,
    seed: 9,
    color: 0xaab0b8,
    roughnessRange: [0.44, 0.68],
    envMapIntensity: 0.5,
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

  // ---- spigot: gasket, bell flange, hex collar, valve, spout, lever -------
  // Low on the jar and on a rib crest at +Z. Built at 1:1 then scaled — at 1×
  // the tap vanished at trio distance and the boss read as a candy jar.
  //
  // REBUILT after the close-up critique (flat matte bone-white disc + slab
  // lever + hard-clipped cone = paper-craft): the finish bar is tier 10's keg
  // tap, so this follows the same captured-verified grammar — mid-rough
  // polishedMetal (satinSteel's 0.44+ roughness floor is right for the big
  // sun-facing lid but renders small hardware as matte bone), a rubber gasket
  // seating the metal on the glass, facet value-steps from a hex collar, a
  // down-turned spout with a rolled lip + dark bore, and a near-vertical
  // lever with a lacquered ball — the red accent is what survives at trio
  // distance, where bare-metal detail degrades to a gray blob.
  const SPIG_SCALE = 1.35
  const SPIG_Y = 0.085 // nozzle tip stays a clear 10 mm above the skirt lip —
  // at 0.082 the old clipped cone visually crowded the stand's wooden skirt
  const spigotWallR = innerRadiusAt(outer, SPIG_Y) + ribAmpAt(SPIG_Y, RIB_AMP)
  const spigot = new THREE.Group()
  const nickel = polishedMetal({ color: 0x99a1aa, roughness: 0.26, envMapIntensity: 1.0 })
  const gunmetal = polishedMetal({ color: 0x5f666f, roughness: 0.3, envMapIntensity: 0.9 })
  const gasketMat = new THREE.MeshPhysicalMaterial({ color: 0x4a423a, roughness: 0.6 })
  const boreMat = new THREE.MeshPhysicalMaterial({ color: 0x241811, roughness: 0.6 })
  const knobMat = new THREE.MeshPhysicalMaterial({
    color: 0xb32530,
    roughness: 0.25,
    clearcoat: 0.8,
    clearcoatRoughness: 0.15,
  })
  const addPart = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.castShadow = true
    m.receiveShadow = true
    spigot.add(m)
    return m
  }
  const zAxis = (g: THREE.CylinderGeometry): THREE.CylinderGeometry => {
    g.rotateX(Math.PI / 2)
    return g
  }
  // fat rubber gasket half-buried against the crest: the metal is PRESSED on
  // the glass, not butted (the tier-10 "tap floats" lesson)
  addPart(new THREE.TorusGeometry(0.0128, 0.0028, 10, 32), gasketMat, 0, 0, 0.0008)
  // bell flange: a small lathe, NOT a flat disc — the rim rolls back toward
  // the glass and necks smoothly into the valve barrel
  const bellProfile: ProfilePoint[] = [
    [0.0155, 0.0002],
    [0.0152, 0.0014],
    [0.0136, 0.0034],
    [0.0111, 0.0048],
    [0.009, 0.0055],
    [0.0077, 0.006],
  ]
  const bellGeo = latheFromProfile(bellProfile, 36, { samples: 16 })
  bellGeo.rotateX(Math.PI / 2)
  addPart(bellGeo, nickel, 0, 0, 0)
  // hex collar: per-facet value steps are the "machined" read
  const nut = addPart(hexNutGeometry(0.0102, 0.0066), gunmetal, 0, 0, 0.0086)
  nut.rotation.z = 0.4 // clock a facet edge into the key light
  addPart(zAxis(new THREE.CylinderGeometry(0.0067, 0.0073, 0.0095, 32)), nickel, 0, 0, 0.0142)
  addPart(zAxis(new THREE.CylinderGeometry(0.0085, 0.0085, 0.0042, 32)), gunmetal, 0, 0, 0.0194)
  addPart(new THREE.SphereGeometry(0.0071, 22, 16), nickel, 0, 0, 0.0206) // valve body
  // down-turned spout: taper + ROLLED LIP + dark bore (the old cone just
  // stopped in a hard clipped face)
  addPart(new THREE.CylinderGeometry(0.0053, 0.0044, 0.0125, 28), nickel, 0, -0.0105, 0.0206)
  const lip = addPart(new THREE.TorusGeometry(0.0042, 0.0013, 8, 24), nickel, 0, -0.0166, 0.0206)
  lip.rotation.x = Math.PI / 2
  const bore = addPart(new THREE.CircleGeometry(0.0034, 16), boreMat, 0, -0.017, 0.0206)
  bore.rotation.x = Math.PI / 2 // face world-down
  // lever: tapered stem leaning out over the spout, lacquered ball on top
  const LEVER_TILT = 0.35
  const leverDir = new THREE.Vector3(0, Math.cos(LEVER_TILT), Math.sin(LEVER_TILT))
  const pivot = new THREE.Vector3(0, 0.004, 0.0206)
  const lever = addPart(
    new THREE.CylinderGeometry(0.0022, 0.0028, 0.019, 14),
    nickel,
    0,
    0,
    0
  )
  lever.position.copy(pivot).addScaledVector(leverDir, 0.0095)
  lever.rotation.x = LEVER_TILT
  const knob = addPart(new THREE.SphereGeometry(0.0057, 18, 14), knobMat, 0, 0, 0)
  knob.position.copy(pivot).addScaledVector(leverDir, 0.021)
  // seat the assembly at crest − 5 mm (ribs are narrow ridges; the gasket
  // fills the ring where the bell rim stands off the groove glass). The spout
  // overhangs the footprint ~20 mm toward the camera — same soft visual
  // overlap license as the pineapple crown.
  spigot.scale.setScalar(SPIG_SCALE)
  spigot.position.set(0, SPIG_Y, spigotWallR - 0.005)

  // template order mirrors the highball reference: opaque + liquid first,
  // transmissive glass last
  template.add(brew.volumeMesh, brew.capMesh, ice, lid, spigot, glassMesh)
  return { template, height: H, radius: R, liquid: brew.spec }

  // -- local helpers --------------------------------------------------------
  function ribAmpAt(y: number, amp: number): number {
    // matches applyRadialRibs' envelope (feather 0.014 from RIB_Y[0])
    const t = (y - RIB_Y[0]) / 0.014
    const s = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)
    return amp * s // +Z sits on a crest (cos(24·π/2) = cos 12π = 1)
  }
}
