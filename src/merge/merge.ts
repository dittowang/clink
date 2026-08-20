import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import type { EventBus } from '../core/events'
import type { PhysicsWorld } from '../physics/world'
import type { Drink } from '../core/drink'
import { SURFACE_Y } from '../config/table'
import { TIERS, nextTier, type TierId } from '../config/tiers'

/**
 * MergeSystem — contact graph, snap & grow (see ARCHITECTURE.md src/merge).
 *
 * Every fixed step, live + slow drinks are grouped per tier and their contact
 * graph (queried straight from world.contactPairs via pairKey) is BFSed. A
 * component of >= 3 fires a merge: the 3 members with the most recent
 * same-tier contact go kinematic, their colliders are DISABLED (three
 * full-size colliders converging on one point would detonate the
 * neighbourhood), they snap to the centroid over SNAP_S while shrinking to
 * SHRINK_TO, then despawn. The next tier spawns at the centroid kinematic
 * with collider radius+halfHeight at GROW_FROM, growing linearly to 1x over
 * GROW_S (collider.setShape each fixed step; the kinematic body's y tracks
 * the half-height so the base stays on the plank) while the mesh scales with
 * an ease-out-back overshoot. Neighbours inside NEIGHBOR_RADIUS_X of the new
 * radius get a small radial impulse (target NEIGHBOR_DV each, scaled by
 * mass) so they make room without flying.
 *
 * The MERGE_MAX_SPEED gate is what keeps a drink in flight out of a merge:
 * a launched body moves at 1.5-3 m/s, so it can never be stolen mid-air; it
 * joins the component naturally once contact friction has slowed it down.
 *
 * Chain: a mergeDone within CHAIN_WINDOW_S of the previous one increments
 * the chain (x1.5 per link). score = tier_result^2 * 10 * 1.5^(chain-1),
 * emitted with mergeDone at the moment the new drink appears.
 */

const SNAP_S = 0.16
const GROW_S = 0.24
const GROW_FROM = 0.4
const SHRINK_TO = 0.25
export const CHAIN_WINDOW_S = 1.0
/** bodies at or above this planar speed (m/s) never participate in a merge */
const MERGE_MAX_SPEED = 0.6
/** neighbours within this multiple of the new drink's radius get shoved */
const NEIGHBOR_RADIUS_X = 1.6
/** target outward speed for shoved neighbours (m/s) */
const NEIGHBOR_DV = 0.25
/**
 * Same-tier drinks whose footprint GAP is under this count as touching for
 * the component BFS. The contact graph stays primary — the slop only ADDS
 * edges. Why: a merge-grown drink can come to rest 1–4 mm from two same-tier
 * neighbours (collider grow + neighbour shove timing) without Rapier ever
 * reporting a contact pair, silently missing the follow-up cascade merge.
 */
const PROXIMITY_SLOP_M = 0.005

export function mergeScore(resultTier: TierId, chain: number): number {
  return Math.round(resultTier * resultTier * 10 * Math.pow(1.5, chain - 1))
}

/**
 * CONFIG (level modifiers): local plank-top height at world z. Sloped levels
 * override this with world.surfaceYAt so the grow animation seats the new
 * drink on the tilted plank; the level scene resets it on level load.
 */
export const mergeSurface = {
  yAt: (_z: number): number => SURFACE_Y,
}

function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  const u = t - 1
  return 1 + c3 * u * u * u + c1 * u * u
}

export interface MergeHooks {
  /** parent the tier visuals into drink.visual and add drink.root to the scene */
  attach(drink: Drink): void
  /** dispose per-instance visuals and remove from the physics world */
  remove(drink: Drink): void
}

interface SnapJob {
  drinks: Drink[]
  from: THREE.Vector3[]
  tier: TierId
  cx: number
  cz: number
  t: number
}

interface GrowJob {
  drink: Drink
  cx: number
  cz: number
  t: number
}

// scratch — reused, no per-step allocation on the hot path
const _v = new THREE.Vector3()
const _imp = { x: 0, y: 0, z: 0 }

