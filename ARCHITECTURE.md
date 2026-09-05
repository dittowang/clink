# Clink — architecture contract

Read this before touching anything. It is the shared contract between
subsystems; if you need to change a contract, change it here AND in code,
and say so in your report.

## Non-negotiables (from the design brief)

- Exactly two runtime deps: `three`, `@dimforge/rapier3d-compat`. Dev deps
  (vite, typescript, playwright, @types/three) are fine. NOTHING ELSE. No
  asset files: every texture is a CanvasTexture painted at load, every
  geometry is constructed, every sound is synthesized.
- `npm run typecheck` must pass after every change you make. Run it.
- 60 fps on integrated GPU with 60 settled drinks: share geometry and
  materials per tier (clone only what must vary per instance, e.g. liquid
  materials carrying a clipping plane), transmission only on glass tiers,
  bodies sleep, particles capped.
- Verify every visual/feel claim with `node scripts/capture.mjs ...` output —
  a real PNG or a real state log — never by reading your own code.

## Coordinates and the table

See `src/config/table.ts`. +Y up. Long axis on Z. Camera at +Z (near, open
edge) looking toward -Z (far rail). Playfield: x ∈ [-0.4, 0.4],
z ∈ [-0.9, 0.9], surface at y = SURFACE_Y (0.72). Foul line z = FOUL_Z.
Launch cradle at z = CRADLE_Z. Rails: far + both sides; near edge OPEN.

## Core files (owned by the integrator — coordinate before changing)

- `src/config/massLadder.ts` — THE mass table + impulse law (J = K·pull·m^α).
  All feel tuning goes through it.
- `src/config/tiers.ts` — tier defs: mass, footprint radius, height, sound
  material, cold flag, hue.
- `src/config/table.ts` — table dims, foul line, settle thresholds.
- `src/core/scheduler.ts` — fixed step 1/120 with render interpolation and
  0.1 s accumulator clamp. Harness drives time via `stepTo`.
- `src/core/events.ts` — typed EventBus. Physics/merge emit; render/audio/UI
  listen. RENDER NEVER WRITES BACK TO PHYSICS.
- `src/core/drink.ts` — the Drink entity: tier + body + collider + interpolated
  `root` + wobble `visual` + LiquidRig. States: tray / cradle / live /
  merging / serving (orders: kinematic carry-off) / sand / dead.
- `src/core/strings.ts` — every user-facing string, en + zh-CN.
- `src/main.ts` — boot + scene router (`?scene=game|lineup|ladder`).

## Subsystem contracts

### src/drinks — procedural drink factory
- `src/drinks/types.ts` exports:
  ```ts
  interface DrinkVisual {
    /** template; instances are created via instantiate() */
    template: THREE.Group          // origin at BASE CENTER, +Y up
    height: number                 // matches tiers.ts
    radius: number                 // physics footprint, matches tiers.ts
    liquid?: LiquidSpec            // present on glass tiers with visible liquid
  }
  interface LiquidSpec { fillY: number; capRadius: number; volumeMesh: THREE.Mesh; capMesh: THREE.Mesh }
  type DrinkBuilder = () => DrinkVisual
  ```
- `src/drinks/index.ts` — `buildDrink(tier): DrinkVisual` (cached templates)
  and `instantiateDrink(tier): { group, liquid }` which clones the template,
  cloning ONLY liquid materials (they carry per-instance clipping planes).
- Every rotationally symmetric drink: `LatheGeometry` from a hand-authored
  CatmullRom profile (12–24 control points → 48–96 segments) WITH shoulder,
  neck, lip, foot recess. Glass profiles authored TWICE (outer + inner wall
  offset by real thickness); `thickness` on the material = real wall
  thickness; liquid volume built from the INNER profile, slightly inset.
- Labels: offscreen canvas → CanvasTexture. Color bands ≥ 1/4 of drink height
  + roundels; label text is decorative only (unreadable at game distance is
  fine, fine print is NOT allowed as the primary read).
- Silhouette test: every tier identifiable as a pure black 128 px fill.
  Adjacent tiers differ in ≥ 2 of (height, footprint, top shape).

### src/render — stage, environment, post
- `createStage(renderer, opts)` returns
  ```ts
  interface Stage {
    scene: THREE.Scene; camera: THREE.PerspectiveCamera
    setPreset(p: 'morning'|'noon'|'golden'|'night'): void
    render(dt: number): void      // owns the EffectComposer
    onResize(w,h): void
    sun: THREE.DirectionalLight
    tableGroup: THREE.Group       // plank + legs + rails visuals
  }
  ```
- Environment: procedural beach scene (sky gradient sphere, sun disc, sea
  band, sand) → `PMREMGenerator.fromScene` → `scene.environment`, regenerated
  per preset; sun direction matches the DirectionalLight. ONE directional
  light. Shadow camera fitted tight to the table, map 2048 on the high
  quality tier (1024 on mid/low).
