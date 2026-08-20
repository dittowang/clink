import * as THREE from 'three'

/**
 * Offscreen-canvas texture factory + label painting helpers. EVERY texture in
 * the game comes through here (zero asset files). Color maps are sRGB;
 * roughness/normal/height data stays linear (srgb: false).
 */
export interface CanvasTextureOpts {
  /** color map → true (default). data maps (roughness/normal) → false. */
  srgb?: boolean
  /** sets RepeatWrapping + repeat */
  repeat?: readonly [number, number]
  /** default 4 — plenty for label text at game distance */
  anisotropy?: number
}

export function makeCanvasTexture(
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  opts: CanvasTextureOpts = {}
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  paint(ctx, w, h)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = (opts.srgb ?? true) ? THREE.SRGBColorSpace : THREE.NoColorSpace
  if (opts.repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(opts.repeat[0], opts.repeat[1])
  }
  tex.anisotropy = opts.anisotropy ?? 4
  tex.needsUpdate = true
  return tex
}

/** the system font stack — labels are decorative, natives fonts are fine */
export const SYSTEM_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

export interface Band {
  /** normalized vertical range, 0 = canvas top, 1 = bottom */
  y0: number
  y1: number
  color: string
}

/** Horizontal color bands — the primary read of every label (≥ 1/4 height). */
export function paintBands(ctx: CanvasRenderingContext2D, w: number, h: number, bands: readonly Band[]): void {
  for (const b of bands) {
    ctx.fillStyle = b.color
    ctx.fillRect(0, b.y0 * h, w, (b.y1 - b.y0) * h)
  }
}

/** Vertical linear gradient across the full canvas. stops: [offset, color]. */
export function paintGradient(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  stops: ReadonlyArray<readonly [number, string]>
): void {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  for (const [o, c] of stops) g.addColorStop(o, c)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

export interface RoundelOpts {
  fill: string
  ring?: string
  /** ring width as a fraction of r (default 0.14) */
  ringWidth?: number
  /** optional inner dot color */
  inner?: string
}

/** Circle badge with a ring — the classic label centrepiece. */
export function paintRoundel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  opts: RoundelOpts
): void {
  ctx.save()
  ctx.fillStyle = opts.fill
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  if (opts.ring) {
    const lw = (opts.ringWidth ?? 0.14) * r
    ctx.strokeStyle = opts.ring
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.arc(x, y, r - lw * 0.9, 0, Math.PI * 2)
    ctx.stroke()
  }
  if (opts.inner) {
    ctx.fillStyle = opts.inner
    ctx.beginPath()
    ctx.arc(x, y, r * 0.45, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** Simple star motif (default 5 points). */
export function paintStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rOuter: number,
  color: string,
  points = 5,
  innerRatio = 0.45
): void {
  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rOuter * innerRatio
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2
    const px = x + Math.cos(a) * r
    const py = y + Math.sin(a) * r
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** Sine-wave stripe across the canvas at height y (px). */
export function paintWave(
  ctx: CanvasRenderingContext2D,
  w: number,
  y: number,
  amplitude: number,
  wavelength: number,
  color: string,
  lineWidth: number
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  // start at a crest-neutral phase so horizontal tiling stays seamless when
  // wavelength divides w
  for (let x = -lineWidth; x <= w + lineWidth; x += 2) {
    const yy = y + Math.sin((x / wavelength) * Math.PI * 2) * amplitude
    if (x <= -lineWidth) ctx.moveTo(x, yy)
    else ctx.lineTo(x, yy)
  }
  ctx.stroke()
  ctx.restore()
}

export interface TextOpts {
  color?: string
  /** css font-weight (default 700) */
  weight?: number
  align?: CanvasTextAlign
}

/** Decorative label text in the system stack. Unreadable at game distance is fine. */
export function paintText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  sizePx: number,
  opts: TextOpts = {}
): void {
  ctx.save()
  ctx.fillStyle = opts.color ?? '#ffffff'
  ctx.font = `${opts.weight ?? 700} ${sizePx}px ${SYSTEM_FONT}`
  ctx.textAlign = opts.align ?? 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
  ctx.restore()
}
