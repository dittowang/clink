import type * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { TierId, TierDef } from '../config/tiers'

export type DrinkState =
  | 'tray'     // waiting on the in-world tray (visual only, no body)
  | 'cradle'   // in the launch cradle, aimable
  | 'live'     // simulated on the table
  | 'merging'  // kinematic, snapping to centroid
  | 'serving'  // kinematic, collider off, carried off to the service side (orders)
  | 'sand'     // fell off the open edge, rotations unlocked, dying in the sand
  | 'dead'     // removed

/**
 * THE entity: tier + rigid body + collider + interpolated render root +
 * wobble rig + liquid rig. Everything that touches a drink goes through this.
 */
export interface Drink {
  id: number
  tier: TierId
  def: TierDef
  state: DrinkState

  body: RAPIER.RigidBody
  collider: RAPIER.Collider

  /** pose interpolation targets — written by physics fixedUpdate only */
  prevPos: THREE.Vector3
  currPos: THREE.Vector3
  prevRot: THREE.Quaternion
  currRot: THREE.Quaternion

  /** interpolated pose goes here; never touched by anything else */
  root: THREE.Group
  /** child of root; lean/wobble spring writes its rotation. render-only. */
  visual: THREE.Group

  /** damped-spring lean state (radians around X and Z) */
  lean: { rx: number; rz: number; vrx: number; vrz: number }
  /** previous fixed-step linvel, for acceleration estimation */
  lastVel: THREE.Vector3

  /** liquid rig — world clipping plane + cap disc, updated from lean */
  liquid: LiquidRig | null

  /** last fixed-step speed, cached for settle checks and slide audio */
  speed: number
  /** seconds this drink has been at rest beyond the foul line */
  foulTime: number
  /** merge bookkeeping: time of most recent same-tier contact */
  lastSameTierContact: number
}

export interface LiquidRig {
  /** meshes whose materials carry the clipping plane (liquid volume + cap) */
  volume: THREE.Mesh
  cap: THREE.Mesh
  /** world-space plane, rewritten every frame from pose + lean */
  plane: THREE.Plane
  /** local fill height (m above drink origin) */
  fillY: number
  /** cap radius at fill height (m) */
  capRadius: number
}

let nextId = 1
export function allocDrinkId(): number { return nextId++ }
export function resetDrinkIds(): void { nextId = 1 }
