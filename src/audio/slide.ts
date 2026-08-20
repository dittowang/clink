import { whiteNoiseBuffer } from './dsp'

/**
 * The slide voice: one looping bandpassed-noise source whose gain and cutoff
 * follow the bus `sliding` event (aggregate speed of awake drinks). Runs for
 * the life of the context at gain 0 when idle — starting/stopping sources at
 * 120 Hz would be far more expensive than one silent voice.
 *
 * The `sliding` event fires every fixed step (120 Hz); automation writes are
 * throttled so the AudioParam timeline isn't flooded. Smoothing ~80 ms.
 */
const SMOOTH_S = 0.08
const MIN_SPEED = 0.05 // m/s — silent below this (brief)
/**
 * Steady mid-band noise passes the master chain ~unity while impact
 * transients get crushed ~12 dB (see impacts.VOICE_PEAK note), so the cap is
 * small: ~-13 dB under a full-slam's post-chain peak (~0.2).
 */
const MAX_GAIN = 0.045
const GAIN_PER_MPS = 0.12 // reaches the cap at ~0.4 m/s aggregate slide
const CUTOFF_LO = 500
const CUTOFF_HI = 1800

export class SlideVoice {
  private readonly gain: GainNode
  private readonly filter: BiquadFilterNode
  private readonly panner: StereoPannerNode
  private lastWrite = -1
  private lastTarget = 0
  private idleWritten = false

  constructor(ctx: BaseAudioContext, dest: AudioNode) {
    const src = ctx.createBufferSource()
    src.buffer = whiteNoiseBuffer(ctx)
    src.loop = true
    this.filter = ctx.createBiquadFilter()
    this.filter.type = 'bandpass'
    this.filter.frequency.value = CUTOFF_LO
    this.filter.Q.value = 0.8
    this.gain = ctx.createGain()
    this.gain.gain.value = 0
    this.panner = ctx.createStereoPanner()
    src.connect(this.filter).connect(this.gain).connect(this.panner).connect(dest)
    src.start()
  }

  /** speed-weighted loudness + brightness, panned toward the sliding
   *  centroid; no allocations (hot path) */
  update(speed: number, pan: number, now: number): void {
    const s = Math.max(0, speed - MIN_SPEED)
    const target = Math.min(MAX_GAIN, s * GAIN_PER_MPS)
    const idle = target < 1e-4 && this.lastTarget < 1e-4
    if (idle && this.idleWritten) return
    if (!idle && now - this.lastWrite < 0.03) return
    this.idleWritten = idle
    this.lastWrite = now
    this.lastTarget = target
    const cutoff = Math.min(CUTOFF_HI, CUTOFF_LO + speed * 1400)
    this.gain.gain.setTargetAtTime(target, now, SMOOTH_S)
    this.filter.frequency.setTargetAtTime(cutoff, now, SMOOTH_S)
    // same ~80 ms smoothing: the loop glides across the field with the pile
    this.panner.pan.setTargetAtTime(pan, now, SMOOTH_S)
  }
}
