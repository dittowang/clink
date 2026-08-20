# src/drinks/lib — procedural drink construction commons

Shared toolkit for all twelve drink builders. Everything is code — no asset
files. All dimensions are **metres**; drink origin is **base centre, +Y up**.

Verify every visual claim with the probe:

```
node scripts/capture.mjs --scene=probe --url-extra="&tier=5" --settle=2 --out=captures/tmp/x.png
```

Probe extras: `&tilt=9` leans the drink while the liquid plane stays level
(verifies your liquid rig), `&env=0.2`/`&key=7` override lighting while you
debug a material, `&shadowhelper=1` draws the shadow frustum.

## profiles.ts

`latheFromProfile(points, segments?, opts?)` builds a LatheGeometry from
hand-authored `[r, y]` control points via a CatmullRom curve (glass-like
fillets for free; **cluster points to keep a feature crisp** — the curve
rounds lonely corners). Points are sampled arc-length-spaced so texture `v`
is proportional to distance along the surface. 64 radial segments is the
default; use 96 for tiers the camera gets close to. LatheGeometry computes
correct smooth normals itself. `offsetProfile(points, inset)` shifts a
profile along its 2D normals — traversing bottom→top on an outer wall,
**positive inset moves inward**; use it to derive the inner glass wall
(inset = wall thickness) or the liquid surface (inset ≈ 0.0005).
`innerRadiusAt(profile, y)` returns the wall radius at a height (largest
crossing, so floor+wall profiles answer with the wall) — cap radii come from
this. `doubleWalledProfile(outer, wall, floorY)` composes outer wall → lip →
inner wall → floor → centre in one watertight-looking profile and also hands
back the inner profile ready for `buildLiquid`.

## canvas.ts

`makeCanvasTexture(w, h, paint, opts)` paints an offscreen canvas and wraps
it in a CanvasTexture. **Color maps: `srgb: true` (default). Roughness,
normal and height data: `srgb: false`** or lighting will be subtly wrong.
`repeat` sets RepeatWrapping. Label helpers: `paintBands` (the primary read —
bands ≥ 1/4 drink height), `paintGradient`, `paintRoundel`, `paintStar`,
`paintWave`, `paintText` (system font stack; decorative only — fine print is
not a primary read).

## noise.ts

`noiseCanvas(w, h, octaves, seed, opts)` — seeded, seamlessly tiling value
noise fBm as a grayscale canvas. `cellsX`/`cellsY` set the base lattice per
axis: asymmetric cells make streaks (brushed steel uses `cellsX: 3,
cellsY: 96`); `range: [lo, hi]` remaps contrast. `normalMapFromHeight(canvas,
strength)` converts any height canvas to a tangent-space normal map (tiling,
OpenGL convention). Deterministic per seed — looks never depend on load
order.

## materials.ts

Recipe factories, all MeshPhysicalMaterial: `glass`, `liquid`, `aluminum`,
`steel`, `paperboard`, `waxRind`. See THE BIG GOTCHA below before touching
`liquid` or any transmissive recipe.

- `glass({ wallThickness, tint?, roughness?, roughnessMap?, normalMap? })` —
  transmission 1, ior 1.5, `thickness` = the REAL wall thickness in metres
  (2–3 mm for a tumbler; it drives refraction depth, not opacity). Tint goes
  through attenuation, not `color`.
- `liquid({ color, attenuationDistance?, ior?, roughness?, transmissive? })`
  — FrontSide, clipShadows false, clipIntersection false; the instance code
  (`instantiateDrink`) clones it and assigns the world clipping plane.
- `aluminum({ labelTexture })` — metal 1 / rough 0.3 under clearcoat 0.6:
  printed lacquer. `steel({ anisotropy })` — brushed-streak roughness canvas
  + anisotropic highlight. `paperboard({ labelTexture })` — rough 0.85.
  `waxRind({ map })` — clearcoat 0.9 for melon/pineapple skins.

### THE BIG GOTCHA — transmission is single-layer

three renders the transmission buffer from **opaque objects only**. Anything
transmissive (or transparent) is INVISIBLE through a transmissive surface.
A/B verified on the highball: `transmissive: true` juice inside the glass
renders as an **empty glass with levitating ice**
(the juice is simply absent behind the wall).

Consequences, baked into the defaults:

- **Liquid inside glass must be opaque-pass** (`transmissive: false`, the
  default). Fake the body with `color` + low roughness + clearcoat. The
  surface cap is lightened ~12% automatically (`capLighten`) to sell the
  liquid surface.
