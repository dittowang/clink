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
