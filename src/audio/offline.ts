import type { SoundMaterial } from '../config/tiers'
import { AMBIENCE_LAYERS, buildAmbience, type AmbienceLayer } from './ambience'
import { panForX } from './dsp'
import { audio, buildMasterChain, buildSurfBed, type EngineStatus } from './engine'
import { coerceMaterial, F_REF, isSoundMaterial, scheduleImpact } from './impacts'
import { scheduleMerge, scheduleOrderUp } from './merge'

/**
 * window.__audio — the headless verification harness. Renders the SAME
 * recipe + master-chain code the live engine plays into an
 * OfflineAudioContext and returns machine-checkable numbers, so envelopes,
 * spectra, durations, and clipping are verified from capture.mjs without a
 * speaker or a user gesture.
 */

const SAMPLE_RATE = 48000
const ENV_BINS = 64
const SPEC_BINS = 64
const SPEC_F_LO = 80
const SPEC_F_HI = 12800

export interface AudioProbe {
  peak: number
  rms: number
  /** 64 downsampled max-|x| points across the render */
  envelope: number[]
  /** alias of `envelope` for older consumers of the harness contract */
  env: number[]
  /** 64 log-magnitude (dB) Goertzel bins at log-spaced frequencies */
  spectrum: number[]
  /** the bin centre frequencies for `spectrum` (Hz) */
  spectrumFreqs: number[]
  /** amplitude-weighted mean frequency (Hz) — the "where does it live" number */
  centroidHz: number
  /** seconds from onset until the envelope stays 40 dB under its peak */
  durationToMinus40dB: number
}

/** stereo-pan verification: a glass impact rendered through the live pan law */
export interface PanProbe {
  /** table x fed in (m) */
  x: number
  /** panForX(x) — the pan value the live voice would be given */
  pan: number
  leftRms: number
  rightRms: number
  /** pan recovered from the rendered L/R power split (equal-power law) */
  measuredPan: number
}

/** post-master-chain peaks of the level anchors + their ratios */
export interface LevelReport {
  impactChainPeak: number
  mergeChainPeak: number
  surfChainPeak: number
  mergeVsImpactDb: number
  surfVsImpactDb: number
  /** whole ambience mix (all layers, 20 s, stereo: max over channels) */
  ambienceChainPeak: number
  ambienceChainRms: number
  /** MUST be ≤ -14 (brief: ambience ≥ 14 dB under a full-force impact) */
  ambienceVsImpactDb: number
}

/** power split of a render into the bands the ambience claims live in */
export interface BandReport {
  /** fraction of total power per band (sums to 1) */
  fraction: Record<string, number>
  /** the same in dB relative to the total */
  db: Record<string, number>
}

export interface LayerProbe extends AudioProbe {
  rmsDbfs: number
  /** layer peak vs the post-chain peak of a full-force glass impact */
  vsImpactPeakDb: number
  bands: BandReport
}

export interface AmbienceProbe extends AudioProbe {
  seconds: number
  seed: number
  /** pre-chain peak of the whole bus vs the compressor threshold (0.5) */
  busPeak: number
  limiterHeadroomDb: number
  /** vs the post-chain peak of a full-force glass impact (renderLevels anchor) */
  impactChainPeak: number
  vsImpactPeakDb: number
  /** 100 ms RMS frames of the whole mix (envelope at wave resolution) */
  rmsFrames: number[]
  /** onsets (s) of the wave swells picked from the waves layer's frames */
  waveSwellTimes: number[]
  /** Goertzel magnitude (dB) of the music layer at its pentatonic pitches vs
   *  the midpoints between them — energy must sit on the notes */
  musicTones: { noteHz: number[]; noteDb: number[]; betweenHz: number[]; betweenDb: number[]; noteMinusBetweenDb: number }
  layers: Record<AmbienceLayer, LayerProbe>
}

/**
 * renderImpact/renderMerge probe the RECIPE alone (straight to destination):
 * the quadratic gain law, band placement, and decay times are recipe
 * contracts, and Chrome's compressor smears fast transients ~-12 dB in a
 * level-independent way that would pollute exactly those measurements.
 * renderPileup/renderSurf/renderLevels run through the full master chain —
 * they verify the MIX: no clipping, and the briefed loudness relations.
 */
