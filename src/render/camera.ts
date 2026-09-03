import * as THREE from 'three'
import { SURFACE_Y, TABLE } from '../config/table'

/**
 * Game camera: parked at the near (+Z) end, long-lens product feel. It never
 * moves during play except the impact nudge — a few pixels of camera-plane
 * offset with a critically-damped return (~100 ms).
 *
 * Framing: the TABLE is the frame. The rig fits the whole plank (rails and
 * the far-end drink heights included) into the viewport at ELEV_DEG with a
 * long lens, so the table fills ~75% of the screen height on landscape and
 * the full width on portrait; the horizon is out of frame (the player asked
 * for the table, not the sea). The fit is recomputed on resize so phones and
 * ultrawide windows get the same table-fills-the-screen read.
 */

const FOV = 36
/** camera elevation above the table plane (deg) — the brief's 38–45 band */
const ELEV_DEG = 42
/** frame margins as fractions of the viewport: HUD lives in the top band */
const MARGIN_TOP = 0.11
const MARGIN_BOTTOM = 0.04
const MARGIN_SIDE = 0.03
/** the far-end drink tops that must stay in frame (m above the surface) */
const FAR_HEADROOM = 0.28

export interface CameraRig {
  camera: THREE.PerspectiveCamera
  /** canonical pose (no nudge, no sequence) — scenes ease back to this */
  basePos: THREE.Vector3
  baseQuat: THREE.Quaternion
  nudge(dir: THREE.Vector2, strength01: number): void
  update(dt: number): void
  onResize(w: number, h: number): void
}

// critically damped return: settles < 5% in ~95 ms
const OMEGA = 50

/** the points the frame must contain: plank corners + far-end headroom */
function fitPoints(): THREE.Vector3[] {
  const hw = TABLE.HALF_W + TABLE.RAIL_T + 0.02
  const zFar = -TABLE.HALF_L - TABLE.RAIL_T - 0.02
  const zNear = TABLE.HALF_L + 0.02
  return [
    new THREE.Vector3(-hw, SURFACE_Y, zNear),
    new THREE.Vector3(hw, SURFACE_Y, zNear),
    new THREE.Vector3(-hw, SURFACE_Y, zFar),
    new THREE.Vector3(hw, SURFACE_Y, zFar),
    new THREE.Vector3(-hw, SURFACE_Y + FAR_HEADROOM, zFar),
    new THREE.Vector3(hw, SURFACE_Y + FAR_HEADROOM, zFar),
    new THREE.Vector3(0, SURFACE_Y + FAR_HEADROOM, zFar),
  ]
}

const _p = new THREE.Vector3()
const _dir = new THREE.Vector3()

/**
 * Solve camera distance + look target so the fit points land inside the
 * margins: shrink/grow the distance to the tight axis, then pan the target
 * along the table axis to centre the table in the allowed vertical band.
 */
function frameTable(camera: THREE.PerspectiveCamera, target: THREE.Vector3): void {
  const el = THREE.MathUtils.degToRad(ELEV_DEG)
  _dir.set(0, Math.sin(el), Math.cos(el))
  const pts = fitPoints()
  const allowedH = 2 - (MARGIN_TOP + MARGIN_BOTTOM) * 2 // NDC units
  const allowedW = 2 - MARGIN_SIDE * 2 * 2
  target.set(0, SURFACE_Y, 0)
  let dist = 2.6
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
  for (let iter = 0; iter < 24; iter++) {
    camera.position.copy(target).addScaledVector(_dir, dist)
    camera.lookAt(target)
    camera.updateMatrixWorld(true)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const q of pts) {
      _p.copy(q).project(camera)
      minX = Math.min(minX, _p.x); maxX = Math.max(maxX, _p.x)
      minY = Math.min(minY, _p.y); maxY = Math.max(maxY, _p.y)
    }
    const ratio = Math.max((maxY - minY) / allowedH, (maxX - minX) / allowedW)
    dist *= Math.pow(ratio, 0.85) // damped so it converges without hunting
    // centre the projected table inside the vertical band (top margin > bottom).
    // Image too HIGH (err > 0) → look further up-table (−z) so it drops.
    // 1 m of target z shifts the image ≈ sin(el)/(dist·tan(fov/2)) NDC.
    const bandCentre = MARGIN_BOTTOM - MARGIN_TOP // NDC: +y is up
    const centreErr = (minY + maxY) / 2 - bandCentre
    const gain = (dist * tanHalf) / Math.sin(el)
    target.z = THREE.MathUtils.clamp(target.z - centreErr * gain * 0.8, -1.2, 1.2)
  }
  camera.position.copy(target).addScaledVector(_dir, dist)
  camera.lookAt(target)
  camera.updateMatrixWorld(true)
}

