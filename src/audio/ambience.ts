import { noiseBurst, partial, pinkNoise, whiteNoiseBuffer, type SourceSink } from './dsp'
import { F_REF, scheduleImpact } from './impacts'

/**
 * Beach ambience — every layer synthesized, written against BaseAudioContext
 * so the live engine and the OfflineAudioContext probe (offline.ts
 * renderAmbience) run the exact same code.
 *
 * Layers (each behind its own trim, all summed on one bus):
 *   bed     the original pink-noise surf bed (two slow LFO swells)
 *   waves   discrete wave cycles every 6–11 s: swell → break → hissing retreat
 *   murmur  5 bandpassed-noise "voices" with syllabic gating, 15 m away
 *   clinks  distant glass clinks / ice rattles (the glass impact recipe, -24 dB)
 *   gulls   sparse FM gull calls, high-passed, very low
 *   music   a 76 BPM pentatonic mallet loop through a short feedback delay,
 *           lowpassed like a bar speaker far away, + off-beat shaker
 *
 * bus → gentle lowpass → level (setAmbienceLevel) → master chain input.
 *
 * Time is handled by a look-ahead scheduler: `scheduleUntil(until, from)`
 * emits every discrete event with an onset before `until`; the live engine
 * calls it from a timer, the offline probe calls it once for the whole
 * render. Randomness comes from a seeded PRNG so a probe render is
 * reproducible; the live engine seeds from Math.random.
 */

export type AmbienceLayer = 'bed' | 'waves' | 'murmur' | 'clinks' | 'gulls' | 'music'
export const AMBIENCE_LAYERS: readonly AmbienceLayer[] = ['bed', 'waves', 'murmur', 'clinks', 'gulls', 'music']

export interface AmbienceOptions {
  seed?: number
  /** subset of layers to build (default: all) — the offline probe solos layers */
  layers?: readonly AmbienceLayer[]
}

export interface AmbienceHandle {
  /** bus input (post layer trims, pre lowpass) */
  input: GainNode
  /** the 0..1 user level (engine.setAmbienceLevel) */
  level: GainNode
  layerGains: Record<AmbienceLayer, GainNode>
  /** schedule every discrete event with onset in [cursor, until); `from` is
   *  "now" — cursors that fell behind it (tab was hidden) jump forward so a
   *  backlog never fires as one burst */
  scheduleUntil(until: number, from: number): void
  /** silence + release every continuous source; scheduled one-shots end on their own */
  stop(): void
}

/** the ambience bus's lowpass: takes the edge off, keeps wave hiss present */
const BUS_LOWPASS_HZ = 6000

/* ---------------------------------------------------------------- levels
 * Every constant below is a PRE-chain gain. The master chain crushes a
 * full-force impact transient ~12.7 dB (0.82 → 0.19) but passes this
 * low-level ambience ~unity, so every dB claim is MEASURED POST-chain by the
 * offline probe (renderAmbience / renderLevels) against the post-chain peak
 * of a full-force glass impact (0.19). Measured over seeds 1/2/3/7/11 at
 * 20–30 s (layer peak vs that impact): waves -17..-19, music -20..-22,
 * clinks -23..-28, bed -22..-25, murmur -26..-28, gulls -29..-32; the whole
 * mix peaks 15–18.5 dB under it (brief: ≥ 14) and > 22 dB below the
 * compressor threshold, so the ambience alone never engages the limiter.
 */
const SURF_LEVEL = 0.0112 // unchanged: bed peak measured -23..-26 dB (LFO phase)
const WAVE_SWELL = 0.025
const WAVE_BREAK = 0.025
const WAVE_RETREAT = 0.018 // the retreat's 4 kHz lowpass passes most of the noise power
const WAVE_FIZZ = 0.005
const MURMUR_LEVEL = 0.04
const CLINK_LEVEL = 0.015 // -24 dB POST-chain vs the crushed full-force impact
const GULL_LEVEL = 0.005
const MUSIC_LEVEL = 0.011
const SHAKER_LEVEL = 0.5 // relative to a music note (sits under the 2.4 kHz speaker lowpass)

