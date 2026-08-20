import * as THREE from 'three'
import type { TierId } from '../config/tiers'
import type { DrinkVisual, DrinkBuilder, DrinkInstance } from './types'
import { buildJuiceBox } from './tiers/juiceBox'
import { buildSlimCan } from './tiers/slimCan'
import { buildColaCan } from './tiers/colaCan'
import { buildSodaBottle } from './tiers/sodaBottle'
import { buildHighball } from './tiers/highball'
import { buildMasonJar } from './tiers/masonJar'
import { buildCoconut } from './tiers/coconut'
import { buildPineapple } from './tiers/pineapple'
import { buildPitcher } from './tiers/pitcher'
import { buildWatermelon } from './tiers/watermelon'
import { buildIceBucket } from './tiers/iceBucket'
import { buildDispenser } from './tiers/dispenser'

const BUILDERS: Record<TierId, DrinkBuilder> = {
  1: buildJuiceBox,
  2: buildSlimCan,
  3: buildColaCan,
  4: buildSodaBottle,
  5: buildHighball,
  6: buildMasonJar,
  7: buildCoconut,
  8: buildPineapple,
  9: buildPitcher,
  10: buildWatermelon,
  11: buildIceBucket,
  12: buildDispenser,
}

const templateCache = new Map<TierId, DrinkVisual>()

/** Build (once) and cache the template for a tier. Geometry + materials shared. */
export function buildDrink(tier: TierId): DrinkVisual {
  let v = templateCache.get(tier)
  if (!v) {
    v = BUILDERS[tier]()
    templateCache.set(tier, v)
  }
  return v
}

/** Warm the whole cache up front (loading screen) so first spawn never hitches. */
export function buildAllDrinks(): void {
  for (let t = 1 as TierId; t <= 12; t++) buildDrink(t as TierId)
}

/**
 * Clone the template for one on-table instance. Shares all geometry and all
 * materials EXCEPT liquid materials, which are cloned so each instance can
 * carry its own world-space clipping plane (slosh tilt).
 */
export function instantiateDrink(tier: TierId): DrinkInstance {
  const vis = buildDrink(tier)
  const group = vis.template.clone(true)
  if (!vis.liquid) return { group, liquid: null }

  let volume: THREE.Mesh | null = null
  let cap: THREE.Mesh | null = null
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      if (o.userData.liquidVolume) volume = o
      if (o.userData.liquidCap) cap = o
    }
  })
  if (!volume || !cap) return { group, liquid: null }

  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
  for (const mesh of [volume, cap] as THREE.Mesh[]) {
    const mat = (mesh.material as THREE.Material).clone()
    ;(mat as THREE.MeshPhysicalMaterial).clippingPlanes = mesh === cap ? [] : [plane]
    mesh.material = mat
  }
  return {
    group,
    liquid: { volume, cap, fillY: vis.liquid.fillY, capRadius: vis.liquid.capRadius, plane },
  }
}
