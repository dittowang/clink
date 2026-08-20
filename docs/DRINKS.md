# The twelve drinks — art direction

The player looks at these ninety percent of the time. Each is built at
product-shoot quality: honest silhouettes, honest materials, labels that read
as color blocks at 40–120 px. Dimensions (radius/height) are LAW — they come
from `src/config/tiers.ts` and the physics collider is a cylinder of exactly
that radius/height with base-center origin.

Global rules:
- Rotationally symmetric bodies are `LatheGeometry` from hand-authored
  CatmullRom profiles (12–24 control points) — shoulder, neck, lip, foot
  recess IN THE CURVE. Use `src/drinks/lib/profiles.ts`.
- Glass is double-walled (outer profile over the lip and down the inside);
  material `thickness` = the real wall gap. Liquid comes from
  `lib/liquid.ts`, built on the INNER profile, never coincident with glass.
- Cold tiers (see tiers.ts) get `lib/condensation.ts` maps on the outer wall.
- Labels via `lib/canvas.ts`: color bands ≥ ¼ of drink height + roundels.
  Text is decoration; the color block is the read.
- Every mesh casts shadow; glass casts shadow (opacity handled by material).
- Budget: ≤ ~12k triangles per drink template, shared materials within the
  template wherever possible.

Silhouette contract (black-fill test at 128 px must distinguish neighbours):

| # | drink | silhouette signature vs neighbour |
|---|-------|------------------------------------|
| 1 | juice box | rectangular brick + straw kink |
| 2 | slim can | tall slender cylinder, necked top |
| 3 | cola can | shorter & fatter cylinder (height AND width vs 2) |
| 4 | soda bottle | shoulder + neck + crown cap (new top shape, taller) |
| 5 | highball | open-top tumbler, straw, no neck |
| 6 | mason jar | screw shoulder + LOOP HANDLE |
| 7 | coconut | squat organic sphere |
| 8 | pineapple | tall barrel + spiky leaf crown |
| 9 | pitcher | belly + SPOUT + big handle |
| 10 | watermelon | huge squat striped sphere + tap nub |
| 11 | ice bucket | flared cone + three bottle necks poking out |
| 12 | dispenser | tall ribbed jar on a stand, lid knob |

Per-tier specs:

**1 · Juice box** (paper, r .026 h .105) — Tetra-brick with slightly rounded
edges (box ~.037×.037×.105 fits the collider circle), pinched top seam with
two tiny side ears, glossy bent straw (Tube along CatmullRom, elbow ribs
implied by a slight kink) rising from a corner. Paperboard material, matte.
Label: warm orange body band (≥ half height), cream top, roundel with a
simple orange-slice motif (two-tone circle + wedge lines), playful name text.

**2 · Slim can** (aluminum, r .029 h .134) — tall 250 ml slim. Profile: flat
bottom with rim chamfer, straight wall, gentle neck-in at 88% height, torus
top rim, recessed lid disc with a pull-tab (Extrude from a stadium Shape with
two holes). Lacquered print: white upper third, deep teal lower band with
thin wave stripes, tiny roundel. Brushed bare aluminum top/bottom margins.

**3 · Cola can** (aluminum, r .033 h .116) — classic 330 ml. Wider, shorter;
bottom dome recess hinted by foot torus; same tab construction as 2. Print:
signature red all over, one bold white ribbon swash band across the middle,
white circular roundel on the back side. Slight condensation (cold).

**4 · Stubby soda bottle** (glass, r .037 h .185) — brown AMBER glass, stubby
70s proportions: wide low body (60% of height), fast shoulder, short neck,
crown cap (cylinder + fluted skirt: 21 tiny scallops via a scaled star
profile or normal-mapped ring), paper band label mid-body (cream, red
roundel, thin gold pinstripes). Dark cola liquid inside (deep attenuation, it
should read nearly black-brown with ruby edges against the sun).

**5 · Highball of OJ** (glass, r .041 h .150) — the reference build (already
done in lib milestone): clear glass, slight taper, foot recess, orange juice
(shallow attenuation ~2 cm), 4 ice cubes at the surface, bright straw,
condensation. Refine to match its neighbours' finish level if needed.

