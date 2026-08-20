import * as THREE from 'three'

/**
 * Extra helpers for the organic-fruit tiers (7 coconut, 8 pineapple):
 * seeded 3D value-noise fBm for radial displacement of solid bodies, and a
 * position-weld normal fixer for displaced indexed geometry (UV-seam and
 * pole duplicates otherwise show a lit crease after computeVertexNormals).
 * New file — existing lib files are owned by other groups.
 */

function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 1103515245 + (seed | 0) * 2246822519) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

/** one octave of 3D value noise, trilinear, [0,1) — stable per seed */
export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  const fx = smooth(x - ix)
  const fy = smooth(y - iy)
  const fz = smooth(z - iz)
  let out = 0
  for (let dz = 0; dz <= 1; dz++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const w =
          (dx === 0 ? 1 - fx : fx) * (dy === 0 ? 1 - fy : fy) * (dz === 0 ? 1 - fz : fz)
        out += hash3(ix + dx, iy + dy, iz + dz, seed) * w
      }
    }
  }
  return out
}

/** fBm of valueNoise3, normalized to [0,1] */
export function fbm3(
  x: number,
  y: number,
  z: number,
  octaves: number,
  seed: number,
  persistence = 0.5
): number {
  let sum = 0
  let amp = 1
  let ampSum = 0
  let f = 1
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise3(x * f, y * f, z * f, seed + o * 131) * amp
    ampSum += amp
    amp *= persistence
    f *= 2
  }
  return sum / ampSum
}

/**
 * Average normals across coincident vertices (rounded to `grid` metres).
 * Run AFTER computeVertexNormals on displaced indexed geometry: the wrap
 * seam and pole rows duplicate positions, and without welding each copy gets
 * a slightly different normal → a visible lit crease down the body.
 */
export function weldVertexNormals(geo: THREE.BufferGeometry, grid = 1e-6): void {
  const pos = geo.getAttribute('position')
  const nrm = geo.getAttribute('normal')
  const buckets = new Map<string, number[]>()
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) / grid)},${Math.round(pos.getY(i) / grid)},${Math.round(pos.getZ(i) / grid)}`
    let list = buckets.get(key)
    if (!list) {
      list = []
      buckets.set(key, list)
    }
    list.push(i)
  }
  const acc = new THREE.Vector3()
  for (const list of buckets.values()) {
    if (list.length < 2) continue
    acc.set(0, 0, 0)
    for (const i of list) acc.add(new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i)))
    acc.normalize()
    for (const i of list) nrm.setXYZ(i, acc.x, acc.y, acc.z)
  }
  nrm.needsUpdate = true
}

/** clamped smoothstep in plain numbers (no THREE.MathUtils import churn) */
export function sstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
