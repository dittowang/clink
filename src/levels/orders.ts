import type { TierId } from '../config/tiers'
import { Rng } from '../core/rng'
import {
  ORDER_FIRST_TIER,
  ORDER_LADDER_STEP,
  ORDER_MAX_TIER,
  ORDER_POOL_HEADROOM,
  BUDGET_BASE,
  BUDGET_PER_TIER,
  BUDGET_NO_BASE_MULT,
  TIP_PER_PUSH,
  TIP_CAP,
  JUNK_TIERS,
  JUNK_X_RANGE_M,
  JUNK_VEL_MAX,
  POOL_SHIFT_EVERY,
  POOL_SHIFT_MAX,
  BAR_BUSY_FULL_SERVED,
} from '../config/orders'

/**
 * OrderManager — the Endless order ladder, per src/config/orders.ts.
 *
 * Pure bookkeeping: which tier to ask for, how many launches it gets, what
 * a serve is worth, when the pool shifts, what junk a miss tosses. The scene
 * owns the physics/visual consequences (serve glide, junk spawn, HUD).
 *
 * Determinism: the junk toss draws from a private Rng seeded off the level
 * seed (ORDER_SEED_SALT) — never the spawn director's stream, so existing
 * QA draw sequences are untouched. The tier ladder itself is a pure function
 * of (served, table contents) and consumes no draws.
 */

export interface Order {
  tier: TierId
  budget: number
  /** launches taken since the order was issued */
  used: number
}

export interface JunkToss {
  tier: TierId
  /** seeded x in ±JUNK_X_RANGE_M */
  x: number
  /** small seeded horizontal velocity, |v| ≤ JUNK_VEL_MAX */
  vx: number
  vz: number
}

export class OrderManager {
  served = 0
  missed = 0
  current: Order | null = null
  private readonly rng: Rng

  /**
   * @param onTable copies of a tier currently on the table (live + merging +
   *   cradle — anything the player can see standing there)
   */
  constructor(
    seed: number,
    private readonly basePool: readonly TierId[],
    private readonly onTable: (tier: TierId) => number
  ) {
    this.rng = new Rng(seed)
  }

  /** pool shifts earned so far (every POOL_SHIFT_EVERY served, capped) */
  get poolShift(): number {
    return Math.min(POOL_SHIFT_MAX, Math.floor(this.served / POOL_SHIFT_EVERY))
  }

  /** the shifted Endless pool: [1..5] → [2..6] → [3..7] → [4..8] */
  pool(): TierId[] {
    const k = this.poolShift
    return this.basePool.map((t) => Math.min(ORDER_MAX_TIER, t + k) as TierId)
  }

  /** ambience busyness 0..1 */
  busy(): number {
    return Math.min(1, this.served / BAR_BUSY_FULL_SERVED)
  }

  /**
   * Target tier: T_base = FIRST + floor(served / STEP), never below
   * poolMax + 1 (always at least one merge above what is dealt), capped at
   * min(12, poolMax + headroom); bumped +1 while that tier already stands on
   * the table (up to 12).
   */
  targetTier(): TierId {
    const pool = this.pool()
    let poolMax = pool[0]
    for (const t of pool) if (t > poolMax) poolMax = t
    const cap = Math.min(ORDER_MAX_TIER, poolMax + ORDER_POOL_HEADROOM)
    let tier = Math.min(cap, ORDER_FIRST_TIER + Math.floor(this.served / ORDER_LADDER_STEP))
    tier = Math.max(ORDER_FIRST_TIER, tier)
    // an order is always ABOVE the dealt pool: it must take at least one
    // merge to make — a tier the pool deals directly would serve itself
    tier = Math.max(tier, Math.min(ORDER_MAX_TIER, poolMax + 1))
    while (tier < ORDER_MAX_TIER && this.onTable(tier as TierId) > 0) tier++
    return tier as TierId
  }

  /** BUDGET(T) = BASE + PER_TIER·(T−2); ×1.4 (ceil) with nothing of T−1 to build from */
  budgetFor(tier: TierId): number {
    let b = BUDGET_BASE + BUDGET_PER_TIER * (tier - 2)
    if (this.onTable((tier - 1) as TierId) === 0) b = Math.ceil(b * BUDGET_NO_BASE_MULT)
    return b
  }

  issue(): Order {
    const tier = this.targetTier()
    this.current = { tier, budget: this.budgetFor(tier), used: 0 }
    return this.current
  }

  /** a launch happened (the same event the push counter uses) */
  onLaunch(): void {
    if (this.current) this.current.used++
  }

  get pushesLeft(): number {
    return this.current ? Math.max(0, this.current.budget - this.current.used) : 0
  }

  get budgetExhausted(): boolean {
    return this.current !== null && this.current.used >= this.current.budget
  }

  /**
   * The ordered drink arrived. Returns the tip multiplier (1 + 0.1 per push
   * left, ≤ TIP_CAP) and whether this serve shifted the pool.
   */
  serve(): { tier: TierId; tip: number; pushesLeft: number; served: number; shifted: boolean } {
    const o = this.current!
    const pushesLeft = this.pushesLeft
    const tip = Math.min(TIP_CAP, 1 + TIP_PER_PUSH * pushesLeft)
    const before = this.poolShift
    this.served++
    this.current = null
    return { tier: o.tier, tip, pushesLeft, served: this.served, shifted: this.poolShift !== before }
  }

  /** the budget ran out: customer left. A miss moves the ladder neither way. */
  miss(): { tier: TierId; missed: number } {
    const o = this.current!
    this.missed++
    this.current = null
    return { tier: o.tier, missed: this.missed }
  }

  /** the mess a miss tosses on the table — three seeded draws, fixed order */
  junkToss(): JunkToss {
    const tier = this.rng.pick(JUNK_TIERS)
    const x = this.rng.range(-JUNK_X_RANGE_M, JUNK_X_RANGE_M)
    const ang = this.rng.range(0, Math.PI * 2)
    const speed = this.rng.range(JUNK_VEL_MAX * 0.3, JUNK_VEL_MAX)
    return { tier, x, vx: Math.cos(ang) * speed, vz: Math.sin(ang) * speed }
  }
}
