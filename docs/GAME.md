# Game flow — levels, director, HUD (spec for the levels subsystem)

## Level definition shape

```ts
interface LevelDef {
  id: number                      // 1..12 (0 = Endless)
  chapter: 1 | 2 | 3 | 4
  preset: 'morning' | 'noon' | 'golden' | 'night'
  name?: { en: string; 'zh-CN': string }   // shown on the objective chip / complete screen
  pool: TierId[]                  // Endless spawn pool (puzzles: the hand's tiers)
  queue?: TierId[]                // PUZZLES: the fixed hand, dealt in order; length = push budget
  par?: number                    // PUZZLES: 3★ ≤ par pushes, 2★ ≤ par+1, 1★ solved within the hand
  solution?: (number | { angle: number; waitBefore?: number })[]
                                  // replay shots in DEGREES (0 = straight at the far rail,
                                  // + = toward +x) for scripts/puzzles.mjs
  goal:
    | { kind: 'makeTier'; tier: TierId }
    | { kind: 'mergeCount'; tier: TierId; count: number }   // make N drinks of tier T
    | { kind: 'endless' }
  mods?: {
    tableHalfW?: number           // 0.25 narrows the table (noon chapter)
    umbrella?: { x: number; z: number }  // pole collider + visual parasol
    slopeDeg?: number             // rotate gravity plane: creep toward +Z (near edge!)
    wetPatch?: { x: number; z: number; w: number; l: number } // low-friction ZONE (μ 0.03)
    wind?: { amp: number; steady?: true } // gusts (2–6 s noise, ±x) or a constant +x wind
    removeRails?: ('left' | 'right')[]
    preplaced?: { tier: TierId; x: number; z: number }[]
  }
}
```

Puzzle turn loop: the hand replaces the spawn director — the cradle gets
`queue[0]`, the tray shows `queue[1]`, one card per launch; the tray goes empty
with the last card. When the hand is spent and the goal is unmet, the run
resolves on true settle into "Out of Pushes". Stars are pushes-vs-par only;
score still displays.

## The 12 puzzles

Table space: x right, z toward the far rail NEGATIVE (far rail −0.75, foul line
+0.5, cradle +0.64). Every level below is verified by `npm run puzzles`
(solution replay at seed 1 → goal met, pushes ≤ par, no foul);
`npm run puzzles -- --lessons` also replays each documented failure path.
Preplaced pairs sit 2 mm apart (0.068 for cans), not touching: an exactly
touching pair does not creep on the sloped tables.

Ch.1 Morning — full table, teach the pull:
- L1 Clink / 碰杯 — t3 (−.034,−.2)(.034,−.2); hand [3,3], par 1, make t4.
  Straight (0°). Lesson: three of a kind touching merge.
- L2 Around the pitcher / 绕过冰茶壶 — t3 (−.27,−.66)(−.202,−.66), t9 (−.09,−.15)
  on the straight line; hand [3,3], par 1, make t4. Solution −18° (−22…−14°
  works): the can rides the left rail to the far corner. A −10° lane shot
  stops dead on the pitcher; −25° bleeds too much speed on the rail hit and
  dies at z −0.5.
- L3 Two for one / 一石二鸟 — t2 (−.03,−.62)(.03,−.62), t3 (.078,−.6)(.146,−.6);
  hand [2,2], par 1, make t4. Straight: the grown can lands within 2 cm of the
  cola pair and chains.
- L4 Heavy hand / 重手 — t3 at (0,−.3)(0,−.45)(0,−.6), loose; hand [9], par 1,
  make t4. Straight: the pitcher plows all three into a heap (a t3 shot also
  gathers them — the launched can is the third — the pitcher is the spectacle).

Ch.2 Noon — tableHalfW 0.25, umbrella pole at (0, −0.15):
- L5 Pole shadow / 杆影 — t3 (.03,−.55)(.098,−.55); hand [3,3], par 1, make t4.
  Solution 5° (4–8°): pass the pole's right flank; 0–3° stops dead on the pole.
- L6 Off the pole / 借杆一拐 — t3 (−.217,−.62)(−.149,−.62), t9 (−.17,+.2) parked
  on the left rail ahead of the cradle; hand [3,3,3], par 1, make t4. Solution
  −6° (−8.5…−3.5°): the slot between the pitcher and the pole, brushing the
  pole's left flank. Every rail ride (−30…−9°) and the centre lane die on the
  pitcher.
