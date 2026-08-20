import * as THREE from 'three'
import type { DrinkVisual } from '../types'
import { TIERS } from '../../config/tiers'
import { latheFromProfile, type ProfilePoint } from '../lib/profiles'
import { glass } from '../lib/materials'
import { buildLiquid } from '../lib/liquid'
import { makeCondensation } from '../lib/condensation'
import { bentStraw, scatterIce } from '../lib/parts'

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
    baseRoughness: 0.1,
    normalStrength: 2.8,
  })
  condensation.roughnessMap.repeat.set(2, 1)
  condensation.normalMap.repeat.set(2, 1)
  const glassMat = glass({
    wallThickness: WALL,
    roughnessMap: condensation.roughnessMap,
    normalMap: condensation.normalMap,
    normalScale: 0.85,
    envMapIntensity: 1.5, // grazing-angle Fresnel is what sells the glass edge
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
  const juice = buildLiquid(innerProfile, FILL_Y, {
    color: 0xef6402, // fresh OJ — AgX desaturates, so start punchy
    attenuationColor: 0xb84a02,
    attenuationDistance: 0.02, // reads opaque-juicy if ever run transmissive
    roughness: 0.06, // wet gloss
    // NOTE: transmissive:true was A/B tested — the juice VANISHES behind the
    // transmissive glass wall (three's transmission buffer holds opaque
    // objects only). Keep the liquid opaque-pass. See lib/README.md.
  })

  // ---- ice: 4 cubes floating at the surface ------------------------------
  const ice = scatterIce({
    count: 4,
    size: 0.021,
    surfaceY: FILL_Y + 0.003, // corners break the surface
    spreadRadius: 0.02,
    seed: 55,
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
