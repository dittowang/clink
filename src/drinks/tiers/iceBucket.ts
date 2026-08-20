import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { DrinkVisual } from '../types'
import { TIERS } from '../../config/tiers'
import { Rng } from '../../core/rng'
import { latheFromProfile, type ProfilePoint } from '../lib/profiles'
import { brushedSteelWall } from '../lib/extra-g1011'
import { makeCondensation } from '../lib/condensation'
import { iceMaterial } from '../lib/parts'
import { noiseCanvas, normalMapFromHeight } from '../lib/noise'

/**
 * Tier 11 — steel ice bucket. Flared truncated cone (bottom r 0.082 → top
 * r 0.110) with a rolled torus lip, brushed steel (anisotropic streak
 * roughness + condensation normals — it's a cold tier), two hanging ring
 * handles on bosses, heaped transmissive ice above the rim (nothing
 * transmissive in front of it → real transmission is safe here), and three
 * bottle necks (opaque-pass dark amber/green glass — they sit BEHIND the
 * transmissive cubes, so transmissive bottles would vanish) with crinkled
 * foil caps in gold, red, green. R = 0.110, H = 0.230 (config/tiers.ts):
 * the rim lands at 0.1505 and the tallest foil tip at ~0.2295.
 */
export function buildIceBucket(): DrinkVisual {
  const def = TIERS[11]
  const R = def.radius // 0.110
  const H = def.height // 0.230

  const template = new THREE.Group()

  // ---- bucket: one lathe — recess, flare, beads, rolled lip, inner wall ---
  // Two swaged BEADS interrupt the straight flare. Load-bearing for the
  // metal read: the lineup stage's hemisphere fill lights metal as a flat
  // direction-independent wash (verified with mirror-roughness canaries — no
  // material scalar can beat it), but the wash's COLOR/intensity varies with
  // normal elevation (cool sky up, warm sand down). Only curvature turns
  // that into visible structure — the rolled lip and the dispenser's dome
  // read as metal for exactly this reason, so the wall gets its own
  // curvature: bright crest / dark under-curve bands at each bead.
  const RIM_Y = 0.146
  const bucketProfile: ProfilePoint[] = [
    [0.0004, 0.0018], // recessed bottom
    [0.0450, 0.0018],
    [0.0680, 0.0022],
    [0.0755, 0.0],
    [0.0790, 0.0], // contact ring
    [0.0818, 0.003], // base round-over
    [0.0822, 0.008],
    [0.0836, 0.02],
    [0.0846, 0.03],
    [0.0866, 0.0365], // bead 1 crest
    [0.0850, 0.0425], // bead 1 under-curve
    [0.0865, 0.055],
    [0.0895, 0.075],
    [0.0912, 0.088],
    [0.0938, 0.0955], // bead 2 crest
    [0.0922, 0.1025], // bead 2 under-curve
    [0.0947, 0.115],
    [0.0982, 0.126],
    [0.1013, 0.135],
    [0.1045, 0.1405],
    [0.108, RIM_Y],
    [0.1093, 0.1477], // rolled lip: out…
    [0.1095, 0.1494], //   …around…
    [0.1082, 0.1506],
    [0.1062, 0.1502],
    [0.105, 0.1484], //   …and tucked under
    [0.1038, RIM_Y],
    [0.1012, 0.125], // inner wall
    [0.0988, 0.103],
    [0.094, 0.0965], // hidden floor (well under the ice heap)
    [0.06, 0.0935],
    [0.0004, 0.0935],
  ]
  // Material: brushedSteelWall — the metal read is BAKED into the color map
  // from the sampled profile (see extra-g1011.ts). Capture-verified history:
  //  - near-mirror map + cool-white F0 → "matte celadon enamel";
  //  - warm-neutral F0 (0xbfb4a4) at env 2.6 → "tan thrown clay" at probe
  //    (the probe env is a warm studio; a side-facing metal wall integrates
  //    it into a smooth warm diffuse-looking ramp) and "cream enamelware" at
  //    trio distance (the lineup hemisphere fill washes metal flat —
  //    envMapIntensity 0.05 vs 3.0 canaries rendered identically).
  //  Specular alone cannot carry this wall in either scene, so the bake puts
  //  the high-contrast curvature response (cool sky on bead crests + rolled
  //  lip, dark under-curves, interior/base AO) into F0 itself, on an
  //  ACHROMATIC gray base — the tan multiply is gone, and the bead pairs
  //  read as swaged metal bands instead of throwing ridges.
  // 56×44: 44 samples keep the bead crest/under-curve pairs crisp; radial
  // dropped 64→56 to stay ≤ ~12k template tris (56-gon sagitta at r=0.11 is
  // 0.2 mm — invisible), net ≈ 11.8k
  const bucketGeo = latheFromProfile(bucketProfile, 56, { samples: 44 })
  const steelMat = brushedSteelWall(bucketGeo.parameters.points, {
    seed: 11,
    // F0 leans COOL on purpose: a vertical wall can only reflect the probe
    // env's warm horizon band (the lid escapes by facing the white zenith),
    // and a truly achromatic F0 multiplied that into bronze stoneware in
    // captures — the blue lean cancels the warm light back to neutral steel,
    // and under the lineup's cooler wash it lands on icy blue-gray, which is
    // the right family for an ice bucket
    base: 0xa5b6c6,
    sky: 0xd8e4ee,
    ground: 0x46484c,
    roughnessRange: [0.16, 0.55],
    anisotropy: 0.65,
    // 0.7: at 1.1 the warm env swamped the baked map; at 0.55 the wall went
    // too dark against the lid's brightness
    envMapIntensity: 0.7,
  })
  // cold tier: condensation NORMAL map, kept subtle — at 0.55 the droplet
  // bumps scatter the mirror read into speckled ceramic
  const cond = makeCondensation(512, 1024, 11, { baseRoughness: 0.1, normalStrength: 2.4 })
  cond.normalMap.repeat.set(3, 1)
  steelMat.normalMap = cond.normalMap
  steelMat.normalScale.set(0.16, 0.16) // at .28 the droplets speckled the satin read
  const bucket = new THREE.Mesh(bucketGeo, steelMat)

  // ---- ring handles on bosses at ±X --------------------------------------
  // slightly smoother than the wall so the small rings glint — achromatic
  // gray like the wall (the old warm 0xb5ac9c went tan with it at probe);
  // not chrome-white, which ghosts against a bright set
  const polished = new THREE.MeshPhysicalMaterial({
    color: 0xa4a9af,
    metalness: 1,
    roughness: 0.22,
    envMapIntensity: 1.2,
  })
  const BOSS_Y = 0.118
  const wallR = 0.0957 // beaded profile's outer radius at BOSS_Y
  const bossGeo = new THREE.SphereGeometry(0.0105, 12, 8)
  bossGeo.scale(0.55, 1, 1) // squashed dome, axis along X
  const ringGeo = new THREE.TorusGeometry(0.0175, 0.0028, 8, 20)
  for (const side of [1, -1]) {
    const boss = new THREE.Mesh(bossGeo, polished)
    boss.position.set(side * (wallR + 0.001), BOSS_Y, 0)
    // ring hangs from the boss, plane tangent to the wall, top tipped out a
    // touch so the bottom sits back toward the flare
    const ring = new THREE.Mesh(ringGeo, polished)
    ring.rotation.y = Math.PI / 2
    ring.rotation.z = side * -0.22
    const drop = 0.0155
    ring.position.set(side * (wallR + 0.0035), BOSS_Y - drop, 0)
    template.add(boss, ring)
  }

  // ---- ice heap above the rim (transmissive — nothing in front of it) -----
  const rng = new Rng(1111)
  const cubeGeo = new RoundedBoxGeometry(0.027, 0.027, 0.027, 2, 0.0042)
  const cubeMat = iceMaterial({ transmissive: true, size: 0.027 })
  cubeMat.color.set(0xe2f0fc) // nudge the transmitted warm env toward cold
  const heap = new THREE.Group()
  const addCube = (x: number, y: number, z: number): void => {
    const cube = new THREE.Mesh(cubeGeo, cubeMat)
    cube.position.set(x, y, z)
    cube.rotation.set(rng.range(0, Math.PI), rng.range(0, Math.PI), rng.range(0, Math.PI))
    cube.scale.set(rng.range(0.85, 1.12), rng.range(0.82, 1.05), rng.range(0.85, 1.12))
    heap.add(cube)
  }
  // outer ring hugs the rim — no moat between ice and lip
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rng.range(-0.25, 0.25)
    const rad = 0.076 * rng.range(0.85, 1.05)
    addCube(Math.cos(a) * rad, 0.141 + rng.range(-0.004, 0.004), Math.sin(a) * rad)
  }
  // mid layer is hand-placed: random rings kept guillotining bottle necks
  addCube(-0.02, 0.166, 0.036)
  addCube(-0.041, 0.164, -0.012)
  addCube(0.012, 0.168, -0.042)
  addCube(0.004, 0.187, 0.006) // peak cube

  // ---- three bottle necks poking out of the ice ---------------------------
  // Opaque-pass glossy glass: dark amber/green bottle glass reads nearly
  // opaque in life, and opaque survives being seen through the ice cubes.
  const glassStub: ProfilePoint[] = [
    [0.0004, 0.0],
    [0.021, 0.0],
    [0.0216, 0.004],
    [0.0213, 0.012],
    [0.0196, 0.021], // champagne shoulder
    [0.0158, 0.031],
    [0.0118, 0.041],
    [0.0096, 0.05],
    [0.0088, 0.058], // long neck
    [0.0086, 0.066],
    [0.0086, 0.072],
  ]
  const foilProfile: ProfilePoint[] = [
    [0.0094, 0.052],
    [0.0092, 0.06],
    [0.0092, 0.0665],
    [0.0106, 0.0705], // collar bulge over the crown
    [0.0104, 0.074],
    [0.0092, 0.077],
    [0.009, 0.0795],
    [0.0076, 0.082], // top dome
    [0.0042, 0.0845],
    [0.0004, 0.085],
  ]
  const stubGeo = latheFromProfile(glassStub, 20, { samples: 12 })
  const foilGeo = latheFromProfile(foilProfile, 20, { samples: 10 })
  const bottleGlass = (color: number): THREE.MeshPhysicalMaterial =>
    new THREE.MeshPhysicalMaterial({
      color,
      metalness: 0,
      roughness: 0.03,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      specularIntensity: 1,
      envMapIntensity: 1.35,
    })
  const foilCrinkle = new THREE.CanvasTexture(
    normalMapFromHeight(noiseCanvas(128, 128, 3, 313, { cellsX: 22, cellsY: 22 }), 2.2)
  )
  foilCrinkle.colorSpace = THREE.NoColorSpace
  foilCrinkle.wrapS = foilCrinkle.wrapT = THREE.RepeatWrapping
  const foilMat = (color: number): THREE.MeshPhysicalMaterial => {
    const m = new THREE.MeshPhysicalMaterial({
      color,
      metalness: 1,
      roughness: 0.34,
      envMapIntensity: 1.2,
    })
    m.normalMap = foilCrinkle
    m.normalScale.set(0.8, 0.8)
    return m
  }
  // near-black bodies with warm/cool cores — dark bottle glass in life
  const amber = bottleGlass(0x1c0b03)
  const green = bottleGlass(0x081f0c)
  const bottles: Array<{
    glass: THREE.MeshPhysicalMaterial
    foil: THREE.MeshPhysicalMaterial
    base: readonly [number, number, number]
    lean: number // radians from vertical
    az: number // lean direction, radians from +Z toward +X
  }> = [
    // tallest foil tip = 0.156 + 0.0845·cos(0.5) ≈ 0.2296 — the height law
    { glass: amber, foil: foilMat(0xd8b23c), base: [-0.006, 0.156, -0.014], lean: 0.5, az: 1.05 },
    { glass: green, foil: foilMat(0xb02330), base: [0.012, 0.153, 0.0], lean: 0.62, az: -1.83 },
    { glass: amber, foil: foilMat(0x2c8040), base: [0.02, 0.146, 0.018], lean: 0.55, az: -0.55 },
  ]
  const leanAxis = new THREE.Vector3()
  for (const b of bottles) {
    const g = new THREE.Group()
    const stub = new THREE.Mesh(stubGeo, b.glass)
    const foil = new THREE.Mesh(foilGeo, b.foil)
    g.add(stub, foil)
    g.position.set(...b.base)
    leanAxis.set(Math.cos(b.az), 0, -Math.sin(b.az)) // ⟂ to the lean direction
    g.quaternion.setFromAxisAngle(leanAxis, b.lean)
    heap.add(g)
  }

  template.add(bucket, heap)
  template.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  return { template, height: H, radius: R, liquid: null }
}
