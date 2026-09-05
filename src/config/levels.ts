import type { TierId } from './tiers'

/**
 * The LevelDef table — docs/GAME.md "The 12 puzzles" + Endless.
 *
 * Campaign levels are hand-designed PUZZLES: a fixed hand (`queue`) dealt in
 * order, a preplaced layout, one goal, and a `par`. Stars come from pushes
 * used (3★ ≤ par, 2★ ≤ par + 1, 1★ solved within the hand). Every level's
 * `solution` is replayed by `npm run puzzles` (scripts/puzzles.mjs), which
 * asserts the goal is met within par with no foul — a level that fails that
 * test does not ship. Coordinates are table space (x right, z toward the far
 * rail NEGATIVE); the far rail's inner face is z = −0.75, the foul line
 * z = +0.5, the cradle z = +0.64.
 */

export type Goal =
  | { kind: 'makeTier'; tier: TierId }
  /** make `count` drinks of `tier` (each merge that produces the tier counts) */
  | { kind: 'mergeCount'; tier: TierId; count: number }
  /** endless mode has no goal — runs until a foul */
  | { kind: 'endless' }

export interface LevelMods {
  /** narrows the physical table (noon chapter uses 0.25) */
  tableHalfW?: number
  /** umbrella pole collider + parasol visual at (x, z) */
  umbrella?: { x: number; z: number }
  /** whole-table tilt around X at the table centre; +Z (near) edge drops */
  slopeDeg?: number
  /** low-friction wet strip on the plank, centre (x,z), extents w × l (m) */
  wetPatch?: { x: number; z: number; w: number; l: number }
  /**
   * wind: gusty by default (force = amp · frontalArea · gust(t), 2–6 s noise,
   * direction ±X off the seed); `steady` = a constant full-strength wind
   * blowing toward +X (the L11 crosswind lesson)
   */
  wind?: { amp: number; steady?: true }
  removeRails?: ('left' | 'right')[]
  /** drinks resting on the table before the first turn */
  preplaced?: { tier: TierId; x: number; z: number }[]
}

/** a replay shot: launch angle in DEGREES (0 = straight at the far rail, + = toward +x) */
export type SolutionShot = number | { angle: number; waitBefore?: number }

export type Preset = 'morning' | 'noon' | 'golden' | 'night'
export type ChapterId = 1 | 2 | 3 | 4

export interface LevelDef {
  /** 1..12 for campaign puzzles, 0 for endless */
  id: number
  chapter: ChapterId
  preset: Preset
  /** localized level name (puzzles; Endless uses the `endless` string) */
  name?: { en: string; 'zh-CN': string }
  /** spawn pool: Endless draws from it; puzzles keep the hand's tiers here */
  pool: TierId[]
  /** puzzles: the FIXED hand, dealt in order; its length is the push budget */
  queue?: TierId[]
  /** puzzles: 3★ at ≤ par pushes, 2★ at par + 1, 1★ anywhere inside the hand */
  par?: number
  /** puzzles: the shots scripts/puzzles.mjs replays (degrees, optional waits) */
  solution?: SolutionShot[]
  goal: Goal
  mods?: LevelMods
}

interface PuzzleSpec {
  id: number
  chapter: ChapterId
  preset: Preset
  name: [en: string, zh: string]
  queue: TierId[]
  par: number
  goal: Goal
  solution: SolutionShot[]
  mods?: LevelMods
}

function puzzle(p: PuzzleSpec): LevelDef {
  const pool = [...new Set(p.queue)].sort((a, b) => a - b)
  return {
    id: p.id,
    chapter: p.chapter,
    preset: p.preset,
    name: { en: p.name[0], 'zh-CN': p.name[1] },
    pool,
    queue: p.queue,
    par: p.par,
    solution: p.solution,
    goal: p.goal,
    mods: p.mods,
  }
}

const T3 = (x: number, z: number) => ({ tier: 3 as TierId, x, z })

/*
 * Preplaced pairs keep a ≥ 2 mm footprint GAP (t3: 0.068 apart, not 0.066).
 * Well inside the merge slop, but an EXACTLY touching pair does not creep on
 * the sloped tables (the resting contact pins them — measured 1 mm/s vs the
 * 14 mm/s of anything free), which would kill the Ch.3 timing lessons.
 */

// Ch.2 shared dressing: narrow table + umbrella pole at (0, -0.15)
const NOON = { tableHalfW: 0.25, umbrella: { x: 0, z: -0.15 } }

