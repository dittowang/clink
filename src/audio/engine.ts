import { buildAmbience, type AmbienceHandle } from './ambience'
import type { EventBus } from '../core/events'
import { clamp01, panForX } from './dsp'
import { playImpact, type ScheduledVoice } from './impacts'
import {
  playFoul,
  playGameOver,
  playLevelComplete,
  playMerge,
  playOrderUp,
  playOrderTick,
  playSandThud,
  playSpawnThud,
} from './merge'
import { SlideVoice } from './slide'

/** the surf bed lives with the other ambience layers now; kept exported for offline.ts */
export { buildSurfBed } from './ambience'

/**
 * The AudioEngine singleton. The AudioContext is created lazily on the first
 * user gesture (resumeOnGesture) because autoplay policy blocks it earlier.
 * Master chain: voiceBus -> DynamicsCompressor (limiter-ish) -> master gain
 * -> destination. Impacts run through a 6-voice stolen pool; merge/UI
 * one-shots and the surf bed feed the same compressor so nothing can clip.
 */

export interface MasterChain {
  input: GainNode
  compressor: DynamicsCompressorNode
  master: GainNode
}

/**
 * Post-limiter trim. Chrome's DynamicsCompressor applies automatic makeup
 * gain, so the trim is calibrated against the offline renderPileup probe
 * (6 max-force voices) until peak < 1.0.
 */
export const MASTER_TRIM = 0.8

/** Shared with offline.ts so the harness renders through the same chain. */
export function buildMasterChain(ctx: BaseAudioContext): MasterChain {
  const input = ctx.createGain()
  const compressor = ctx.createDynamicsCompressor()
  compressor.threshold.value = -6
  compressor.knee.value = 4
  compressor.ratio.value = 12
  compressor.attack.value = 0.002
  compressor.release.value = 0.15
  const master = ctx.createGain()
  master.gain.value = MASTER_TRIM
  input.connect(compressor).connect(master).connect(ctx.destination)
  return { input, compressor, master }
}

const MAX_VOICES = 6
const STEAL_FADE_S = 0.005

interface Voice {
  gain: GainNode
  srcs: AudioScheduledSourceNode[]
  started: number
  ends: number
}

export interface VoiceHandle {
  ctx: BaseAudioContext
  out: GainNode
  now: number
  register(v: ScheduledVoice): void
}

/**
 * Ambience look-ahead: discrete events (waves, clinks, gull calls, music
 * notes) are scheduled this far ahead from a timer. Background tabs throttle
 * timers to ≥ 1 s (minutes after long hides) — the lookahead covers the
 * former, and scheduleUntil's `from` drops the backlog after the latter.
 */
const AMBIENCE_LOOKAHEAD_S = 12
const AMBIENCE_TICK_MS = 1500

export interface EngineStatus {
  contextState: AudioContextState | 'none'
  currentTime: number
  sampleRate: number
  muted: boolean
  ambienceLevel: number
  /** orders: bar busyness 0..1 driving the murmur/clink layer gains */
  barBusy: number
  ambience: {
    running: boolean
    scheduledUntil: number
    /** RMS of the ambience bus over the last analyser frame (live meter) */
    rms: number
  }
}

class AudioEngine {
  private ctx: AudioContext | null = null
  private chain: MasterChain | null = null
  private voices: Voice[] = []
  private slide: SlideVoice | null = null
  private muted = false
  private ambience: AmbienceHandle | null = null
  private ambienceTimer: ReturnType<typeof setInterval> | null = null
  private ambienceMeter: AnalyserNode | null = null
  private ambienceScheduledUntil = 0
  private ambienceLevel = 1
  private barBusy = 0

