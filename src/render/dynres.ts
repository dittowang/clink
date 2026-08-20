import type * as THREE from 'three'
import { isHarness } from '../harness/api'
import { basePixelRatio, getRenderScale, setRenderScale, isMeasuring } from './quality'

/**
 * Dynamic resolution (docs/PERF.md §2): an EMA of wall-clock frame time,
 * measured between stage.render calls. Sustained > 17.5 ms for > 1 s steps
 * the render scale down 10% (floor 0.7× of the tier's base dpr); sustained
 * < 13 ms for > 2 s steps back up (ceiling 1.0×). The dead band between the
 * two thresholds plus a 1 s post-change cooldown prevents oscillation.
 *
 * Scale changes route through renderer.setPixelRatio + the caller's resize
 * hook (post.setSize), so the composer + GTAO + bloom targets stay in sync —
 * the same path a window resize takes.
 *
 * Disabled in harness mode (SwiftShader wall time would drive every capture
 * to the floor and captures must stay deterministic); ?dynres=1 forces it on,
 * ?dynres=0 forces it off.
 */
const OVER_MS = 17.5
const UNDER_MS = 13
const OVER_HOLD_S = 1
const UNDER_HOLD_S = 2
const COOLDOWN_S = 1
const STEP = 0.9
const FLOOR = 0.7
const EMA_ALPHA = 0.1
/** a dt this large is a tab switch or debugger pause, not a slow frame */
const HITCH_S = 0.25

export interface DynRes {
  /** call once per rendered frame, before rendering */
  update(): void
}

export function createDynRes(renderer: THREE.WebGLRenderer, applySize: () => void): DynRes {
  const params = new URLSearchParams(window.location.search)
  const flag = params.get('dynres')
  const enabled = flag === '1' ? true : flag === '0' ? false : !isHarness()

  let last = -1
  let ema = 0
  let over = 0
  let under = 0
  let cooldown = 0

  function apply(scale: number): void {
    setRenderScale(scale)
    renderer.setPixelRatio(basePixelRatio() * scale)
    applySize()
    cooldown = COOLDOWN_S
    over = 0
    under = 0
  }

  return {
    update() {
      if (!enabled || isMeasuring()) return
      const now = performance.now()
      if (last < 0) {
        last = now
        return
      }
      const dt = (now - last) / 1000
      last = now
      if (dt > HITCH_S) {
        ema = 0
        over = 0
        under = 0
        return
      }
      const ms = dt * 1000
      ema = ema === 0 ? ms : ema + EMA_ALPHA * (ms - ema)
      if (cooldown > 0) {
        cooldown -= dt
        return
      }
      if (ema > OVER_MS) {
        over += dt
        under = 0
      } else if (ema < UNDER_MS) {
        under += dt
        over = 0
      } else {
        over = 0
        under = 0
      }
      const scale = getRenderScale()
      if (over > OVER_HOLD_S && scale > FLOOR + 1e-3) {
        apply(Math.max(FLOOR, scale * STEP))
      } else if (under > UNDER_HOLD_S && scale < 1 - 1e-3) {
        apply(Math.min(1, scale / STEP))
      }
    },
  }
}
