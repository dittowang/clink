import * as THREE from 'three'
import type { EventBus, GameEvents } from '../core/events'
import { TABLE, SURFACE_Y, FAR_Z, NEAR_Z } from '../config/table'
import type { Drink } from '../core/drink'
import { applyLaunch, launchImpulse, predictStopDistance } from './impulse'

/**
 * SlingshotController — pointer → pull → launch. The ONLY path from input to
 * motion: release calls applyLaunch (impulse.ts), never setLinvel.
 *
 * Pull model: pointer ray is intersected with the table plane y = SURFACE_Y.
 * The drag offset (hit − drink origin) counts only while it points BACKWARD
 * (+Z, toward the player); its length is clamped to MAX_PULL. pull01 =
 * len / MAX_PULL, aim = the normalized opposite of the drag. Dragging back
 * onto/past the origin (pull01 < 0.05) arms a cancel — release then emits
 * 'pullCancel' instead of launching; dragging out again re-arms the launch.
 */

/** full-power drag length (m on the table plane) — a comfortable thumb arc */
export const MAX_PULL = 0.45

/** below this pull the release is a cancel, not a feeble launch */
const CANCEL_PULL = 0.05

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

    this.group.add(this.line, this.ring)
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
    const pull = this.pull01
    const angle = this.angle
    this.endPull()
    if (!d) return
    if (pull < CANCEL_PULL) {
      this.bus.emit('pullCancel', {})
      return
    }
    applyLaunch(d, angle, pull)
    d.state = 'live'
    this.drink = null
    this.bus.emit('launch', { id: d.id, tier: d.tier, impulse: launchImpulse(d.tier, pull) })
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

  /** recompute pull/aim from _hit and refresh visuals + 'pullMove' */
  private updatePull(): void {
    const d = this.drink
    if (!d) return
    const dx = _hit.x - this.originX
    const dz = _hit.z - this.originZ
    if (dz <= 0) {
      // dragged forward of the origin: backward-only rule → armed cancel
      this.pull01 = 0
    } else {
      const len = Math.min(Math.hypot(dx, dz), MAX_PULL)
      this.pull01 = len / MAX_PULL
      if (len > 1e-5) {
        this.dirX = -dx / Math.hypot(dx, dz)
        this.dirZ = -dz / Math.hypot(dx, dz)
        // angle from −Z toward +X — the impulse.ts convention
        this.angle = Math.atan2(this.dirX, -this.dirZ)
      }
    }

    _pullMove.pull01 = this.pull01
    this.bus.emit('pullMove', _pullMove)

    if (this.pull01 < CANCEL_PULL) {
      this.group.visible = false // cancel armed: no aim, no marker
      return
    }
    this.group.visible = true

    // stop marker at origin + dir · predicted, clamped inside the rails
    const dist = predictStopDistance(d.tier, this.pull01)
    const r = d.def.radius
    const mx = clamp(this.originX + this.dirX * dist, -this.halfW + r, this.halfW - r)
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
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
