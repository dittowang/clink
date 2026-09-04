import * as THREE from 'three'
import type { EventBus, GameEvents } from '../core/events'
import { TABLE, SURFACE_Y, FAR_Z, NEAR_Z } from '../config/table'
import type { Drink } from '../core/drink'
import { applyLaunch, launchImpulse, predictStopDistance } from './impulse'

/**
 * SlingshotController — pointer → aim → launch. The ONLY path from input to
 * motion: release calls applyLaunch (impulse.ts), never setLinvel.
 *
 * Aim model (swipe direction, uniform power): press ANYWHERE the pointer ray
 * meets the table plane (table or sand) and drag — the launch direction is
 * the swipe vector (press point → current point) on that plane, so the
 * gesture works identically wherever the thumb lands and never has to start
 * on the drink. Every launch fires at LAUNCH_POWER — the ladder's tuning
 * point — so weight is read purely from how far each tier slides. A release
 * before the pointer has travelled DRAG_MIN is a tap → 'pullCancel', never a
 * launch. Swipes aimed back toward the player are clamped to ±MAX_AIM_DEG
 * from straight ahead so a stray flick never sends the drink off the open
 * near edge.
 */

/** every launch fires at this pull01 — the ladder (massLadder.ts) is tuned here */
export const LAUNCH_POWER = 1.0

/**
 * the pointer must travel at least this far (m on the table plane) from where
 * it pressed before a release counts as an aim — a tap anywhere (dismissing a
 * score pop, brushing the HUD) is never a launch.
 */
const DRAG_MIN = 0.05

/**
 * widest aim from straight ahead (−Z). 35° still reaches every side-rail
 * point beyond z ≈ +0.2 for bank shots; wider shots only ever slid into a
 * side rail 30 cm out, which the player read as "it went where I didn't aim".
 */
const MAX_AIM_DEG = 35

/** kept for API compatibility with the ladder harness scene */
export const MAX_PULL = 0.45

// aim visuals sit just above the plank to avoid z-fighting
const AIM_Y = SURFACE_Y + 0.003

const _ndc = new THREE.Vector2()
const _hit = new THREE.Vector3()
const _pullMove: GameEvents['pullMove'] = { pull01: 0 }

export class SlingshotController {
  /** add this to the scene — owns the aim line + stop-marker ring */
  readonly group = new THREE.Group()

