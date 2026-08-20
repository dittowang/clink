import type { Drink } from '../core/drink'

/**
 * Fixed-step → render-frame pose interpolation. The scheduler steps physics
 * at 1/120 and hands the render layer an alpha; drawing at the blend between
 * the previous and current solver poses is what makes sliding judder-free at
 * any refresh rate. Writes drink.root ONLY — the wobble spring owns
 * drink.visual and physics never sees either.
 *
 * lerpVectors / slerpQuaternions write in place: zero allocation.
 */
export function applyInterpolatedPose(drink: Drink, alpha: number): void {
  drink.root.position.lerpVectors(drink.prevPos, drink.currPos, alpha)
  drink.root.quaternion.slerpQuaternions(drink.prevRot, drink.currRot, alpha)
}