  /** the live context, or null before the first user gesture */
  get context(): AudioContext | null {
    return this.ctx
  }

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === 'running'
  }

  /** Create + resume the context. Call from inside a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      let ctx: AudioContext
      try {
        ctx = new AudioContext({ latencyHint: 'interactive' })
      } catch {
        return // no WebAudio (ancient browser / headless quirk): stay silent
      }
      this.ctx = ctx
      this.chain = buildMasterChain(ctx)
      this.applyMute()
      this.startAmbience()
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  /** null while the context can't play — callers simply skip scheduling */
  playbackHandle(): { ctx: BaseAudioContext; fx: AudioNode; now: number } | null {
    if (!this.ctx || !this.chain || this.ctx.state !== 'running') return null
    return { ctx: this.ctx, fx: this.chain.input, now: this.ctx.currentTime }
  }

  /**
   * Impact voice pool: max 6 concurrent; stealing kills the OLDEST playing
   * voice with a 5 ms fade so a can shower never turns to mud or clipping.
   * `pan` (-1..1) places the voice in the stereo field — the caller derives
   * it from the impact point's table x via panForX.
   */
  allocImpactVoice(pan = 0): VoiceHandle | null {
    if (!this.ctx || !this.chain || this.ctx.state !== 'running') return null
    const ctx = this.ctx
    const now = ctx.currentTime
    if (this.voices.length > 0) {
      this.voices = this.voices.filter((v) => v.ends > now)
    }
    if (this.voices.length >= MAX_VOICES) {
      const oldest = this.voices.shift()!
      // voice gain carries no automation (envelopes live inside the recipe),
      // so a bare setTargetAtTime from 1 is click-free
      oldest.gain.gain.setTargetAtTime(0, now, STEAL_FADE_S / 3)
      for (const s of oldest.srcs) {
        try {
          s.stop(now + STEAL_FADE_S * 2)
        } catch {
          /* already stopped */
        }
      }
    }
    const gain = ctx.createGain()
    const panner = ctx.createStereoPanner()
    panner.pan.value = pan
    gain.connect(panner).connect(this.chain.input)
    const voice: Voice = { gain, srcs: [], started: now, ends: now + 0.3 }
    this.voices.push(voice)
    return {
      ctx,
      out: gain,
      now,
      register: (sv) => {
        voice.srcs = sv.srcs
        voice.ends = now + Math.max(0.05, sv.duration + 0.06)
      },
    }
  }

  /** mute state is applied here; persisting it is the caller's job */
  setMuted(muted: boolean): void {
    this.muted = muted
    this.applyMute()
  }

  get isMuted(): boolean {
    return this.muted
  }

  private applyMute(): void {
    if (!this.ctx || !this.chain) return
    this.chain.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_TRIM, this.ctx.currentTime, 0.02)
  }

  /** hot path (120 Hz sliding events): no allocations, throttled writes.
   *  x = sliding-centroid table x, mapped to pan inside the voice. */
  updateSlide(speed: number, x: number): void {
    if (!this.ctx || !this.chain || this.ctx.state !== 'running') return
    if (!this.slide) this.slide = new SlideVoice(this.ctx, this.chain.input)
    this.slide.update(speed, panForX(x), this.ctx.currentTime)
  }

  /**
   * Ambience (surf bed + waves + beach bar) starts with the context and runs
   * for its life; the timer keeps discrete events scheduled ahead.
   */
  private startAmbience(): void {
    const ctx = this.ctx!
    const at = ctx.currentTime + 0.05
    const amb = buildAmbience(ctx, this.chain!.input, at)
    amb.level.gain.value = this.ambienceLevel
    amb.setBusy(this.barBusy, ctx.currentTime)
    this.ambience = amb
    // meter tap for the harness smoke test (proves the bus carries signal live)
    const meter = ctx.createAnalyser()
    meter.fftSize = 1024
    const sink = ctx.createGain()
    sink.gain.value = 0
    amb.level.connect(meter).connect(sink).connect(ctx.destination)
    this.ambienceMeter = meter
    const tick = (): void => {
      if (!this.ctx || !this.ambience) return
      const now = this.ctx.currentTime
      this.ambienceScheduledUntil = now + AMBIENCE_LOOKAHEAD_S
      this.ambience.scheduleUntil(this.ambienceScheduledUntil, now)
    }
    tick()
    this.ambienceTimer = setInterval(tick, AMBIENCE_TICK_MS)
  }

  /** 0..1 ambience level (default 1); persisting it is the caller's job */
  setAmbienceLevel(level: number): void {
    this.ambienceLevel = clamp01(level)
    if (this.ctx && this.ambience) {
      this.ambience.level.gain.setTargetAtTime(this.ambienceLevel, this.ctx.currentTime, 0.05)
    }
  }

  get ambienceLevelValue(): number {
    return this.ambienceLevel
  }

  /** orders: 0..1 bar busyness → murmur + clink layers 1× → ~1.8× */
  setBarBusy(busy: number): void {
    this.barBusy = clamp01(busy)
    if (this.ctx && this.ambience) this.ambience.setBusy(this.barBusy, this.ctx.currentTime)
  }

  get barBusyValue(): number {
    return this.barBusy
  }

  /** harness probe: context + ambience state, plus a live RMS of the ambience bus */
  status(): EngineStatus {
    let rms = 0
    if (this.ambienceMeter) {
      const buf = new Float32Array(this.ambienceMeter.fftSize)
      this.ambienceMeter.getFloatTimeDomainData(buf)
      let s = 0
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
      rms = Math.sqrt(s / buf.length)
    }
    return {
      contextState: this.ctx ? this.ctx.state : 'none',
      currentTime: this.ctx ? this.ctx.currentTime : 0,
      sampleRate: this.ctx ? this.ctx.sampleRate : 0,
      muted: this.muted,
      ambienceLevel: this.ambienceLevel,
      barBusy: this.barBusy,
      ambience: {
        running: this.ambience !== null && this.ambienceTimer !== null,
        scheduledUntil: this.ambienceScheduledUntil,
        rms,
      },
    }
  }

  /** stop the ambience and close the context; the next unlock() starts fresh */
  dispose(): void {
    if (this.ambienceTimer !== null) clearInterval(this.ambienceTimer)
    this.ambienceTimer = null
    this.ambience?.stop()
    this.ambience = null
    this.ambienceMeter = null
    this.ambienceScheduledUntil = 0
    this.voices = []
    this.slide = null
    const ctx = this.ctx
    this.ctx = null
    this.chain = null
    if (ctx) void ctx.close().catch(() => undefined)
  }
}

