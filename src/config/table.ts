/**
 * The table + world coordinate contract. One table for the whole game.
 *
 * Axes: +Y up. The plank's LONG axis runs along Z; the camera sits at +Z
 * (the near, open end) looking toward -Z (the far rail). +X is the player's
 * right. All gameplay happens in table-surface coordinates.
 */
export const TABLE = {
  /** playfield half-extents (m): 1.8 m long (Z), 0.8 m wide (X) */
  HALF_W: 0.4,
  HALF_L: 0.9,
  /** table top height above the sand (m) */
  TOP_Y: 0.72,
  /** plank thickness (m) */
  THICKNESS: 0.05,
  /** rail height above the table top and rail thickness (m) */
  RAIL_H: 0.045,
  RAIL_T: 0.03,
  /** foul line distance from the near (open) edge (m) — brief: 25-30 cm */
  FOUL_FROM_NEAR: 0.28,
  /** launch cradle centre, distance from near edge (m) */
  CRADLE_FROM_NEAR: 0.12,
} as const

/** z of the near (open) edge */
export const NEAR_Z = TABLE.HALF_L
/** z of the far rail inner face */
export const FAR_Z = -TABLE.HALF_L
/** z of the foul line */
export const FOUL_Z = NEAR_Z - TABLE.FOUL_FROM_NEAR
/** z of the launch cradle centre */
export const CRADLE_Z = NEAR_Z - TABLE.CRADLE_FROM_NEAR
/** y of the table surface (top of plank) */
export const SURFACE_Y = TABLE.TOP_Y

/** seconds a resting drink may sit across the foul line before the run ends */
export const FOUL_GRACE_S = 2.5

/** speed below which a body counts as settled for turn advancement (m/s) */
export const SETTLE_SPEED = 0.06
/** max wait before the next drink arrives regardless of settling (s) */
export const TURN_TIMEOUT_S = 1.6
