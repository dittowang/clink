import * as THREE from 'three'
import { Rng } from '../../core/rng'
import { normalMapFromHeight } from './noise'

/**
 * Cold-drink condensation: hundreds of droplets (big sparse + small dense,
 * a few with run streaks) painted into a height canvas, converted into
 *  - roughnessMap: hazy matte base with SMOOTH (dark) droplet spots, so the
 *    fog blurs what's behind the glass while droplets stay glossy-clear
 *  - normalMap: droplet bumps that catch the key light
 * Layer both onto glass()/aluminum()/steel() via their map options.
 * Textures tile on both axes.
 */
export interface CondensationOpts {
  /** roughness of the fogged base film, default 0.12 — above ~0.2 the fog
   * eats the whole glass read; keep the glass clear and let droplets carry
   * the "cold" story */
  baseRoughness?: number
  /** roughness inside a droplet (clear glass), default 0.03 */
  dropletRoughness?: number
  /** droplet count multiplier, default 1 */
  density?: number
  /** normal strength, default 2.2 */
  normalStrength?: number
}

export interface CondensationMaps {
  roughnessMap: THREE.CanvasTexture
  normalMap: THREE.CanvasTexture
}

interface Drop {
  x: number
  y: number
  r: number
  /** run-streak length in px (0 = none) */
  run: number
}

export function makeCondensation(
  w: number,
  h: number,
  seed: number,
  opts: CondensationOpts = {}
): CondensationMaps {
  const rng = new Rng(seed)
  const density = opts.density ?? 1
  const baseR = opts.baseRoughness ?? 0.12
  const dropR = opts.dropletRoughness ?? 0.03

  // droplet radii scale with canvas size so the physical droplet size is
  // resolution-independent (reference: 1024 px tall canvas)
  const s = h / 1024
  const drops: Drop[] = []
  const bigCount = Math.round(((w * h) / (10000 * s * s)) * density)
  const smallCount = Math.round(((w * h) / (700 * s * s)) * density)
  const runCount = Math.max(3, Math.round(bigCount * 0.12))
  for (let i = 0; i < bigCount; i++) {
    drops.push({ x: rng.next() * w, y: rng.next() * h, r: rng.range(4.5, 11) * s, run: 0 })
  }
  for (let i = 0; i < smallCount; i++) {
    drops.push({ x: rng.next() * w, y: rng.next() * h, r: rng.range(1.1, 3.2) * s, run: 0 })
  }
  for (let i = 0; i < runCount; i++) {
    drops.push({
      x: rng.next() * w,
      y: rng.range(0.05, 0.55) * h,
      r: rng.range(5, 9) * s,
      run: rng.range(0.06, 0.22) * h,
    })
  }

  // ---- height canvas (black base, droplets = white domes) --------------
  const height = document.createElement('canvas')
  height.width = w
  height.height = h
  const hc = height.getContext('2d')!
  hc.fillStyle = '#000'
  hc.fillRect(0, 0, w, h)
  hc.globalCompositeOperation = 'lighter'
  const dome = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, peak: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    // stops approximate a hemisphere profile rather than a cone
    g.addColorStop(0, `rgba(255,255,255,${peak})`)
    g.addColorStop(0.55, `rgba(255,255,255,${peak * 0.86})`)
    g.addColorStop(0.85, `rgba(255,255,255,${peak * 0.45})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // wrap-aware painting: repeat near edges so the texture tiles
  const stamped = (paintFn: (x: number, y: number) => void, x: number, y: number, r: number) => {
    for (const dx of [-w, 0, w]) {
      for (const dy of [-h, 0, h]) {
        if (x + dx > -r * 2 && x + dx < w + r * 2 && y + dy > -r * 2 && y + dy < h + r * 2) {
          paintFn(x + dx, y + dy)
        }
      }
    }
  }
  for (const d of drops) {
    if (d.run > 0) {
      // run trail: thin fading streak below the droplet, drop settles at the end
      stamped((x, y) => {
        const grad = hc.createLinearGradient(x, y, x, y + d.run)
        grad.addColorStop(0, 'rgba(255,255,255,0.28)')
        grad.addColorStop(1, 'rgba(255,255,255,0.05)')
        hc.fillStyle = grad
        hc.fillRect(x - d.r * 0.35, y, d.r * 0.7, d.run)
        dome(hc, x, y + d.run, d.r, 0.9)
      }, d.x, d.y, Math.max(d.r, 8))
    } else {
      stamped((x, y) => dome(hc, x, y, d.r, 0.9), d.x, d.y, d.r)
    }
  }

  // ---- roughness canvas -------------------------------------------------
  const rough = document.createElement('canvas')
  rough.width = w
  rough.height = h
  const rc = rough.getContext('2d')!
  const baseByte = Math.round(baseR * 255)
  rc.fillStyle = `rgb(${baseByte},${baseByte},${baseByte})`
  rc.fillRect(0, 0, w, h)
  const dropByte = Math.round(dropR * 255)
  const midByte = Math.round((dropR + baseR) * 0.5 * 255)
  for (const d of drops) {
    if (d.run > 0) {
      stamped((x, y) => {
        rc.fillStyle = `rgb(${midByte},${midByte},${midByte})`
        rc.fillRect(x - d.r * 0.3, y, d.r * 0.6, d.run)
        const g = rc.createRadialGradient(x, y + d.run, 0, x, y + d.run, d.r)
        g.addColorStop(0, `rgb(${dropByte},${dropByte},${dropByte})`)
        g.addColorStop(0.8, `rgb(${dropByte},${dropByte},${dropByte})`)
        g.addColorStop(1, `rgb(${baseByte},${baseByte},${baseByte})`)
        rc.fillStyle = g
        rc.beginPath()
        rc.arc(x, y + d.run, d.r, 0, Math.PI * 2)
        rc.fill()
      }, d.x, d.y, Math.max(d.r, 8))
    } else {
      stamped((x, y) => {
        const g = rc.createRadialGradient(x, y, 0, x, y, d.r)
        g.addColorStop(0, `rgb(${dropByte},${dropByte},${dropByte})`)
        g.addColorStop(0.8, `rgb(${dropByte},${dropByte},${dropByte})`)
        g.addColorStop(1, `rgb(${baseByte},${baseByte},${baseByte})`)
        rc.fillStyle = g
        rc.beginPath()
        rc.arc(x, y, d.r, 0, Math.PI * 2)
        rc.fill()
      }, d.x, d.y, d.r)
    }
  }

  const normal = normalMapFromHeight(height, opts.normalStrength ?? 2.2)

  const roughnessMap = new THREE.CanvasTexture(rough)
  const normalMap = new THREE.CanvasTexture(normal)
  for (const t of [roughnessMap, normalMap]) {
    t.colorSpace = THREE.NoColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 4
    t.needsUpdate = true
  }
  return { roughnessMap, normalMap }
}
