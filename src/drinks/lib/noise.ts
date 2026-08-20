/**
 * Seeded, TILING value noise + fBm painted to a canvas, and a height→normal
 * converter. Generic surface breakup for coconut husk, rinds, brushed metal
 * streaks — anything that must not look CG-clean. Deterministic per seed so
 * drink looks never depend on load order.
 */

/** integer lattice hash → [0,1), stable across runs */
function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + (seed | 0) * 2246822519) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

/** one octave of tiling value noise; u,v in [0,1), cells per axis */
function valueNoise(u: number, v: number, cellsX: number, cellsY: number, seed: number): number {
  const x = u * cellsX
  const y = v * cellsY
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = smooth(x - ix)
  const fy = smooth(y - iy)
  const x0 = ((ix % cellsX) + cellsX) % cellsX
  const x1 = (x0 + 1) % cellsX
  const y0 = ((iy % cellsY) + cellsY) % cellsY
  const y1 = (y0 + 1) % cellsY
  const a = hash2(x0, y0, seed)
  const b = hash2(x1, y0, seed)
  const c = hash2(x0, y1, seed)
  const d = hash2(x1, y1, seed)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

export interface NoiseOpts {
  /** base lattice cells across x (default 8). Streaks: few cells one axis, many the other. */
  cellsX?: number
  /** base lattice cells across y (default 8) */
  cellsY?: number
  /** octave gain (default 0.5) */
  persistence?: number
  /** remap output range [lo, hi] → [0,255] after normalization (contrast) */
  range?: readonly [number, number]
}

/**
 * fBm value noise → grayscale canvas, seamlessly tiling on both axes.
 * Returns the canvas; wrap in makeCanvasTexture(..., { srgb:false }) or feed
 * to normalMapFromHeight.
 */
export function noiseCanvas(
  w: number,
  h: number,
  octaves: number,
  seed: number,
  opts: NoiseOpts = {}
): HTMLCanvasElement {
  const cellsX = opts.cellsX ?? 8
  const cellsY = opts.cellsY ?? 8
  const persistence = opts.persistence ?? 0.5
  const [lo, hi] = opts.range ?? [0, 1]
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(w, h)
  const data = img.data
  // total amplitude for normalization
  let ampSum = 0
  for (let o = 0, a = 1; o < octaves; o++, a *= persistence) ampSum += a
  for (let y = 0; y < h; y++) {
    const v = y / h
    for (let x = 0; x < w; x++) {
      const u = x / w
      let sum = 0
      let amp = 1
      let fx = cellsX
      let fy = cellsY
      for (let o = 0; o < octaves; o++) {
        sum += valueNoise(u, v, fx, fy, seed + o * 101) * amp
        amp *= persistence
        fx *= 2
        fy *= 2
      }
      let n = sum / ampSum // [0,1]
      n = (n - lo) / (hi - lo)
      const g = Math.max(0, Math.min(255, Math.round(n * 255)))
      const i = (y * w + x) * 4
      data[i] = g
      data[i + 1] = g
      data[i + 2] = g
      data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

/**
 * Convert a grayscale height canvas to a tangent-space normal map canvas
 * (OpenGL convention, +Z out). Sampling wraps, so tiling height maps give
 * tiling normal maps. `strength` ~1–4: how many pixels of slope one full
 * black→white step represents.
 */
export function normalMapFromHeight(height: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const w = height.width
  const h = height.height
  const srcCtx = height.getContext('2d')!
  const src = srcCtx.getImageData(0, 0, w, h).data
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const dstCtx = out.getContext('2d')!
  const img = dstCtx.createImageData(w, h)
  const dst = img.data
  const at = (x: number, y: number): number => {
    const xx = ((x % w) + w) % w
    const yy = ((y % h) + h) % h
    return src[(yy * w + xx) * 4] / 255
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel gradients with wrap
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1)
      const l = at(x - 1, y), r = at(x + 1, y)
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1)
      const gx = (tr + 2 * r + br - tl - 2 * l - bl) / 4
      const gy = (bl + 2 * b + br - tl - 2 * t - tr) / 4
      // canvas y grows downward but CanvasTexture flipY=true flips the image,
      // so +gy here lands as +v in texture space → keep OpenGL green as-is.
      let nx = -gx * strength
      let ny = gy * strength
      let nz = 1
      const inv = 1 / Math.hypot(nx, ny, nz)
      nx *= inv
      ny *= inv
      nz *= inv
      const i = (y * w + x) * 4
      dst[i] = Math.round((nx * 0.5 + 0.5) * 255)
      dst[i + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      dst[i + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      dst[i + 3] = 255
    }
  }
  dstCtx.putImageData(img, 0, 0)
  return out
}