export interface AudioHarness {
  renderImpact(mat: string, force: number): Promise<AudioProbe>
  renderMerge(tier: number, chain?: number): Promise<AudioProbe>
  /** 6 simultaneous max-force voices through the master chain: peak MUST be < 1 */
  renderPileup(): Promise<AudioProbe>
  /** the surf bed alone through the chain (2 s) */
  renderSurf(): Promise<AudioProbe>
  /** post-chain peaks: full-force glass impact vs merge vs surf */
  renderLevels(): Promise<LevelReport>
  /** stereo render of a glass impact panned by table x via the live pan law */
  renderPan(x: number): Promise<PanProbe>
  /** the whole ambience (bed + waves + bar) through the chain, plus each layer
   *  solo; `seed` picks the stochastic layers' PRNG (default 7) so a sweep
   *  over seeds bounds the live engine's random cases */
  renderAmbience(seconds?: number, seed?: number): Promise<AmbienceProbe>
  /** the LIVE engine's state (context, ambience scheduler, bus meter) */
  liveStatus(): EngineStatus
  /** orders: the "order up" bell + tip tick at a given tip multiplier */
  renderOrderUp(tip?: number): Promise<AudioProbe>
}

declare global {
  interface Window {
    __audio?: AudioHarness
  }
}

/** Goertzel single-bin magnitude, normalized like a full-buffer DFT bin. */
function goertzelMag(x: Float32Array, sampleRate: number, freq: number): number {
  const w = (2 * Math.PI * freq) / sampleRate
  const c = 2 * Math.cos(w)
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < x.length; i++) {
    const s0 = x[i] + c * s1 - s2
    s2 = s1
    s1 = s0
  }
  const power = s1 * s1 + s2 * s2 - c * s1 * s2
  return (2 * Math.sqrt(Math.max(power, 0))) / x.length
}

const round = (v: number, digits: number): number => {
  const m = Math.pow(10, digits)
  return Math.round(v * m) / m
}

function analyze(buf: AudioBuffer): AudioProbe {
  return analyzeSamples(buf.getChannelData(0), buf.sampleRate)
}

/**
 * Stereo mix probe: peak/envelope are the max over both channels, spectrum
 * and centroid come from the (L+R)/2 downmix, rms is the power mean of both.
 */
function analyzeStereo(buf: AudioBuffer): AudioProbe {
  if (buf.numberOfChannels < 2) return analyze(buf)
  const l = buf.getChannelData(0)
  const r = buf.getChannelData(1)
  const n = l.length
  const mono = new Float32Array(n)
  const absMax = new Float32Array(n)
  let sumSq = 0
  for (let i = 0; i < n; i++) {
    mono[i] = 0.5 * (l[i] + r[i])
    const al = Math.abs(l[i])
    const ar = Math.abs(r[i])
    absMax[i] = al > ar ? al : ar
    sumSq += 0.5 * (l[i] * l[i] + r[i] * r[i])
  }
  const base = analyzeSamples(mono, buf.sampleRate)
  const peakProbe = analyzeSamples(absMax, buf.sampleRate)
  return {
    ...base,
    peak: peakProbe.peak,
    rms: round(Math.sqrt(sumSq / n), 6),
    envelope: peakProbe.envelope,
    env: peakProbe.envelope,
    durationToMinus40dB: peakProbe.durationToMinus40dB,
  }
}

