import type { SoundMaterial } from '../config/tiers'

/**
 * Contact material table — friction/restitution per SoundMaterial plus the
 * table wood, all inside the brief bands (friction 0.25–0.55, restitution
 * 0.10–0.35). Rapier combines pairs with the AVERAGE rule, so the effective
 * table friction for a drink is (mat.friction + TABLE_WOOD.friction) / 2 —
 * `tableFriction()` below is THE formula; the aim marker and the ladder log
 * both go through it.
 *
 * WHY THE FRICTION COLUMN IS NEARLY FLAT: stop distance ∝ 1/μ_eff, and the
 * ladder harness targets (tier 1 stops 10–20% short of the far rail, tier 12
 * still crosses the midline, every adjacent pair visibly shorter) pin the
 * μ ratios between materials to within a few percent — glass alone spans
 * tiers 4→12 (9.1× mass), so any big per-material friction spread breaks the
 * monotonic stop-distance ladder. Material CHARACTER therefore lives in
 * restitution and, later, the audio recipes; friction is a legibility knob.
 */
export interface ContactMaterial {
  friction: number
  restitution: number
}

/**
 * The plank. friction 0.30 = varnished pine with sand dust — mid-band, every
 * μ_eff below is (mat + 0.30)/2. restitution 0.18: wood has a little knock in
 * it, so cans landing from the spawn drop give an audible tick (impact events)
 * without ever visibly bouncing.
 */
export const TABLE_WOOD: ContactMaterial = { friction: 0.3, restitution: 0.18 }

export const MATERIALS: Readonly<Record<SoundMaterial, ContactMaterial>> = {
  // friction 0.340 — grippiest surface on the ladder (dry card drags on wood).
  //   Sets μ_eff = 0.320; being ~1% over aluminum keeps the tier-1 slide the
  //   longest without stealing the tier-1→2 step. restitution 0.10 — band
  //   floor: a juice box lands DEAD, the dullest thud in the game.
  paper: { friction: 0.34, restitution: 0.1 },
  // friction 0.335 — μ_eff 0.3175, deliberately 2.4% above glass: that gap is
  //   what keeps the tier-3→4 (can → bottle) step readable, because the 1.45×
  //   mass jump alone would be partly eaten by glass being slicker.
  //   restitution 0.24 — mid-band: can-into-can reads as a crisp click, and
  //   the restitution contrast vs glass (0.12) is what the audio system later
  //   leans on for "click vs shove".
  aluminum: { friction: 0.335, restitution: 0.24 },
  // friction 0.320 — slickest: condensation-wet glass on varnish. Glass backs
  //   tiers 4,5,6,9,12; this single low value is what lets the 5 kg dispenser
  //   still cross the midline at full pull. restitution 0.12 — near-floor:
  //   a pitcher pushed into cans is a dull shove, momentum transfer with
  //   almost no rebound.
  glass: { friction: 0.32, restitution: 0.12 },
  // friction 0.320 — fibrous but round-bottomed; matched to glass so the
  //   mason-jar → coconut step is carried by the 1.40× mass jump alone.
  //   restitution 0.16 — slightly livelier than glass: husk knocks.
  husk: { friction: 0.32, restitution: 0.16 },
  // friction 0.320 — waxy fruit skin, matched to glass (tiers 8/10 sandwich
  //   glass tier 9 — any friction offset would un-sort the 8→9→10 stops).
  //   restitution 0.14 — heavy wet fruit, barely bouncier than glass.
  rind: { friction: 0.32, restitution: 0.14 },
  // friction 0.320 — polished steel, matched to glass so the bucket→dispenser
  //   step stays monotone. restitution 0.32 — highest on the ladder (band top
  //   is 0.35): steel RINGS, and the visible little rebound when cans hit the
  //   bucket is the material's signature.
  steel: { friction: 0.32, restitution: 0.32 },
}

/**
 * Off-table sand. Scenery, not gameplay — deliberately outside the brief band:
 * high friction + near-zero restitution so fallen drinks die where they land.
 */
export const SAND: ContactMaterial = { friction: 0.8, restitution: 0.02 }

/**
 * Linear damping on drink bodies. 0.08 trims only ~4% off a full-pull slide —
 * friction does the stopping (billiards, not air hockey) — but it kills the
 * infinitesimal residual creep Coulomb solvers leave and makes settle checks
 * converge crisply. predictStopDistance() accounts for it in closed form.
 */
export const LINEAR_DAMPING = 0.08

/** Effective drink-vs-table friction under Rapier's Average combine rule. */
export function tableFriction(mat: SoundMaterial): number {
  return (MATERIALS[mat].friction + TABLE_WOOD.friction) / 2
}
