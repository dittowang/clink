import * as THREE from 'three'
import { FIXED_DT } from '../core/scheduler'
import { MASS_KG } from '../config/massLadder'
import { TIER_IDS } from '../config/tiers'
import type { Drink } from '../core/drink'

/**
 * Render-only lean/slosh. Reads the fixed-step pose history on the entity,
 * writes drink.visual rotation and the liquid clipping plane. PHYSICS NEVER
 * SEES ANY OF THIS — the collider stays a perfectly upright cylinder.
 */

const DEG = Math.PI / 180

/**
 * Second-order damped spring: x'' = ω²(target − x) − 2ζω x'.
 * 3 Hz natural frequency (brief band 2–4): fast enough that the lean reads as
 * a reaction to THIS shove, slow enough to see. ζ = 0.42 (band 0.3–0.5):
 * underdamped, so a launch produces one visible counter-wobble before the
 * drink settles into its steady sliding lean.
 * Semi-implicit Euler — stable for ω·dt < 2, i.e. any dt below ~0.1 s.
 */
export class LeanSpring {
  readonly omega: number
  readonly zeta: number

  constructor(freqHz = 3.0, zeta = 0.42) {
    this.omega = 2 * Math.PI * freqHz
    this.zeta = zeta
  }

  advance(lean: Drink['lean'], targetRx: number, targetRz: number, dt: number): void {
    const w = this.omega
    const d = 2 * this.zeta * w
    lean.vrx += (w * w * (targetRx - lean.rx) - d * lean.vrx) * dt
    lean.vrz += (w * w * (targetRz - lean.rz) - d * lean.vrz) * dt
    lean.rx += lean.vrx * dt
    lean.rz += lean.vrz * dt
  }
}

/**
 * Max lean per tier, radians. 4° for the juice box shrinking to 1.6° for the
 * dispenser via 1 − 0.6·log(m/m₁)/log(m₁₂/m₁): heavier drinks lean LESS —
 * a 5 kg dispenser that tipped like a juice box would read as papier-mâché.
 * Stays inside the briefed 1–4° clamp for every tier.
 */
const LEAN_MAX: number[] = (() => {
  const arr = new Array<number>(13).fill(0)
  const logSpan = Math.log(MASS_KG[12] / MASS_KG[1])
  for (const t of TIER_IDS) {
    arr[t] = 4 * DEG * (1 - 0.6 * (Math.log(MASS_KG[t] / MASS_KG[1]) / logSpan))
  }
  return arr
})()

/**
 * Lean gain: 0.8° per m/s². Steady sliding decel is μg ≈ 3.1 m/s² → ~2.5° of
 * lean mid-slide on light tiers (visible but not cartoonish); the one-step
 * launch spike (hundreds of m/s²) just pins the target at LEAN_MAX for a
 * frame, which is exactly the "kick" the hand wants to see.
 */
const ACCEL_TO_LEAN = 0.8 * DEG

/** Liquid tilts ~1.8× the container lean — the liquid overshoots the glass. */
const LIQUID_OVERSHOOT = 1.8

const spring = new LeanSpring()

// scratch — reused every call, zero per-frame allocation
const _euler = new THREE.Euler()
const _n = new THREE.Vector3()
const _p = new THREE.Vector3()

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Advance the lean spring for one rendered frame and write the visual rig.
 *
 * Acceleration is estimated purely from fixed-step data already on the
 * entity: this step's velocity comes from the pose pair
 * (currPos − prevPos)/FIXED_DT and the previous step's velocity is
 * drink.lastVel (written by PhysicsWorld.step) — no wasm calls, no allocation.
 *
 * Lean is AGAINST the acceleration (inertia: shove a glass forward and the
 * top lags back): +Z accel → −rx (top toward −Z), +X accel → +rz (top
 * toward −X).
 */
export function updateFeel(drink: Drink, dtFrame: number): void {
  const inv = 1 / FIXED_DT
  const vx = (drink.currPos.x - drink.prevPos.x) * inv
  const vz = (drink.currPos.z - drink.prevPos.z) * inv
  const ax = (vx - drink.lastVel.x) * inv
  const az = (vz - drink.lastVel.z) * inv

  const max = LEAN_MAX[drink.tier]
  const targetRx = clamp(-az * ACCEL_TO_LEAN, -max, max)
  const targetRz = clamp(ax * ACCEL_TO_LEAN, -max, max)

  // clamp dt: a hitchy 200 ms frame must not slingshot the spring
  const dt = Math.min(dtFrame, 0.05)
  if (dt > 0) spring.advance(drink.lean, targetRx, targetRz, dt)

  drink.visual.rotation.x = drink.lean.rx
  drink.visual.rotation.z = drink.lean.rz

  if (drink.liquid) updateLiquidPlane(drink)
}

/**
 * Rewrite the world-space clipping plane and the cap disc from the lean.
 * Plane normal points DOWN (three.js clips fragments with negative signed
 * distance, so a down normal through the fill point keeps liquid below it),
 * tilted by LIQUID_OVERSHOOT × lean. The plane passes through the fill point
 * in world space: root is the body CENTER, the drink origin (base) sits
 * height/2 below it, fillY is measured from the base.
 *
 * The cap disc lives inside the visual group (already rotated by 1× lean),
 * so its local extra tilt is (OVERSHOOT − 1)× lean, at local height fillY.
 */
function updateLiquidPlane(drink: Drink): void {
  const liq = drink.liquid!
  const over = LIQUID_OVERSHOOT
  _euler.set(drink.lean.rx * over, 0, drink.lean.rz * over)
  _n.set(0, -1, 0).applyEuler(_euler)
  _p.set(
    drink.root.position.x,
    drink.root.position.y - drink.def.height / 2 + liq.fillY,
    drink.root.position.z
  )
  liq.plane.setFromNormalAndCoplanarPoint(_n, _p)

  const residual = over - 1
  liq.cap.position.set(0, liq.fillY, 0)
  liq.cap.rotation.set(drink.lean.rx * residual, 0, drink.lean.rz * residual)
}
