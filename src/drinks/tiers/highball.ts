import * as THREE from 'three'
import type { DrinkVisual } from '../types'
import { TIERS } from '../../config/tiers'
import { latheFromProfile, type ProfilePoint } from '../lib/profiles'
import { glass } from '../lib/materials'
import { buildLiquid } from '../lib/liquid'
import { makeCondensation } from '../lib/condensation'
import { makeCanvasTexture } from '../lib/canvas'
import { bentStraw } from '../lib/parts'
import { floatingIce } from '../lib/extra-g512'

/**
 * Tier 5 — orange-juice highball. THE reference glass recipe: double-walled
 * clear glass (honest 2.5 mm wall, thick 10 mm base, foot recess, rounded
 * lip), opaque-pass juice inset from the inner wall, four floating ice
 * cubes, condensation, one bright straw. Other glass tiers copy this file's
 * structure.
 *
 * All dimensions in metres. R = 0.041, H = 0.150 (config/tiers.ts).
 */
export function buildHighball(): DrinkVisual {
  const def = TIERS[5]
  const R = def.radius // 0.041
  const H = def.height // 0.150
  const WALL = 0.0025
  const FLOOR_Y = 0.010 // inner floor height (thick base)
  const FILL_Y = 0.105 // juice level, 70% of H

  // ---- glass: ONE lathe — recess, foot, up the outside, over the lip,
  // ---- down the inside, across the inner floor ---------------------------
  const outerWall: ProfilePoint[] = [
    [0.0004, 0.0018], // recess centre (slightly above the table)
    [0.0190, 0.0018], // recess ceiling
    [0.0300, 0.0014], // recess curls down…
    [0.0342, 0.0], //    …to the foot ring
    [0.0372, 0.0], // foot contact band
    [0.0398, 0.0038], // base round-over
    [0.0402, 0.0110],
    [0.0404, 0.0300], // very subtle taper up the body
    [0.0407, 0.0750],
    [0.0410, 0.1200],
    [0.0410, 0.1440], // straight to just under the rim
    [0.0406, 0.1487], // lip outer round
  ]
  const lipTop: ProfilePoint = [0.0396, 0.1500] // rim apex, half a wall in
  const innerWall: ProfilePoint[] = [
    [0.0386, 0.1487], // lip inner round
    [0.0383, 0.1440],
    [0.0381, 0.1100],
    [0.0378, 0.0600],
    [0.0374, 0.0200], // inner wall bottom
    [0.0330, 0.0122], // floor fillet
    [0.0180, 0.0100], // inner floor
    [0.0004, 0.0100], // floor centre
  ]
  const fullProfile: ProfilePoint[] = [...outerWall, lipTop, ...innerWall]
  const glassGeo = latheFromProfile(fullProfile, 96, { samples: 96 })

  const condensation = makeCondensation(768, 1536, 5, {
    baseRoughness: 0.048, // fog above ~0.09 lays a white wash over the juice;
    // 0.075 still contributed a milky veil — droplets carry the cold read
    normalStrength: 2.8,
  })
  condensation.roughnessMap.repeat.set(2, 1)
  condensation.normalMap.repeat.set(2, 1)
  const glassMat = glass({
    wallThickness: WALL,
    roughnessMap: condensation.roughnessMap,
    normalMap: condensation.normalMap,
    normalScale: 0.85,
    envMapIntensity: 1.1, // grazing-angle Fresnel sells the glass edge, but
    // more also lays the env's warm tan over the whole front face — the wash
    // that pulls the juice behind it toward butterscotch (measured +80 blue)
  })
  const glassMesh = new THREE.Mesh(glassGeo, glassMat)
  glassMesh.castShadow = false // transmission-lit; a solid shadow blob lies
  glassMesh.receiveShadow = false

  // ---- juice --------------------------------------------------------------
  // inner profile for the liquid: floor centre → up the inner wall
  const innerProfile: ProfilePoint[] = [
    [0.0004, 0.0100],
    [0.0180, 0.0100],
    [0.0330, 0.0122],
    [0.0374, 0.0200],
    [0.0378, 0.0600],
    [0.0381, 0.1100],
    [0.0383, 0.1440],
  ]
  const juice = buildLiquid(
    innerProfile,
    FILL_Y,
    {
      color: 0xf89104, // fresh OJ. Two prior failure modes bracket this:
      // BRIGHT + full specular stack rendered a pale creamsicle (the white
      // wash), and the counter-move — darkening to 0xd47802 × 0.84 — rendered
      // muddy sienna, i.e. ICED COFFEE (critic: probe body rgb(170,116,57)).
      // With the wash now trimmed (below), the darkness is no longer needed:
      // OJ is bright, saturated, HIGH VALUE, authored hue ~34 (renders ~36–40
      // after the ramp's +7 juicier shift — clear of tier 9's tea at ~25).
      attenuationColor: 0xd97a02,
      attenuationDistance: 0.02, // reads opaque-juicy if ever run transmissive
      roughness: 0.05, // wet gloss
      // NOTE: transmissive:true was A/B tested — the juice VANISHES behind the
      // transmissive glass wall (three's transmission buffer holds opaque
      // objects only). Keep the liquid opaque-pass. See lib/README.md.
    },
    { capLighten: 0.08 } // default 0.12 pushed the surface toward pale peach
  )
  // The juicier-shifted ramp body: what the lib bakes for 0xf89104 (h+7°,
  // s×1.25, l×0.92) ≈ rgb(232,160,0). Authored here explicitly because the
  // lib ramp's depth stops (deep 0.3×, mid 0.55×) are tuned for BIG vessels;
  // over this 10 cm tumbler they read as cold-brew sludge at trio distance
  // (critic: rgb(119,67,24) = tea, ~7° off tier 9). A short glass of 2 cm-
  // attenuation juice barely darkens: deep 0.52×, mid 0.8×.
  const OJ_BODY = 0xffb202 // A/B measured (glass hidden vs shown: identical
  // rgb): the desaturation is NOT a glass/specular wash — it is AgX's inset
  // matrix bleeding r+g luminance into blue (~+88 b at val 0.78 for this g).
  // That sets a hard sat ceiling ~0.57 at val ~0.8 for a yellow-orange; going
  // redder would buy sat but land back on tier 9's tea (renders hue 24), so
  // OJ takes the bright-and-yellow corner of the achievable gamut instead:
  // rendered ≈ hue 34 / sat 0.56 / val 0.8 — 10° and +0.2 value off the tea,
  // same brightness class as the juice-box band, yellower (OJ, not coffee).
  const OJ_DEEP = 0xd08202
  {
    const body = new THREE.Color(OJ_BODY)
    const deep = new THREE.Color(OJ_DEEP).multiplyScalar(0.65)
    const mid = body.clone().multiplyScalar(0.8)
    const surface = body.clone().lerp(new THREE.Color(0xffffff), 0.06)
    const ramp = makeCanvasTexture(2, 128, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, h, 0, 0) // canvas bottom = v0 (floor)
      g.addColorStop(0, `#${deep.getHexString()}`)
      g.addColorStop(0.34, `#${mid.getHexString()}`)
      g.addColorStop(0.8, `#${body.getHexString()}`)
      g.addColorStop(1, `#${surface.getHexString()}`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    })
    // Keep the white-wash trims (they are what LET the body stay saturated at
    // high value): clearcoat Fresnel + sharp env mirror of the warm sky laid
    // ~+70 blue over an orange whose own blue is ~0.
    const vm = juice.volumeMesh.material as THREE.MeshPhysicalMaterial
    vm.map = ramp
    vm.color.set(0xffffff) // ramp carries the read — NO darkening multiplier
    vm.specularIntensity = 0.18
    vm.clearcoat = 0.28
    vm.envMapIntensity = 0.75
    vm.sheen = 0.3
    vm.sheenColor.setHex(0xf09a08) // hue-locked, NOT whitened (the lib whitens
    // it 12%); a full trim A/B (spec .06 / cc .12 / env .5) measured the SAME
    // body rgb, so the moderate stack stays for the wet read — it is not the
    // desaturator (AgX is, see OJ_BODY note)
    const cm = juice.capMesh.material as THREE.MeshPhysicalMaterial
    cm.specularIntensity = 0.25
    cm.clearcoat = 0.35
    cm.envMapIntensity = 0.75
    cm.color.setHex(0xb45802) // sky-facing disc under 2–4× the wall's
    // irradiance, so it is authored darker AND redder than the body — the old
    // 0x9e4b02 was NEAR-BROWN (capped the drink with mud) while 0xc06a02
    // rendered a dusty salmon top. This renders a saturated orange surface.
  }

  // ---- ice: melted lumps riding ~2/3 submerged with a baked waterline -----
  // floatingIce (not lib scatterIce): irregular lump silhouettes + vertex-
  // color waterline in the juice's own tone — the perfect chalk-white
  // RoundedBoxes read as marshmallows placed ON the surface (critic, twice).
  const ice = floatingIce({
    count: 4, // 5 rafted into a cap-covering cluster — 4 leaves juice surface
    // visible between lumps, which is what lets the waterline read at all
    size: 0.021,
    surfaceY: FILL_Y,
    spreadRadius: 0.024,
    seed: 55,
    liquidTint: 0xd98402, // a step darker/redder than the body: the waterline
    // must read as a wet JUICE line against the icy crown — tinting with the
    // bright body color soaked the whole lump caramel-milk instead
    liquidDeep: 0xa85e02,
  })

  // ---- straw --------------------------------------------------------------
  const straw = bentStraw({
    radius: 0.0024,
    bottom: [0.017, 0.016, -0.007],
    bendStart: [0.0248, 0.152, -0.007],
    tip: [0.0385, 0.187, -0.007],
    color: 0xff4f43,
    stripe: 0xfff4ec,
  })

  const template = new THREE.Group()
  template.add(juice.volumeMesh, juice.capMesh, ice, straw, glassMesh)
  return { template, height: H, radius: R, liquid: juice.spec }
}