/** deterministic 32-bit PRNG (mulberry32) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rng = () => number
const range = (rng: Rng, lo: number, hi: number): number => lo + rng() * (hi - lo)
const clampPan = (p: number): number => (p < -0.75 ? -0.75 : p > 0.75 ? 0.75 : p)

/** looping white-noise source at a random offset (decorrelates layers) */
function noiseSource(ctx: BaseAudioContext, rng: Rng, sink?: SourceSink): { src: AudioBufferSourceNode; offset: number } {
  const src = ctx.createBufferSource()
  src.buffer = whiteNoiseBuffer(ctx)
  src.loop = true
  sink?.srcs.push(src)
  return { src, offset: rng() * 1.5 }
}

/**
 * Surf bed: two pink-noise sources through a ~600 Hz lowpass, each swelling
 * on its own slow LFO (0.08 / 0.13 Hz) so the beach breathes instead of
 * hissing. Shared with offline.ts so the level claim is verifiable.
 * Returns a stop() for the continuous sources.
 */
export function buildSurfBed(ctx: BaseAudioContext, dest: AudioNode, startAt: number): () => void {
  // Calibrated against the offline renderLevels probe: post-chain surf peak
  // sits ~-26 dB under the post-chain peak of a full-force glass impact.
  // (Not derived from VOICE_PEAK: the chain crushes impact transients ~12 dB
  // but passes the slow low surf almost untouched.)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 600
  lp.Q.value = 0.5
  lp.connect(dest)
  const beds: Array<{ lfoHz: number; base: number }> = [
    { lfoHz: 0.08, base: SURF_LEVEL },
    { lfoHz: 0.13, base: SURF_LEVEL * 0.75 },
  ]
  const stops: Array<() => void> = []
  for (const bed of beds) {
    const pink = pinkNoise(ctx)
    const g = ctx.createGain()
    g.gain.value = bed.base
    const lfo = ctx.createOscillator()
    lfo.frequency.value = bed.lfoHz
    const depth = ctx.createGain()
    depth.gain.value = bed.base * 0.55 // swell between ~0.45x and ~1.55x
    lfo.connect(depth).connect(g.gain)
    pink.out.connect(g).connect(lp)
    pink.start(startAt)
    lfo.start(startAt + Math.random() * 4) // offset the two swells
    stops.push(() => {
      pink.stop()
      lfo.stop()
    })
  }
  return () => {
    for (const s of stops) s()
    lp.disconnect()
  }
}

/* ---------------------------------------------------------------- waves */

/**
 * One wave cycle: swell (bandpass centre 300→1500 Hz, gain rising over
 * 1.5–2.5 s) → break (short 2.2 kHz burst) → retreat (lowpass 4 k→500 Hz,
 * gain decaying 3–5 s) + sand fizz (>4.5 kHz, decaying 2–3.5 s). The whole
 * cycle pans across a random arc. Returns the cycle's duration.
 */