function analyzeSamples(x: Float32Array, sampleRate: number): AudioProbe {
  const n = x.length

  let peak = 0
  let sumSq = 0
  for (let i = 0; i < n; i++) {
    const a = Math.abs(x[i])
    if (a > peak) peak = a
    sumSq += x[i] * x[i]
  }
  const rms = Math.sqrt(sumSq / n)

  const binLen = Math.ceil(n / ENV_BINS)
  const envelope = new Array<number>(ENV_BINS).fill(0)
  for (let b = 0; b < ENV_BINS; b++) {
    let m = 0
    const end = Math.min(n, (b + 1) * binLen)
    for (let i = b * binLen; i < end; i++) {
      const a = Math.abs(x[i])
      if (a > m) m = a
    }
    envelope[b] = m
  }

  // duration from onset to the last envelope bin above peak - 40 dB
  const thresh = peak * 0.01
  let first = -1
  let last = -1
  for (let b = 0; b < ENV_BINS; b++) {
    if (envelope[b] > thresh) {
      if (first < 0) first = b
      last = b
    }
  }
  const binDur = binLen / sampleRate
  const durationToMinus40dB = first < 0 ? 0 : (last - first + 1) * binDur

  const spectrumFreqs = new Array<number>(SPEC_BINS)
  const spectrum = new Array<number>(SPEC_BINS)
  const ratio = SPEC_F_HI / SPEC_F_LO
  let linSum = 0
  let linWeighted = 0
  for (let k = 0; k < SPEC_BINS; k++) {
    const f = SPEC_F_LO * Math.pow(ratio, k / (SPEC_BINS - 1))
    spectrumFreqs[k] = round(f, 1)
    const mag = goertzelMag(x, sampleRate, f)
    spectrum[k] = round(20 * Math.log10(mag + 1e-9), 2)
    linSum += mag
    linWeighted += mag * f
  }
  const centroidHz = linSum > 0 ? linWeighted / linSum : 0

  const rounded = envelope.map((v) => round(v, 5))
  return {
    peak: round(peak, 5),
    rms: round(rms, 6),
    envelope: rounded,
    env: rounded,
    spectrum,
    spectrumFreqs,
    centroidHz: round(centroidHz, 1),
    durationToMinus40dB: round(durationToMinus40dB, 4),
  }
}

/** recipe probe: straight into the destination, no master chain */
async function renderDirect(
  seconds: number,
  build: (ctx: OfflineAudioContext, input: AudioNode) => void
): Promise<AudioProbe> {
  const ctx = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * seconds), SAMPLE_RATE)
  build(ctx, ctx.destination)
  const buf = await ctx.startRendering()
  return analyze(buf)
}

/** mix probe: through the exact master chain the live engine builds */
async function renderMastered(
  seconds: number,
  build: (ctx: OfflineAudioContext, input: AudioNode) => void
): Promise<AudioProbe> {
  const ctx = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * seconds), SAMPLE_RATE)
  const chain = buildMasterChain(ctx)
  build(ctx, chain.input)
  const buf = await ctx.startRendering()
  return analyze(buf)
}

const T0 = 0.005

/**
 * Stereo probe: the exact scheduleImpact recipe through a StereoPanner set by
 * the live pan law. measuredPan inverts the equal-power law
 * (L = cos((p+1)π/4), R = sin((p+1)π/4)) from the channel RMS split, so the
 * JSON both states the pan the game would use AND proves the rendered energy
 * actually lands there.
 */
async function renderPanProbe(x: number): Promise<PanProbe> {
  const ctx = new OfflineAudioContext(2, Math.ceil(SAMPLE_RATE * 0.4), SAMPLE_RATE)
  const pan = panForX(x)
  const panner = ctx.createStereoPanner()
  panner.pan.value = pan
  panner.connect(ctx.destination)
  scheduleImpact(ctx, panner, T0, 'glass', 'glass', F_REF)
  const buf = await ctx.startRendering()
  const rms = (ch: number): number => {
    const d = buf.getChannelData(ch)
    let s = 0
    for (let i = 0; i < d.length; i++) s += d[i] * d[i]
    return Math.sqrt(s / d.length)
  }
  const l = rms(0)
  const r = rms(1)
  const measuredPan = Math.atan2(r, l) / (Math.PI / 4) - 1
  return {
    x,
    pan: round(pan, 4),
    leftRms: round(l, 6),
    rightRms: round(r, 6),
    measuredPan: round(measuredPan, 4),
  }
}

function requireMaterial(mat: string): SoundMaterial {
  if (!isSoundMaterial(mat)) {
    throw new Error(`unknown SoundMaterial "${mat}" (paper|aluminum|glass|husk|rind|steel)`)
  }
  return mat
}

/** worst-case pileup: 6 voices, saturated force, heavy-material mix */
const PILEUP_MATS: Array<[string, string]> = [
  ['steel', 'glass'],
  ['glass', 'glass'],
  ['glass', 'aluminum'],
  ['aluminum', 'aluminum'],
  ['rind', 'husk'],
  ['steel', 'steel'],
]

/** in-place iterative radix-2 FFT (re/im), n a power of two */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const xr = re[b] * cr - im[b] * ci
        const xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