export const LEVELS: readonly LevelDef[] = [
  // ---- Ch.1 Morning — full table, teach the pull ----
  puzzle({
    id: 1, chapter: 1, preset: 'morning', name: ['Clink', '碰杯'],
    queue: [3, 3], par: 1, goal: { kind: 'makeTier', tier: 4 }, solution: [0],
    // three of a kind touching merge: a straight shot into a touching pair
    mods: { preplaced: [T3(-0.034, -0.2), T3(0.034, -0.2)] },
  }),
  puzzle({
    id: 2, chapter: 1, preset: 'morning', name: ['Around the pitcher', '绕过冰茶壶'],
    queue: [3, 3], par: 1, goal: { kind: 'makeTier', tier: 4 }, solution: [-18],
    // the pitcher sits on the straight line; ride the left rail to the far corner.
    // −22…−14° works; steeper hits bleed too much speed on the rail (−25° dies at z −0.5)
    mods: { preplaced: [T3(-0.27, -0.66), T3(-0.202, -0.66), { tier: 9, x: -0.09, z: -0.15 }] },
  }),
  puzzle({
    id: 3, chapter: 1, preset: 'morning', name: ['Two for one', '一石二鸟'],
    queue: [2, 2], par: 1, goal: { kind: 'makeTier', tier: 4 }, solution: [0],
    // chain: the grown can must land within 2 cm of the cola pair
    mods: { preplaced: [
      { tier: 2, x: -0.03, z: -0.62 }, { tier: 2, x: 0.03, z: -0.62 },
      T3(0.078, -0.6), T3(0.146, -0.6),
    ] },
  }),
  puzzle({
    id: 4, chapter: 1, preset: 'morning', name: ['Heavy hand', '重手'],
    queue: [9], par: 1, goal: { kind: 'makeTier', tier: 4 }, solution: [0],
    // the pitcher plows three loose cans into a touching heap at the far rail
    mods: { preplaced: [T3(0, -0.3), T3(0, -0.45), T3(0, -0.6)] },
  }),

  // ---- Ch.2 Noon — tableHalfW 0.25, umbrella pole at (0, -0.15) ----
  puzzle({
    id: 5, chapter: 2, preset: 'noon', name: ['Pole shadow', '杆影'],
    queue: [3, 3], par: 1, goal: { kind: 'makeTier', tier: 4 }, solution: [5],
    // a straight shot stops dead on the pole; pass its right flank (4–8° works)
    mods: { ...NOON, preplaced: [T3(0.03, -0.55), T3(0.098, -0.55)] },
  }),
  puzzle({
    id: 6, chapter: 2, preset: 'noon', name: ['Off the pole', '借杆一拐'],
    queue: [3, 3, 3], par: 1, goal: { kind: 'makeTier', tier: 4 }, solution: [-6],
    // the pitcher parks on the left rail just ahead of the cradle: every rail
    // ride and the lane to the pair's centre die on it, the pole shadows the
    // rest — the only way through is the slot between them, brushing the
    // pole's left flank (−8.5…−3.5° works; the pitcher's original spot beside
    // the pole left a 1° slot)
    mods: { ...NOON, preplaced: [T3(-0.217, -0.62), T3(-0.149, -0.62), { tier: 9, x: -0.17, z: 0.2 }] },
  }),
  puzzle({
    id: 7, chapter: 2, preset: 'noon', name: ['Two lanes', '两条道'],
    queue: [3, 3, 3, 3], par: 2, goal: { kind: 'mergeCount', tier: 4, count: 2 }, solution: [-7, 7],
    mods: { ...NOON, preplaced: [
      T3(-0.172, -0.5), T3(-0.104, -0.5), T3(0.104, -0.5), T3(0.172, -0.5),
      { tier: 1, x: 0.2, z: 0.44 }, // junk just inside the foul line
    ] },
  }),

  // ---- Ch.3 Golden hour — 3° slope, everything creeps toward the foul line ----
  puzzle({
    id: 8, chapter: 3, preset: 'golden', name: ['Last call', '打烊前'],
    queue: [3], par: 1, goal: { kind: 'makeTier', tier: 4 }, solution: [0],
    // the pair is sliding for the line — shoot NOW
    mods: { slopeDeg: 3, preplaced: [T3(-0.034, 0.4), T3(0.034, 0.4)] },
  }),
  puzzle({
    id: 9, chapter: 3, preset: 'golden', name: ['Slick', '滑道'],
    queue: [3, 3], par: 1, goal: { kind: 'makeTier', tier: 4 }, solution: [-25],
    // a straight shot bounces off the pitcher onto the slick and slides back over
    // the line; the left rail is the one route to the pair (the pitcher's
    // shove costs the right-rail corner shot its speed)
    // (everything creeps: the pitcher itself reaches the slick after ~10 s and
    // slides for the line — golden hour is on the clock)
    mods: { slopeDeg: 3, wetPatch: { x: 0, z: 0.055, w: 0.65, l: 0.83 }, preplaced: [
      { tier: 9, x: 0, z: -0.5 }, T3(-0.26, -0.66), T3(-0.192, -0.66),
    ] },
  }),
  puzzle({
    id: 10, chapter: 3, preset: 'golden', name: ['Triple', '三连'],
    queue: [2], par: 1, goal: { kind: 'makeTier', tier: 5 }, solution: [0],
    // one shot: slim pair → cola → cola pair → bottle → bottle pair → highball
    mods: { slopeDeg: 3, preplaced: [
      { tier: 2, x: -0.03, z: -0.66 }, { tier: 2, x: 0.03, z: -0.66 },
      T3(0.071, -0.606), T3(0.139, -0.606),
      { tier: 4, x: 0.112, z: -0.691 }, { tier: 4, x: 0.188, z: -0.691 },
    ] },
  }),

  // ---- Ch.4 Night — wind, missing rails ----
  puzzle({
    id: 11, chapter: 4, preset: 'night', name: ['Crosswind', '侧风'],
    queue: [3, 3], par: 1, goal: { kind: 'makeTier', tier: 4 }, solution: [-6],
    // steady wind toward +x, left rail gone: aim into the wind, not too far
    mods: { wind: { amp: 2, steady: true }, removeRails: ['left'], preplaced: [T3(-0.034, -0.6), T3(0.034, -0.6)] },
  }),
  puzzle({
    id: 12, chapter: 4, preset: 'night', name: ['No rails', '无栏'],
    queue: [3, 3, 3, 3], par: 2, goal: { kind: 'mergeCount', tier: 4, count: 2 }, solution: [-10, 10],
    mods: { wind: { amp: 2 }, removeRails: ['left', 'right'], preplaced: [
      T3(-0.252, -0.62), T3(-0.184, -0.62), T3(0.184, -0.62), T3(0.252, -0.62),
    ] },
  }),
]

