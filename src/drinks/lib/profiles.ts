import * as THREE from 'three'

/**
 * Lathe-profile toolkit. A profile is a hand-authored list of [r, y] control
 * points in METRES, ordered along the surface path (for glassware: up the
 * outside, over the lip, down the inside, across the inner floor to the
 * centre). A CatmullRom curve through the points gives glass-like fillets for
 * free; sharp features are kept crisp by clustering control points.
 */
export type ProfilePoint = readonly [r: number, y: number]

export interface ProfileOpts {
  /** samples along the curve (arc-length spaced). 48–96 is the house range. */
  samples?: number
  /** CatmullRom tension: 0.5 = soft glass fillets, 0 = looser, 1 = tighter */
  tension?: number
}

/** CatmullRom through the control points, in the (r, y) plane. */
export function profileCurve(points: readonly ProfilePoint[], tension = 0.5): THREE.CatmullRomCurve3 {
  const v = points.map(([r, y]) => new THREE.Vector3(Math.max(0, r), y, 0))
  return new THREE.CatmullRomCurve3(v, false, 'catmullrom', tension)
}

/**
 * Sample the profile curve into arc-length-spaced Vector2s. Arc-length
 * spacing matters: LatheGeometry assigns v by point index, so this keeps
 * texture v proportional to distance along the surface.
 */
export function sampleProfile(
  points: readonly ProfilePoint[],
  samples = 72,
  tension = 0.5
): THREE.Vector2[] {
  const curve = profileCurve(points, tension)
  return curve.getSpacedPoints(samples).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y))
}

/**
 * The one lathe builder every drink uses. Radial `segments` default 64
 * (rim close-ups want 96). LatheGeometry computes smooth per-profile normals
 * and merges the seam itself — nothing extra needed.
 */
export function latheFromProfile(
  points: readonly ProfilePoint[],
  segments = 64,
  opts: ProfileOpts = {}
): THREE.LatheGeometry {
  const pts = sampleProfile(points, opts.samples ?? 72, opts.tension ?? 0.5)
  return new THREE.LatheGeometry(pts, segments)
}

/**
 * Offset a profile along its 2D normals. Convention: traversing the profile
 * bottom→top on an outer wall (tangent ≈ +y), a POSITIVE inset moves INWARD
 * (toward the axis). Used to derive the inner glass wall from the outer
 * (inset = wall thickness) and the liquid surface from the inner wall
 * (inset ≈ 0.0005). Radii are clamped ≥ 0.
 */
export function offsetProfile(points: readonly ProfilePoint[], inset: number): ProfilePoint[] {
  const n = points.length
  const out: ProfilePoint[] = []
  let lastNx = -1
  let lastNy = 0
  for (let i = 0; i < n; i++) {
    const [pr, py] = points[Math.max(0, i - 1)]
    const [nr, ny] = points[Math.min(n - 1, i + 1)]
    let tx = nr - pr
    let ty = ny - py
    const len = Math.hypot(tx, ty)
    let nx: number, nyy: number
    if (len < 1e-9) {
      nx = lastNx
      nyy = lastNy
    } else {
      tx /= len
      ty /= len
      // rotate tangent +90°: normal = (-ty, tx)
      nx = -ty
      nyy = tx
      lastNx = nx
      lastNy = nyy
    }
    const [r, y] = points[i]
    out.push([Math.max(0, r + nx * inset), y + nyy * inset])
  }
  return out
}

/**
 * Radius of the profile at height y — the LARGEST r where the curve crosses
 * y (so a floor + wall profile answers with the wall, not the floor edge).
 * Used for liquid cap radii. Clamps to the nearest endpoint outside the
 * profile's y range.
 */
export function innerRadiusAt(points: readonly ProfilePoint[], y: number, tension = 0.5): number {
  const s = sampleProfile(points, 256, tension)
  let best = -1
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]
    const b = s[i]
    if ((a.y <= y && b.y >= y) || (a.y >= y && b.y <= y)) {
      const t = Math.abs(b.y - a.y) < 1e-9 ? 0 : (y - a.y) / (b.y - a.y)
      const r = a.x + (b.x - a.x) * t
      if (r > best) best = r
    }
  }
  if (best >= 0) return best
  // outside range: nearest endpoint
  const first = s[0]
  const last = s[s.length - 1]
  return Math.abs(first.y - y) < Math.abs(last.y - y) ? first.x : last.x
}

/**
 * Compose a watertight-looking double-walled glass profile from just the
 * OUTER wall: outer points ascending → rounded lip bridge → inner wall
 * (outer offset inward by wallThickness) descending → inner floor at
 * floorY → centre. Returns the combined control points, plus the inner
 * profile (floor-centre → up) ready for buildLiquid().
 */
export function doubleWalledProfile(
  outer: readonly ProfilePoint[],
  wallThickness: number,
  floorY: number
): { full: ProfilePoint[]; inner: ProfilePoint[] } {
  const innerWallDesc = offsetProfile(outer, wallThickness).reverse()
  // drop inner points below the floor, then close across the floor to centre
  const innerWall = innerWallDesc.filter(([, y]) => y > floorY + wallThickness * 0.4)
  const lastR = innerWall.length > 0 ? innerWall[innerWall.length - 1][0] : outer[0][0]
  const top = outer[outer.length - 1]
  const lipTop: ProfilePoint = [top[0] - wallThickness * 0.5, top[1] + wallThickness * 0.35]
  const full: ProfilePoint[] = [
    ...outer,
    lipTop,
    ...innerWall,
    [lastR * 0.92, floorY + wallThickness * 0.16],
    [lastR * 0.5, floorY],
    [0.0004, floorY],
  ]
  const inner: ProfilePoint[] = [
    [0.0004, floorY],
    [lastR * 0.5, floorY],
    [lastR * 0.92, floorY + wallThickness * 0.16],
    ...innerWall.slice().reverse(),
  ]
  return { full, inner }
}
