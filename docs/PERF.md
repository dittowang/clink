# Performance measurements + optimization brief

Measured 2026-08-21 on the dev Mac (Apple silicon, Chrome, dpr 2, 1280×720
css = 2560×1440 px), game scene golden preset, forced-sync renders
(readPixels), 30-frame averages. SwiftShader numbers are never used for fps.

| scenario | ms/frame |
|---|---|
| game, 61 drinks settled, GTAO on | 16.2 |
| game, 122 drinks (2× design load), GTAO on | 18.7 |
| lineup, 12 drinks, GTAO on | 14.9 |
| lineup, 12 drinks, GTAO off (`&lowpower=1`) | 9.5 |

Physics (`world.step` via stepTo, amortized): **0.13 ms/step at 61 drinks,
0.78 ms/step at 122** — the 4 ms budget has huge headroom; physics needs no
work.

Render is the whole problem. Breakdown implied by the table:
- **GTAO ≈ 5.4 ms** at dpr 2 — the single biggest lever.
- Baseline full-screen stack (main render + transmission pass + bloom chain +
  SMAA + output) ≈ 9.5 ms at 12 drinks; +~1.3 ms going 12 → 60 drinks
  (geometry/draw calls are NOT dominant on this GPU, resolution is).
- A 2020 integrated GPU is roughly 4–6× slower than this machine → ~40–60 ms
  at these settings. The design target (60 fps there) requires the mid tier
  below.

## Required optimization plan (perf milestone)

1. **Quality tiers** picked at boot (WEBGL_debug_renderer_info string +
   first-frames timing probe), user-overridable later:
   - high: dpr ≤ 2, GTAO on, transmissionResolutionScale 0.6, shadows 2048.
   - mid (2020 iGPU laptops): dpr ≤ 1.5, GTAO OFF, transmission 0.5,
     shadows 1024.
   - low (mid phones): dpr ≤ 1.25 with internal render scale ~0.8, GTAO off,
     transmission 0.5, shadows 1024, bloom low-res.
2. **Dynamic resolution**: EMA of frame time; scale composer/render size
   0.7–1.0× within the tier when over/under budget for >1 s.
3. **Draw-call diet**: merge static same-material sub-meshes per drink
   template (BufferGeometryUtils.mergeGeometries) — drinks are drawn ~3×
   (shadow + transmission + main); template mesh-count cuts multiply.
4. Never regress: milestones' visual quality on high tier; captures compare.

## Implemented 2026-08-21 (measured)

- Quality tiers: `src/render/quality.ts` (boot detection from the GL renderer
  string, `?quality=low|mid|high` override, harness defaults HIGH so captures
  stay pixel-stable). Settings exactly as §1; low additionally runs the bloom
  chain at half res. `window.__perf` = { tier, measure(frames), info(),
  templates() }; measure() is the forced-sync readPixels probe above.
- Dynamic resolution: `src/render/dynres.ts`, ticked in stage.render. EMA of
  wall dt; >17.5 ms for >1 s → scale ×0.9 (floor 0.7), <13 ms for >2 s →
  ÷0.9 (cap 1.0), 1 s cooldown, dead band between thresholds. Resizes
  composer + GTAO + bloom via the post.setSize path. Verified live (dev Mac,
  240-drink overload, merge pass off): scale walked 1.0 → 0.7 (dpr 2 → 1.4)
  and back to 1.0 after the load cleared, no oscillation.
- Draw-call diet: `src/drinks/lib/mergeStatic.ts` applied in buildDrink
  (`?mergeoff=1` disables). Template meshes 154 → 84 total
  (per tier 1..12: 6→3, 5→3, 7→4, 6→6, 8→5, 13→8, 5→5, 24→11, 11→7, 14→9,
  23→8, 32→15; liquid volume/cap and userData-flagged meshes are never
  merged). 61 settled drinks, high tier: **1966 → 1336 draw calls (−32%)**,
  triangles identical (3,553,607). Real-GPU frame time at 61 drinks
  (dev Mac, browser pane, dpr 2): 5.99 → 5.52 ms/frame; mid tier
  (GTAO off, dpr 1.5): 3.46 ms/frame, 801 calls.
