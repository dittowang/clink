import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { FIXED_DT } from '../core/scheduler'
import type { EventBus, GameEvents } from '../core/events'
import { TABLE, SURFACE_Y, FAR_Z } from '../config/table'
import { TIERS, type TierId } from '../config/tiers'
import { MASS_KG } from '../config/massLadder'
import { MATERIALS, TABLE_WOOD, SAND, LINEAR_DAMPING } from './materials'
import { allocDrinkId, type Drink, type DrinkState } from '../core/drink'

/**
 * PhysicsWorld — the one wrapper around RAPIER.World. Owns the static table
 * colliders, spawns/removes drink bodies, steps the solver at FIXED_DT and
 * drains its events onto the bus. Render code reads the pose fields it writes
 * into Drink entities; nothing outside this file mutates the solver except
 * impulse.ts (launches) and the merge system (kinematic snaps).
 */

/**
 * Rapier JS collider "handles" are u64 index+generation bit patterns
 * REINTERPRETED as f64 — they compare fine (bit-exact) as Map keys but are
 * useless for arithmetic (a recycled slot is a denormal like 3e-312). Pair
 * keys therefore go through a compact sequential id assigned per collider —
 * see PhysicsWorld.pairKey().
 */
const PAIR_BASE = 1 << 26

export interface SpawnOpts {
  /** gap between the collider base and the table top at spawn (m) */
  dropHeight?: number
  state?: DrinkState
}

/**
 * Level modifiers the world is built with (all additive; defaults reproduce
 * the classic table exactly). slopeDeg tilts every TABLE collider (plank,
 * rails, wet patch) with one rotation around X at the table centre
 * (0, SURFACE_Y, 0) so the +Z (near/foul) edge drops; gravity stays -Y and
 * drinks stay rotation-locked, so resting drinks feel downslope pull.
 */
export interface WorldMods {
  /** playfield half-width; default TABLE.HALF_W */
  halfW?: number
  /** whole-table tilt in degrees; + drops the near (+Z) edge */
  slopeDeg?: number
  /** omit these side rail colliders (their handles become -1) */
  removeRails?: ('left' | 'right')[]
  /** thin low-friction strip ON the plank, centre (x,z), extents w × l */
  wetPatch?: { x: number; z: number; w: number; l: number }
}

/** wet varnish: Min combine rule beats the drink's Average, so μ_eff = this */
const WET_FRICTION = 0.03
/** wet strip collider half-thickness (1.5 mm strip on the plank) */
const WET_HALF_T = 0.00075

/** ~2 N: a juice box set down gently is right at the edge of audibility. */
const CONTACT_FORCE_THRESHOLD = 2

/**
 * Contact skin on the RAIL colliders only (m). At full launch speed a can
 * travels ~19 mm per 120 Hz step, so its first post-step pose could sit
 * ~8 mm inside a rail face for one frame before the solver pushed back. The
 * skin resolves contacts that far off the face, turning the visible one-frame
 * clip into an invisible ~4 mm gap. Plank and drink colliders are untouched —
 * a skin there would float drinks above the wood and hold merges apart.
 */
const RAIL_SKIN = 0.004

/**
 * A contact-force event is only surfaced as an 'impact' within this window
 * after the contact STARTS. Rapier re-reports the force every step it stays
 * above threshold, and a resting drink's support force alone exceeds 2 N —
 * without the gate every settled drink would "impact" 120×/s forever.
 */
const IMPACT_WINDOW_S = 0.06

interface StaticInfo {
  label: string
  pos: THREE.Vector3
}

// Emitted payloads are REUSED between events (hot path, zero allocation).
// Listeners must copy anything they keep beyond the callback.
const _impact: GameEvents['impact'] = {
  a: -1,
  b: -1,
  force: 0,
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  tierA: null,
  tierB: null,
  matA: '',
  matB: '',
}
const _sliding: GameEvents['sliding'] = { speed: 0, count: 0, x: 0 }

export class PhysicsWorld {
  readonly raw: RAPIER.World
  private readonly queue: RAPIER.EventQueue

  /** all live drinks, iteration order = spawn order */
  readonly all: Drink[] = []
  /** colliderHandle → Drink, for event routing and the merge system */
  readonly byCollider = new Map<number, Drink>()
  /**
   * Live contact-pair set (keys from pairKey). Maintained from collision
   * started/stopped events every step — the merge system BFSes this.
   */
  readonly contactPairs = new Set<number>()

  /** simulation time, seconds of fixed steps taken */
  time = 0

  readonly plankHandle: number
  readonly farRailHandle: number
  /** -1 where the rail was removed by a level modifier */
  readonly sideRailHandles: [number, number]
  readonly sandHandle: number
  /** handle of the wet-patch strip, or -1 when the level has none */
  readonly wetPatchHandle: number = -1

