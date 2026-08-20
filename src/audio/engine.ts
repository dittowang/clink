import type { EventBus } from '../core/events'
import { panForX, pinkNoise } from './dsp'
import { playImpact, type ScheduledVoice } from './impacts'
import {
  playFoul,
  playGameOver,
  playLevelComplete,
  playMerge,
  playSandThud,
  playSpawnThud,
} from './merge'
import { SlideVoice } from './slide'

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
 * Surf bed: two pink-noise sources through a ~600 Hz lowpass, each swelling
 * on its own slow LFO (0.08 / 0.13 Hz) so the beach breathes instead of
 * hissing. Shared with offline.ts so the level claim is verifiable.
 */
export function buildSurfBed(ctx: BaseAudioContext, dest: AudioNode, startAt: number): void {
  // Calibrated against the offline renderLevels probe: post-chain surf peak
  // sits ~-26 dB under the post-chain peak of a full-force glass impact.
  // (Not derived from VOICE_PEAK: the chain crushes impact transients ~12 dB
  // but passes the slow low surf almost untouched.)
  const SURF_LEVEL = 0.0112
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 600
  lp.Q.value = 0.5
  lp.connect(dest)
  const beds: Array<{ lfoHz: number; base: number }> = [
    { lfoHz: 0.08, base: SURF_LEVEL },
    { lfoHz: 0.13, base: SURF_LEVEL * 0.75 },
  ]
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
  }
}

class AudioEngine {
  private ctx: AudioContext | null = null
  private chain: MasterChain | null = null
  private voices: Voice[] = []
  private slide: SlideVoice | null = null
  private muted = false

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
      this.startSurf()
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

  private startSurf(): void {
    const ctx = this.ctx!
    buildSurfBed(ctx, this.chain!.input, ctx.currentTime + 0.05)
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
    bus.on('muteChange', (e) => audio.setMuted(e.muted)),
  ]
  return () => {
    for (const off of offs) off()
  }
}
