import { type Locale, detectLocale } from '../core/strings'

/**
 * Persistence — localStorage `clink.save.v1`, exactly the shape docs/GAME.md
 * allows and NOTHING else: { stars, endless top-5 (+ parallel orders-served
 * counts), locale, muted }.
 * Loaded once at boot; persisted on level end and on settings change.
 */

export const SAVE_KEY = 'clink.save.v1'

export interface SaveData {
  /** levelId → stars earned (0–3); absent = never completed */
  stars: Record<number, number>
  /** endless top-5 scores, descending */
  endless: number[]
  /** orders served in each top-5 run, parallel to `endless` (old saves → 0) */
  endlessOrders: number[]
  locale: Locale
  muted: boolean
}

function fresh(): SaveData {
  return { stars: {}, endless: [], endlessOrders: [], locale: detectLocale(), muted: false }
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return fresh()
    const p = JSON.parse(raw) as Partial<SaveData>
    const out = fresh()
    if (p.stars && typeof p.stars === 'object') {
      for (const [k, v] of Object.entries(p.stars)) {
        const id = Number(k)
        const s = Number(v)
        if (Number.isInteger(id) && s >= 0 && s <= 3) out.stars[id] = s
      }
    }
    if (Array.isArray(p.endless)) {
      out.endless = p.endless
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
        .slice(0, 5)
    }
    // parallel served counts; a pre-orders save has none → zeros
    const orders = Array.isArray(p.endlessOrders) ? p.endlessOrders : []
    out.endlessOrders = out.endless.map((_, i) => {
      const n = orders[i]
      return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
    })
    if (p.locale === 'en' || p.locale === 'zh-CN') out.locale = p.locale
    if (typeof p.muted === 'boolean') out.muted = p.muted
    return out
  } catch {
    return fresh()
  }
}

export function persistSave(save: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save))
  } catch {
    /* storage may be unavailable (private mode) — play on without saving */
  }
}

export function wipeSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch {
    /* ignore */
  }
}

export function totalStars(save: SaveData): number {
  let n = 0
  for (const v of Object.values(save.stars)) n += v
  return n
}

/** record a level result; keeps the best. Returns true if it improved. */
export function recordLevelStars(save: SaveData, levelId: number, stars: number): boolean {
  const prev = save.stars[levelId] ?? 0
  if (stars <= prev) return false
  save.stars[levelId] = stars
  return true
}

/**
 * Insert an endless score into the local top-5. Returns the 0-based rank the
 * score landed at, or null if it didn't chart.
 */
export function recordEndlessScore(save: SaveData, score: number, served = 0): number | null {
  if (score <= 0) return null // a merge-less run doesn't chart on Local Best
  const rows = save.endless.map((s, i) => ({ s, o: save.endlessOrders[i] ?? 0 }))
  const entry = { s: score, o: served }
  // stable sort by score: an equal score charts BELOW the older run
  const list = [...rows, entry].sort((a, b) => b.s - a.s).slice(0, 5)
  save.endless = list.map((r) => r.s)
  save.endlessOrders = list.map((r) => r.o)
  const rank = list.indexOf(entry)
  return rank >= 0 ? rank : null
}