- Post: EffectComposer with GTAO (high tier only), UnrealBloom (threshold
  ≥ 0.9; half-res chain on the low tier), SMAA, Output.
- Quality tiers + dynamic resolution (docs/PERF.md): `src/render/quality.ts`
  picks low/mid/high at boot from the GL renderer string (`?quality=`
  overrides; harness mode defaults HIGH so captures stay pixel-stable) and
  sets dpr cap / GTAO / transmission resolution / shadow size;
  `src/render/dynres.ts` walks the render scale 0.7–1.0× inside the tier on
  sustained frame-time over/under budget (off in harness). Drink templates
  get a static same-material sub-mesh merge in `buildDrink`
  (`src/drinks/lib/mergeStatic.ts`; `?mergeoff=1` disables for A/B).
  `window.__perf` (tier, measure(), info(), templates()) is the probe API.
- Camera: near end, elevation 38–45°, FOV ~40. Never moves during a pull.
  Impact nudge: ≤ 5 px, 80–120 ms, along impact axis, gated + scaled by the
  HORIZONTAL contact force (force · |normal_xz|, gate 40 N) so routine
  vertical drop landings and light taps never move the screen.

### src/physics — world, slingshot, feel
- `PhysicsWorld` wraps RAPIER.World (timestep 1/120, CCD on launched body),
  creates table/rail/umbrella colliders (the wet patch is a FRICTION ZONE,
  not a collider: drinks inside it get μ 0.03 with the Min combine rule — a
  1.5 mm strip on the plank was a curb that stopped launched cans dead),
  spawns/removes drink bodies
  (cylinder colliders, `setEnabledRotations(false, true, false)`,
  `setAdditionalMass` from the ladder), steps with EventQueue and drains
  collision + contact-force events into the bus.
- Friction/restitution per SoundMaterial pair (see brief: 0.25–0.55 /
  0.10–0.35). Linear damping tuned so sliding decays believably (billiards,
  not air hockey).
- Slingshot: swipe anywhere; the swipe direction (table-plane, ±35° from
  straight ahead) is the launch direction; release: `applyImpulse(m·v0·dir)`
  with v0 solved per tier so every drink's free slide would stop
  TARGET_STOP_M (massLadder.ts) out — beyond the far rail. Marker ring at
  the first rail/stop along the true aim line, plus a one-bounce preview.
- Lean/wobble: render-only damped spring (2–4 Hz, ζ 0.3–0.5) driven by body
  acceleration; writes `visual` rotation and the liquid plane tilt. Reads
  physics, NEVER writes.

### src/merge — contact graph, snap & grow
- Adjacency map from collision started/stopped events, per tier, PLUS a
  proximity slop: same-tier drinks whose footprint gap is < 5 mm count as
  touching for the component BFS (the contact graph stays primary; the slop
  only ADDS edges — it exists because a merge-grown drink can rest 1–4 mm
  from its neighbours without Rapier ever reporting a contact pair, silently
  missing the cascade). BFS the component; if ≥ 3, take the 3 most recent
  contacts, fire merge: bodies kinematic → pull to centroid + shrink
  120–200 ms → despawn → spawn next tier with collider radius growing
  0.4→1× over 180–300 ms, mesh ease-out-back in lockstep → small radial
  impulse on neighbors. Chain window 1 s, ×1.5 per link.
- Scoring: tier² × 10 × chain.

### src/audio — synthesis, zero samples
- `AudioEngine` on first user gesture. Voice pool: max 6 impact voices,
  steal oldest. Master limiter (DynamicsCompressor). Surf bed: pink noise +
  slow LFO, well under impacts.
- Impact recipes per SoundMaterial (see brief §12); loudness quadratic in
  `totalForceMagnitude`, brightness rises with force. Slide: filtered noise
  loop gated by `sliding` events. Merge: band-pass-swept pour + pop pitched
  down by tier.
- Stereo: every impact voice, the slide loop, and each merge one-shot run
  through a StereoPanner set by `panForX` (dsp.ts): table x ∈ [-0.4, 0.4] →
  pan ±0.55. Impacts pan by the impact point's x, the slide loop by the
  `sliding` event's speed-weighted centroid x (the event carries `x` now —
  events.ts + world.ts), merges by the mergeDone centroid x.
