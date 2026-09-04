import { clamp01, noiseBurst, panForX, partial, vary, whiteNoiseBuffer, type SourceSink } from './dsp'
import { audio } from './engine'
import { TIP_CAP } from '../config/orders'

/**
 * Merge + one-shot UI/game sounds. `scheduleMerge` is the shared recipe core
 * (BaseAudioContext only) so offline.ts verifies the exact sound the game
 * plays; the play* wrappers are what engine.subscribe(bus) wires up.
 */

/** pop pitch drops as tiers get heavier: tier 2 ≈ 536 Hz, tier 11 ≈ 280 Hz */
export function popPitch(tier: number): number {
  return 620 * Math.pow(0.93, tier)
}

/**
 * Pour (bandpass-swept noise with bubbling ripple) + pop (falling sine),
 * plus a rising sparkle arpeggio when a chain is running. Returns total
 * duration in seconds.
 */
export function scheduleMerge(
  ctx: BaseAudioContext,
  dest: AudioNode,
  t0: number,
  tier: number,
  chain: number
): number {
  const sink: SourceSink = { srcs: [] }

  // --- pour: noise through a bandpass sweeping 400 -> 1400 Hz over ~250 ms
  const src = ctx.createBufferSource()
  src.buffer = whiteNoiseBuffer(ctx)
  src.loop = true
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 2.4
  bp.frequency.setValueAtTime(400, t0)
  bp.frequency.exponentialRampToValueAtTime(1400, t0 + 0.25)
  // bubbling: two incommensurate LFOs ripple the pour amplitude
  const ripple = ctx.createGain()
  ripple.gain.value = 1
  for (const hz of [11.3, 17.9]) {
    const lfo = ctx.createOscillator()
    lfo.frequency.value = vary(hz, 0.12)
    const depth = ctx.createGain()
    depth.gain.value = 0.3
    lfo.connect(depth).connect(ripple.gain)
    lfo.start(t0)
    lfo.stop(t0 + 0.4)
    sink.srcs.push(lfo)
  }
  const env = ctx.createGain()
  env.gain.setValueAtTime(0, t0)
  env.gain.linearRampToValueAtTime(0.28, t0 + 0.05)
  env.gain.setValueAtTime(0.28, t0 + 0.2)
  env.gain.exponentialRampToValueAtTime(1e-4, t0 + 0.33)
  env.gain.setValueAtTime(0, t0 + 0.33)
  src.connect(bp).connect(ripple).connect(env).connect(dest)
  src.start(t0, Math.random())
  src.stop(t0 + 0.36)
  sink.srcs.push(src)

  // --- pop: sine dropping ~520 -> 300 Hz-ish, pitched down as tier rises
  const p = popPitch(tier) * vary(1, 0.02)
  partial(ctx, dest, sink, t0 + 0.17, {
    freq: p,
    amp: 0.2,
    decay: 0.1,
    bendRatio: 0.56, // 620·0.93^t → ×0.56 ≈ the briefed 520→300 slope
    bendTime: 0.06,
    attack: 0.004,
  })
  noiseBurst(ctx, dest, sink, t0 + 0.17, {
    dur: 0.02,
    amp: 0.06,
    type: 'bandpass',
    freq: p * 3,
    q: 2,
  })

  let end = t0 + 0.36
  // --- chain sparkle: short rising arpeggio, more/higher notes per link
  if (chain > 1) {
    const n = Math.min(chain + 1, 6)
    const noteAmp = 0.055 + 0.009 * Math.min(chain, 6)
    for (let k = 0; k < n; k++) {
      const at = t0 + 0.24 + k * 0.05
      partial(ctx, dest, sink, at, {
        freq: 1350 * Math.pow(1.26, k) * vary(1, 0.01),
        amp: noteAmp,
        decay: 0.2,
        attack: 0.003,
      })
    }
    end = t0 + 0.24 + n * 0.05 + 0.22
  }
  return end - t0
}

/** x = merge centroid's table x — the pour/pop comes from where it happened */
export function playMerge(tier: number, chain: number, x = 0): void {
  const h = audio.playbackHandle()
  if (!h) return
  const panner = h.ctx.createStereoPanner()
  panner.pan.value = panForX(x)
  panner.connect(h.fx)
  scheduleMerge(h.ctx, panner, h.now + 0.01, tier, chain)
}

/** soft lowpassed knock when the next drink lands in the cradle */
export function playSpawnThud(): void {
  const h = audio.playbackHandle()
  if (!h) return
  const sink: SourceSink = { srcs: [] }
  const t0 = h.now + 0.005
  noiseBurst(h.ctx, h.fx, sink, t0, { dur: 0.07, amp: 0.1, type: 'lowpass', freq: 340, q: 0.7 })
  partial(h.ctx, h.fx, sink, t0, { freq: vary(150, 0.05), amp: 0.055, decay: 0.1, bendRatio: 0.78, bendTime: 0.07 })
}

