import * as THREE from 'three'

/**
 * Every texture in the stage is painted here on offscreen canvases at load.
 * Deterministic (seeded RNG) so captures are stable frame-to-frame and
 * run-to-run.
 */

/** mulberry32 — tiny deterministic PRNG for texture painting */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  return [c, ctx]
}

function toTexture(c: HTMLCanvasElement, aniso: number, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.anisotropy = aniso
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

export interface SurfaceMaps {
  map: THREE.CanvasTexture
  /** grayscale grain reused as bumpMap + roughnessMap */
  gray: THREE.CanvasTexture
}

/**
 * Weathered plank tabletop. Canvas u = table X (across), v = table Z (along)
 * so planks and grain both run along the table's long axis. 5 planks with
 * per-plank tone jitter, wavy grain streaks, knots, seam lines.
 */
export function makeWoodMaps(aniso: number): SurfaceMaps {
  const S = 1024
  const [c, ctx] = makeCanvas(S)
  const r = rng(20260820)
  const PLANKS = 5
  const pw = S / PLANKS

  for (let p = 0; p < PLANKS; p++) {
    const x0 = p * pw
    // per-plank tone: sun-bleached warm timber with slight variation
    const hue = 27 + r() * 9
    const sat = 30 + r() * 12
    const lit = 52 + r() * 11
    ctx.fillStyle = `hsl(${hue},${sat}%,${lit}%)`
    ctx.fillRect(x0, 0, pw, S)

    // long grain streaks: wavy vertical strokes
    const streaks = 60
    for (let k = 0; k < streaks; k++) {
      const gx = x0 + 4 + r() * (pw - 8)
      const dark = r() < 0.82
      const a = 0.03 + r() * (dark ? 0.1 : 0.06)
      ctx.strokeStyle = dark
        ? `rgba(62,40,20,${a.toFixed(3)})`
        : `rgba(255,238,206,${a.toFixed(3)})`
      ctx.lineWidth = 0.8 + r() * 2.4
      ctx.beginPath()
      ctx.moveTo(gx + (r() - 0.5) * 6, -16)
      const seg = 5
      for (let sgi = 1; sgi <= seg; sgi++) {
        const y = (S + 32) * (sgi / seg) - 16
        ctx.quadraticCurveTo(
          gx + (r() - 0.5) * 14, y - S / seg / 2,
          gx + (r() - 0.5) * 8, y
        )
      }
      ctx.stroke()
    }

    // occasional knot: dark ellipse + growth rings
    if (r() < 0.55) {
      const kx = x0 + pw * (0.25 + r() * 0.5)
      const ky = S * r()
      const kr = 7 + r() * 12
      const g = ctx.createRadialGradient(kx, ky, 1, kx, ky, kr * 2.4)
      g.addColorStop(0, 'rgba(46,28,14,0.75)')
      g.addColorStop(0.35, 'rgba(78,50,26,0.35)')
      g.addColorStop(1, 'rgba(78,50,26,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.ellipse(kx, ky, kr * 2.4, kr * 3.4, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(60,38,20,0.25)'
      ctx.lineWidth = 1.2
      for (let ring = 1; ring <= 3; ring++) {
        ctx.beginPath()
        ctx.ellipse(kx, ky, kr * (0.8 + ring * 0.55), kr * (1.2 + ring * 0.8), 0, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // seam between planks: shadow line + catch-light
    if (p > 0) {
      ctx.fillStyle = 'rgba(38,24,12,0.6)'
      ctx.fillRect(x0 - 1.5, 0, 3, S)
      ctx.fillStyle = 'rgba(255,236,200,0.16)'
      ctx.fillRect(x0 + 1.5, 0, 1.5, S)
    }
  }

  // fine speckle so flat areas never read as vinyl
  const img = ctx.getImageData(0, 0, S, S)
  const d = img.data
  const nr = rng(77)
  for (let i = 0; i < d.length; i += 4) {
    const n = (nr() - 0.5) * 18
    d[i] += n; d[i + 1] += n; d[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)

  // grayscale grain: darker color = deeper/rougher (bump + roughness share it)
  const [gc, gctx] = makeCanvas(S)
  gctx.drawImage(c, 0, 0)
  const gimg = gctx.getImageData(0, 0, S, S)
  const gd = gimg.data
  for (let i = 0; i < gd.length; i += 4) {
    const lum = (gd[i] * 0.3 + gd[i + 1] * 0.59 + gd[i + 2] * 0.11) / 255
    // roughness 0.5 (pale, worn-smooth) .. 0.85 (dark grain valleys)
    const v = Math.round((0.85 - lum * 0.35) * 255)
    gd[i] = gd[i + 1] = gd[i + 2] = v
  }
  gctx.putImageData(gimg, 0, 0)

  return { map: toTexture(c, aniso, true), gray: toTexture(gc, aniso, false) }
}

/**
 * Tiling beach sand: per-pixel grain noise + low-frequency wind ripples.
 * Ripples use integer wave numbers over the canvas so the tile is seamless.
 */
export function makeSandMaps(aniso: number): SurfaceMaps {
  const S = 512
  const [c, ctx] = makeCanvas(S)
  const [gc, gctx] = makeCanvas(S)
  const img = ctx.createImageData(S, S)
  const gimg = gctx.createImageData(S, S)
  const d = img.data
  const gd = gimg.data
  const r = rng(4242)
  const TAU = Math.PI * 2
  // base sand: warm pale gold
  const br = 216, bg = 196, bb = 156
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4
      // seamless ripple field (integer cycles across the tile) — kept faint;
      // strong regular ripples moiré into corduroy at distance
      const rip =
        0.022 * Math.sin((TAU * (2 * x + 9 * y)) / S) +
        0.014 * Math.sin((TAU * (7 * x - 3 * y)) / S + 1.7) +
        0.01 * Math.sin((TAU * (13 * x + 21 * y)) / S + 0.6)
      const grain = (r() - 0.5) * 0.16
      let f = 1 + rip + grain
      // sparse darker flecks (shell bits, damp grains)
      if (r() < 0.004) f *= 0.72
      if (r() < 0.003) f *= 1.22
      d[i] = Math.min(255, br * f)
      d[i + 1] = Math.min(255, bg * f)
      d[i + 2] = Math.min(255, bb * f * (0.98 + grain))
      d[i + 3] = 255
      const g = Math.max(0, Math.min(255, 128 + (rip * 1.2 + grain) * 300))
      gd[i] = gd[i + 1] = gd[i + 2] = g
      gd[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  gctx.putImageData(gimg, 0, 0)
  return { map: toTexture(c, aniso, true), gray: toTexture(gc, aniso, false) }
}

/** Soft radial sun glow with a hot core — the daytime key billboard. */
export function makeSunSprite(): THREE.CanvasTexture {
  const S = 256
  const [c, ctx] = makeCanvas(S)
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.18, 'rgba(255,252,240,1)')
  g.addColorStop(0.3, 'rgba(255,240,205,0.85)')
  g.addColorStop(0.55, 'rgba(255,220,160,0.28)')
  g.addColorStop(1, 'rgba(255,210,150,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Crisp moon disc: pale face, a few soft maria, terminator shading. */
export function makeMoonSprite(): THREE.CanvasTexture {
  const S = 256
  const [c, ctx] = makeCanvas(S)
  const r = rng(9)
  const cx = S / 2, cy = S / 2, R = S * 0.34
  // outer haze
  const halo = ctx.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 1.7)
  halo.addColorStop(0, 'rgba(210,225,255,0.35)')
  halo.addColorStop(1, 'rgba(210,225,255,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, S, S)
  // face
  const face = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R)
  face.addColorStop(0, 'rgba(235,242,255,1)')
  face.addColorStop(0.85, 'rgba(205,218,242,1)')
  face.addColorStop(1, 'rgba(178,195,226,1)')
  ctx.fillStyle = face
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.fill()
  // maria
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.clip()
  for (let i = 0; i < 7; i++) {
    const mx = cx + (r() - 0.5) * R * 1.5
    const my = cy + (r() - 0.5) * R * 1.5
    const mr = R * (0.1 + r() * 0.22)
    ctx.fillStyle = `rgba(150,168,205,${0.12 + r() * 0.14})`
    ctx.beginPath()
    ctx.ellipse(mx, my, mr, mr * (0.7 + r() * 0.5), r() * 3, 0, Math.PI * 2)
    ctx.fill()
  }
  // terminator: subtle shadow on one limb
  const term = ctx.createRadialGradient(cx + R * 0.55, cy + R * 0.2, R * 0.2, cx + R * 0.55, cy + R * 0.2, R * 1.4)
  term.addColorStop(0, 'rgba(30,45,80,0.28)')
  term.addColorStop(0.6, 'rgba(30,45,80,0)')
  ctx.fillStyle = term
  ctx.fillRect(0, 0, S, S)
  ctx.restore()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