- **Ice inside glass must be opaque-pass** → the default `iceMaterial()` is
  a frosted recipe. Pass `transmissive: true` ONLY where nothing transmissive
  sits in front (e.g. cubes heaped above a steel bucket's rim).
- Glass in front of glass shows the background, not the second glass — keep
  compositions single-walled toward the camera (a lathe with outer+inner
  walls is fine: that is one transmissive surface).

## condensation.ts

`makeCondensation(w, h, seed, opts)` → `{ roughnessMap, normalMap }`.
Hundreds of droplets (big sparse + small dense + a few run streaks) painted
into a height canvas; the roughness map is a hazy base with SMOOTH (dark)
droplet spots, the normal map makes droplets catch the key light. Layer both
onto `glass()` (set `repeat` ≈ 2×1 for a tumbler). Droplet radii are
resolution-independent (scaled to canvas height). Tuning: `baseRoughness`
0.08–0.12 — **above ~0.2 the fog eats the whole glass read**; 512×1024 is
plenty at game distance (the highball's 768×1536 is close-up vanity — share
one set of maps across cold tiers rather than one per tier if VRAM matters).

## parts.ts

`bentStraw({ bottom, bendStart, tip, radius?, color?, stripe? })` — tube
along a CatmullRom path with the classic tight elbow; `stripe` paints candy
stripes. Keep the tip inside the tier's footprint radius.
`iceCubeGeometry(size)` + `iceMaterial({ transmissive? })` + `scatterIce({
count, surfaceY, spreadRadius, seed })` — cubes share ONE geometry and ONE
material; variance is per-mesh scale/rotation. Centres sit just under
`surfaceY` so tilted corners break the liquid surface.
`paperUmbrella({ radius, pleats, colors, stickLength })` — faceted pleated
canopy + stick, origin at stick bottom. `pullTab()` — extruded stadium shape
with finger + rivet holes, lying flat, rivet at origin. `handle({ radius,
tube, arc })` — torus arc for mugs/pitchers.

## liquid.ts

`buildLiquid(innerProfile, fillY, tintOpts, opts?)` → `{ volumeMesh, capMesh,
spec }`. Builds the liquid volume lathe from the INNER glass profile inset
0.5 mm, plus a cap disc of `innerRadiusAt(fillY)`. Marks
`userData.liquidVolume` / `userData.liquidCap` so `instantiateDrink` finds
them. **The volume wall runs 4 mm ABOVE fillY** and closes on top, so a
tilted clipping plane always cuts solid wall, never an open edge. Add the
returned meshes to your template and return `spec` as `DrinkVisual.liquid`.

### Clipping plane conventions (game + probe)

- The plane is **world-space** and belongs to the INSTANCE:
  `instantiateDrink` clones liquid materials and assigns
  `plane = Plane(normal (0,-1,0), constant)`.
- `constant` = world y of the liquid surface: points with
  `normal·p + constant ≥ 0` (i.e. `y ≤ constant`) survive.
- The cap material gets NO planes; the game positions/orients the cap disc to
  lie in the plane (probe's `&tilt=` shows the counter-rotation math).
- `clipShadows` stays false: the volume's shadow is cast unclipped, which is
  invisible in practice because the overhang is 4 mm.

## Worked example — tiers/highball.ts (tier 5, THE reference glass)

1. **One lathe, honest walls**: control points run recess → foot ring → up
   the outside (subtle 1.5 mm taper) → rounded lip at h=0.150 → down the
   inside (2.5 mm wall) → floor fillet → 10 mm-thick floor → centre.
   96 radial segments. `glass({ wallThickness: 0.0025, condensation maps,
   envMapIntensity 1.5 })`. **glassMesh.castShadow = false** — a transmissive
   mesh casting a solid black blob is a lie; let the liquid cast instead.
2. **Juice**: `buildLiquid(innerProfile, 0.105, { color 0xef6402, roughness
   0.06 })`. The 0.5 mm inset + 2.5 mm wall puts the meniscus visibly INSIDE
   the glass — check it at the surface line in captures.
3. **Ice**: `scatterIce({ count: 4, size: 0.021, surfaceY: fillY + 0.003 })`
   — centres just under the surface, corners breaking it, frosted material.
4. **Straw**: bright, candy-striped, elbow above the rim, tip inside r=0.041.
5. Template order/flags: liquid volume + cap + ice + straw cast shadows;
   glass does not; nothing receives.

## Tuning notes (hard-won)

- **attenuationDistance is metres of liquid that matter**: 0.02 reads
  opaque-juicy, 0.05–0.1 is tinted glass, 0.2+ is watery. Only does anything
  when transmission > 0 — for opaque-pass liquids put the read into `color`.
- **AgX tone mapping desaturates**: author juice/label colors 10–20% more
  saturated than the target. Cream-on-cream compositions die; keep value
  contrast between drink and backdrop.
- **roughnessMap uses the GREEN channel** and multiplies the scalar — when a
  map carries absolute values, set `roughness: 1`.
- **Key light placement in the probe**: a frontal key hides the cast shadow
  BEHIND the drink; from upper camera-left (~33° elevation) the form gets
  raked and the shadow falls right where the pedestal shows it. If a "shadow
  disappears", check where it lands before touching the shadow camera.
- Droplet visibility comes from the NORMAL map (glints), not the roughness
  contrast; `normalScale` ~0.85 at close-up, less at game distance.
- LatheGeometry seams/normals are handled internally — never call
  `computeVertexNormals()` on a lathe, it will crease the seam.
