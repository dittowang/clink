import type { Rng } from '../core/rng'
import type { TierId } from '../config/tiers'
import { TURN_TIMEOUT_S } from '../config/table'

/**
 * TurnManager — the draw stream + turn phase timers, per docs/GAME.md.
 *
 * Endless-lite v1: uniform draws from the pool off the seeded Rng (the
 * weighted director arrives later). `currentTier` is what sits (or will sit)
 * in the cradle; `nextTier` is what the in-world tray shows. The next drink
 * is drawn AT LAUNCH (per the spec), so the tray refreshes the moment the
 * current one flies.
 *
 * Phases:
 *   drop — the cradle drink is falling in; after DROP_SETTLE_S it's aimable
 *   aim  — waiting for the player (or harness push); no timers run
 *   wait — launched; the next drink arrives when the table settles
 *          (all live speeds < SETTLE_SPEED, checked by the scene) or
 *          TURN_TIMEOUT_S elapses — never waits for full rest
 *   over — game over, nothing advances
 */

export type TurnPhase = 'drop' | 'aim' | 'wait' | 'over'
export type TurnAction = 'aimReady' | 'spawn' | null

/** let the spawn drop land + settle before handing over the slingshot (s) */
const DROP_SETTLE_S = 0.35
/** ignore the settle check right after launch while speed ramps in (s) */
const MIN_WAIT_S = 0.25

export class TurnManager {
  currentTier: TierId
  nextTier: TierId
  phase: TurnPhase = 'drop'
  /** launches taken this run */
  turns = 0
  private t = 0

  constructor(
    private readonly rng: Rng,
    private readonly pool: readonly TierId[]
  ) {
    this.currentTier = this.draw()
    this.nextTier = this.draw()
  }

  private draw(): TierId {
    return this.rng.pick(this.pool)
  }

  /** the cradle drink launched: shift the queue, draw the new tray drink */
  onLaunch(): void {
    if (this.phase === 'over') return
    this.phase = 'wait'
    this.t = 0
    this.turns++
    this.currentTier = this.nextTier
    this.nextTier = this.draw()
  }

  end(): void {
    this.phase = 'over'
  }

  /** one fixed step; allSettled = every live body below SETTLE_SPEED */
  update(dt: number, allSettled: boolean): TurnAction {
    if (this.phase === 'over' || this.phase === 'aim') return null
    this.t += dt
    if (this.phase === 'drop') {
      if (this.t >= DROP_SETTLE_S) {
        this.phase = 'aim'
        return 'aimReady'
      }
      return null
    }
    // 'wait'
    if ((this.t >= MIN_WAIT_S && allSettled) || this.t >= TURN_TIMEOUT_S) {
      this.phase = 'drop'
      this.t = 0
      return 'spawn'
    }
    return null
  }
}
