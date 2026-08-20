import type { SoundMaterial } from '../config/tiers'
import { buildMasterChain, buildSurfBed } from './engine'
import { coerceMaterial, F_REF, isSoundMaterial, scheduleImpact } from './impacts'
import { scheduleMerge } from './merge'

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

/** post-master-chain peaks of the three level anchors + their ratios */
export interface LevelReport {
  impactChainPeak: number
  mergeChainPeak: number
  surfChainPeak: number
  mergeVsImpactDb: number
  surfVsImpactDb: number
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
  const x = buf.getChannelData(0)
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
  const binDur = binLen / buf.sampleRate
  const durationToMinus40dB = first < 0 ? 0 : (last - first + 1) * binDur

  const spectrumFreqs = new Array<number>(SPEC_BINS)
  const spectrum = new Array<number>(SPEC_BINS)
  const ratio = SPEC_F_HI / SPEC_F_LO
  let linSum = 0
  let linWeighted = 0
  for (let k = 0; k < SPEC_BINS; k++) {
    const f = SPEC_F_LO * Math.pow(ratio, k / (SPEC_BINS - 1))
    spectrumFreqs[k] = round(f, 1)
    const mag = goertzelMag(x, buf.sampleRate, f)
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
      const db = (a: number, b: number): number => round(20 * Math.log10(a / Math.max(b, 1e-9)), 1)
      return {
        impactChainPeak: impact.peak,
        mergeChainPeak: merge.peak,
        surfChainPeak: surf.peak,
        mergeVsImpactDb: db(merge.peak, impact.peak),
        surfVsImpactDb: db(surf.peak, impact.peak),
      }
    },
  }
}

installAudioHarness()
