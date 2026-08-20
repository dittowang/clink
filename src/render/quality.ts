import type * as THREE from 'three'
import { isHarness, registerPerf, type PerfApi } from '../harness/api'

/**
 * Quality tiers (docs/PERF.md). Picked once at boot from the GL renderer
 * string, overridable with ?quality=low|mid|high. Harness captures default
 * to HIGH so SwiftShader stills stay pixel-comparable with the pre-perf
 * pipeline (SwiftShader measures LOOK, never fps); the string heuristic
 * would otherwise classify it as software → low.
 *
 * The runtime corrective for a wrong boot guess is dynamic resolution
 * (dynres.ts), which walks the render scale 0.7–1.0× inside the tier.
 */
export type QualityTier = 'low' | 'mid' | 'high'

export interface QualitySettings {
  tier: QualityTier
  /** devicePixelRatio cap */
  dprCap: number
  /** internal render scale under the dpr cap (low tier renders at 0.8×) */
  baseRenderScale: number
  gtao: boolean
  transmissionResolutionScale: number
  shadowMapSize: number
  /** bloom chain runs at half the composer resolution */
  bloomHalfRes: boolean
}

const SETTINGS: Record<QualityTier, QualitySettings> = {
  high: {
    tier: 'high',
    dprCap: 2,
    baseRenderScale: 1,
    gtao: true,
    transmissionResolutionScale: 0.6,
    shadowMapSize: 2048,
    bloomHalfRes: false,
  },
  mid: {
    tier: 'mid',
    dprCap: 1.5,
    baseRenderScale: 1,
    gtao: false,
    transmissionResolutionScale: 0.5,
    shadowMapSize: 1024,
    bloomHalfRes: false,
  },
  low: {
    tier: 'low',
    dprCap: 1.25,
    baseRenderScale: 0.8,
    gtao: false,
    transmissionResolutionScale: 0.5,
    shadowMapSize: 1024,
    bloomHalfRes: true,
  },
}

/**
 * WEBGL_debug_renderer_info heuristics. Order matters: software rasterizers
 * first (they match nothing else), then mobile GPUs, then integrated Intel,
 * then the discrete/Apple family; unknown strings land on mid.
 */
export function classifyRendererString(s: string): QualityTier {
  const r = s.toLowerCase()
  if (/swiftshader|llvmpipe|softpipe|software rasterizer|microsoft basic render/.test(r)) return 'low'
  if (/mali|adreno|powervr|videocore|vivante|xclipse|immortalis/.test(r)) return 'low'
  if (/intel/.test(r)) return 'mid' // (U)HD / Iris integrated
  if (/\bapple\b|nvidia|geforce|\brtx\b|\bgtx\b|quadro|radeon|\bamd\b/.test(r)) return 'high'
  return 'mid'
}

function glRendererString(renderer: THREE.WebGLRenderer): string {
  try {
    const gl = renderer.getContext()
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const raw = ext
      ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER)
    return String(raw ?? '')
  } catch {
    return ''
  }
}

let current: QualitySettings | null = null
/** dynamic-resolution scale inside the tier, 0.7–1.0 (dynres.ts writes it) */
let renderScale = 1
/** true while __perf.measure() runs — dynres must not react to probe frames */
let measuring = false

/** detect + apply the tier: dpr cap × render scale, transmission resolution */
export function initQuality(renderer: THREE.WebGLRenderer): QualitySettings {
  const params = new URLSearchParams(window.location.search)
  const override = params.get('quality')
  let tier: QualityTier
  if (override === 'low' || override === 'mid' || override === 'high') {
    tier = override
  } else if (isHarness()) {
    tier = 'high'
  } else {
    tier = classifyRendererString(glRendererString(renderer))
  }
  current = SETTINGS[tier]
  renderScale = 1
  renderer.setPixelRatio(basePixelRatio())
  renderer.transmissionResolutionScale = current.transmissionResolutionScale
  return current
}

/** the active tier settings (high until initQuality has run) */
export function getQuality(): QualitySettings {
  return current ?? SETTINGS.high
}

/** device pixel ratio after the tier cap and the tier's internal scale */
export function basePixelRatio(): number {
  const q = getQuality()
  return Math.min(window.devicePixelRatio || 1, q.dprCap) * q.baseRenderScale
}

export function getRenderScale(): number {
  return renderScale
}

export function setRenderScale(s: number): void {
  renderScale = s
}

export function isMeasuring(): boolean {
  return measuring
}

/**
 * window.__perf — scriptable perf probes (docs/PERF.md methodology):
 * measure() renders N frames forced-sync via readPixels and averages wall
 * time; info() snapshots tier/dpr/scale and renderer.info counters for the
 * LAST rendered frame; templates() reports the static-merge mesh diet.
 */
export function installPerf(
  renderer: THREE.WebGLRenderer,
  renderFrame: () => void,
  templates: () => unknown
): void {
  const gl = renderer.getContext()
  const px = new Uint8Array(4)
  const sync = (): void => {
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
  }
  const api: PerfApi = {
    tier: getQuality().tier,
    measure(frames = 30) {
      measuring = true
      try {
        for (let i = 0; i < 3; i++) {
          renderFrame()
          sync()
        }
        const t0 = performance.now()
        for (let i = 0; i < frames; i++) {
          renderFrame()
          sync()
        }
        const ms = (performance.now() - t0) / frames
        return { frames, msPerFrame: Math.round(ms * 100) / 100 }
      } finally {
        measuring = false
      }
    },
    info() {
      // renderer.info auto-resets on every internal renderer.render() call
      // (composer passes, shadow map, transmission pass) — render ONE frame
      // with autoReset off so calls/triangles are true per-frame totals
      measuring = true
      renderer.info.autoReset = false
      renderer.info.reset()
      try {
        renderFrame()
      } finally {
        renderer.info.autoReset = true
        measuring = false
      }
      return {
        tier: getQuality().tier,
        dpr: renderer.getPixelRatio(),
        renderScale: getRenderScale(),
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
      }
    },
    templates,
  }
  registerPerf(api)
}
