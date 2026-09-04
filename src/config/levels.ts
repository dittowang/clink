import type { TierId } from './tiers'

/**
 * The LevelDef table — docs/GAME.md "The 24 levels", implemented EXACTLY.
 * Pools, goals, push budgets and modifiers are the spec; star thresholds are
 * initial tuning numbers (2★ ≈ 1.6× a just-passing score, 3★ ≈ 2.6×) and are
 * expected to move once real playthrough scores exist. TUNABLE.
 */

export type Goal =
  | { kind: 'makeTier'; tier: TierId }
  | { kind: 'score'; score: number }
  | { kind: 'survive'; pushes: number }
  /** endless mode has no goal — runs until a foul */
  | { kind: 'endless' }

export interface LevelMods {
  /** narrows the physical table (noon chapter uses 0.3) */
  tableHalfW?: number
  /** umbrella pole collider + parasol visual at (x, z) */
  umbrella?: { x: number; z: number }
  /** whole-table tilt around X at the table centre; +Z (near) edge drops */
  slopeDeg?: number
  /** low-friction wet strip on the plank, centre (x,z), extents w × l (m) */
  wetPatch?: { x: number; z: number; w: number; l: number }
  /** horizontal gust force = amp · frontalArea · gust(t), 2–6 s noise */
  wind?: { amp: number }
  removeRails?: ('left' | 'right')[]
  /** drinks resting on the table before the first turn */
  preplaced?: { tier: TierId; x: number; z: number }[]
}

export interface LevelDef {
  /** 1..24 for campaign levels, 0 for endless */
  id: number
  chapter: 1 | 2 | 3 | 4
  preset: 'morning' | 'noon' | 'golden' | 'night'
  pool: TierId[]
  goal: Goal
  /** push budget (null = unlimited; survive goals count their own pushes) */
  pushes: number | null
  /** score thresholds for 1/2/3 stars (1★ needs the goal met regardless) */
  stars: [number, number, number]
  mods?: LevelMods
}

// Ch.2 shared dressing: narrow table + umbrella pole at (0, -0.15)
const NOON = { tableHalfW: 0.25, umbrella: { x: 0, z: -0.15 } }

