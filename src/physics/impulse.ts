import { PUSH_K, PUSH_ALPHA, MASS_KG } from '../config/massLadder'
import { TIERS, type TierId } from '../config/tiers'
import { tableFriction, LINEAR_DAMPING } from './materials'
import { applyLaunchLeanKick } from './feel'
import type { Drink } from '../core/drink'

/**
 * The launch law and its honest inverse. pull01 maps to motion through THIS
 * FILE ONLY — nothing in the game ever calls setLinvel to move a drink.
 */

const GRAVITY = 9.81

/** J = PUSH_K · pull01 · m^PUSH_ALPHA (N·s). The one impulse formula. */
export function launchImpulse(tier: TierId, pull01: number): number {
  const p = Math.min(Math.max(pull01, 0), 1)
  return PUSH_K * p * Math.pow(MASS_KG[tier], PUSH_ALPHA)
}

/** Launch speed the impulse produces: v0 = J / m (m/s). */
export function launchSpeed(tier: TierId, pull01: number): number {
  return launchImpulse(tier, pull01) / MASS_KG[tier]
}

// scratch — applyImpulse copies the values, safe to reuse
const _imp = { x: 0, y: 0, z: 0 }

/**
 * Apply the launch impulse in the table plane and arm CCD on the body.
 * Angle convention (matches HarnessApi.push): measured FROM THE −Z AXIS
 * (straight at the far rail), positive rotating TOWARD +X (player's right).
 *   dir = (sin a, 0, −cos a)
 */
export function applyLaunch(drink: Drink, angleRad: number, pull01: number): void {
  const j = launchImpulse(drink.tier, pull01)
  const dx = Math.sin(angleRad)
  const dz = -Math.cos(angleRad)
  _imp.x = dx * j
  _imp.y = 0
  _imp.z = dz * j
  drink.body.applyImpulse(_imp, true)
  // a full-pull can moves ~25 mm per 120 Hz step — CCD is cheap insurance
  // against clipping a 30 mm rail or a thin drink at launch speed
  drink.body.enableCcd(true)
  // render-only: rock the visual BACK against the launch acceleration (the
  // one-step Δv spike is invisible to the per-frame accel estimate — see feel.ts)
  applyLaunchLeanKick(drink, dx, dz, j / MASS_KG[drink.tier])
}

/**
 * Predicted slide distance for the aim marker AND the ladder log — one
 * formula, so the marker is exactly as honest as the harness says it is.
 *
 * Model: dv/dt = −μ_eff·g − c·v with μ_eff from the Average combine rule
 * (materials.ts) and c = LINEAR_DAMPING. Closed form:
 *   x = c·v0 / (μg),  d = (μg / c²)·(x − ln(1 + x))
 * which limits to the familiar v0²/(2 μ_eff g) as c → 0 (damping trims ~4%
 * at full pull). Ladder captures show the Rapier solver tracks this within
 * a few percent, so no fudge factor is applied.
 */
export function predictStopDistance(tier: TierId, pull01: number): number {
  const v0 = launchSpeed(tier, pull01)
  if (v0 <= 0) return 0
  const a = tableFriction(TIERS[tier].material) * GRAVITY
  const c = LINEAR_DAMPING
  if (c < 1e-6) return (v0 * v0) / (2 * a)
  const x = (c * v0) / a
  return (a / (c * c)) * (x - Math.log(1 + x))
}
