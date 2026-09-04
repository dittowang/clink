# Game flow — levels, director, HUD (spec for the levels subsystem)

## Level definition shape

```ts
interface LevelDef {
  id: number                      // 1..24
  chapter: 1 | 2 | 3 | 4
  preset: 'morning' | 'noon' | 'golden' | 'night'
  pool: TierId[]                  // spawn pool (weighted low, see director)
  goal:
    | { kind: 'makeTier'; tier: TierId }
    | { kind: 'score'; score: number }
    | { kind: 'survive'; pushes: number }
  pushes: number | null           // push budget (null = unlimited, survive uses its own count)
  stars: [number, number, number] // score thresholds for 1/2/3 stars
  mods?: {
    tableHalfW?: number           // 0.3 narrows the table (noon chapter)
    umbrella?: { x: number; z: number }  // pole collider + visual parasol
    slopeDeg?: number             // rotate gravity plane: creep toward +Z (near edge!)
    wetPatch?: { x: number; z: number; w: number; l: number } // low-friction zone
    wind?: { amp: number }        // gust force ∝ frontal area, 2–6 s noise
    removeRails?: ('left' | 'right')[]
    preplaced?: { tier: TierId; x: number; z: number }[]
  }
}
```

## The 24 levels

Ch.1 Morning — wide table, teach the pull:
- L1  pool [1,2]        makeTier 3, 12 pushes
- L2  pool [1,2,3]      makeTier 4, 16 pushes (far rail glints on first bank)
- L3  pool [1,2,3]      survive 20
- L4  pool [1,2,3,4]    makeTier 5, 20 pushes
- L5  pool [1,2,3,4]    score 2500, 18 pushes
- L6  pool [1,2,3,4]    score 4000, 22 pushes

Ch.2 Noon — tableHalfW 0.25, umbrella pole at (0, -0.15):
- L7  pool [2,3]        score 1500, 12
- L8  pool [2,3,4]      score 2500, 14
- L9  pool [2,3,4,5]    survive 22
- L10 pool [2,3,4,5]    score 3500, 16
- L11 pool [3,4,5]      score 5000, 18
- L12 pool [2,3,4,5]    makeTier 6, 24

Ch.3 Golden hour — slope toward the NEAR edge (foul pressure), wet patches:
- L13 pool [3,4,5]      score 3000, 14, slope 2
- L14 pool [3,4,5]      makeTier 7, 22, slope 2.5, wetPatch
- L15 pool [4,5,6]      score 6000, 18, slope 3
- L16 pool [4,5,6]      survive 25, slope 3, wetPatch
- L17 pool [4,5,6,7]    makeTier 8, 26, slope 3.5
- L18 pool [5,6,7]      makeTier 9, 28, slope 4, wetPatch

Ch.4 Night — wind, missing rails, pre-placed tangles:
- L19 pool [5,6,7]      score 5000, 16, wind 0.4
- L20 pool [5,6,7]      score 4000, 12, wind 0.5, removeRails [left], preplaced tangle
- L21 pool [6,7,8]      makeTier 10, 30, wind 0.5
- L22 pool [6,7,8]      survive 25, wind 0.8, removeRails [left,right]
- L23 pool [7,8,9]      score 12000, 24, wind 0.6, preplaced
- L24 pool [7,8,9,10]   makeTier 12, 60, wind 0.5

Endless: golden preset, pool [1..5], no push limit, local top-5 leaderboard.

Stars: 1★ = goal met; 2★/3★ = score thresholds (tune per level ≈ 1.6× and
2.6× of a just-passing run). 10★ total unlocks the next chapter.

## Spawn director

Weighted pool: base weight w(tier) = 1 / tierIndexInPool (skewed low).
Rubber band: a tier with ≥ 2 copies at rest on the table gets ×1.3 weight
(cap ×1.4); a tier with 0 copies (and not the pool's lowest) gets ×0.7.
Next drink is drawn when the previous one launches, shown on the in-world
tray. Deterministic from the seeded Rng stream.

## Turn loop (beat by beat, from the brief)

spawn drop 5 cm into cradle (soft thud) → aim (direction only — point AT the target, uniform full power;
releasing with the pointer still on the drink cancels; camera frozen) → release: impulse + slide noise → contacts:
force-scaled clink + camera nudge (only above force threshold) → merge check
(chain ×1.5 within 1 s) → next drink when all speeds < SETTLE_SPEED or 1.6 s
elapsed, whichever first. Foul: any drink at rest past FOUL_Z for 2.5 s → run
ends (camera rises + tilts down, offender pulses). Off the open near edge →
sand thud + dust puff, points forfeited, drink dies into the sand.

## HUD

Score top-left, pushes top-right, objective chip bottom-left, next drink
in-world on a tray beside the cradle. HTML overlay only for menus and score
pops (positioned via Vector3.project). System font stack. All strings via
`t()` from src/core/strings.ts.

## Persistence

localStorage `clink.save.v1`: { stars: Record<levelId, 0-3>, endless: number[],
locale, muted }. Never store anything else.