function scheduleWave(ctx: BaseAudioContext, dest: AudioNode, t0: number, rng: Rng): number {
  const swellDur = range(rng, 1.5, 2.5)
  const retreatDur = range(rng, 3, 5)
  const fizzDur = range(rng, 2, 3.5)
  const tBreak = t0 + swellDur
  const end = tBreak + retreatDur
  const sink: SourceSink = { srcs: [] }

  const pan = ctx.createStereoPanner()
  const p0 = range(rng, -0.6, 0.6)
  const arc = (rng() < 0.5 ? -1 : 1) * range(rng, 0.3, 0.7)
  pan.pan.setValueAtTime(p0, t0)
  pan.pan.linearRampToValueAtTime(clampPan(p0 + arc), end)
  pan.connect(dest)

  // swell: rising centre + rising gain, handed over to the retreat at the break
  {
    const { src, offset } = noiseSource(ctx, rng, sink)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 0.8
    bp.frequency.setValueAtTime(300, t0)
    bp.frequency.exponentialRampToValueAtTime(1500, tBreak)
    const g = ctx.createGain()
    g.gain.setValueAtTime(WAVE_SWELL * 0.02, t0)
    g.gain.exponentialRampToValueAtTime(WAVE_SWELL, tBreak)
    g.gain.exponentialRampToValueAtTime(WAVE_SWELL * 0.01, tBreak + 0.7)
    g.gain.setValueAtTime(0, tBreak + 0.7)
    src.connect(bp).connect(g).connect(pan)
    src.start(t0, offset)
    src.stop(tBreak + 0.75)
  }
  // break: brighter, short, soft-edged
  noiseBurst(ctx, pan, sink, tBreak - 0.06, {
    dur: range(rng, 0.6, 0.9),
    amp: WAVE_BREAK,
    type: 'bandpass',
    freq: range(rng, 1900, 2600),
    q: 0.7,
    attack: 0.06,
  })
  // retreat: the hiss darkens as it drains back
  {
    const { src, offset } = noiseSource(ctx, rng, sink)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.Q.value = 0.6
    lp.frequency.setValueAtTime(4000, tBreak)
    lp.frequency.exponentialRampToValueAtTime(500, end)
    const g = ctx.createGain()
    g.gain.setValueAtTime(WAVE_RETREAT * 0.01, tBreak)
    g.gain.exponentialRampToValueAtTime(WAVE_RETREAT, tBreak + 0.15)
    g.gain.exponentialRampToValueAtTime(WAVE_RETREAT * 1e-3, end)
    g.gain.setValueAtTime(0, end)
    src.connect(lp).connect(g).connect(pan)
    src.start(tBreak, offset)
    src.stop(end + 0.02)
  }
  // sand fizz: fine high hiss riding the first seconds of the retreat
  {
    const { src, offset } = noiseSource(ctx, rng, sink)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 4500
    hp.Q.value = 0.7
    const shelf = ctx.createBiquadFilter()
    shelf.type = 'highshelf'
    shelf.frequency.value = 7000
    shelf.gain.value = 4
    const g = ctx.createGain()
    g.gain.setValueAtTime(WAVE_FIZZ * 0.01, tBreak)
    g.gain.exponentialRampToValueAtTime(WAVE_FIZZ, tBreak + 0.25)
    g.gain.exponentialRampToValueAtTime(WAVE_FIZZ * 1e-3, tBreak + fizzDur)
    g.gain.setValueAtTime(0, tBreak + fizzDur)
    src.connect(hp).connect(shelf).connect(g).connect(pan)
    src.start(tBreak, offset)
    src.stop(tBreak + fizzDur + 0.02)
  }
  return end - t0
}

/* --------------------------------------------------------------- murmur */

/**
 * One crowd voice: white noise through a narrow bandpass (a single formant
 * in 250–900 Hz) whose gain is gated syllabically (3–6 Hz) inside 1–3 s
 * phrases separated by pauses; the formant drifts per syllable so the
 * gating reads as speech-like rather than a tremolo.
 */
class MurmurVoice {
  private readonly src: AudioBufferSourceNode
  private readonly bp: BiquadFilterNode
  private readonly gate: GainNode
  private next: number

  constructor(ctx: BaseAudioContext, dest: AudioNode, startAt: number, private readonly rng: Rng) {
    const { src, offset } = noiseSource(ctx, rng)
    this.src = src
    this.bp = ctx.createBiquadFilter()
    this.bp.type = 'bandpass'
    this.bp.frequency.value = range(rng, 250, 900)
    this.bp.Q.value = range(rng, 4, 8)
    this.gate = ctx.createGain()
    this.gate.gain.value = 0
    const pan = ctx.createStereoPanner()
    pan.pan.value = range(rng, -0.4, 0.4)
    src.connect(this.bp).connect(this.gate).connect(pan).connect(dest)
    src.start(startAt, offset)
    this.next = startAt + range(rng, 0, 2)
  }

  scheduleUntil(until: number, from: number): void {
    const rng = this.rng
    if (this.next < from) this.next = from + range(rng, 0, 1.5)
    while (this.next < until) {
      const centre = range(rng, 250, 900)
      const phraseDur = range(rng, 1, 3)
      const sylRate = range(rng, 3, 6)
      const loud = range(rng, 0.5, 1)
      let t = this.next
      while (t < this.next + phraseDur) {
        const sylDur = 1 / sylRate
        const on = sylDur * range(rng, 0.45, 0.8)
        this.gate.gain.setTargetAtTime(loud * range(rng, 0.35, 1), t, 0.02)
        this.gate.gain.setTargetAtTime(0, t + on, 0.03)
        this.bp.frequency.setTargetAtTime(centre * range(rng, 0.8, 1.25), t, 0.04)
        t += sylDur
      }
      this.next = t + range(rng, 0.4, 3)
    }
  }