/** a drink met the beach: dull 120 Hz thump + sand hiss */
export function playSandThud(): void {
  const h = audio.playbackHandle()
  if (!h) return
  const sink: SourceSink = { srcs: [] }
  const t0 = h.now + 0.005
  partial(h.ctx, h.fx, sink, t0, { freq: vary(120, 0.05), amp: 0.14, decay: 0.16, bendRatio: 0.85, bendTime: 0.1 })
  noiseBurst(h.ctx, h.fx, sink, t0 + 0.01, { dur: 0.26, amp: 0.035, type: 'highpass', freq: 1800, q: 0.6 })
}

/** low dissonant sting for the foul warning turning into a foul */
export function playFoul(): void {
  const h = audio.playbackHandle()
  if (!h) return
  const sink: SourceSink = { srcs: [] }
  const t0 = h.now + 0.005
  const lp = h.ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 420
  lp.Q.value = 0.7
  lp.connect(h.fx)
  partial(h.ctx, lp, sink, t0, { freq: 110, amp: 0.2, decay: 0.5, type: 'sawtooth', attack: 0.01 })
  partial(h.ctx, lp, sink, t0, { freq: 116.7, amp: 0.16, decay: 0.5, type: 'sawtooth', attack: 0.01 })
}

/** warm 3-note marimba-ish arp: sine fundamental + the marimba 1:4 partial */
export function playLevelComplete(): void {
  const h = audio.playbackHandle()
  if (!h) return
  const sink: SourceSink = { srcs: [] }
  const notes = [523.25, 659.25, 783.99] // C5 E5 G5
  for (let i = 0; i < notes.length; i++) {
    const t0 = h.now + 0.01 + i * 0.13
    partial(h.ctx, h.fx, sink, t0, { freq: notes[i], amp: 0.2, decay: 0.4, attack: 0.003 })
    partial(h.ctx, h.fx, sink, t0, { freq: notes[i] * 4, amp: 0.055, decay: 0.09, attack: 0.002 })
    noiseBurst(h.ctx, h.fx, sink, t0, { dur: 0.008, amp: 0.04, type: 'bandpass', freq: notes[i] * 4, q: 2 })
  }
}

/** descending minor line, soft and final */
export function playGameOver(): void {
  const h = audio.playbackHandle()
  if (!h) return
  const sink: SourceSink = { srcs: [] }
  const lp = h.ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 1100
  lp.Q.value = 0.6
  lp.connect(h.fx)
  const notes = [392, 329.63, 261.63, 220] // G4 E4 C4 A3 — falling A-minor
  for (let i = 0; i < notes.length; i++) {
    const t0 = h.now + 0.01 + i * 0.24
    const last = i === notes.length - 1
    partial(h.ctx, lp, sink, t0, { freq: notes[i], amp: 0.17, decay: last ? 0.9 : 0.4, type: 'triangle', attack: 0.008 })
  }
}

/**
 * "Order up": two clean sines a fifth apart (C6 → G6), 60 ms apart, 300 ms
 * decay, plus a soft coin/tip tick whose level scales with the tip (silent
 * at tip 1, a bright little ting at TIP_CAP). Shared core so offline.ts can
 * verify it. Returns total duration (s).
 */
export function scheduleOrderUp(ctx: BaseAudioContext, dest: AudioNode, t0: number, tip: number): number {
  const sink: SourceSink = { srcs: [] }
  partial(ctx, dest, sink, t0, { freq: 1046.5, amp: 0.16, decay: 0.3, attack: 0.002 })
  partial(ctx, dest, sink, t0 + 0.06, { freq: 1568.0, amp: 0.14, decay: 0.3, attack: 0.002 })
  const k = clamp01((tip - 1) / (TIP_CAP - 1))
  let end = t0 + 0.36
  if (k > 0) {
    const at = t0 + 0.17
    partial(ctx, dest, sink, at, { freq: 2637 * vary(1, 0.01), amp: 0.025 + 0.075 * k, decay: 0.14, attack: 0.001 })
    partial(ctx, dest, sink, at, { freq: 5274, amp: 0.012 + 0.03 * k, decay: 0.07, attack: 0.001 })
    noiseBurst(ctx, dest, sink, at, { dur: 0.03, amp: 0.015 + 0.03 * k, type: 'bandpass', freq: 5200, q: 3 })
    end = at + 0.16
  }
  return end - t0
}

/** the serve bell, from the service side (left) of the stereo field */
export function playOrderUp(tip: number): void {
  const h = audio.playbackHandle()
  if (!h) return
  const panner = h.ctx.createStereoPanner()
  panner.pan.value = panForX(-0.3)
  panner.connect(h.fx)
  scheduleOrderUp(h.ctx, panner, h.now + 0.01, tip)
}