export const audio = new AudioEngine()

/**
 * Wire the engine's unlock to the first pointerdown on `el` (and keep
 * listening so a suspended context resumes after tab switches).
 * Returns an unsubscribe.
 */
export function resumeOnGesture(el: EventTarget = window): () => void {
  const onDown = (): void => audio.unlock()
  el.addEventListener('pointerdown', onDown, { passive: true })
  return () => el.removeEventListener('pointerdown', onDown)
}

/**
 * One-line integration: subscribe every audio reaction to the game bus.
 * Render/audio only LISTEN — nothing here writes back into physics.
 */
export function subscribe(bus: EventBus): () => void {
  const offs = [
    bus.on('impact', (e) => playImpact(e.matA, e.matB, e.force, e.point.x)),
    bus.on('sliding', (e) => audio.updateSlide(e.speed, e.x)),
    bus.on('mergeDone', (e) => playMerge(e.tier, e.chain, e.centroid.x)),
    bus.on('spawnDrop', () => playSpawnThud()),
    bus.on('sandThud', () => playSandThud()),
    bus.on('foul', () => playFoul()),
    bus.on('levelComplete', () => playLevelComplete()),
    bus.on('gameOver', () => playGameOver()),
    bus.on('orderServed', (e) => playOrderUp(e.tip)),
    bus.on('orderTick', (e) => playOrderTick(e.left)),
    bus.on('muteChange', (e) => audio.setMuted(e.muted)),
  ]
  return () => {
    for (const off of offs) off()
  }
}
