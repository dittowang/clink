/**
 * Seeded PRNG (mulberry32). The harness sets the seed via ?seed=; the game
 * uses one global stream for the spawn director so runs are reproducible.
 * Procedural texture generation uses its own fixed-seed streams so drink
 * looks never depend on gameplay order.
 */
export class Rng {
  private s: number
  constructor(seed: number) {
    this.s = seed >>> 0
    if (this.s === 0) this.s = 0x9e3779b9
  }
  /** [0, 1) */
  next(): number {
    let t = (this.s += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next()
  }
  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1))
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))]
  }
}

export function seedFromUrl(defaultSeed = 1337): number {
  if (typeof window === 'undefined') return defaultSeed
  const p = new URLSearchParams(window.location.search).get('seed')
  if (!p) return defaultSeed
  const n = Number(p)
  return Number.isFinite(n) ? n : defaultSeed
}
