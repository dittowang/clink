import * as THREE from 'three'
import { sampleProfile, type ProfilePoint } from './profiles'

/**
 * Shared helpers for tiers 3–4 (cola can + stubby soda bottle). New file per
 * the parallel-agent rule — existing lib files stay untouched.
 */

/**
 * Arc-length v (0..1) of the first crossing of height y along a profile,
 * using the same CatmullRom sampling as latheFromProfile — so the returned v
 * matches LatheGeometry's texture v for that surface point. Lets a label
 * painter place features (bands, roundels, wordmarks) at exact drink heights
 * on a curved wall instead of guessing arc fractions.
 */
export function vAtY(
  points: readonly ProfilePoint[],
  y: number,
  samples = 96,
  tension = 0.5
): number {
  const s = sampleProfile(points, samples, tension)
  const cum: number[] = [0]
  for (let i = 1; i < s.length; i++) cum.push(cum[i - 1] + s[i].distanceTo(s[i - 1]))
  const total = cum[cum.length - 1] || 1
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]
    const b = s[i]
    if ((a.y - y) * (b.y - y) <= 0 && Math.abs(b.y - a.y) > 1e-9) {
      const t = (y - a.y) / (b.y - a.y)
      return (cum[i - 1] + (cum[i] - cum[i - 1]) * t) / total
    }
  }
  return y <= s[0].y ? 0 : 1
}

export interface CrownCapOpts {
  /** nominal shell radius (m) — the fluted crimp flares a little beyond it */
  radius: number
  /** total cap height (m); origin at the skirt bottom, +Y up */
  height: number
  /** scallop count, default 21 (the real-world crown standard) */
  flutes?: number
  /** radial scallop amplitude at the crimp (m), default radius * 0.055 */
  scallop?: number
  material: THREE.Material
  /** printed lid art: a disc floated just above the cap top */
  topMaterial?: THREE.Material
}

/**
 * Crown cap: parametric shell — flat top, rolled edge, skirt that flares and
 * breaks into the classic downward-pointing scallops at the crimp, with a
 * short tuck-under so the bottom edge has visible thickness. Radial scallop
 * = amp·cos(flutes·θ); scallop peaks also dip in y (crimp points down).
 */
export function crownCap(opts: CrownCapOpts): THREE.Group {
  const R = opts.radius
  const H = opts.height
  const flutes = opts.flutes ?? 21
  const A = opts.scallop ?? R * 0.055
  // rows: [radius factor, height factor, scallop amp 0..1, crimp dip 0..1]
  const rows: ReadonlyArray<readonly [number, number, number, number]> = [
    [0.0, 1.0, 0, 0],
    [0.55, 1.0, 0, 0],
    [0.92, 1.0, 0, 0], // wide flat top — crowns are squat
    [0.985, 0.955, 0.05, 0],
    [1.0, 0.8, 0.22, 0],
    [1.005, 0.55, 0.55, 0],
    [1.035, 0.3, 0.9, 0.35],
    [1.08, 0.04, 1.0, 1.0], // crimp bottom edge
    [1.015, 0.12, 0.9, 1.0], // tuck under
  ]
  const cols = flutes * 5
  const positions: number[] = []
  for (const [rf, yf, amp, dip] of rows) {
    for (let c = 0; c < cols; c++) {
      const th = (c / cols) * Math.PI * 2
      const wave = Math.cos(th * flutes)
      const r = rf * R + amp * A * wave
      const y = yf * H - dip * H * 0.055 * Math.max(0, wave) ** 2
      positions.push(Math.cos(th) * r, y, Math.sin(th) * r)
    }
  }
  const index: number[] = []
  for (let rI = 0; rI < rows.length - 1; rI++) {
    for (let c = 0; c < cols; c++) {
      const a = rI * cols + c
      const b = rI * cols + ((c + 1) % cols)
      const c2 = (rI + 1) * cols + c
      const d = (rI + 1) * cols + ((c + 1) % cols)
      index.push(a, b, c2, b, d, c2)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(index)
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, opts.material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  if (opts.topMaterial) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R * 0.86, 48), opts.topMaterial)
    disc.rotation.x = -Math.PI / 2
    disc.position.y = H + 0.00025
    disc.castShadow = false
    disc.receiveShadow = true
    group.add(disc)
  }
  return group
}