**6 · Mason-jar lemonade** (glass, r .048 h .170) — jar body with the classic
shoulder, 3 thread ridges (small tori or lathe bumps), matte STEEL screw band
at the top (no lid — open jar), C-shaped mug handle (torus arc, glass
material) on the +X side, cloudy pale-yellow lemonade (higher roughness on
liquid, attenuation medium), 3 ice cubes, straw, a lemon wheel clipped to the
rim (flat cylinder, canvas texture: rind ring + pulp wedges).

**7 · Coconut** (husk, r .058 h .140) — icosahedron(3) displaced by fBm
(±8%), squashed to 0.78 height ratio, three faint darker ridge bands running
pole-to-pole (paint into the color map), fibrous normal map (directional
streak noise), brown husk color ramp. Top sliced flat: white flesh ring
(annulus), dark coconut-water disc inside (deep attenuation look via plain
dark glossy disc), straw. NO umbrella (that is the pineapple's).

**8 · Pineapple cup** (rind, r .066 h .260) — body is a lathe barrel
(bulging middle, both ends tucked), diamond-pattern normal map built
procedurally (two crossing sets of diagonal grooves + a dot at each cell
center) + warm golden-brown color map with per-cell tone jitter; crown of
10–14 leaves: Extrude/Shape blades, two rings (tall inner ring, splayed outer
ring), slight random yaw/pitch per leaf, top cut carries a paper umbrella
(pleated cone, visible bamboo stick, tilted 20°) and a straw. Leaves may
exceed the collider height a little (soft visual overlap is fine).

**9 · Glass pitcher of iced tea** (glass, r .075 h .240) — big-bellied
profile (widest at 45%), pinched SPOUT at the front rim (scale a 30° arc of
the rim outward+down, or add a shaped lip piece), large D-handle opposite
(torus arc, glass), amber tea (attenuation deep, warm), 5 ice cubes, two
lemon wheels pressed against the inside wall (visible through glass),
condensation.

**10 · Watermelon keg** (rind, r .095 h .200) — melon = sphere squashed to
0.72, wavy dark/light green stripes (12–14 meridian stripes with jittered
edges painted on canvas) under a waxy clearcoat; sits on a tiny wooden
X-cradle (two crossed planks, reuse wood tones); top cut open: pink flesh
annulus + slightly sunken pink disc with seed specks; brass/steel TAP at the
front lower third (small lathe: flange, barrel, downturned nozzle, lever).

**11 · Steel ice bucket** (steel, r .110 h .230) — truncated cone flaring
upward (bottom r ≈ .082, top r ≈ .110), rolled lip (torus), two side ring
handles on small mounts, brushed steel: anisotropic roughness streaks
(horizontal brush canvas), subtle vertical panel seams. Filled above the rim
with an ice heap (12–16 RoundedBox cubes, shared material) and THREE bottle
necks (short amber/green glass neck+shoulder stubs with foil caps — gold,
red, green) leaning at different angles. The heap and necks are one merged
visual cluster; keep polycount sane.

**12 · Glass drink dispenser** (glass, r .130 h .360) — the boss. Short
wooden stand (4 chunky legs + ring skirt, wood tones) raising the jar ~5 cm;
jar: fat cylinder with 24 vertical RIBS (lathe profile with radial wave via
scaling lathe points per segment — or normal-map ribs + 8 real ribs),
shoulder to a wide mouth, STEEL lid (shallow dome + knob); front spigot near
the jar bottom (steel lathe + lever + short spout); sunset-orange agua fresca
filling 70%, two orange wheels + one lime wheel pressed flat against the
inside wall, ice cubes at the surface. This must read as HEAVY: thick glass
(4 mm), wide stance, dense liquid color.

Verification loop per drink (the artist agent runs it, not assumes it):
```
node scripts/capture.mjs --scene=probe --url-extra="&tier=N" --settle=2 --out=captures/tmp/tierN.png
node scripts/capture.mjs --scene=lineup --url-extra="&only=N-1,N,N+1" --out=captures/tmp/nbrN.png
node scripts/capture.mjs --scene=lineup --url-extra="&silhouette=1" --out=captures/tmp/sil.png
```
Done means: material truth at close-up, the neighbour shot shows two visibly
different objects, and the silhouette strip stays fully identifiable.