  /** effective playfield half-width (levels may narrow the table) */
  readonly halfW: number
  /** table tilt in radians (0 on flat levels) */
  readonly slopeRad: number
  private readonly slopeTan: number

  private readonly statics = new Map<number, StaticInfo>()
  /** pairKey → sim time until which a force event counts as a fresh impact */
  private readonly impactWindow = new Map<number, number>()
  /** collider handle (f64 bit pattern) → compact sequential id for pair math */
  private readonly handleIds = new Map<number, number>()
  private nextHandleId = 1
  private busRef: EventBus | null = null

  /** compact id for a collider handle (assigned on first sight) */
  private idOf(handle: number): number {
    let id = this.handleIds.get(handle)
    if (id === undefined) {
      id = this.nextHandleId++
      this.handleIds.set(handle, id)
    }
    return id
  }

  /**
   * Order-independent numeric key for a collider pair. THE way to query the
   * live contact set: `world.contactPairs.has(world.pairKey(h1, h2))`.
   */
  pairKey(h1: number, h2: number): number {
    const a = this.idOf(h1)
    const b = this.idOf(h2)
    return a < b ? a * PAIR_BASE + b : b * PAIR_BASE + a
  }

  // pre-bound drain callbacks so step() allocates no closures
  private readonly onCollision = (h1: number, h2: number, started: boolean): void => {
    const key = this.pairKey(h1, h2)
    if (started) {
      this.contactPairs.add(key)
      this.impactWindow.set(key, this.time + IMPACT_WINDOW_S)
      const a = this.byCollider.get(h1)
      const b = this.byCollider.get(h2)
      if (a && b && a.tier === b.tier) {
        a.lastSameTierContact = this.time
        b.lastSameTierContact = this.time
      }
    } else {
      this.contactPairs.delete(key)
      this.impactWindow.delete(key)
    }
  }

  private readonly onContactForce = (ev: RAPIER.TempContactForceEvent): void => {
    const bus = this.busRef
    if (!bus) return
    const h1 = ev.collider1()
    const h2 = ev.collider2()
    const key = this.pairKey(h1, h2)
    const until = this.impactWindow.get(key)
    if (until === undefined || this.time > until) return
    this.impactWindow.delete(key) // one impact per contact start

    const a = this.byCollider.get(h1)
    const b = this.byCollider.get(h2)
    const sa = a ? null : this.statics.get(h1)
    const sb = b ? null : this.statics.get(h2)

    _impact.a = a ? a.id : -1
    _impact.b = b ? b.id : -1
    _impact.force = ev.totalForceMagnitude()
    _impact.tierA = a ? a.tier : null
    _impact.tierB = b ? b.tier : null
    _impact.matA = a ? a.def.material : (sa?.label ?? 'wood')
    _impact.matB = b ? b.def.material : (sb?.label ?? 'wood')

    // world point ≈ midpoint of the two collider positions (good enough for
    // audio panning and the camera nudge); normal = strongest force direction
    const pa = a ? a.currPos : (sa?.pos ?? _impact.point.set(0, SURFACE_Y, 0))
    const pb = b ? b.currPos : (sb?.pos ?? pa)
    _impact.point.addVectors(pa, pb).multiplyScalar(0.5)
    const dir = ev.maxForceDirection()
    _impact.normal.set(dir.x, dir.y, dir.z)
    bus.emit('impact', _impact)
  }