/** Endless: golden preset, pool 1..3 to start (orders shift it up), no push limit, local top-5. */
export const ENDLESS: LevelDef = {
  id: 0,
  chapter: 1,
  preset: 'golden',
  pool: [1, 2, 3],
  goal: { kind: 'endless' },
}

export function levelById(id: number): LevelDef | null {
  if (id === 0) return ENDLESS
  return LEVELS.find((l) => l.id === id) ?? null
}

export const CHAPTERS: readonly ChapterId[] = [1, 2, 3, 4]

export function levelsOfChapter(ch: number): LevelDef[] {
  return LEVELS.filter((l) => l.chapter === ch)
}

/** push budget: the hand size for puzzles, unlimited (null) for Endless */
export function pushBudget(def: LevelDef): number | null {
  return def.queue ? def.queue.length : null
}

/** chapter N+1 unlocks once every level of chapter N is solved (any stars) */
export function isChapterUnlocked(ch: number, stars: Readonly<Record<number, number>>): boolean {
  if (ch <= 1) return true
  const prev = levelsOfChapter(ch - 1)
  return prev.length > 0 && prev.every((l) => (stars[l.id] ?? 0) > 0)
}

/** puzzle stars by pushes used: 3★ ≤ par, 2★ ≤ par + 1, 1★ solved at all */
export function puzzleStars(def: LevelDef, pushesUsed: number): number {
  if (def.par === undefined) return 0
  if (pushesUsed <= def.par) return 3
  if (pushesUsed <= def.par + 1) return 2
  return 1
}

/** per-level seed stream so wind/draws differ between levels on one URL seed */
export function levelSeed(baseSeed: number, levelId: number): number {
  return ((baseSeed ^ Math.imul(levelId + 1, 0x9e3779b9)) >>> 0) || 0x1234567
}
