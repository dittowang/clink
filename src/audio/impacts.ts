import type { SoundMaterial } from '../config/tiers'
import { clamp01, noiseBurst, partial, rand, vary, type SourceSink } from './dsp'
import { audio } from './engine'

/**
 * Impact synthesis. One recipe per SoundMaterial; a pair impact plays the
 * HEAVIER material as the dominant layer plus a touch of the lighter one.
 * Loudness is quadratic in Rapier's totalForceMagnitude, brightness (filter
 * cutoffs + upper-partial mix) rises linearly with it.
 *
 * `scheduleImpact` is the shared core: it only touches BaseAudioContext, so
 * the OfflineAudioContext harness (offline.ts) verifies the exact same code
 * the live engine plays.
 */

/** contact force (N) that reads as a full slam — gain saturates here */
export const F_REF = 25
/**
 * Per-voice peak budget (pre-limiter). Chrome's DynamicsCompressor at the
 * briefed settings attenuates fast bright transients ~-12 dB even below
 * threshold (measured: level-independent, persists at ratio=1 — it's the
 * emphasis-filter smear, not gain reduction), so impacts are driven hot and
 * the chain output lands ~0.2 peak for a full slam. 6 simultaneous voices
 * stay < 1.0 at the master — verified by renderPileup in offline.ts.
 */
export const VOICE_PEAK = 1.0

export function impactGain01(force: number): number {
  const f = force / F_REF
  return clamp01(f * f)
}

/** heaviness ranking used to pick the dominant layer of a pair impact */
const RANK: Record<SoundMaterial, number> = {
  paper: 0,
  aluminum: 1,
  husk: 2,
  rind: 3,
  glass: 4,
  steel: 5,
}

export function isSoundMaterial(m: string): m is SoundMaterial {
  return Object.prototype.hasOwnProperty.call(RANK, m)
}

export function coerceMaterial(m: string): SoundMaterial {
  return isSoundMaterial(m) ? m : 'glass'
}

export interface ScheduledVoice {
  /** seconds until the voice is fully decayed (source stop time) */
  duration: number
  srcs: AudioScheduledSourceNode[]
}

type Recipe = (
  ctx: BaseAudioContext,
  dest: AudioNode,
  sink: SourceSink,
  t0: number,
  amp: number,
  bright: number,
  f01: number
) => number

/** aluminum can clank: 2–5 kHz noise burst + 4 inharmonic metallic partials */
const aluminum: Recipe = (ctx, dest, sink, t0, amp, bright) => {
  noiseBurst(ctx, dest, sink, t0, {
    dur: rand(0.02, 0.035),
    amp: amp * 0.75,
    type: 'bandpass',
    freq: 3200 * bright,
    q: 1.1,
  })
  const freqs = [2100, 3400, 4700, 6100]
  const amps = [0.34, 0.25, 0.18 * bright, 0.13 * bright]
  // decays 40–90 ms to -40 dB → -60 dB ramp times ×1.5, ±15% per hit
  const decays = [0.135, 0.115, 0.09, 0.07]
  for (let i = 0; i < freqs.length; i++) {
    partial(ctx, dest, sink, t0, {
      freq: vary(freqs[i], 0.02),
      amp: amp * amps[i],
      decay: vary(decays[i], 0.15),
    })
  }
  return 0.16
}

/** glass clink: 3 inharmonic sines (1 : 1.62 : 2.41) + beating pair + tick */
const glass: Recipe = (ctx, dest, sink, t0, amp, bright) => {
  const f0 = vary(2250, 0.015)
  const ratios = [1, 1.62, 2.41]
  const amps = [0.34, 0.22, 0.15 * bright]
  const decays = [0.26, 0.19, 0.13] // fundamental -40 dB ≈ 175 ms (brief: 80–200)
  for (let i = 0; i < ratios.length; i++) {
    partial(ctx, dest, sink, t0, {
      freq: f0 * ratios[i] * vary(1, 0.015),
      amp: amp * amps[i],
      decay: vary(decays[i], 0.15),
    })
  }
  // near-unison partner ~8 Hz off the fundamental → subtle beating
  partial(ctx, dest, sink, t0, {
    freq: f0 * 1.0035,
    amp: amp * 0.2,
    decay: vary(0.24, 0.15),
  })
  noiseBurst(ctx, dest, sink, t0, {
    dur: 0.012,
    amp: amp * 0.35,
    type: 'bandpass',
    freq: 4500 * bright,
    q: 1.4,
  })
  return 0.3
}

/** juice-box thump: lowpassed noise + soft 180 Hz body knock */
const paper: Recipe = (ctx, dest, sink, t0, amp, bright) => {
  noiseBurst(ctx, dest, sink, t0, {
    dur: rand(0.08, 0.11), // -40 dB at 53–73 ms (brief: 40–80)
    amp: amp * 1.4, // lowpass eats most broadband power; compensate
    type: 'lowpass',
    freq: 900 * bright,
    q: 0.7,
  })
  partial(ctx, dest, sink, t0, {
    freq: vary(180, 0.06),
    amp: amp * 0.55,
    decay: vary(0.1, 0.15),
    bendRatio: 0.9,
    bendTime: 0.07,
  })
  return 0.13
}

