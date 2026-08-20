/**
 * THE MASS LADDER — the one table every impulse, friction stop, impact sound,
 * and camera nudge is driven through. Tune here, nowhere else.
 *
 * Design rules that produced these numbers:
 *  - Total span ~25x (0.20 -> 5.00 kg) per the design brief.
 *  - Every adjacent step is a ratio between 1.22x and 1.45x. Below ~1.2x two
 *    neighbouring tiers stop at indistinguishable distances under the same
 *    pull (J = k * pull * m^alpha means stop distance scales ~ m^(2*alpha-2));
 *    above ~1.5x the light tier feels like a toy next to the heavy one.
 *  - The ratio SHRINKS toward the top of the ladder (1.4x down low, 1.22x up
 *    high) because heavy drinks are read by their reluctance to move at all,
 *    not by their stop distance — the ear and eye need less mass contrast up
 *    there, and a full 1.4x ratio at 4 kg would make tier 12 unpushable.
 */
export const MASS_KG: Readonly<Record<number, number>> = {
  1: 0.20, //  juice box — a real 200 ml juice box is ~0.21 kg; the featherweight anchor of the ladder, full pull must stop 10-20% short of the far rail
  2: 0.28, //  slim can — 1.40x over juice box; a real 250 ml slim can is ~0.27 kg, and the step is big enough that the first upgrade already lands shorter
  3: 0.38, //  cola can — 1.36x; a real 330 ml can is ~0.37 kg; the tier the tutorial teaches with, so it sits near the middle of the light group's feel
  4: 0.55, //  stubby bottle — 1.45x, the biggest step on the ladder: paper/aluminum -> GLASS is the ladder's first material cliff and the mass jump sells it
  5: 0.75, //  highball + ice — 1.36x; a filled 300 ml tumbler with ice cubes really is ~0.7-0.8 kg; first tier that visibly shoves cans aside
  6: 1.00, //  mason jar — 1.33x; the 1 kg waypoint, halfway anchor of the ladder in log space; handle adds footprint so it also reads bigger at rest
  7: 1.40, //  coconut — 1.40x; a real drinking coconut is 1.2-1.6 kg; deliberately heavier than its size suggests, the "denser than it looks" surprise tier
  8: 1.90, //  pineapple cup — 1.36x; a whole pineapple is ~1.8-2 kg; last tier a full pull still carries past the table's midline
  9: 2.50, //  glass pitcher — 1.32x; 1.5 L of tea plus ~1 kg of glass; from here on drinks are pushed INTO, not pushed — they mostly receive momentum
  10: 3.30, // watermelon keg — 1.32x; a small hollowed melon plus tap hardware; the wall you bank light cans off without it giving an inch
  11: 4.10, // steel ice bucket — 1.24x; ratio narrows: at this weight reluctance-to-move reads the difference, stop distance no longer needs to
  12: 5.00, // drink dispenser — 1.22x over the bucket, 25x over the juice box; the ladder's ceiling — a full-pull juice box should barely rock it
}

/**
 * Impulse law: J = PUSH_K * pull01 * m^PUSH_ALPHA.
 *
 * ALPHA 0.92 — ABOVE the briefed 0.5-0.8 band (and above the 0.85 allowance),
 * and it has to be. Stop distance scales as m^(2a-2) / mu_eff, and the ladder
 * harness targets pin both ends AND the middle:
 *   - tier 1 full pull must stop 1.25-1.4 m out (10-20% short of the far rail)
 *   - tier 12 must still cross the midline (>= ~0.85 m)
 *   - stop distances must fall MONOTONICALLY through all 12 tiers
 * Friction is per SoundMaterial (physics/materials.ts), and GLASS backs tiers
 * 4, 5, 6, 9 and 12 — a 9.1x mass span sharing one mu. Within that group the
 * distance ratio is purely (m4/m12)^(2a-2) = 9.09^(2-2a); for tier 4 to land
 * below tier 3 (~1.2 m) while tier 12 still reaches ~0.86 m, 2-2a must be
 * <= ~0.16, i.e. ALPHA >= ~0.92. At the briefed 0.8 (or even 0.85) tier 4
 * would out-slide tier 1 by half a metre or tier 12 would die at ~0.55 m —
 * verified in the ladder harness, not just on paper. The band was written
 * assuming friction could fall freely with tier; the material table can't do
 * that with glass at both ends of the ladder.
 *
 * Consequences, measured in ?scene=ladder (capture --scene=ladder --state):
 *   - full-pull stops descend ~1.38 -> ~0.86 m; adjacent gaps 2.7-6.2 cm
 *     (biggest low on the ladder where stop distance is the weight-read;
 *     tiers 10-12 differ ~3 cm because up there reluctance-to-move reads the
 *     weight, per the MASS_KG rationale above)
 *   - launch speeds still fall with mass (v ~ m^-0.08 gives 3.0 -> 2.3 m/s),
 *     so heavier drinks read slower AND shorter, just less steeply than the
 *     original band assumed.
 *
 * PUSH_K 2.66 calibrated in the ladder harness: tier 1 full pull stops ~16%
 * short of the far rail, tier 12 crosses the midline by ~8 cm.
 */
export const PUSH_ALPHA = 0.92
export const PUSH_K = 2.66