- Harness: `window.__audio.renderImpact(material, force): Promise<{env: number[], spectrum: number[]}>`
  via OfflineAudioContext so envelopes/spectra are verifiable headlessly.
  Extended (superset, `env`/`spectrum` unchanged): probes also carry `peak`,
  `rms`, `envelope` (= `env`), `spectrumFreqs`, `centroidHz`,
  `durationToMinus40dB`; plus `renderMerge(tier, chain?)`, `renderPileup()`
  (6 max-force voices through the master chain, peak must stay < 1),
  `renderSurf()`, `renderLevels()` (post-chain impact/merge/surf peaks +
  dB ratios), and `renderPan(x)` (stereo render of a glass impact through the
  live pan law; reports panForX(x) AND the pan recovered from the rendered
  L/R energy split — capture spec `pan:<x>`). renderImpact/renderMerge measure the recipe DIRECT (no chain):
  Chrome's compressor smears fast transients ~-12 dB level-independently and
  would pollute the gain-law/decay measurements; mix-level checks go through
  the chain via renderPileup/renderLevels. Driven by
  `capture.mjs --audio="impact:glass:8" | "merge:5[:chain]" | "pileup" |
  "surf" | "levels" | "matrix" | comma-list` (loads the game scene, injects
  `src/audio/offline.ts`, writes JSON to `--out`).
- Integration: `subscribe(bus)` + `resumeOnGesture(el)` from
  `src/audio/engine.ts` — one call each; `audio.setMuted(b)` applies mute
  (persistence is the caller's job).
- Ambience (`src/audio/ambience.ts`, started with the context on the first
  gesture): surf bed + discrete wave cycles (swell/break/retreat, panned,
  every 6–11 s) + beach-bar layers (crowd murmur, occasional clinks, sparse
  gulls, a far-away pentatonic mallet loop at 76 BPM). Whole mix sits
  ≥ 15 dB under a full-force impact and can never engage the limiter alone.
  `engine.setAmbienceLevel(0..1)`; probes `renderAmbience(seconds, seed)`,
  `liveStatus()`; capture specs `--audio=ambience[:s[:seed]]` and
  `--audio=smoke` (real-time gesture + context check).

### src/levels — game scene, director, HUD, menus, persistence
- Owns `createGameScene`, level defs (4 chapters × 6 hand-designed PUZZLES +
  endless — docs/GAME.md), spawn director (Endless: weighted pool, rubber
  band ±20–40%; puzzles deal a fixed `queue` instead), HUD (HTML overlay,
  strings via `t()`), score pops via `Vector3.project`, localStorage
  persistence. Every puzzle's `solution` is replayed by `npm run puzzles`
  (scripts/puzzles.mjs): goal met within par, no foul; `--lessons` replays
  the documented failure paths too.
- **Orders (Endless pacing)** — `src/levels/orders.ts` (ladder, budgets,
  pool shift, seeded junk toss) + every constant in `src/config/orders.ts`.
  One active order ("serve one drink of tier T"); a T at rest on the table
  → SERVE (the drink goes `state: 'serving'`: kinematic, collider off,
  lifts + glides off the LEFT/service side, removed; score =
  mergeScore(T,1)×3×tip); budget of launches spent → MISS (card shake, one
  seeded junk drink tossed just inside the foul line). Bus events
  `orderNew` / `orderServed` / `orderMissed`. The director takes an order
  bias (`setOrderBias`: T−1 ×1.6, T−2 ×1.25) and a shifted pool
  (`setPool`, every 3 served); the order Rng is a separate salted stream so
  the director's draws are unchanged for a given seed. Order-card
  thumbnails: `src/render/thumbnails.ts` renders each tier inside the stage
  scene (same program keys) into a 128² target → data URL, prerendered in
  the warm-up (lazy in the harness). Ambience hook: `audio.setBarBusy(0..1)`
  scales the murmur + clink layers 1× → 1.8×. Harness: `__game.order()`,
  `state().order`, log events `orderNew/orderServed/orderMissed/junkToss/
  junkLanded/poolShift`.

### src/harness — debug scenes + automation
- `?scene=lineup`: all 12 on a bare plank, golden hour; `&silhouette=1`
  renders black fills on white; `&only=3,4,5` frames a subset close-up.
- `?scene=ladder`: every tier launched with an identical full pull;
  `__game.logs()` returns per-tier stop distances.
- `window.__game`: see `src/harness/api.ts`.

## Capture workflow (scripts/capture.mjs)

```
node scripts/capture.mjs --scene=lineup --out=captures/lineup.png
node scripts/capture.mjs --scene=lineup --url-extra="&silhouette=1" --out=captures/sil.png
node scripts/capture.mjs --scene=ladder --settle=8 --state
node scripts/capture.mjs --scene=game --eval="__game.spawn(3); __game.push(0, 1.0)" --frames=90 --fps=60 --outdir=captures/seq
```
Ports are randomized; parallel captures are safe. SwiftShader is slow but
correct — measure LOOK there, never fps. Fps is measured in the real
Browser pane by the integrator.

## Style

- TypeScript strict. No `any` unless interfacing wasm quirks.
- Comments state constraints and tuning rationale, not narration.
- Per-frame allocations: none in hot paths — reuse scratch Vector3/Quaternion.
