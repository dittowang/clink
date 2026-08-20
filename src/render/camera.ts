import * as THREE from 'three'
import { SURFACE_Y } from '../config/table'

/**
 * Game camera: parked at the near (+Z) end, long-lens product feel. It never
 * moves during play except the impact nudge — a few pixels of camera-plane
 * offset with a critically-damped return (~100 ms).
 *
 * Framing: full table in the lower part of the frame, sand at the sides,
 * the sea band and a sliver of sky along the top. The pitch is intentionally
 * shallower than the position-elevation so the horizon stays in frame.
 */

const FOV = 43
// base pose — tuned against captures, change only with a capture in hand.
// Pitch ~19° keeps the horizon just inside the top of the frame while the
// table fills the lower half; the position sits ~1.1 m above the surface.
const CAM_POS = new THREE.Vector3(0, 1.95, 2.45)
const CAM_TARGET = new THREE.Vector3(0, SURFACE_Y + 0.05, -0.95)

export interface CameraRig {
  camera: THREE.PerspectiveCamera
  nudge(dir: THREE.Vector2, strength01: number): void
  update(dt: number): void
  onResize(w: number, h: number): void
}

// critically damped return: settles < 5% in ~95 ms
const OMEGA = 50

export function createCameraRig(viewW: number, viewH: number): CameraRig {
  const camera = new THREE.PerspectiveCamera(FOV, viewW / viewH, 0.05, 900)
  camera.position.copy(CAM_POS)
  camera.lookAt(CAM_TARGET)

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
    nudge(dir, strength01) {
      const len = dir.length()
      if (len < 1e-6) return
      if (!active) {
        base.copy(camera.position)
        active = true
      }
      const s = THREE.MathUtils.clamp(strength01, 0, 1)
      const px = 3 + 2 * s // 3–5 px worth of displacement
      // px -> world at the depth of the table centre
      const worldPerPx = (2 * base.distanceTo(CAM_TARGET) * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / viewHeight
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
    },
  }
}