- L7 Two lanes / 两条道 — t3 (−.172,−.5)(−.104,−.5)(.104,−.5)(.172,−.5), junk t1 at
  (.2,.44) just inside the foul line; hand [3,3,3,3], par 2, make 2 × t4.
  Solution −7°, 7°.

Ch.3 Golden hour — slopeDeg 3: everything creeps toward the foul line at
~14 mm/s (free drinks; the merge-grown drink is kinematic while it grows):
- L8 Last call / 打烊前 — t3 (−.034,.4)(.034,.4); hand [3], par 1, make t4.
  Straight, NOW: the pair crosses the line at 7 s and fouls at 9.5 s.
- L9 Slick / 滑道 — wetPatch z ∈ [−.36,.47] full width; t9 (0,−.5);
  t3 (−.26,−.66)(−.192,−.66); hand [3,3], par 1, make t4. Solution −25°
  (−30…−14° all work: the slick even helps the rail hit). Straight: the can
  bounces off the pitcher onto the slick, slides over the line and fouls at
  ~7.7 s. The right rail parks in the empty corner. The pitcher itself reaches
  the slick after ~10 s and fouls at ~16 s — golden hour is on the clock.
- L10 Triple / 三连 — t2 (−.03,−.66)(.03,−.66); t3 (.071,−.606)(.139,−.606);
  t4 (.112,−.691)(.188,−.691); hand [2], par 1, make t5. Straight: t2 → t3 →
  t4 → t5 in one shot (the merge spawns at the three-drink centroid, ~2 cm
  toward +z of the pair; each next pair sits ≤ 8 cm from that point).
  Verified immediately and after 3 s of creep.

Ch.4 Night — wind, missing rails:
- L11 Crosswind / 侧风 — wind {amp 2, steady} toward +x; left rail removed;
  t3 (−.034,−.6)(.034,−.6); hand [3,3], par 1, make t4. Solution −6°
  (−11…−1°): aim into the wind. Straight drifts 18 cm right and misses;
  −25° drops off the open edge.
- L12 No rails / 无栏 — both rails removed; wind {amp 2} gusts (seed-dependent
  direction, ±26° wander); t3 (−.252,−.62)(−.184,−.62)(.184,−.62)(.252,−.62);
  hand [3,3,3,3], par 2, make 2 × t4. Solution −10°, 10° (seed 1 first-shot
  window −12…−6°); `waitBefore` is available to shoot in a lull.

Chapter N+1 unlocks when all three levels of chapter N are solved (any
stars). Old save records for ids 13–24 are dropped on load.

Endless: golden preset, pool [1..5], no push limit, local top-5 leaderboard.
Paced by ORDERS (src/config/orders.ts has every number): one card at a time,
"serve one drink of tier T". First order T3; the ladder climbs one tier per
2 served (cap min(12, poolMax+2); bumped +1 while T already stands on the
table). Budget = 5 + 2(T−2) launches (+40 % when no T−1 is on the table);
the miss resolves when the last launch has settled. Serve: the drink lifts
40 cm, a waiter's tray slides in under it from the left (service) side and
carries it out; score = mergeScore(T,1) × 3 × tip,
tip = 1 + 0.1 × pushes left (≤ 2.0). Miss: "customer left", one seeded junk
drink (tier 1–2) is tossed 12 cm inside the foul line. Every 3 served the
pool shifts up a tier ([1..5] → … → [4..8]) with a toast, and the bar
ambience gets busier (murmur + clinks up to 1.8×). Run Over shows orders
served; the local top-5 keeps a parallel served count.

## Spawn director (Endless)

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

Score top-left (Endless: "Served N" under it), pushes top-right, the Endless
order card top-centre (56 px drink thumbnail, tier name, budget pips — a bar
above 12 — pulsing at ≤ 2 left; green tick on serve, red shake on a miss),
objective chip bottom-left ("<level name> · <goal> · par N" on puzzles), next
drink in-world on a tray beside the cradle (empty once the last card of the
hand is in the cradle). The level-complete screen shows pushes used vs par
under the stars. HTML overlay only for menus and score
pops (positioned via Vector3.project). System font stack. All strings via
`t()` from src/core/strings.ts.

## Persistence

localStorage `clink.save.v1`: { stars: Record<levelId, 0-3>, endless: number[],
endlessOrders: number[] (orders served per top-5 run, parallel to `endless`;
missing in old saves → zeros), locale, muted }. Never store anything else.

Miss escalation: consecutive misses toss 1, then 2, then 3 junk drinks, each
batch landing closer to the foul line (JUNK_STREAK_INSETS); a serve resets the
streak. A run that can no longer keep up with its orders ends within a few of
them instead of stalling.