  constructor(mods: WorldMods = {}) {
    this.raw = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    this.raw.timestep = FIXED_DT
    this.queue = new RAPIER.EventQueue(true)

    const { HALF_L, THICKNESS, RAIL_H, RAIL_T } = TABLE
    const HALF_W = (this.halfW = mods.halfW ?? TABLE.HALF_W)
    this.slopeRad = ((mods.slopeDeg ?? 0) * Math.PI) / 180
    this.slopeTan = Math.tan(this.slopeRad)

    // whole-table tilt: one rotation about X at (0, SURFACE_Y, 0). Applied to
    // every table collider via tilt(); positive slope drops the +Z near edge.
    const sin = Math.sin(this.slopeRad)
    const cos = Math.cos(this.slopeRad)
    const q = { x: Math.sin(this.slopeRad / 2), y: 0, z: 0, w: Math.cos(this.slopeRad / 2) }
    const tilt = (desc: RAPIER.ColliderDesc, cx: number, cy: number, cz: number): RAPIER.ColliderDesc => {
      const ry = cy - SURFACE_Y
      return desc
        .setTranslation(cx, SURFACE_Y + ry * cos - cz * sin, ry * sin + cz * cos)
        .setRotation(q)
    }

    // plank top — the playfield
    this.plankHandle = this.addStatic(
      tilt(RAPIER.ColliderDesc.cuboid(HALF_W, THICKNESS / 2, HALF_L), 0, SURFACE_Y - THICKNESS / 2, 0),
      TABLE_WOOD.friction,
      TABLE_WOOD.restitution,
      'wood'
    )
    // far rail — spans the full width plus both side-rail corners
    this.farRailHandle = this.addStatic(
      tilt(
        RAPIER.ColliderDesc.cuboid(HALF_W + RAIL_T, RAIL_H / 2, RAIL_T / 2),
        0,
        SURFACE_Y + RAIL_H / 2,
        FAR_Z - RAIL_T / 2
      ).setContactSkin(RAIL_SKIN),
      TABLE_WOOD.friction,
      TABLE_WOOD.restitution,
      'wood'
    )
    // two side rails; the NEAR edge stays open — drinks pushed too far
    // sideways stay in, drinks dragged off the near edge fall to the sand.
    // Night levels may remove one or both (handle -1).
    const removed = mods.removeRails ?? []
    const side = (sign: 1 | -1): number =>
      removed.includes(sign < 0 ? 'left' : 'right')
        ? -1
        : this.addStatic(
            tilt(
              RAPIER.ColliderDesc.cuboid(RAIL_T / 2, RAIL_H / 2, HALF_L),
              sign * (HALF_W + RAIL_T / 2),
              SURFACE_Y + RAIL_H / 2,
              0
            ).setContactSkin(RAIL_SKIN),
            TABLE_WOOD.friction,
            TABLE_WOOD.restitution,
            'wood'
          )
    this.sideRailHandles = [side(-1), side(1)]
    // the beach: a big slab whose top face is y = 0 — fallen drinks land here
    this.sandHandle = this.addStatic(
      RAPIER.ColliderDesc.cuboid(12, 0.5, 12).setTranslation(0, -0.5, 0),
      SAND.friction,
      SAND.restitution,
      'sand'
    )
    // wet patch: 1.5 mm low-friction strip ON the plank. Min combine rule
    // beats the drink's Average, so μ_eff = WET_FRICTION — on sloped tables
    // (tan 2.5° ≈ 0.044 > 0.03) drinks parked on it genuinely slide.
    if (mods.wetPatch) {
      const wp = mods.wetPatch
      const desc = tilt(
        RAPIER.ColliderDesc.cuboid(wp.w / 2, WET_HALF_T, wp.l / 2),
        wp.x,
        SURFACE_Y + WET_HALF_T,
        wp.z
      )
        .setFriction(WET_FRICTION)
        .setRestitution(TABLE_WOOD.restitution)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Average)
      const col = this.raw.createCollider(desc)
      const t = col.translation()
      this.statics.set(col.handle, { label: 'wood', pos: new THREE.Vector3(t.x, t.y, t.z) })
      this.wetPatchHandle = col.handle
    }
  }

  /**
   * World-space plank-top height at world z (the tilted plane through the
   * table centre). Spawn, cradle, merge growth and dressing all sit on this.
   */
  surfaceYAt(z: number): number {
    return SURFACE_Y - this.slopeTan * z
  }

  private addStatic(
    desc: RAPIER.ColliderDesc,
    friction: number,
    restitution: number,
    label: string
  ): number {
    desc
      .setFriction(friction)
      .setRestitution(restitution)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Average)
    const col = this.raw.createCollider(desc)
    const t = col.translation()
    this.statics.set(col.handle, { label, pos: new THREE.Vector3(t.x, t.y, t.z) })
    return col.handle
  }

  /** Static umbrella-pole collider (obstacle levels). Runs sand → above table. */
  addPole(x: number, z: number, r: number): number {
    return this.addStatic(
      RAPIER.ColliderDesc.cylinder(1.1, r).setTranslation(x, 1.1, z),
      TABLE_WOOD.friction,
      TABLE_WOOD.restitution,
      'wood'
    )
  }

  /**
   * Spawn a drink body + entity at (x, z) on the table.
   *
   * Mass: the collider is created MASSLESS (density 0) and the exact ladder
   * mass is attached with setAdditionalMassProperties — MASS_KG is the whole
   * truth, never density × volume. Explicit cylinder inertia is passed
   * because the additional-mass path has no shape to derive it from; only
   * the Y term matters (X/Z rotations are locked upright).
   *
   * The returned entity's root/visual groups are bare transforms — the scene
   * parents the tier's template into drink.visual and adds drink.root to the
   * stage. visual sits at −height/2 so it (and the lean spring) pivots at
   * the drink's BASE, matching the template origin contract.
   */
  spawnDrink(tier: TierId, x: number, z: number, opts?: SpawnOpts): Drink {
    const def = TIERS[tier]
    const m = MASS_KG[tier]
    const drop = opts?.dropHeight ?? 0.004
    // sloped levels: spawn height follows the local plank height at z
    const y = this.surfaceYAt(z) + def.height / 2 + drop

    const body = this.raw.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .enabledRotations(false, true, false) // upright always; Y spin allowed
        .setLinearDamping(LINEAR_DAMPING)
    )
    const mat = MATERIALS[def.material]
    const collider = this.raw.createCollider(
      RAPIER.ColliderDesc.cylinder(def.height / 2, def.radius)
        .setDensity(0)
        .setFriction(mat.friction)
        .setRestitution(mat.restitution)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Average)
        .setActiveEvents(
          RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS
        )
        .setContactForceEventThreshold(CONTACT_FORCE_THRESHOLD),
      body
    )
    // solid cylinder inertia about the center: Iy = m r²/2, Ix = Iz = m(3r²+h²)/12
    const r2 = def.radius * def.radius
    const h2 = def.height * def.height
    body.setAdditionalMassProperties(
      m,
      { x: 0, y: 0, z: 0 },
      { x: (m * (3 * r2 + h2)) / 12, y: (m * r2) / 2, z: (m * (3 * r2 + h2)) / 12 },
      { x: 0, y: 0, z: 0, w: 1 },
      true
    )

    const root = new THREE.Group()
    const visual = new THREE.Group()
    visual.position.y = -def.height / 2
    root.add(visual)
    root.position.set(x, y, z)

    const drink: Drink = {
      id: allocDrinkId(),
      tier,
      def,
      state: opts?.state ?? 'live',
      body,
      collider,
      prevPos: new THREE.Vector3(x, y, z),
      currPos: new THREE.Vector3(x, y, z),
      prevRot: new THREE.Quaternion(),
      currRot: new THREE.Quaternion(),
      root,
      visual,
      lean: { rx: 0, rz: 0, vrx: 0, vrz: 0 },
      lastVel: new THREE.Vector3(),
      liquid: null,
      speed: 0,
      foulTime: 0,
      lastSameTierContact: -Infinity,
    }
    this.all.push(drink)
    this.byCollider.set(collider.handle, drink)
    return drink
  }

  /** Remove body + entity; also detaches the render root for convenience. */
  removeDrink(drink: Drink): void {
    const handle = drink.collider.handle
    this.byCollider.delete(handle)
    const i = this.all.indexOf(drink)
    if (i >= 0) this.all.splice(i, 1)
    // purge stale pairs involving this collider (compact-id decode)
    const id = this.handleIds.get(handle)
    if (id !== undefined) {
      for (const key of this.contactPairs) {
        if (Math.floor(key / PAIR_BASE) === id || key % PAIR_BASE === id) {
          this.contactPairs.delete(key)
          this.impactWindow.delete(key)
        }
      }
      this.handleIds.delete(handle)
    }
    this.raw.removeRigidBody(drink.body) // removes the collider with it
    drink.root.removeFromParent()
    drink.state = 'dead'
  }

  /**
   * One fixed step. Order matters:
   *  1. lastVel ← this step's outgoing velocity, prev pose ← curr pose
   *  2. solver step (events collected)
   *  3. curr pose ← body pose, speed from the pose delta (no wasm vel calls)
   *  4. drain collision events (contact set) then force events ('impact')
   *  5. one aggregate 'sliding' emit
   * Sleeping bodies skip the wasm pose reads entirely — 60 settled drinks
   * cost nothing here.
   */
  step(bus: EventBus): void {
    this.busRef = bus
    const inv = 1 / FIXED_DT

    for (const d of this.all) {
      d.lastVel.subVectors(d.currPos, d.prevPos).multiplyScalar(inv)
      d.prevPos.copy(d.currPos)
      d.prevRot.copy(d.currRot)
    }

    this.raw.step(this.queue)
    this.time += FIXED_DT

    let slidingSpeed = 0
    let slidingCount = 0
    let slidingX = 0
    for (const d of this.all) {
      if (d.body.isSleeping()) {
        d.speed = 0
        continue
      }
      const t = d.body.translation()
      d.currPos.set(t.x, t.y, t.z)
      const q = d.body.rotation()
      d.currRot.set(q.x, q.y, q.z, q.w)
      d.speed = d.currPos.distanceTo(d.prevPos) * inv
      if (d.speed > 0.02) {
        slidingSpeed += d.speed
        slidingCount++
        slidingX += d.currPos.x * d.speed
      }
    }

    this.queue.drainCollisionEvents(this.onCollision)
    this.queue.drainContactForceEvents(this.onContactForce)

    _sliding.speed = slidingSpeed
    _sliding.count = slidingCount
    _sliding.x = slidingSpeed > 1e-6 ? slidingX / slidingSpeed : 0
    bus.emit('sliding', _sliding)
    this.busRef = null
  }

  dispose(): void {
    this.queue.free()
    this.raw.free()
    this.all.length = 0
    this.byCollider.clear()
    this.contactPairs.clear()
    this.impactWindow.clear()
    this.handleIds.clear()
  }
}