export function createCameraRig(viewW: number, viewH: number): CameraRig {
  const camera = new THREE.PerspectiveCamera(FOV, viewW / viewH, 0.05, 900)
  const target = new THREE.Vector3()
  frameTable(camera, target)

  const basePos = camera.position.clone()
  const baseQuat = camera.quaternion.clone()

  const base = new THREE.Vector3()
  let active = false // spring engaged; when idle the camera is never touched,
  //                    so scenes may reposition it freely (lineup does)
  let viewHeight = viewH
  // spring state in camera-plane coordinates (metres)
  let offX = 0, offY = 0, velX = 0, velY = 0

  const right = new THREE.Vector3()
  const up = new THREE.Vector3()

  return {
    camera,
    basePos,
    baseQuat,
    nudge(dir, strength01) {
      const len = dir.length()
      if (len < 1e-6) return
      if (!active) {
        base.copy(camera.position)
        active = true
      }
      const s = THREE.MathUtils.clamp(strength01, 0, 1)
      // proportional: 1.6 px at the force gate rising to the 5 px cap — a
      // constant floor made every gated impact read identically hard
      const px = 1.6 + 3.4 * s
      // px -> world at the depth of the table centre
      const worldPerPx = (2 * base.distanceTo(target) * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / viewHeight
      const amp = px * worldPerPx
      offX += (dir.x / len) * amp
      offY += (dir.y / len) * amp
    },
    update(dt) {
      if (!active) return
      // semi-implicit critically damped spring. Substep: at OMEGA=50 the
      // integrator is only stable for dt < ~2/OMEGA — a 0.1 s harness slice
      // or a sub-50fps frame would detonate it into NaN without this.
      const k = OMEGA * OMEGA
      const c = 2 * OMEGA
      const MAX_STEP = 0.012
      let remaining = Math.min(dt, 0.1)
      while (remaining > 0) {
        const h = Math.min(remaining, MAX_STEP)
        remaining -= h
        velX += (-k * offX - c * velX) * h
        velY += (-k * offY - c * velY) * h
        offX += velX * h
        offY += velY * h
      }
      if (Math.abs(offX) < 1e-6 && Math.abs(offY) < 1e-6 && Math.abs(velX) < 1e-5 && Math.abs(velY) < 1e-5) {
        offX = offY = velX = velY = 0
        camera.position.copy(base)
        active = false
        return
      }
      // translate in the camera plane — orientation stays fixed
      right.setFromMatrixColumn(camera.matrixWorld, 0)
      up.setFromMatrixColumn(camera.matrixWorld, 1)
      camera.position.copy(base)
        .addScaledVector(right, offX)
        .addScaledVector(up, offY)
    },
    onResize(w, h) {
      viewHeight = h
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      // re-fit the table for the new aspect. Only move the live camera if it
      // is parked at the (old) base — a scene mid-sequence keeps its pose
      const parked = camera.position.distanceTo(basePos) < 0.03
      const savedPos = camera.position.clone()
      const savedQuat = camera.quaternion.clone()
      frameTable(camera, target)
      basePos.copy(camera.position)
      baseQuat.copy(camera.quaternion)
      if (!parked) {
        camera.position.copy(savedPos)
        camera.quaternion.copy(savedQuat)
      }
      if (active) base.copy(basePos)
    },
  }
}