  stop(): void {
    this.src.stop()
  }
}

/* --------------------------------------------------------------- clinks */

/** a distant single clink (60 %) or an ice-in-glass rattle of 4–7 ticks */
function scheduleClink(ctx: BaseAudioContext, dest: AudioNode, t0: number, rng: Rng): void {
  const pan = ctx.createStereoPanner()
  pan.pan.value = range(rng, -0.6, 0.6)
  pan.connect(dest)
  if (rng() < 0.6) {
    scheduleImpact(ctx, pan, t0, 'glass', 'glass', F_REF * range(rng, 0.75, 1))
    return
  }
  const n = 4 + Math.floor(rng() * 4)
  let t = t0
  for (let i = 0; i < n; i++) {
    const fade = 1 - (i / n) * 0.5
    scheduleImpact(ctx, pan, t, 'glass', 'glass', F_REF * range(rng, 0.45, 0.7) * fade)
    t += range(rng, 0.03, 0.08)
  }
}

/* ---------------------------------------------------------------- gulls */

/**
 * One gull call: 2–3 FM notes (carrier + 1:1 modulator, index ~1.5 → harmonic
 * rasp, 25 Hz flutter), pitch rising then falling per note, later notes
 * lower. Kept low and >800 Hz — a hint on the wind, not a cartoon.
 */
function scheduleGull(ctx: BaseAudioContext, dest: AudioNode, t0: number, rng: Rng): void {
  const pan = ctx.createStereoPanner()
  pan.pan.value = range(rng, -0.5, 0.5)
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 800
  hp.Q.value = 0.7
  hp.connect(pan).connect(dest)
  const notes = 2 + (rng() < 0.4 ? 1 : 0)
  const base = range(rng, 1000, 1500)
  let at = t0
  for (let i = 0; i < notes; i++) {
    const dur = range(rng, 0.22, 0.4)
    const f = base * (1 - i * range(rng, 0.05, 0.1))
    const car = ctx.createOscillator()
    const mod = ctx.createOscillator()
    const flutter = ctx.createOscillator()
    car.type = 'sine'
    mod.type = 'sine'
    flutter.type = 'sine'
    flutter.frequency.value = range(rng, 22, 30)
    for (const o of [car, mod]) {
      o.frequency.setValueAtTime(f * 0.85, at)
      o.frequency.exponentialRampToValueAtTime(f * 1.08, at + dur * 0.3)
      o.frequency.exponentialRampToValueAtTime(f * 0.78, at + dur)
    }
    const index = ctx.createGain()
    index.gain.value = f * 1.5
    mod.connect(index).connect(car.frequency)
    const flDepth = ctx.createGain()
    flDepth.gain.value = f * 0.03
    flutter.connect(flDepth).connect(car.frequency)
    const g = ctx.createGain()
    const amp = GULL_LEVEL * range(rng, 0.7, 1) * (i === 0 ? 1 : 0.8)
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(amp, at + 0.03)
    g.gain.setValueAtTime(amp, at + dur * 0.45)
    g.gain.exponentialRampToValueAtTime(amp * 1e-3, at + dur)
    g.gain.setValueAtTime(0, at + dur)
    car.connect(g).connect(hp)
    for (const o of [car, mod, flutter]) {
      o.start(at)
      o.stop(at + dur + 0.02)
    }
    at += dur + range(rng, 0.08, 0.2)
  }
}

/* ---------------------------------------------------------------- music */

const BPM = 76
const BEAT_S = 60 / BPM
const STEP_S = BEAT_S / 2 // eighth-note grid
const STEPS = 32 // 4 bars of 4/4
/** the pattern is fixed by this seed; humanization draws from the live rng */
const MUSIC_SEED = 37 // C4 C4 | E4 G4 E4 D4 | G4 E4 E4 | G4 C5 A4 C5
const PENTA_C4 = [261.63, 293.66, 329.63, 392.0, 440.0] // C D E G A
const BASS_ROOTS = [130.81, 110.0, 98.0, 130.81] // C3 A2 G2 C3 per bar

interface MusicNote {
  step: number
  hz: number
  vel: number
  bass: boolean
}

