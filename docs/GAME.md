# Game flow — levels, director, HUD (spec for the levels subsystem)

## Level definition shape

```ts
interface LevelDef {
  id: number                      // 1..24 (0 = Endless), 6 per chapter, contiguous
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
    wind?: { amp: number; steady?: true; dir?: -1 | 1 } // gusts (2–6 s noise, ±x) or a constant
                                  // wind along x (+x by default, dir −1 = toward −x)
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

## The 24 puzzles

Table space: x right, z toward the far rail NEGATIVE (far rail −0.75, foul line
+0.5, cradle +0.64). Every level below is verified by `npm run puzzles`
(solution replay at seed 1 → goal met, pushes ≤ par, no foul);
`npm run puzzles -- --lessons` also replays each documented failure path.
Preplaced pairs sit 2 mm apart (0.068 for cans), not touching: an exactly
touching pair does not creep on the sloped tables. Angle windows below are
measured (1° steps) at seed 1 with the replay's timing (a hand fires in
~1 s per shot — a human aims for ~2 s, so creep lessons use `waitBefore`);
a merge that lands completes the level even if another drink is already
over the line — a creep lesson only bites when the pair FOULS (2.5 s over
the line) first.

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
- L5 Through the gap / 穿缝 — t9 (−.195,−.3)(−.045,−.3)(.195,−.3): a pitcher
  wall with one 9 cm gap (x .03….12) and 5.5 cm edge slots no can fits;
  t3 (.041,−.68)(.109,−.68) behind the gap; hand [3,3], par 1, make t4.
  Solution 3° (−1…5° works — the middle pitcher's round flank funnels a
  slightly-left shot into the gap). 6°+ stops dead on the right pitcher;
  −2° stops on the middle one.
- L6 Build then finish / 先凑对 — t3 (−.29,−.715) and (.29,−.715), one can in
  each far corner, no pair on the table; hand [3,3,3], par 2, make t4.
  Solution −18°, −18° (−20…−12° works): the first left-rail ride makes a pair
  in the corner, the second finishes it. −22° dies on the rail at z −0.63; two
  straight shots stack at the rail's centre and nothing merges. Lesson: make
  a pair, then finish it (left, right, left also solves it — 2★).

Ch.2 Noon — tableHalfW 0.25, umbrella pole at (0, −0.15):
- L7 Pole shadow / 杆影 — t3 (.03,−.55)(.098,−.55); hand [3,3], par 1, make t4.
  Solution 5° (4–8°): pass the pole's right flank; 0–3° stops dead on the pole.
- L8 Off the pole / 借杆一拐 — t3 (−.217,−.62)(−.149,−.62), t9 (−.17,+.2) parked
  on the left rail ahead of the cradle; hand [3,3,3], par 1, make t4. Solution
  −6° (−8.5…−3.5°): the slot between the pitcher and the pole, brushing the
  pole's left flank. Every rail ride (−30…−9°) and the centre lane die on the
  pitcher.
- L9 Two lanes / 两条道 — t3 (−.172,−.5)(−.104,−.5)(.104,−.5)(.172,−.5), junk t1 at
  (.2,.44) just inside the foul line; hand [3,3,3,3], par 2, make 2 × t4.
  Solution −7°, 7°.
- L10 Both flanks / 两翼 — t3 (−.144,−.6)(−.076,−.6) and (.076,−.6)(.144,−.6),
  a pair behind each flank of the pole; hand [3,3,3], par 2, make 2 × t4.
  Solution −5°, 5° (4–9° either side works); 3° clips the pole and rides off
  to the rail, 0° stops dead on it.
- L11 Wall of cans / 罐墙 — t2 (−.184,−.35)(−.089,−.35)(.016,−.35)(.184,−.35):
  a slim-can wall with 3.7 cm slots and ONE 11 cm gap (x .045….155);
  t3 (.066,−.68)(.134,−.68) behind it; hand [3,3], par 1, make t4. Solution 6°
  (4–8° works; the gap's line clears the pole by 2.5 cm). Hitting a wall can
  just shoves it aside (−4°: the left can slides to z −.65) — the shooter
  stops and the pair stays walled off. Lesson: find the gap.
- L12 Chain around the pole / 绕杆连锁 — t2 (−.15,−.62)(−.09,−.62), t3
  (−.042,−.6)(.026,−.6) — L3's chain behind the pole's left flank; hand [2,2],
  par 1, make t4. Solution −5° (−6…−4°): thread the flank, the slim pair
  merges and the grown cola lands on the cola pair. −7° and wider still makes
  the cola but 9 cm from the pair (no chain); −3° clips the pole.

Ch.3 Golden hour — slopeDeg 3: everything creeps toward the foul line at
~14 mm/s (free drinks; the merge-grown drink is kinematic while it grows):
- L13 Last call / 打烊前 — t3 (−.034,.4)(.034,.4); hand [3], par 1, make t4.
  Straight, NOW: the pair crosses the line at 7 s and fouls at 9.5 s.
- L14 Slick / 滑道 — wetPatch z ∈ [−.36,.47] full width; t9 (0,−.5);
  t3 (−.26,−.66)(−.192,−.66); hand [3,3], par 1, make t4. Solution −25°
  (−30…−14° all work: the slick even helps the rail hit). Straight: the can
  bounces off the pitcher onto the slick, slides over the line and fouls at
  ~7.7 s. The right rail parks in the empty corner. The pitcher itself reaches
  the slick after ~10 s and fouls at ~16 s — golden hour is on the clock.
- L15 Triple / 三连 — t2 (−.03,−.66)(.03,−.66); t3 (.071,−.606)(.139,−.606);
  t4 (.112,−.691)(.188,−.691); hand [2], par 1, make t5. Straight: t2 → t3 →
  t4 → t5 in one shot (the merge spawns at the three-drink centroid, ~2 cm
  toward +z of the pair; each next pair sits ≤ 8 cm from that point).
  Verified immediately and after 3 s of creep.
- L16 Two calls / 两桌打烊 — t3 (−.154,.35)(−.086,.35) and (.086,.35)(.154,.35),
  both creeping (over the line at ~10.7 s, foul at ~13 s); hand [3,3], par 2,
  make 2 × t4. Solution 22°, −22° (20–24° either side; the second pair has
  crept ~5 cm nearer by the second shot, the catch zone absorbs it). Lesson:
  speed — first pair on time, then 12 s of dawdling and the second pair
  fouls before the shot. (The design's z .4 put the pairs at 32° from the
  cradle, too close to the ±35° clamp — moved to z .35.)
- L17 Ice rink / 滑冰场 — wetPatch z ∈ [−.6,−.2] full width; a runner t3 at
  (0,−.25) on the slick; t3 (−.034,−.68)(.034,−.68) at the far rail; hand [3],
  par 1, make t4. Straight: the shot hands its speed to the runner, which
  glides 43 cm up the slick into the pair. Verified counterfactual: the same
  table WITHOUT the slick (`--lessons` strips wetPatch) leaves the runner at
  z −.44, 19 cm short — the slick is the delivery. Waiting is survivable here
  (the pair creeps onto the slick at ~6 s and slides down to meet the shot),
  so the lesson is the slick, not the clock.
- L18 Sunset rush / 日落冲刺 — t3 (−.134,.36)(−.066,.36) near-left,
  (.186,.15)(.254,.15) mid-right, (.116,−.15)(.184,−.15) far-right, all
  creeping; hand [3,3,3], par 3, make 3 × t4 — every card must land.
  Solution −20°, 24°, 11° (near pair −19…−22°; 22–24° / 10–12° for the
  others; the far lanes clear the near pair's right can by ≥ 5 cm). Lesson:
  speed. The near pair crosses at ~10 s and the bottle it becomes is born
  3 cm nearer the line, so it fouls at ~11.5 s: the hand must be away
  inside ~9 s. The bare replay fires a hand in 2.4 s, so the lessons are
  paced with `waitBefore` — 5 s per aim fouls (first bottle over the line
  before the third shot), 3 s per aim still solves (an `expect: 'solved'`
  control). (Design: "hit the one nearest the line first, far one first
  lets the near pair cross" — that lesson cannot be made true here: a
  merge product creeps like its pair and spawns nearer the line, so
  merging the near pair first buys nothing; and a near pair close enough
  to punish "far first" (z ≥ .475) births its bottle already over the line
  and fouls at any human pace. Order is free; the clock is the lesson.)

Ch.4 Night — wind, missing rails:
- L19 Crosswind / 侧风 — wind {amp 2, steady} toward +x; left rail removed;
  t3 (−.034,−.6)(.034,−.6); hand [3,3], par 1, make t4. Solution −6°
  (−11…−1°): aim into the wind. Straight drifts 18 cm right and misses;
  −25° drops off the open edge.
- L20 No rails / 无栏 — both rails removed; wind {amp 2} gusts (seed-dependent
  direction, ±26° wander); t3 (−.252,−.62)(−.184,−.62)(.184,−.62)(.252,−.62);
  hand [3,3,3,3], par 2, make 2 × t4. Solution −10°, 10° (seed 1 first-shot
  window −12…−6°); `waitBefore` is available to shoot in a lull.
- L21 Headwind / 逆风 — wind {amp 2, steady, dir −1} toward −x; RIGHT rail
  removed; t3 (−.034,−.6)(.034,−.6); hand [3,3], par 1, make t4. Solution 6°
  (2–10°). Straight drifts left past the pair (stops at x −.18); 12° and
  beyond drop off the open right edge.
- L22 Night delivery / 夜间送达 — wind {amp 2, steady} toward +x; a runner t3
  at (0,−.55) gated by t9 (−.17,−.55)(.17,−.55) (6.2 cm slots beside it, no
  can passes); t3 (−.034,−.7)(.034,−.7) 15 cm behind; hand [3,3], par 1,
  make t4. Solution −5° (−3…−8°): the shot arrives square, the runner slides
  into the pair. Straight or 2°: the wind carries the shot onto the runner's
  side and it skids off; −10°+ hits the left pitcher. Lesson: hit a can to
  deliver it. (Design: a morning level with a 28 cm carry — that hit is a
  ±1° affair with a hole at −6° even in still air, so the carry shrank to
  8 cm; and Ch.1 already had four levels, so it became the night chapter's
  fourth with the crosswind on top.)
- L23 Gust window / 等风 — both rails removed; wind {amp 6} gusts (seed 1:
  rising over the first 3 s to ~1.9, a lull from ~4 to ~9 s at ~0.4, the big
  gust 11–17 s at ~5); t3 (−.034,−.62)(.034,−.62); hand [3,3,3], par 1, make
  t4. Solution { angle 0, waitBefore 4 } — shoot in the lull (3–6 s waits,
  ±3° all work). Shooting at 2 s into the opening gust drifts the can 18 cm
  wide; at 12 s the peak blows it clean off the open edge. (Design amp 2.5:
  no shot failed even at the peak; amp 6 is the first that makes the lull
  matter.)
- L24 Last shift / 最后一班 — both rails removed; wind {amp 2} gusts; t9 (0,−.3)
  on the centre line; t3 (−.29,−.715)(−.222,−.715) and (.222,−.715)(.29,−.715)
  in both far corners; hand [3,3,3,3], par 2, make 2 × t4. Solution −11°, 11°
  (−12…−8° / 8…12° at seed 1). Straight stops dead on the pitcher.

Chapter N+1 unlocks when four of the six levels of chapter N are solved
(any stars). Level ids are contiguous per chapter (1–6, 7–12, 13–18, 19–24);
a save from the 12-level campaign (`clink.save.v1`) is migrated without its
stars (the ids moved) — Endless scores, locale and mute carry over.

Endless: golden preset, pool [1..5], no push limit, local top-5 leaderboard.
Paced by ORDERS (src/config/orders.ts has every number): one card at a time,
"serve one drink of tier T", on a CLOCK. Target tier is always ≥ poolMax + 1
(one merge above what is dealt); the ladder climbs one tier per 2 served
(cap min(12, poolMax + 2); bumped +1 while T already stands on the table).
Budget = 25 + 10·(T − 4) seconds of play time (menus pause it), ×1.4 when no
T−1 is on the table; pushes are unlimited (the next drink arrives ≤ 0.8 s
after a launch so a rush is possible). The last 5 s tick and pulse the card.
Time-up with a launch still in flight gets 1.5 s of grace; a merge in
progress always finishes. Serve: the drink lifts 40 cm, a waiter's tray
slides in and carries it out; score = mergeScore(T,1) × 3 × tip, tip = 1 +
(clock left / budget) (≤ 2.0). Miss: "customer left", junk tossed near the
foul line (1/2/3 drinks on consecutive misses, closer each time). Every 3
served the pool shifts up a tier (start [1..3], cap [8..10] so orders reach
the dispenser) with a toast, and the bar ambience gets busier. Run Over
shows orders served; the local top-5 keeps a parallel served count.

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

localStorage `clink.save.v2`: { stars: Record<levelId, 0-3>, endless: number[],
endlessOrders: number[] (orders served per top-5 run, parallel to `endless`;
missing in old saves → zeros), locale, muted }. Never store anything else.
A `clink.save.v1` record (12-level campaign) is read once when v2 is absent:
its stars are dropped (ids were renumbered), the rest carries over.

Miss escalation: consecutive misses toss 1, then 2, then 3 junk drinks, each
batch landing closer to the foul line (JUNK_STREAK_INSETS); a serve resets the
streak. A run that can no longer keep up with its orders ends within a few of
them instead of stalling.
