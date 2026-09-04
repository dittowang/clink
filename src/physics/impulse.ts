import { TARGET_STOP_M, MASS_KG } from '../config/massLadder'
import { TIERS, type TierId } from '../config/tiers'
import { tableFriction, LINEAR_DAMPING } from './materials'
import { applyLaunchLeanKick } from './feel'
import type { Drink } from '../core/drink'

/**
 * The launch law and its honest inverse. pull01 maps to motion through THIS
 * FILE ONLY — nothing in the game ever calls setLinvel to move a drink.
 */

const GRAVITY = 9.81

/**
 * Full-pull launch speed per tier: the v0 whose free slide (friction +
 * damping model below) stops exactly TARGET_STOP_M out. Solved once per tier
 * by bisection on stopDistanceForSpeed and cached — the launch law is
 * "same stopping point for every drink", so J = m * v0 (heavier = harder).
 */
const fullSpeedCache = new Map<TierId, number>()

function fullLaunchSpeed(tier: TierId): number {
  let v = fullSpeedCache.get(tier)
  if (v === undefined) {
    let lo = 0, hi = 8
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (stopDistanceForSpeed(tier, mid) < TARGET_STOP_M) lo = mid
      else hi = mid
    }
    v = (lo + hi) / 2
    fullSpeedCache.set(tier, v)
  }
  return v
}

/** Launch speed for a pull: v0 = pull01 * fullLaunchSpeed (m/s). */
export function launchSpeed(tier: TierId, pull01: number): number {
  const p = Math.min(Math.max(pull01, 0), 1)
  return p * fullLaunchSpeed(tier)
}

/** J = m * v0 (N·s). The one impulse formula. */
export function launchImpulse(tier: TierId, pull01: number): number {
  return MASS_KG[tier] * launchSpeed(tier, pull01)
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
  return stopDistanceForSpeed(tier, launchSpeed(tier, pull01))
}

/** free-slide distance for a given launch speed (the model above) */
export function stopDistanceForSpeed(tier: TierId, v0: number): number {
  if (v0 <= 0) return 0
  const a = tableFriction(TIERS[tier].material) * GRAVITY
  const c = LINEAR_DAMPING
  if (c < 1e-6) return (v0 * v0) / (2 * a)
  const x = (c * v0) / a
  return (a / (c * c)) * (x - Math.log(1 + x))
}