export const LEVELS: readonly LevelDef[] = [
  // ---- Ch.1 Morning — wide table, teach the pull ----
  { id: 1, chapter: 1, preset: 'morning', pool: [1, 2], goal: { kind: 'makeTier', tier: 3 }, pushes: 12, stars: [150, 250, 400] },
  { id: 2, chapter: 1, preset: 'morning', pool: [1, 2, 3], goal: { kind: 'makeTier', tier: 4 }, pushes: 16, stars: [350, 560, 910] },
  { id: 3, chapter: 1, preset: 'morning', pool: [1, 2, 3], goal: { kind: 'survive', pushes: 20 }, pushes: null, stars: [300, 480, 780] },
  { id: 4, chapter: 1, preset: 'morning', pool: [1, 2, 3, 4], goal: { kind: 'makeTier', tier: 5 }, pushes: 20, stars: [650, 1040, 1690] },
  { id: 5, chapter: 1, preset: 'morning', pool: [1, 2, 3, 4], goal: { kind: 'score', score: 2500 }, pushes: 18, stars: [2500, 4000, 6500] },
  { id: 6, chapter: 1, preset: 'morning', pool: [1, 2, 3, 4], goal: { kind: 'score', score: 4000 }, pushes: 22, stars: [4000, 6400, 10400] },

  // ---- Ch.2 Noon — tableHalfW 0.25, umbrella pole at (0, -0.15) ----
  { id: 7, chapter: 2, preset: 'noon', pool: [2, 3], goal: { kind: 'score', score: 1500 }, pushes: 12, stars: [1500, 2400, 3900], mods: { ...NOON } },
  { id: 8, chapter: 2, preset: 'noon', pool: [2, 3, 4], goal: { kind: 'score', score: 2500 }, pushes: 14, stars: [2500, 4000, 6500], mods: { ...NOON } },
  { id: 9, chapter: 2, preset: 'noon', pool: [2, 3, 4, 5], goal: { kind: 'survive', pushes: 22 }, pushes: null, stars: [700, 1120, 1820], mods: { ...NOON } },
  { id: 10, chapter: 2, preset: 'noon', pool: [2, 3, 4, 5], goal: { kind: 'score', score: 3500 }, pushes: 16, stars: [3500, 5600, 9100], mods: { ...NOON } },
  { id: 11, chapter: 2, preset: 'noon', pool: [3, 4, 5], goal: { kind: 'score', score: 5000 }, pushes: 18, stars: [5000, 8000, 13000], mods: { ...NOON } },
  { id: 12, chapter: 2, preset: 'noon', pool: [2, 3, 4, 5], goal: { kind: 'makeTier', tier: 6 }, pushes: 24, stars: [1400, 2240, 3640], mods: { ...NOON } },

  // ---- Ch.3 Golden hour — slope toward the NEAR edge, wet patches ----
  { id: 13, chapter: 3, preset: 'golden', pool: [3, 4, 5], goal: { kind: 'score', score: 3000 }, pushes: 14, stars: [3000, 4800, 7800], mods: { slopeDeg: 2 } },
  { id: 14, chapter: 3, preset: 'golden', pool: [3, 4, 5], goal: { kind: 'makeTier', tier: 7 }, pushes: 22, stars: [2400, 3840, 6240], mods: { slopeDeg: 2.5, wetPatch: { x: 0, z: 0.1, w: 0.5, l: 0.3 } } },
  { id: 15, chapter: 3, preset: 'golden', pool: [4, 5, 6], goal: { kind: 'score', score: 6000 }, pushes: 18, stars: [6000, 9600, 15600], mods: { slopeDeg: 3 } },
  { id: 16, chapter: 3, preset: 'golden', pool: [4, 5, 6], goal: { kind: 'survive', pushes: 25 }, pushes: null, stars: [2500, 4000, 6500], mods: { slopeDeg: 3, wetPatch: { x: -0.1, z: -0.1, w: 0.4, l: 0.35 } } },
  { id: 17, chapter: 3, preset: 'golden', pool: [4, 5, 6, 7], goal: { kind: 'makeTier', tier: 8 }, pushes: 26, stars: [3200, 5120, 8320], mods: { slopeDeg: 3.5 } },
  { id: 18, chapter: 3, preset: 'golden', pool: [5, 6, 7], goal: { kind: 'makeTier', tier: 9 }, pushes: 28, stars: [4500, 7200, 11700], mods: { slopeDeg: 4, wetPatch: { x: 0.05, z: 0.3, w: 0.55, l: 0.3 } } },

  // ---- Ch.4 Night — wind, missing rails, pre-placed tangles ----
  { id: 19, chapter: 4, preset: 'night', pool: [5, 6, 7], goal: { kind: 'score', score: 5000 }, pushes: 16, stars: [5000, 8000, 13000], mods: { wind: { amp: 0.4 } } },
  { id: 20, chapter: 4, preset: 'night', pool: [5, 6, 7], goal: { kind: 'score', score: 4000 }, pushes: 12, stars: [4000, 6400, 10400], mods: { wind: { amp: 0.5 }, removeRails: ['left'], preplaced: [
    { tier: 6, x: -0.1, z: -0.35 }, { tier: 6, x: 0.05, z: -0.48 }, { tier: 5, x: -0.22, z: -0.52 }, { tier: 7, x: 0.17, z: -0.28 }, { tier: 5, x: -0.02, z: -0.64 },
  ] } },
  { id: 21, chapter: 4, preset: 'night', pool: [6, 7, 8], goal: { kind: 'makeTier', tier: 10 }, pushes: 30, stars: [7000, 11200, 18200], mods: { wind: { amp: 0.5 } } },
  { id: 22, chapter: 4, preset: 'night', pool: [6, 7, 8], goal: { kind: 'survive', pushes: 25 }, pushes: null, stars: [3500, 5600, 9100], mods: { wind: { amp: 0.8 }, removeRails: ['left', 'right'] } },
  { id: 23, chapter: 4, preset: 'night', pool: [7, 8, 9], goal: { kind: 'score', score: 12000 }, pushes: 24, stars: [12000, 19200, 31200], mods: { wind: { amp: 0.6 }, preplaced: [
    { tier: 8, x: -0.16, z: -0.5 }, { tier: 8, x: 0.16, z: -0.5 }, { tier: 7, x: 0, z: -0.66 },
  ] } },
  { id: 24, chapter: 4, preset: 'night', pool: [7, 8, 9, 10], goal: { kind: 'makeTier', tier: 12 }, pushes: 60, stars: [16000, 25600, 41600], mods: { wind: { amp: 0.5 } } },
]

/** Endless: golden preset, pool 1..5, no push limit, local top-5 leaderboard. */
export const ENDLESS: LevelDef = {
  id: 0,
  chapter: 1,
  preset: 'golden',
  pool: [1, 2, 3, 4, 5],
  goal: { kind: 'endless' },
  pushes: null,
  stars: [0, 0, 0],
}

export function levelById(id: number): LevelDef | null {
  if (id === 0) return ENDLESS
  return LEVELS.find((l) => l.id === id) ?? null
}

export const CHAPTERS: readonly (1 | 2 | 3 | 4)[] = [1, 2, 3, 4]

export function levelsOfChapter(ch: number): LevelDef[] {
  return LEVELS.filter((l) => l.chapter === ch)
}

/** total stars required to unlock a chapter (10★ per docs/GAME.md) */
export function starsToUnlockChapter(ch: number): number {
  return ch <= 1 ? 0 : (ch - 1) * 10
}

/** per-level seed stream so wind/draws differ between levels on one URL seed */
export function levelSeed(baseSeed: number, levelId: number): number {
  return ((baseSeed ^ Math.imul(levelId + 1, 0x9e3779b9)) >>> 0) || 0x1234567
}