export class MergeSystem {
  /** chain counter of the most recent mergeDone (1 = no chain) */
  chain = 0
  private lastDoneAt = -Infinity

  private readonly snaps: SnapJob[] = []
  private readonly grows: GrowJob[] = []

  // reused scan scratch
  private readonly groups = new Map<TierId, Drink[]>()
  private readonly component: Drink[] = []
  private readonly stack: Drink[] = []
  private readonly visited = new Set<number>()

  constructor(
    private readonly world: PhysicsWorld,
    private readonly bus: EventBus,
    private readonly hooks: MergeHooks
  ) {}

  /** true while a snap or grow animation is running */
  get busy(): boolean {
    return this.snaps.length > 0 || this.grows.length > 0
  }

  /** chain counter if the window is still open, else 0 */
  chainNow(): number {
    return this.world.time - this.lastDoneAt <= CHAIN_WINDOW_S ? this.chain : 0
  }

  /** call once per fixed step, AFTER world.step */
  fixedUpdate(dt: number): void {
    this.advanceSnaps(dt)
    this.advanceGrows(dt)
    this.scan()
  }

  // ---- detection ----

  private scan(): void {
    for (const arr of this.groups.values()) arr.length = 0
    for (const d of this.world.all) {
      if (d.state !== 'live' || d.speed >= MERGE_MAX_SPEED) continue
      let arr = this.groups.get(d.tier)
      if (!arr) {
        arr = []
        this.groups.set(d.tier, arr)
      }
      arr.push(d)
    }
    for (const arr of this.groups.values()) {
      if (arr.length < 3) continue
      const tier = arr[0].tier
      if (nextTier(tier) === null) continue // tier 12 has nowhere to go
      this.visited.clear()
      for (const seed of arr) {
        if (this.visited.has(seed.id) || seed.state !== 'live') continue
        this.component.length = 0
        this.stack.length = 0
        this.stack.push(seed)
        this.visited.add(seed.id)
        while (this.stack.length > 0) {
          const cur = this.stack.pop()!
          this.component.push(cur)
          for (const other of arr) {
            if (this.visited.has(other.id) || other.state !== 'live') continue
            if (
              this.world.contactPairs.has(
                this.world.pairKey(cur.collider.handle, other.collider.handle)
              ) ||
              this.withinSlop(cur, other)
            ) {
              this.visited.add(other.id)
              this.stack.push(other)
            }
          }
        }
        if (this.component.length >= 3) this.startMerge(tier)
      }
    }
  }

  /** planar footprint gap under PROXIMITY_SLOP_M (both drinks are upright cylinders) */
  private withinSlop(a: Drink, b: Drink): boolean {
    const dx = a.currPos.x - b.currPos.x
    const dz = a.currPos.z - b.currPos.z
    const reach = a.def.radius + b.def.radius + PROXIMITY_SLOP_M
    return dx * dx + dz * dz < reach * reach
  }

  private startMerge(tier: TierId): void {
    // the 3 most recent same-tier contacts win
    const three = this.component
      .slice()
      .sort((a, b) => b.lastSameTierContact - a.lastSameTierContact)
      .slice(0, 3)
    const cx = (three[0].currPos.x + three[1].currPos.x + three[2].currPos.x) / 3
    const cz = (three[0].currPos.z + three[1].currPos.z + three[2].currPos.z) / 3
    for (const d of three) {
      d.state = 'merging'
      d.collider.setEnabled(false)
      d.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
    }
    this.snaps.push({
      drinks: three,
      from: three.map((d) => d.currPos.clone()),
      tier,
      cx,
      cz,
      t: 0,
    })
    const predicted = this.world.time - this.lastDoneAt <= CHAIN_WINDOW_S ? this.chain + 1 : 1
    this.bus.emit('mergeStart', {
      ids: three.map((d) => d.id),
      tier,
      centroid: new THREE.Vector3(cx, mergeSurface.yAt(cz), cz),
      chain: predicted,
    })
  }

  // ---- snap: pull the 3 to the centroid, shrinking ----