/** 4-bar pentatonic pattern: a bass root per bar + a random-walk melody */
function generatePattern(): MusicNote[] {
  const rng = mulberry32(MUSIC_SEED)
  const scale: number[] = []
  for (let oct = 0; oct < 2; oct++) for (const f of PENTA_C4) scale.push(f * Math.pow(2, oct))
  const notes: MusicNote[] = []
  let degree = 2
  for (let step = 0; step < STEPS; step++) {
    if (step % 8 === 0) notes.push({ step, hz: BASS_ROOTS[step / 8], vel: 0.6, bass: true })
    const onBeat = step % 2 === 0
    if (rng() >= (onBeat ? 0.55 : 0.28)) continue
    const move = rng() < 0.15 ? Math.round(range(rng, -4, 4)) : Math.round(range(rng, -2, 2))
    degree = Math.max(0, Math.min(scale.length - 1, degree + move))
    notes.push({ step, hz: scale[degree], vel: range(rng, 0.55, 1), bass: false })
  }
  return notes
}

/** mallet/steel-pan hybrid: 4 inharmonic sines (1 : 2.01 : 3.93 : 6.3) + tick */
function pluck(ctx: BaseAudioContext, dest: AudioNode, t: number, hz: number, vel: number, bass: boolean): void {
  const sink: SourceSink = { srcs: [] }
  const ratios = [1, 2.01, 3.93, 6.3]
  const amps = bass ? [1, 0.25, 0.08, 0] : [1, 0.32, 0.2, 0.07]
  const decays = bass ? [1.7, 0.7, 0.3, 0.1] : [1.1, 0.55, 0.28, 0.14]
  const amp = MUSIC_LEVEL * vel
  for (let i = 0; i < ratios.length; i++) {
    if (amps[i] === 0) continue
    partial(ctx, dest, sink, t, { freq: hz * ratios[i], amp: amp * amps[i], decay: decays[i], attack: 0.003 })
  }
  noiseBurst(ctx, dest, sink, t, { dur: 0.012, amp: amp * 0.2, type: 'bandpass', freq: 3000, q: 1.5 })
}

class MusicLoop {
  private readonly pattern = generatePattern()
  private readonly dry: GainNode
  private readonly delay: DelayNode
  private readonly fb: GainNode
  private step = 0

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    private readonly startAt: number,
    private readonly rng: Rng
  ) {
    // bar speaker far away: everything → lowpass → slight fixed pan
    const speaker = ctx.createBiquadFilter()
    speaker.type = 'lowpass'
    speaker.frequency.value = 2400
    speaker.Q.value = 0.5
    const pan = ctx.createStereoPanner()
    pan.pan.value = (rng() < 0.5 ? -1 : 1) * 0.25
    speaker.connect(pan).connect(dest)
    this.dry = ctx.createGain()
    this.dry.connect(speaker)
    // short feedback delay for space (3/16 note, darkened in the loop)
    this.delay = ctx.createDelay(1)
    this.delay.delayTime.value = BEAT_S * 0.375
    const loopLp = ctx.createBiquadFilter()
    loopLp.type = 'lowpass'
    loopLp.frequency.value = 2200
    this.fb = ctx.createGain()
    this.fb.gain.value = 0.36
    const wet = ctx.createGain()
    wet.gain.value = 0.4
    this.dry.connect(this.delay).connect(loopLp).connect(this.fb).connect(this.delay)
    this.delay.connect(wet).connect(speaker)
  }

  scheduleUntil(until: number, from: number): void {
    const behind = Math.ceil((from - this.startAt) / STEP_S)
    if (this.step < behind) this.step = behind
    while (this.startAt + this.step * STEP_S < until) {
      const s = this.step % STEPS
      const t = this.startAt + this.step * STEP_S
      for (const n of this.pattern) {
        if (n.step !== s) continue
        pluck(this.ctx, this.dry, t + range(this.rng, -0.012, 0.012), n.hz, n.vel * range(this.rng, 0.9, 1.05), n.bass)
      }
      if (s % 2 === 1) {
        // shaker on the off-beats
        noiseBurst(this.ctx, this.dry, { srcs: [] }, t + range(this.rng, -0.008, 0.008), {
          dur: 0.06,
          amp: MUSIC_LEVEL * SHAKER_LEVEL * range(this.rng, 0.7, 1),
          type: 'bandpass',
          freq: 3500,
          q: 1,
          attack: 0.006,
        })
      }
      this.step++
    }
  }

  stop(): void {
    this.fb.gain.value = 0
    this.dry.disconnect()
  }
}

