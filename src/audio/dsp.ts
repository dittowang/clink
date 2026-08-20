/**
 * Shared DSP building blocks, written against BaseAudioContext so the live
 * AudioEngine and the OfflineAudioContext verification harness run the EXACT
 * same code paths (§ offline.ts). Zero samples: every sound is oscillators,
 * one cached white-noise buffer, and filters.
 */

/** collects every scheduled source of a voice so the pool can steal/stop it */
export interface SourceSink {
  srcs: AudioScheduledSourceNode[]
}

const NOISE_SECONDS = 2
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>()

/** One looping white-noise buffer per context, filled once and shared. */
export function whiteNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx)
  if (!buf) {
    const len = Math.floor(ctx.sampleRate * NOISE_SECONDS)
    buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    noiseCache.set(ctx, buf)
  }
  return buf
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Table x (m) → StereoPanner pan. The playfield spans x ∈ [-0.4, 0.4]; the
 * edges land at ±0.55 — clearly lateralized without ever hard-panning a
 * clink into one ear.
 */
export const panForX = (x: number): number => {
  const p = x * 1.375
  return p < -0.55 ? -0.55 : p > 0.55 ? 0.55 : p
}
export const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo)
/** micro-variation: multiply v by 1 ± pct (audio needs no determinism) */
export const vary = (v: number, pct: number): number => v * (1 + (Math.random() * 2 - 1) * pct)

/**
 * Filtered noise burst with a fast attack and an exponential decay.
 * `dur` is the time to -60 dB; the -40 dB point of an exponential ramp lands
 * at ~2/3·dur, which is what the offline probe measures.
 */
export function noiseBurst(
  ctx: BaseAudioContext,
  dest: AudioNode,
  sink: SourceSink,
  t0: number,
  o: {
    dur: number
    amp: number
    type: BiquadFilterType
    freq: number
    /** optional cutoff sweep target (wet/pour sounds) */
    freqEnd?: number
    q?: number
    attack?: number
  }
): void {
  const src = ctx.createBufferSource()
  src.buffer = whiteNoiseBuffer(ctx)
  src.loop = true
  const filt = ctx.createBiquadFilter()
  filt.type = o.type
  filt.frequency.setValueAtTime(Math.max(20, o.freq), t0)
  if (o.freqEnd) filt.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t0 + o.dur)
  filt.Q.value = o.q ?? 0.9
  const g = ctx.createGain()
  const atk = o.attack ?? 0.002
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(o.amp, t0 + atk)
  g.gain.exponentialRampToValueAtTime(Math.max(o.amp * 1e-3, 1e-6), t0 + o.dur)
  g.gain.setValueAtTime(0, t0 + o.dur)
  src.connect(filt).connect(g).connect(dest)
  // random offset into the loop decorrelates layered bursts
  src.start(t0, Math.random() * (NOISE_SECONDS - 0.5))
  src.stop(t0 + o.dur + 0.02)
  sink.srcs.push(src)
}

/**
 * One exponentially decaying partial. `decay` is time to -60 dB (measured
 * -40 dB point ≈ 2/3·decay). Optional exponential pitch bend for wet knocks.
 */
export function partial(
  ctx: BaseAudioContext,
  dest: AudioNode,
  sink: SourceSink,
  t0: number,
  o: {
    freq: number
    amp: number
    decay: number
    type?: OscillatorType
    bendRatio?: number
    bendTime?: number
    attack?: number
  }
): void {
  const osc = ctx.createOscillator()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(o.freq, t0)
  if (o.bendRatio !== undefined && o.bendRatio !== 1) {
    osc.frequency.exponentialRampToValueAtTime(o.freq * o.bendRatio, t0 + (o.bendTime ?? o.decay))
  }
  const g = ctx.createGain()
  const atk = o.attack ?? 0.0015
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(o.amp, t0 + atk)
  g.gain.exponentialRampToValueAtTime(Math.max(o.amp * 1e-3, 1e-6), t0 + o.decay)
  g.gain.setValueAtTime(0, t0 + o.decay)
  osc.connect(g).connect(dest)
  osc.start(t0)
  osc.stop(t0 + o.decay + 0.02)
  sink.srcs.push(osc)
}

/**
 * Pink noise à la Paul Kellet: three parallel one-pole lowpasses (IIRFilter
 * feedback [1, -p]) stacked over one looping white-noise source, plus a
 * direct tap. Slope is -3 dB/oct down to ~10 Hz — reads as distant surf once
 * lowpassed. Output normalized to roughly ±1.
 */
export function pinkNoise(ctx: BaseAudioContext): { out: GainNode; start: (t: number) => void } {
  const src = ctx.createBufferSource()
  src.buffer = whiteNoiseBuffer(ctx)
  src.loop = true
  const out = ctx.createGain()
  out.gain.value = 0.12 // Kellet sum peaks near ±6
  const stages: Array<[pole: number, gain: number]> = [
    [0.99765, 0.099046],
    [0.963, 0.2965164],
    [0.57, 1.0526913],
  ]
  for (const [p, g] of stages) {
    const f = ctx.createIIRFilter([g], [1, -p])
    src.connect(f).connect(out)
  }
  const direct = ctx.createGain()
  direct.gain.value = 0.1848
  src.connect(direct).connect(out)
  return { out, start: (t: number) => src.start(t, Math.random() * (NOISE_SECONDS - 0.5)) }
}