const BAND_EDGES: Array<[string, number, number]> = [
  ['sub250', 0, 250],
  ['murmur250_900', 250, 900],
  ['mid900_2k', 900, 2000],
  ['hi2k_5k', 2000, 5000],
  ['air5k+', 5000, Infinity],
]

/** power split over BAND_EDGES from a 2^19-point FFT of the first ~10.9 s (Hann) */
function bandReport(buf: AudioBuffer): BandReport {
  const x = buf.getChannelData(0)
  const n = Math.min(1 << 19, 1 << Math.floor(Math.log2(x.length)))
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n))
  fft(re, im)
  const power = new Map<string, number>()
  let total = 0
  const hzPerBin = buf.sampleRate / n
  for (let k = 1; k < n / 2; k++) {
    const p = re[k] * re[k] + im[k] * im[k]
    const f = k * hzPerBin
    total += p
    for (const [name, lo, hi] of BAND_EDGES) {
      if (f >= lo && f < hi) {
        power.set(name, (power.get(name) ?? 0) + p)
        break
      }
    }
  }
  const fraction: Record<string, number> = {}
  const db: Record<string, number> = {}
  for (const [name] of BAND_EDGES) {
    const frac = total > 0 ? (power.get(name) ?? 0) / total : 0
    fraction[name] = round(frac, 4)
    db[name] = round(10 * Math.log10(frac + 1e-12), 1)
  }
  return { fraction, db }
}

/** 100 ms RMS frames, max over channels */
function rmsFrames(buf: AudioBuffer, frameS = 0.1): number[] {
  const len = Math.floor(buf.sampleRate * frameS)
  const frames = Math.floor(buf.length / len)
  const out = new Array<number>(frames).fill(0)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const x = buf.getChannelData(c)
    for (let f = 0; f < frames; f++) {
      let s = 0
      for (let i = f * len; i < (f + 1) * len; i++) s += x[i] * x[i]
      out[f] = Math.max(out[f], Math.sqrt(s / len))
    }
  }
  return out.map((v) => round(v, 5))
}

/** local maxima of a frame series ≥ minSepFrames apart and above thr·max */
function pickSwells(frames: number[], frameS: number, minSepS: number, thr: number): number[] {
  const max = Math.max(...frames)
  const sep = Math.round(minSepS / frameS)
  const out: number[] = []
  for (let i = 0; i < frames.length; i++) {
    if (frames[i] < thr * max) continue
    let isMax = true
    for (let j = Math.max(0, i - sep); j <= Math.min(frames.length - 1, i + sep); j++) {
      if (frames[j] > frames[i]) {
        isMax = false
        break
      }
    }
    // strict > above means a tied plateau yields every tied frame: keep the first
    if (isMax && (out.length === 0 || i * frameS - out[out.length - 1] >= minSepS)) out.push(round(i * frameS, 1))
  }
  return out
}

const AMBIENCE_SEED = 7
const PENTA_HZ = [130.81, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0]

function renderAmbienceBuffer(
  seconds: number,
  layers: readonly AmbienceLayer[],
  mastered: boolean,
  seed = AMBIENCE_SEED
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(SAMPLE_RATE * seconds), SAMPLE_RATE)
  const dest: AudioNode = mastered ? buildMasterChain(ctx).input : ctx.destination
  const amb = buildAmbience(ctx, dest, 0, { seed, layers })
  amb.scheduleUntil(seconds, 0)
  return ctx.startRendering()
}