/* ------------------------------------------------------------------ bus */

/** recurring one-shot layer: `next` onset cursor + a random interval */
class Recurring {
  private next: number
  constructor(
    first: number,
    private readonly interval: [number, number],
    private readonly rng: Rng,
    private readonly fire: (t: number) => void
  ) {
    this.next = first
  }
  scheduleUntil(until: number, from: number): void {
    if (this.next < from) this.next = from + range(this.rng, 0.5, this.interval[0] * 0.5)
    while (this.next < until) {
      this.fire(this.next)
      this.next += range(this.rng, this.interval[0], this.interval[1])
    }
  }
}

export function buildAmbience(
  ctx: BaseAudioContext,
  dest: AudioNode,
  startAt: number,
  opts: AmbienceOptions = {}
): AmbienceHandle {
  const rng = mulberry32(opts.seed ?? Math.floor(Math.random() * 0x7fffffff))
  const want = new Set<AmbienceLayer>(opts.layers ?? AMBIENCE_LAYERS)

  const input = ctx.createGain()
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = BUS_LOWPASS_HZ
  lp.Q.value = 0.5
  const level = ctx.createGain()
  level.gain.value = 1
  input.connect(lp).connect(level).connect(dest)

  const layerGains = {} as Record<AmbienceLayer, GainNode>
  for (const name of AMBIENCE_LAYERS) {
    const g = ctx.createGain()
    g.gain.value = want.has(name) ? 1 : 0
    g.connect(input)
    layerGains[name] = g
  }

  const schedulers: Array<{ scheduleUntil(until: number, from: number): void }> = []
  const stops: Array<() => void> = []
  let stopped = false

  if (want.has('bed')) stops.push(buildSurfBed(ctx, layerGains.bed, startAt))

  if (want.has('waves')) {
    schedulers.push(
      new Recurring(startAt + range(rng, 0.5, 2), [6, 11], rng, (t) => scheduleWave(ctx, layerGains.waves, t, rng))
    )
  }

  if (want.has('murmur')) {
    // 15 m away: the sum loses everything above ~1.3 kHz
    const far = ctx.createBiquadFilter()
    far.type = 'lowpass'
    far.frequency.value = 1300
    far.Q.value = 0.6
    const g = ctx.createGain()
    g.gain.value = MURMUR_LEVEL
    far.connect(g).connect(layerGains.murmur)
    for (let i = 0; i < 5; i++) {
      const v = new MurmurVoice(ctx, far, startAt, rng)
      schedulers.push(v)
      stops.push(() => v.stop())
    }
  }

  if (want.has('clinks')) {
    // across the bar: the recipe at -24 dB, softened by a 3.5 kHz lowpass
    const far = ctx.createBiquadFilter()
    far.type = 'lowpass'
    far.frequency.value = 3500
    far.Q.value = 0.6
    const g = ctx.createGain()
    g.gain.value = CLINK_LEVEL
    far.connect(g).connect(layerGains.clinks)
    schedulers.push(new Recurring(startAt + range(rng, 3, 8), [4, 12], rng, (t) => scheduleClink(ctx, far, t, rng)))
  }

  if (want.has('gulls')) {
    schedulers.push(
      new Recurring(startAt + range(rng, 8, 25), [20, 45], rng, (t) => scheduleGull(ctx, layerGains.gulls, t, rng))
    )
  }

  if (want.has('music')) {
    const loop = new MusicLoop(ctx, layerGains.music, startAt + 0.2, rng)
    schedulers.push(loop)
    stops.push(() => loop.stop())
  }

  return {
    input,
    level,
    layerGains,
    scheduleUntil(until, from) {
      if (stopped) return
      for (const s of schedulers) s.scheduleUntil(until, from)
    },
    stop() {
      if (stopped) return
      stopped = true
      level.disconnect()
      for (const s of stops) {
        try {
          s()
        } catch {
          /* already stopped */
        }
      }
    },
  }
}
