import * as THREE from 'three'

/**
 * Night-chapter wind.
 *
 * WindField — the PHYSICS side: a deterministic gust signal built from
 * smooth value noise (two octaves, ~5 s and ~2.3 s lattices → dominant
 * variation on the briefed 2–6 s timescale). Direction is mostly ±X (the
 * base sign comes off the level seed) with a slow ±26° wander on an 8 s
 * lattice. Per fixed step the level scene applies
 *   F = amp · WIND_PRESSURE · frontalArea(2·r·h) · gust(t)
 * to every awake dynamic drink. Purely a function of (seed, t): replays and
 * harness runs reproduce gusts exactly.
 *
 * WindDrift — the VISUAL side: pooled sand-streak particles blown across the
 * table, spawn rate ∝ gust strength. Render-only; Math.random here never
 * touches physics (same precedent as SandPuff).
 */

/** gust-to-force scale (N per m² at gust 1, amp 1). TUNABLE against captures. */
export const WIND_PRESSURE = 30

function hash01(seed: number, k: number): number {
  let t = (seed + Math.imul(k, 0x9e3779b5)) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** C1-smooth 1D value noise over an integer lattice scaled by `period` */
function valueNoise(seed: number, t: number, period: number, salt: number): number {
  const x = t / period
  const k = Math.floor(x)
  const f = x - k
  const s = f * f * (3 - 2 * f)
  return hash01(seed ^ salt, k) * (1 - s) + hash01(seed ^ salt, k + 1) * s
}

export class WindField {
  /** current gust strength 0..1 (updated by update()) */
  strength01 = 0
  /** current unit direction in the table plane */
  dirX = 1
  dirZ = 0

  private readonly baseSign: number

  constructor(
    private readonly seed: number,
    readonly amp: number
  ) {
    this.baseSign = hash01(seed, 9999) < 0.5 ? -1 : 1
  }

  update(t: number): void {
    // two octaves of smooth noise; shaped so lulls are real lulls
    const n = 0.65 * valueNoise(this.seed, t, 5.0, 0x1111) + 0.35 * valueNoise(this.seed, t, 2.3, 0x2222)
    this.strength01 = n * n * (3 - 2 * n) // smoothstep: spends time near 0 and 1
    // slow direction wander around ±X, ±26°
    const wander = (valueNoise(this.seed, t, 8.0, 0x3333) - 0.5) * 0.9
    this.dirX = this.baseSign * Math.cos(wander)
    this.dirZ = Math.sin(wander)
  }

  /** horizontal gust force (N) on a drink of footprint radius r, height h */
  forceOn(radius: number, height: number): number {
    return this.amp * WIND_PRESSURE * (2 * radius * height) * this.strength01
  }
}

// ---- sand drift (visual cue) ----

const MAX = 90
const PARK_Y = -100

export class WindDrift {
  readonly points: THREE.Points
  private readonly geo: THREE.BufferGeometry
  private readonly mat: THREE.PointsMaterial
  private readonly posAttr: THREE.BufferAttribute
  private readonly vel = new Float32Array(MAX * 3)
  private readonly life = new Float32Array(MAX)
  private cursor = 0
  private spawnDebt = 0

  constructor(private readonly surfaceY: number) {
    const positions = new Float32Array(MAX * 3)
    for (let i = 0; i < MAX; i++) positions[i * 3 + 1] = PARK_Y
    this.geo = new THREE.BufferGeometry()
    this.posAttr = new THREE.BufferAttribute(positions, 3)
    this.posAttr.setUsage(THREE.DynamicDrawUsage)
    this.geo.setAttribute('position', this.posAttr)
    this.mat = new THREE.PointsMaterial({
      color: 0xcbb492,
      size: 0.012,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    })
    this.points = new THREE.Points(this.geo, this.mat)
    this.points.frustumCulled = false
  }

  /** per rendered frame; spawns ∝ gust, streams particles along the wind */
  update(dt: number, wind: WindField): void {
    if (dt <= 0) return
    const a = this.posAttr.array as Float32Array
    // spawn: up to ~26/s at full gust
    this.spawnDebt += wind.strength01 * 26 * dt
    while (this.spawnDebt >= 1) {
      this.spawnDebt -= 1
      const i = this.cursor
      this.cursor = (this.cursor + 1) % MAX
      // enter from the upwind side, drifting just above the plank/sand
      const upX = -Math.sign(wind.dirX) * (0.55 + Math.random() * 0.25)
      a[i * 3] = upX
      a[i * 3 + 1] = this.surfaceY + 0.01 + Math.random() * 0.06
      a[i * 3 + 2] = -0.8 + Math.random() * 1.6
      const sp = (0.7 + Math.random() * 0.8) * (0.4 + 0.6 * wind.strength01)
      this.vel[i * 3] = wind.dirX * sp
      this.vel[i * 3 + 1] = (Math.random() - 0.4) * 0.05
      this.vel[i * 3 + 2] = wind.dirZ * sp + (Math.random() - 0.5) * 0.1
      this.life[i] = 0.8 + Math.random() * 0.7
    }
    let any = false
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue
      this.life[i] -= dt
      any = true
      if (this.life[i] <= 0) {
        a[i * 3 + 1] = PARK_Y
        continue
      }
      a[i * 3] += this.vel[i * 3] * dt
      a[i * 3 + 1] += this.vel[i * 3 + 1] * dt
      a[i * 3 + 2] += this.vel[i * 3 + 2] * dt
    }
    if (any || this.spawnDebt > 0) this.posAttr.needsUpdate = true
  }

  dispose(): void {
    this.geo.dispose()
    this.mat.dispose()
  }
}
