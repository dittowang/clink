/**
 * Fixed-step scheduler with render interpolation.
 *
 * Physics steps at FIXED_DT (1/120 s) from an accumulator; every body keeps
 * its previous and current pose and the render layer draws at the accumulator
 * fraction between them. This is the load-bearing wall of the hand-feel: the
 * solver rate and the display rate never fight, so sliding is judder-free at
 * any refresh rate.
 *
 * The accumulator is clamped to MAX_ACCUM (0.1 s) so a tab hidden for ten
 * minutes resumes with at most 12 catch-up steps instead of a physics
 * explosion.
 */
export const FIXED_DT = 1 / 120
export const MAX_ACCUM = 0.1

export interface Steppable {
  /** advance physics by exactly FIXED_DT */
  fixedUpdate(dt: number): void
  /** called once per rendered frame with interpolation alpha in [0,1] */
  frameUpdate(alpha: number, frameDt: number): void
}

export class Scheduler {
  private accumulator = 0
  private lastTime: number | null = null
  /** true while the harness drives time manually via stepTo() */
  manual = false

  constructor(private target: Steppable) {}

  /** RAF-driven tick. timeMs from performance.now(). */
  tick(timeMs: number): void {
    if (this.manual) return
    if (this.lastTime === null) this.lastTime = timeMs
    let frameDt = (timeMs - this.lastTime) / 1000
    this.lastTime = timeMs
    if (frameDt < 0) frameDt = 0
    this.advance(frameDt)
  }

  /** Harness: advance simulated time deterministically (no wall clock). */
  stepTo(seconds: number): void {
    const total = Math.max(0, seconds)
    let remaining = total
    // advance in <= MAX_ACCUM slices so the clamp never eats harness time
    while (remaining > 1e-9) {
      const slice = Math.min(remaining, MAX_ACCUM)
      this.advance(slice)
      remaining -= slice
    }
  }

  private advance(frameDt: number): void {
    this.accumulator = Math.min(this.accumulator + frameDt, MAX_ACCUM)
    while (this.accumulator >= FIXED_DT) {
      this.target.fixedUpdate(FIXED_DT)
      this.accumulator -= FIXED_DT
    }
    this.target.frameUpdate(this.accumulator / FIXED_DT, frameDt)
  }

  /** call on visibilitychange -> visible so the first frame after resume is calm */
  resetClock(): void {
    this.lastTime = null
    this.accumulator = 0
  }
}
