import * as THREE from 'three'
import type { TierId } from '../config/tiers'
import { SURFACE_Y } from '../config/table'
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
import { mergeStaticMeshes, type MergeStats } from './lib/mergeStatic'

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

/**
 * Draw-call diet (docs/PERF.md §3): per-template static merge stats, keyed by
 * tier. Exposed through window.__perf.templates(). `?mergeoff=1` disables the
 * pass (harness A/B captures).
 */
const mergeStats: Partial<Record<TierId, MergeStats>> = {}

export function templateMergeStats(): Partial<Record<TierId, MergeStats>> {
  return mergeStats
}

const staticMergeEnabled =
  typeof window === 'undefined' ||
  new URLSearchParams(window.location.search).get('mergeoff') !== '1'

/** Build (once) and cache the template for a tier. Geometry + materials shared. */
export function buildDrink(tier: TierId): DrinkVisual {
  let v = templateCache.get(tier)
  if (!v) {
    v = BUILDERS[tier]()
    // post-pass: collapse static same-material sub-meshes (liquid meshes and
    // any userData-flagged mesh are skipped — they are driven per instance)
    if (staticMergeEnabled) {
      const s = mergeStaticMeshes(v.template)
      mergeStats[tier] = s
      if (import.meta.env.DEV) {
        console.log(`[drinks] tier ${tier} static-merge: ${s.before} -> ${s.after} meshes`)
      }
    }
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

// ---- boot warm-up (first-spawn hitch) ----

/**
 * Build every template, one per `yieldFn` (the loading screen hands in a
 * requestAnimationFrame so the tab stays responsive — a tier is lathe
 * geometry + several canvas textures + the static merge, 20–80 ms each on a
 * phone). Cached templates are free, so calling this after some tiers exist
 * is harmless. No yieldFn → fully synchronous (harness).
 */
export async function buildAllDrinksAsync(
  onTier?: (tier: TierId, built: number, total: number) => void,
  yieldFn?: () => Promise<void>
): Promise<void> {
  for (let t = 1; t <= 12; t++) {
    const tier = t as TierId
    buildDrink(tier)
    onTier?.(tier, t, 12)
    if (yieldFn && t < 12) await yieldFn()
  }
}

/**
 * One instance of every tier, laid out on the table in the camera's view,
 * liquid clip planes set exactly as attach()/refreshTray() set them. Added to
 * the stage scene for the warm-up compile + hidden frame, then disposed —
 * dispose() releases ONLY the per-instance liquid materials (everything else
 * is the shared template). Never touches physics, drink ids or the Rng.
 */
export interface WarmupRig {
  group: THREE.Group
  dispose(): void
}

/**
 * Fade-variant rig: every mesh carries a `transparent: true` CLONE of its
 * material. A sand-death corpse fade clones materials transparent, which
 * flips the `opaque` program key — so the first fade of each tier would
 * compile again. Precompiling these clones fills the shared program cache
 * with the very keys those later clones hit. The clones are retained for the
 * session and never disposed: a material dispose releases its program and a
 * released program with no other user is deleted from the cache.
 */
const retainedFadeMats: THREE.Material[] = []

const _rigDown = new THREE.Vector3(0, -1, 0)
const _rigPt = new THREE.Vector3()

export function createWarmupRig(opts: { fade?: boolean } = {}): WarmupRig {
  const group = new THREE.Group()
  const instances: DrinkInstance[] = []
  const fadeClones = new Map<THREE.Material, THREE.Material>()
  const fadeClone = (m: THREE.Material): THREE.Material => {
    let c = fadeClones.get(m)
    if (!c) {
      c = m.clone()
      c.transparent = true
      fadeClones.set(m, c)
      retainedFadeMats.push(c)
    }
    return c
  }
  for (let t = 1; t <= 12; t++) {
    const tier = t as TierId
    const inst = instantiateDrink(tier)
    // 4 × 3 grid across the playfield: every mesh inside the main frustum AND
    // the shadow camera, so the hidden frame draws (and so compiles) all of it
    const col = (t - 1) % 4
    const row = Math.floor((t - 1) / 4)
    const x = -0.3 + col * 0.2
    const z = -0.6 + row * 0.35
    inst.group.position.set(x, SURFACE_Y, z)
    if (inst.liquid) {
      inst.liquid.plane.setFromNormalAndCoplanarPoint(
        _rigDown,
        _rigPt.set(x, SURFACE_Y + inst.liquid.fillY, z)
      )
    }
    inst.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      o.castShadow = true
      if (opts.fade) {
        const m = o.material
        o.material = Array.isArray(m) ? m.map(fadeClone) : fadeClone(m)
      }
    })
    if (opts.fade && inst.liquid) {
      // the per-instance liquid clones become the retained transparent ones
      for (const mesh of [inst.liquid.volume, inst.liquid.cap]) {
        const m = mesh.material as THREE.Material
        m.transparent = true
        retainedFadeMats.push(m)
      }
    }
    group.add(inst.group)
    instances.push(inst)
  }
  return {
    group,
    dispose() {
      if (!opts.fade) {
        for (const inst of instances) {
          if (!inst.liquid) continue
          ;(inst.liquid.volume.material as THREE.Material).dispose()
          ;(inst.liquid.cap.material as THREE.Material).dispose()
        }
      }
      group.clear()
    },
  }
}
