import type { TierId } from './tiers'

/**
 * ORDERS (点单) — the pacing engine of Endless mode. Every constant of the
 * system lives here. One card, one action (serve), one consequence (a mess).
 *
 * An order = "serve one drink of tier T". Endless only (level id 0), exactly
 * one active at a time. Serving lifts the drink off the table (big drinks
 * stop being dead space), failing tosses junk into the danger zone.
 */

/** the first order's tier; the ladder never goes below it */
export const ORDER_FIRST_TIER: TierId = 3
/** the ladder climbs one tier for every this-many orders served */
export const ORDER_LADDER_STEP = 2
/** hard ceiling for any order (the dispenser) */
export const ORDER_MAX_TIER: TierId = 12
/** an order may reach this far above the current pool's top tier */
export const ORDER_POOL_HEADROOM = 2

/**
 * Push budget: BUDGET(T) = BUDGET_BASE + BUDGET_PER_TIER · (T − 2)
 * (T3 → 7 … T9 → 19). Budget counts LAUNCHES — the pips show budget − used.
 * The miss resolves when the LAST launch has settled (not the instant it
 * fires), so a final push that lands the merge still serves the order.
 */
export const BUDGET_BASE = 4
export const BUDGET_PER_TIER = 2
/** ×1.4 (rounded up) when the table holds ZERO drinks of tier T−1 */
export const BUDGET_NO_BASE_MULT = 1.4

/** spawn-director bias while an order for T is active (pool tiers only) */
export const ORDER_BIAS_T_MINUS_1 = 2.0
export const ORDER_BIAS_T_MINUS_2 = 1.25

/** serve sequence: lift, then glide off the left (service) side while shrinking */
export const SERVE_LIFT_M = 0.4
/** the lift's ease-out-back runs over this window (s), inside the glide */
export const SERVE_LIFT_S = 0.3
export const SERVE_GLIDE_S = 0.62
export const SERVE_SHRINK_TO = 0.35
/** glide target x = −halfW − this (m): past the left rail, onto the service side */
export const SERVE_SIDE_MARGIN_M = 0.25

/** score = mergeScore(T, 1) × SERVE_SCORE_MULT × tip */
export const SERVE_SCORE_MULT = 3
/** tip = 1 + TIP_PER_PUSH × pushes left on the order, capped at TIP_CAP */
export const TIP_PER_PUSH = 0.1
export const TIP_CAP = 2.0

/** the next order arrives this long after the serve glide completes (s) */
export const NEXT_ORDER_DELAY_S = 0.6
/** "customer left": card shake + red flash length, then the next order (s) */
export const MISS_FLASH_S = 0.5

/** junk tossed on a miss: tier (seeded pick), drop height, x spread, z inset, speed */
/**
 * a miss tosses min(streak, JUNK_MAX_PER_MISS) junk drinks — 1 for a single
 * slip, 2 then 3 for consecutive misses — each landing closer to the foul
 * line (inset by JUNK_STREAK_INSETS[i]). A run that can no longer keep up
 * with its orders ends within a few of them instead of stalling for ever.
 */
export const JUNK_MAX_PER_MISS = 3
export const JUNK_STREAK_INSETS: readonly number[] = [0.12, 0.07, 0.03]
export const JUNK_TIERS: readonly TierId[] = [1, 2]
export const JUNK_DROP_M = 0.18
export const JUNK_X_RANGE_M = 0.2
/** lands at z = FOUL_Z − this: just beyond the foul line on the SAFE side */
export const JUNK_Z_INSET_M = 0.12
/** max horizontal launch speed of the tossed junk (m/s) */
export const JUNK_VEL_MAX = 0.3

/** pool progression: every N served the Endless pool shifts up one tier */
export const POOL_SHIFT_EVERY = 3
/**
 * max shifts from the [1..3] start: 7 → the pool tops out at [8..10] so the
 * order ladder (capped at poolMax + headroom) can reach the dispenser (12).
 * (At 4 the pool stalled at [5..7] and every order after the pineapple was
 * "pitcher" for ever — the player felt the run stop progressing.)
 */
export const POOL_SHIFT_MAX = 7

/** bar busyness for the ambience = min(1, served / this) */
export const BAR_BUSY_FULL_SERVED = 9
/** murmur + clink layers scale from 1× to this at busy = 1 */
export const BAR_BUSY_GAIN_MAX = 2.6

/** the HUD card pulses when this many pushes (or fewer) remain */
export const HUD_PULSE_AT = 2
/** pips up to this budget; a thin bar above it (a 30-pip ring won't fit a phone) */
export const HUD_MAX_PIPS = 12
/** order-card thumbnail render size (px, square); displayed at 56 css px */
export const THUMB_PX = 128

/** rng stream salt: orders never share a draw with the spawn director */
export const ORDER_SEED_SALT = 0x0ede5