  private advanceSnaps(dt: number): void {
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      const job = this.snaps[i]
      job.t += dt
      const k = Math.min(job.t / SNAP_S, 1)
      const e = k * k // ease-in: accelerate INTO the centroid — reads as a snap
      const scale = 1 - (1 - SHRINK_TO) * e
      for (let j = 0; j < job.drinks.length; j++) {
        const d = job.drinks[j]
        const f = job.from[j]
        _v.set(f.x + (job.cx - f.x) * e, f.y, f.z + (job.cz - f.z) * e)
        d.body.setNextKinematicTranslation(_v)
        d.visual.scale.setScalar(scale)
      }
      if (k >= 1) {
        this.snaps.splice(i, 1)
        this.finishSnap(job)
      }
    }
  }

  private finishSnap(job: SnapJob): void {
    for (const d of job.drinks) this.hooks.remove(d)

    const newTier = nextTier(job.tier)! // guarded in scan()
    const def = TIERS[newTier]
    // spawn so the GROW_FROM-height collider's base sits exactly on the plank
    const drop = -((1 - GROW_FROM) * def.height) / 2
    const drink = this.world.spawnDrink(newTier, job.cx, job.cz, {
      dropHeight: drop,
      state: 'merging',
    })
    drink.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
    drink.collider.setShape(
      new RAPIER.Cylinder((def.height / 2) * GROW_FROM, def.radius * GROW_FROM)
    )
    drink.visual.scale.setScalar(GROW_FROM)
    this.hooks.attach(drink)
    this.grows.push({ drink, cx: job.cx, cz: job.cz, t: 0 })

    // make room: small radial shove, applied while the collider is still small
    const reach = def.radius * NEIGHBOR_RADIUS_X
    for (const n of this.world.all) {
      if (n === drink || n.state !== 'live') continue
      const dx = n.currPos.x - job.cx
      const dz = n.currPos.z - job.cz
      const dist = Math.hypot(dx, dz)
      if (dist > reach) continue
      const m = n.body.mass()
      if (dist > 1e-4) {
        _imp.x = (dx / dist) * NEIGHBOR_DV * m
        _imp.z = (dz / dist) * NEIGHBOR_DV * m
      } else {
        _imp.x = NEIGHBOR_DV * m
        _imp.z = 0
      }
      _imp.y = 0
      n.body.applyImpulse(_imp, true)
    }

    const now = this.world.time
    this.chain = now - this.lastDoneAt <= CHAIN_WINDOW_S ? this.chain + 1 : 1
    this.lastDoneAt = now
    const score = mergeScore(newTier, this.chain)
    this.bus.emit('mergeDone', {
      newId: drink.id,
      tier: newTier,
      centroid: new THREE.Vector3(job.cx, mergeSurface.yAt(job.cz) + def.height, job.cz),
      chain: this.chain,
      score,
    })
  }

  // ---- grow: collider + mesh 0.4x -> 1x ----

  private advanceGrows(dt: number): void {
    for (let i = this.grows.length - 1; i >= 0; i--) {
      const g = this.grows[i]
      const d = g.drink
      if (d.state === 'dead') {
        this.grows.splice(i, 1)
        continue
      }
      g.t += dt
      const k = Math.min(g.t / GROW_S, 1)
      const def = d.def
      const s = GROW_FROM + (1 - GROW_FROM) * k // collider: linear, no overshoot
      d.collider.setShape(new RAPIER.Cylinder((def.height / 2) * s, def.radius * s))
      _v.set(g.cx, mergeSurface.yAt(g.cz) + (def.height / 2) * s, g.cz)
      d.body.setNextKinematicTranslation(_v)
      // mesh overshoots past 1 and settles — lockstep with the collider ramp
      d.visual.scale.setScalar(GROW_FROM + (1 - GROW_FROM) * easeOutBack(k))
      if (k >= 1) {
        this.grows.splice(i, 1)
        d.visual.scale.setScalar(1)
        d.collider.setShape(new RAPIER.Cylinder(def.height / 2, def.radius))
        d.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
        d.state = 'live'
      }
    }
  }
}