/** coconut husk: 2–3 damped low-mid partials + woody knock */
const husk: Recipe = (ctx, dest, sink, t0, amp, bright) => {
  const freqs = [320, 520, 740]
  const amps = [0.45, 0.3, 0.18 * bright]
  const decays = [0.15, 0.12, 0.09] // -40 dB 60–100 ms (brief: 60–120)
  for (let i = 0; i < freqs.length; i++) {
    partial(ctx, dest, sink, t0, {
      freq: vary(freqs[i], 0.05),
      amp: amp * amps[i],
      decay: vary(decays[i], 0.15),
    })
  }
  noiseBurst(ctx, dest, sink, t0, {
    dur: 0.035,
    amp: amp * 0.6,
    type: 'bandpass',
    freq: 1400 * bright,
    q: 1.5,
  })
  return 0.17
}

/** melon/pineapple rind: husk but deeper and wetter — downward pitch bend */
const rind: Recipe = (ctx, dest, sink, t0, amp, bright) => {
  const freqs = [230, 360, 470]
  const amps = [0.48, 0.3, 0.16]
  const decays = [0.19, 0.15, 0.11]
  for (let i = 0; i < freqs.length; i++) {
    partial(ctx, dest, sink, t0, {
      freq: vary(freqs[i], 0.06),
      amp: amp * amps[i],
      decay: vary(decays[i], 0.15),
      bendRatio: 0.86,
      bendTime: 0.09,
    })
  }
  // wet slap: lowpassed noise whose cutoff falls during the hit
  noiseBurst(ctx, dest, sink, t0, {
    dur: rand(0.09, 0.12),
    amp: amp * 1.1,
    type: 'lowpass',
    freq: 950 * bright,
    freqEnd: 340,
    q: 0.8,
  })
  return 0.21
}

/** steel bucket: bright 1.5–8 kHz partials, longer gentle ring */
const steel: Recipe = (ctx, dest, sink, t0, amp, bright) => {
  const freqs = [1500, 2700, 4200, 6300, 7800]
  const amps = [0.28, 0.2, 0.14, 0.1 * bright, 0.07 * bright]
  const decays = [0.42, 0.34, 0.27, 0.21, 0.17] // ring -40 dB ≈ 110–280 ms
  for (let i = 0; i < freqs.length; i++) {
    partial(ctx, dest, sink, t0, {
      freq: vary(freqs[i], 0.01),
      amp: amp * amps[i],
      decay: vary(decays[i], 0.15),
    })
  }
  noiseBurst(ctx, dest, sink, t0, {
    dur: 0.012,
    amp: amp * 0.3,
    type: 'bandpass',
    freq: 3000 * bright,
    q: 1.2,
  })
  return 0.46
}

const RECIPES: Record<SoundMaterial, Recipe> = { paper, aluminum, glass, husk, rind, steel }

/**
 * Shared scheduling core (online + offline). Returns the created sources so
 * the live voice pool can steal them.
 */
export function scheduleImpact(
  ctx: BaseAudioContext,
  dest: AudioNode,
  t0: number,
  matA: SoundMaterial,
  matB: SoundMaterial,
  force: number
): ScheduledVoice {
  const sink: SourceSink = { srcs: [] }
  const g01 = impactGain01(force)
  if (g01 < 1e-4) return { duration: 0, srcs: sink.srcs }
  const f01 = clamp01(force / F_REF)
  const bright = 0.72 + 0.55 * f01
  const amp = VOICE_PEAK * g01
  const [dom, sub] = RANK[matA] >= RANK[matB] ? [matA, matB] : [matB, matA]
  let duration: number
  if (dom === sub) {
    duration = RECIPES[dom](ctx, dest, sink, t0, amp, bright, f01)
  } else {
    duration = RECIPES[dom](ctx, dest, sink, t0, amp * 0.8, bright, f01)
    const subDur = RECIPES[sub](ctx, dest, sink, t0 + 0.002, amp * 0.35, bright, f01)
    duration = Math.max(duration, subDur)
  }
  return { duration, srcs: sink.srcs }
}

/** Live entry point wired by engine.subscribe(bus) to the `impact` event. */
export function playImpact(matA: string, matB: string, force: number): void {
  if (impactGain01(force) < 0.002) return // sub-audible; don't burn a voice
  const v = audio.allocImpactVoice()
  if (!v) return
  const sv = scheduleImpact(v.ctx, v.out, v.now + 0.005, coerceMaterial(matA), coerceMaterial(matB), force)
  v.register(sv)
}