async function renderAmbienceProbe(seconds: number, seed: number): Promise<AmbienceProbe> {
  const impact = await renderMastered(0.6, (ctx, input) => {
    scheduleImpact(ctx, input, T0, 'glass', 'glass', F_REF)
  })
  const db = (a: number, b: number): number => round(20 * Math.log10(Math.max(a, 1e-9) / Math.max(b, 1e-9)), 1)

  const mixBuf = await renderAmbienceBuffer(seconds, AMBIENCE_LAYERS, true, seed)
  const mix = analyzeStereo(mixBuf)
  const busBuf = await renderAmbienceBuffer(seconds, AMBIENCE_LAYERS, false, seed)
  const bus = analyzeStereo(busBuf)

  const layers = {} as Record<AmbienceLayer, LayerProbe>
  let wavesBuf: AudioBuffer | null = null
  let musicBuf: AudioBuffer | null = null
  for (const name of AMBIENCE_LAYERS) {
    const buf = await renderAmbienceBuffer(seconds, [name], true, seed)
    if (name === 'waves') wavesBuf = buf
    if (name === 'music') musicBuf = buf
    const probe = analyzeStereo(buf)
    layers[name] = {
      ...probe,
      rmsDbfs: round(20 * Math.log10(probe.rms + 1e-9), 1),
      vsImpactPeakDb: db(probe.peak, impact.peak),
      bands: bandReport(buf),
    }
  }

  const waveFrames = rmsFrames(wavesBuf!)
  const musicMono = musicBuf!.getChannelData(0)
  const toneDb = (hz: number): number => round(20 * Math.log10(goertzelMag(musicMono, SAMPLE_RATE, hz) + 1e-9), 1)
  const betweenHz = PENTA_HZ.slice(1).map((hz, i) => round(Math.sqrt(hz * PENTA_HZ[i]), 2))
  const noteDb = PENTA_HZ.map(toneDb)
  const betweenDb = betweenHz.map(toneDb)
  const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length

  return {
    ...mix,
    seconds,
    seed,
    busPeak: bus.peak,
    limiterHeadroomDb: db(0.5, bus.peak),
    impactChainPeak: impact.peak,
    vsImpactPeakDb: db(mix.peak, impact.peak),
    rmsFrames: rmsFrames(mixBuf),
    waveSwellTimes: pickSwells(waveFrames, 0.1, 4, 0.45),
    musicTones: {
      noteHz: PENTA_HZ,
      noteDb,
      betweenHz,
      betweenDb,
      noteMinusBetweenDb: round(mean(noteDb) - mean(betweenDb), 1),
    },
    layers,
  }
}

export function installAudioHarness(): void {
  if (typeof window === 'undefined') return
  window.__audio = {
    renderImpact: (mat, force) =>
      renderDirect(0.6, (ctx, input) => {
        const m = requireMaterial(mat)
        scheduleImpact(ctx, input, T0, m, m, force)
      }),
    renderMerge: (tier, chain = 1) =>
      renderDirect(0.9, (ctx, input) => {
        scheduleMerge(ctx, input, T0, tier, chain)
      }),
    renderPileup: () =>
      renderMastered(0.6, (ctx, input) => {
        for (const [a, b] of PILEUP_MATS) {
          scheduleImpact(ctx, input, T0, coerceMaterial(a), coerceMaterial(b), F_REF * 3)
        }
      }),
    renderSurf: () =>
      renderMastered(2, (ctx, input) => {
        buildSurfBed(ctx, input, 0)
      }),
    renderPan: (x) => renderPanProbe(x),
    renderAmbience: (seconds = 20, seed = AMBIENCE_SEED) => renderAmbienceProbe(seconds, seed),
    liveStatus: () => audio.status(),
    renderOrderUp: (tip = 1.5) =>
      renderDirect(0.8, (ctx, input) => {
        scheduleOrderUp(ctx, input, T0, tip)
      }),
    renderLevels: async () => {
      const impact = await renderMastered(0.6, (ctx, input) => {
        scheduleImpact(ctx, input, T0, 'glass', 'glass', F_REF)
      })
      const merge = await renderMastered(0.9, (ctx, input) => {
        scheduleMerge(ctx, input, T0, 5, 1)
      })
      const surf = await renderMastered(2, (ctx, input) => {
        buildSurfBed(ctx, input, 0)
      })
      const ambience = analyzeStereo(await renderAmbienceBuffer(20, AMBIENCE_LAYERS, true))
      const db = (a: number, b: number): number => round(20 * Math.log10(a / Math.max(b, 1e-9)), 1)
      return {
        impactChainPeak: impact.peak,
        mergeChainPeak: merge.peak,
        surfChainPeak: surf.peak,
        mergeVsImpactDb: db(merge.peak, impact.peak),
        surfVsImpactDb: db(surf.peak, impact.peak),
        ambienceChainPeak: ambience.peak,
        ambienceChainRms: ambience.rms,
        ambienceVsImpactDb: db(ambience.peak, impact.peak),
      }
    },
  }
}

installAudioHarness()
