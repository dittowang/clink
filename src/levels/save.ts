import { type Locale, detectLocale } from '../core/strings'
import { levelById } from '../config/levels'

/**
 * Persistence — localStorage `clink.save.v2`, exactly the shape docs/GAME.md
 * allows and NOTHING else: { stars, endless top-5 (+ parallel orders-served
 * counts), locale, muted }.
 * Loaded once at boot; persisted on level end and on settings change.
 *
 * v1 → v2 (the 24-level campaign): level ids were renumbered when each
 * chapter grew to six puzzles, so a v1 record's stars no longer name the
 * same levels — they are REMAPPED through LEGACY_ID_MAP (the twelve original
 * layouts are unchanged); the Endless leaderboard, locale and mute carry over. The v1 key is left in place (harmless, never re-read
 * once v2 exists).
 */

export const SAVE_KEY = 'clink.save.v2'
/** the 12-level campaign's key: read once, stars discarded */
export const LEGACY_SAVE_KEY = 'clink.save.v1'
/** v1 level id → v2 level id (the 12 original puzzles kept their layouts) */
const LEGACY_ID_MAP: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 7, 6: 8, 7: 9, 8: 13, 9: 14, 10: 15, 11: 19, 12: 20 }

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
    let raw = localStorage.getItem(SAVE_KEY)
    let legacy = false
    if (!raw) {
      raw = localStorage.getItem(LEGACY_SAVE_KEY)
      legacy = true
    }
    if (!raw) return fresh()
    const p = JSON.parse(raw) as Partial<SaveData>
    const out = fresh()
    if (p.stars && typeof p.stars === 'object') {
      for (const [k, v] of Object.entries(p.stars)) {
        const rawId = Number(k)
        const s = Number(v)
        // a v1 (12-level) record names the same layouts under old ids —
        // migrate them instead of making the player re-solve the chapter
        const id = legacy ? (LEGACY_ID_MAP[rawId] ?? -1) : rawId
        if (Number.isInteger(id) && id > 0 && levelById(id) && s >= 0 && s <= 3) out.stars[id] = s
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
    localStorage.removeItem(LEGACY_SAVE_KEY)
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