  private drink: Drink | null = null
  private pulling = false
  private pointerId = -1
  private pull01 = 0
  private angle = 0
  private originX = 0
  private originZ = 0
  private pressX = 0
  private pressZ = 0
  private dragged = false
  private dirX = 0
  private dirZ = -1
  private pulseT = 0
  /** table tilt (levels): pull plane + aim visuals follow the tilted plank */
  private slopeTan = 0
  private halfW: number = TABLE.HALF_W
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SURFACE_Y)

  private readonly raycaster = new THREE.Raycaster()
  private readonly line: THREE.Mesh
  private readonly linePos: THREE.BufferAttribute
  /** fainter one-bounce preview after the first rail hit (bank shots) */
  private readonly bounce: THREE.Mesh
  private readonly bouncePos: THREE.BufferAttribute
  private readonly ring: THREE.Mesh
  private readonly ringMat: THREE.MeshBasicMaterial

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly bus: EventBus
  ) {
    // tapered aim line: one quad, 4 verts updated in place every pullMove
    const lineGeo = new THREE.BufferGeometry()
    this.linePos = new THREE.BufferAttribute(new Float32Array(4 * 3), 3)
    lineGeo.setAttribute('position', this.linePos)
    lineGeo.setIndex([0, 1, 2, 2, 1, 3])
    this.line = new THREE.Mesh(
      lineGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    )
    this.line.frustumCulled = false

    const bounceGeo = new THREE.BufferGeometry()
    this.bouncePos = new THREE.BufferAttribute(new Float32Array(4 * 3), 3)
    bounceGeo.setAttribute('position', this.bouncePos)
    bounceGeo.setIndex([0, 1, 2, 2, 1, 3])
    this.bounce = new THREE.Mesh(
      bounceGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    )
    this.bounce.frustumCulled = false

    // stop marker: unit ring scaled per tier, subtle 2 Hz pulse in update()
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), this.ringMat)
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.y = AIM_Y

    this.group.add(this.line, this.bounce, this.ring)
    this.group.visible = false

    dom.addEventListener('pointerdown', this.onDown)
    dom.addEventListener('pointermove', this.onMove)
    dom.addEventListener('pointerup', this.onUp)
    dom.addEventListener('pointercancel', this.onUp)
  }

  /** The cradle drink the next pull applies to (null disables input). */
  setActiveDrink(drink: Drink | null): void {
    this.drink = drink
    if (drink) {
      this.ringMat.color.setHSL(drink.def.hue / 360, 0.65, 0.62)
      const r = drink.def.radius * 1.3 + 0.012
      this.ring.scale.set(r, r, 1)
    }
    if (!drink && this.pulling) this.endPull()
  }

  get isPulling(): boolean {
    return this.pulling
  }

  /**
   * Additive (level modifier): follow a table tilted by slopeDeg around X at
   * the table centre — the drag plane and the aim visuals hug the real plank.
   */
  setSlope(slopeDeg: number): void {
    const rad = (slopeDeg * Math.PI) / 180
    this.slopeTan = Math.tan(rad)
    this.plane.normal.set(0, Math.cos(rad), Math.sin(rad))
    this.plane.constant = -SURFACE_Y * Math.cos(rad)
    this.ring.rotation.x = -Math.PI / 2 + rad
  }

  /** Additive (level modifier): clamp the stop marker inside a narrowed table. */
  setTableHalfW(halfW: number): void {
    this.halfW = halfW
  }

  /** plank-top y at world z under the current slope */
  private yAt(z: number): number {
    return SURFACE_Y - this.slopeTan * z
  }

  /**
   * Additive: abort an in-progress pull (resize / orientation change / pause).
   * Emits 'pullCancel' so audio/UI treat it exactly like a drag-back cancel.
   */
  cancel(): void {
    if (!this.pulling) return
    this.endPull()
    this.bus.emit('pullCancel', {})
  }

  get currentPull(): number {
    return this.pulling ? this.pull01 : 0
  }

  /** Per rendered frame: drives the marker pulse. No allocation. */
  update(dtFrame: number): void {
    if (!this.group.visible) return
    this.pulseT += dtFrame
    const s = 1 + 0.06 * Math.sin(this.pulseT * Math.PI * 4)
    const base = this.drink ? this.drink.def.radius * 1.3 + 0.012 : 0.05
    this.ring.scale.set(base * s, base * s, 1)
  }

  dispose(): void {
    this.dom.removeEventListener('pointerdown', this.onDown)
    this.dom.removeEventListener('pointermove', this.onMove)
    this.dom.removeEventListener('pointerup', this.onUp)
    this.dom.removeEventListener('pointercancel', this.onUp)
    this.line.geometry.dispose()
    ;(this.line.material as THREE.Material).dispose()
    this.bounce.geometry.dispose()
    ;(this.bounce.material as THREE.Material).dispose()
    this.ring.geometry.dispose()
    this.ringMat.dispose()
  }

  // ---- pointer path ----

  private readonly onDown = (e: PointerEvent): void => {
    const d = this.drink
    if (!d || this.pulling) return
    if (!this.raycast(e)) return
    this.pulling = true
    this.pointerId = e.pointerId
    try {
      this.dom.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic events have no active pointer to capture */
    }
    this.originX = d.currPos.x
    this.originZ = d.currPos.z
    this.pressX = _hit.x
    this.pressZ = _hit.z
    this.dragged = false
    this.pull01 = 0
    this.bus.emit('pullStart', {})
    this.updatePull()
  }

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.pulling || e.pointerId !== this.pointerId) return
    if (!this.raycast(e)) return
    this.updatePull()
  }

  private readonly onUp = (e: PointerEvent): void => {
    if (!this.pulling || e.pointerId !== this.pointerId) return
    const d = this.drink
    const aimed = this.pull01 > 0
    const angle = this.angle
    this.endPull()
    if (!d) return
    if (!aimed) {
      this.bus.emit('pullCancel', {})
      return
    }
    applyLaunch(d, angle, LAUNCH_POWER)
    d.state = 'live'
    this.drink = null
    this.bus.emit('launch', { id: d.id, tier: d.tier, impulse: launchImpulse(d.tier, LAUNCH_POWER) })
  }

  private endPull(): void {
    this.pulling = false
    this.pointerId = -1
    this.group.visible = false
  }

  /** pointer event → table-plane hit into _hit. false if ray misses (horizon). */
  private raycast(e: PointerEvent): boolean {
    const rect = this.dom.getBoundingClientRect()
    _ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(_ndc, this.camera)
    return this.raycaster.ray.intersectPlane(this.plane, _hit) !== null
  }

  /** recompute aim from _hit and refresh visuals + 'pullMove' */
  private updatePull(): void {
    const d = this.drink
    if (!d) return
    // swipe vector on the table plane: press point → current pointer
    const dx = _hit.x - this.pressX
    const dz = _hit.z - this.pressZ
    if (!this.dragged && Math.hypot(dx, dz) >= DRAG_MIN) this.dragged = true
    if (!this.dragged) {
      // a tap (no drag yet): cancel armed, nothing to aim with
      this.pull01 = 0
    } else {
      this.pull01 = LAUNCH_POWER
      // angle from −Z toward +X — the impulse.ts convention; the swipe
      // direction IS the launch direction, clamped so nothing aims back off
      // the open edge
      const maxAim = (MAX_AIM_DEG * Math.PI) / 180
      this.angle = clamp(Math.atan2(dx, -dz), -maxAim, maxAim)
      this.dirX = Math.sin(this.angle)
      this.dirZ = -Math.cos(this.angle)
    }

    _pullMove.pull01 = this.pull01
    this.bus.emit('pullMove', _pullMove)

    if (this.pull01 <= 0) {
      this.group.visible = false // cancel armed: no aim, no marker
      return
    }
    this.group.visible = true

    // marker at the FIRST thing the drink meets along the true aim line: a
    // side rail, the far rail, or the predicted stop — never clamped per axis
    // (per-axis clamping bent the drawn arrow off the real launch direction)
    const r = d.def.radius
    const predicted = predictStopDistance(d.tier, LAUNCH_POWER)
    let dist = predicted
    let sideHit = false
    if (Math.abs(this.dirX) > 1e-6) {
      const wall = this.dirX > 0 ? this.halfW - r : -this.halfW + r
      const tx = (wall - this.originX) / this.dirX
      if (tx > 0 && tx < dist) { dist = tx; sideHit = true }
    }
    if (this.dirZ < -1e-6) {
      const tz = (FAR_Z + r - this.originZ) / this.dirZ
      if (tz > 0 && tz < dist) { dist = tz; sideHit = false }
    }
    const mx = this.originX + this.dirX * dist
    const mz = clamp(this.originZ + this.dirZ * dist, FAR_Z + r, NEAR_Z)
    this.ring.position.set(mx, this.yAt(mz) + 0.003, mz)

    // tapered quad from drink edge to the marker; wide at the drink, thin far
    const px = -this.dirZ
    const pz = this.dirX
    const w0 = Math.max(r * 0.85, 0.02)
    const w1 = 0.006
    const sx = this.originX + this.dirX * r
    const sz = this.originZ + this.dirZ * r
    const a = this.linePos.array as Float32Array
    const sy = this.yAt(sz) + 0.003
    const my = this.yAt(mz) + 0.003
    a[0] = sx + px * w0
    a[1] = sy
    a[2] = sz + pz * w0
    a[3] = sx - px * w0
    a[4] = sy
    a[5] = sz - pz * w0
    a[6] = mx + px * w1
    a[7] = my
    a[8] = mz + pz * w1
    a[9] = mx - px * w1
    a[10] = my
    a[11] = mz - pz * w1
    this.linePos.needsUpdate = true

    // one-bounce preview: reflect off the side rail and run on to the far
    // rail (or the remaining predicted slide) — direction only, no speed loss
    // shown; enough to line up a bank shot on purpose
    this.bounce.visible = sideHit
    if (sideHit) {
      const bx = -this.dirX
      const bz = this.dirZ
      let rest = Math.max(0, predicted - dist)
      if (bz < -1e-6) rest = Math.min(rest, (FAR_Z + r - mz) / bz)
      if (Math.abs(bx) > 1e-6) {
        const wall2 = bx > 0 ? this.halfW - r : -this.halfW + r
        const tx2 = (wall2 - mx) / bx
        if (tx2 > 0) rest = Math.min(rest, tx2)
      }
      const ex = mx + bx * rest
      const ez = mz + bz * rest
      const qx = -bz
      const qz = bx
      const wA = 0.006
      const wB = 0.004
      const b = this.bouncePos.array as Float32Array
      const ya = this.yAt(mz) + 0.003
      const yb = this.yAt(ez) + 0.003
      b[0] = mx + qx * wA; b[1] = ya; b[2] = mz + qz * wA
      b[3] = mx - qx * wA; b[4] = ya; b[5] = mz - qz * wA
      b[6] = ex + qx * wB; b[7] = yb; b[8] = ez + qz * wB
      b[9] = ex - qx * wB; b[10] = yb; b[11] = ez - qz * wB
      this.bouncePos.needsUpdate = true
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
