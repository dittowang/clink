import type { TierId } from '../config/tiers'
import { SETTLE_SPEED } from '../config/table'
import { Rng } from '../core/rng'
import type { PhysicsWorld } from '../physics/world'

/**
 * SpawnDirector — the weighted draw stream, per docs/GAME.md.
 *
 * Base weight w(tier) = 1 / indexInPool (1-based, so the pool skews low).
 * Rubber band, recomputed from the live table at every draw:
 *   - a tier with >= 2 copies AT REST on the table gets ×1.3 (more copies
 *     push it toward the ×1.4 cap) — feed an almost-ready merge;
 *   - a tier with 0 copies that is not the pool's lowest gets ×0.7 — don't
 *     seed a tier the player has no partners for.
 * Draws consume exactly one rng.next() each, so runs stay reproducible from
 * the seeded stream (same seed + same pushes → same draws).
 */
export class SpawnDirector {
  // scratch, reused per draw
  private readonly weights: number[]

  constructor(
    private readonly rng: Rng,
    readonly pool: readonly TierId[],
    private readonly world: PhysicsWorld
  ) {
    this.weights = new Array(pool.length).fill(0)
  }

  /** copies of a tier at rest on the table (live + below settle speed) */
  private restingCopies(tier: TierId): number {
    let n = 0
    for (const d of this.world.all) {
      if (d.tier === tier && d.state === 'live' && d.speed < SETTLE_SPEED) n++
    }
    return n
  }

  /** recompute the weight row (also what directorStats reports) */
  computeWeights(): readonly number[] {
    for (let i = 0; i < this.pool.length; i++) {
      let w = 1 / (i + 1)
      const copies = this.restingCopies(this.pool[i])
      if (copies >= 2) {
        w *= Math.min(1 + 0.15 * copies, 1.4) // 2 copies → ×1.3, 3+ → ×1.4 cap
      } else if (copies === 0 && i > 0) {
        w *= 0.7
      }
      this.weights[i] = w
    }
    return this.weights
  }

  private drawFrom(rng: Rng): TierId {
    this.computeWeights()
    let total = 0
    for (const w of this.weights) total += w
    let r = rng.next() * total
    for (let i = 0; i < this.weights.length; i++) {
      r -= this.weights[i]
      if (r <= 0) return this.pool[i]
    }
    return this.pool[this.pool.length - 1]
  }

  /** the game's draw — consumes the level's seeded stream */
  draw(): TierId {
    let t = this.drawFrom(this.rng)
    // streak guard: 4+ identical draws in a row makes the tutorial pools feel
    // rigged-monotonous (seed 1337 dealt 7 juice boxes straight); one forced
    // redraw stays deterministic and barely dents the weighting
    if (t === this.lastDraw && this.streak >= 3 && this.pool.length > 1) {
      const other = this.drawFrom(this.rng)
      if (other !== t) t = other
    }
    if (t === this.lastDraw) this.streak++
    else { this.lastDraw = t; this.streak = 1 }
    return t
  }

  private lastDraw: TierId | null = null
  private streak = 0

  /**
   * QA: histogram of n draws against the CURRENT table state, using a private
   * rng so the gameplay stream is untouched.
   */
  stats(n: number, seed = 12345): { weights: number[]; counts: Partial<Record<TierId, number>> } {
    const rng = new Rng(seed)
    const counts: Partial<Record<TierId, number>> = {}
    for (let i = 0; i < n; i++) {
      const t = this.drawFrom(rng)
      counts[t] = (counts[t] ?? 0) + 1
    }
    return { weights: [...this.computeWeights()], counts }
  }
}
