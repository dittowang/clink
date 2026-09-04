import * as THREE from 'three'
import type { TierId } from '../config/tiers'
import { TIERS } from '../config/tiers'
import { THUMB_PX } from '../config/orders'
import { instantiateDrink } from '../drinks'

/**
 * Drink thumbnails for the order card — rendered at boot, zero asset files.
 *
 * Each tier's template is instantiated inside a small rig (warm neutral
 * backdrop + the drink) that is parked INSIDE the stage scene, far off the
 * table, and rendered with a tight thumb camera into a THUMB_PX² render
 * target; the pixels are read back, tone-mapped, sRGB-encoded and put in a
 * canvas → data URL. Using the stage scene (its sun, hemi, fog, environment)
 * means the drink materials hit the SAME program-cache keys the game's
 * composer pass compiles, so the pre-render at warm-up costs no extra
 * shader compiles — and a lazy render (harness) compiles only what a spawn
 * of that tier would compile anyway.
 *
 * Render targets get no tone mapping in three (AgX runs in the OutputPass),
 * so the readback applies a filmic curve of its own — thumbnails need to
 * read as the same drink, not match the beach pixel for pixel.
 */
export interface Thumbnailer {
  /** data URL for the tier (rendered on first request, cached) */
  get(tier: TierId): string
  /** render every tier now (loading bar) */
  prerender(onTier?: (tier: TierId) => void): void
  dispose(): void
}

/** where the rig sits: far from the table, outside the shadow frustum */
const RIG_POS = new THREE.Vector3(9, 4, 0)
const BACKDROP_COLOR = 0xf1dcbd
const BACKDROP_DIST = 0.6
/** camera elevation and how much of the frame the drink's height fills */
const CAM_ELEV_RAD = 0.3
const FRAME_FILL = 0.72
const CAM_FOV = 28

const _dir = new THREE.Vector3()
const _look = new THREE.Vector3()
const _down = new THREE.Vector3(0, -1, 0)
const _pt = new THREE.Vector3()

function filmic(x: number): number {
  // Narkowicz ACES fit; exposure folded into the caller
  const y = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)
  return y < 0 ? 0 : y > 1 ? 1 : y
}

function toSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

export function createThumbnailer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  sun: THREE.DirectionalLight
): Thumbnailer {
  const cache = new Map<TierId, string>()
  const rig = new THREE.Group()
  rig.position.copy(RIG_POS)
  const backdropMat = new THREE.MeshBasicMaterial({ color: BACKDROP_COLOR })
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), backdropMat)
  rig.add(backdrop)
  const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.02, 3)
  const rt = new THREE.WebGLRenderTarget(THUMB_PX, THUMB_PX, {
    type: THREE.HalfFloatType,
    samples: 4,
    depthBuffer: true,
  })
  const canvas = document.createElement('canvas')
  canvas.width = THUMB_PX
  canvas.height = THUMB_PX
  const ctx2d = canvas.getContext('2d')
  const half = new Uint16Array(THUMB_PX * THUMB_PX * 4)

  function render(tier: TierId): string {
    if (!ctx2d) return ''
    const def = TIERS[tier]
    const inst = instantiateDrink(tier)
    inst.group.position.set(0, 0, 0)
    if (inst.liquid) {
      // static fill plane, exactly as the tray sets it
      inst.liquid.plane.setFromNormalAndCoplanarPoint(
        _down,
        _pt.set(RIG_POS.x, RIG_POS.y + inst.liquid.fillY, RIG_POS.z)
      )
    }
    rig.add(inst.group)

    // front-lit: camera on the sun's side of the drink, slightly above
    _dir.subVectors(sun.position, sun.target.position)
    _dir.y = 0
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1)
    _dir.normalize()
    const frameH = Math.max(def.height, def.radius * 2.6) / FRAME_FILL
    const dist = frameH / 2 / Math.tan((CAM_FOV * Math.PI) / 360)
    const cy = def.height * 0.5
    camera.position.set(
      RIG_POS.x + _dir.x * dist * Math.cos(CAM_ELEV_RAD),
      RIG_POS.y + cy + dist * Math.sin(CAM_ELEV_RAD),
      RIG_POS.z + _dir.z * dist * Math.cos(CAM_ELEV_RAD)
    )
    _look.set(RIG_POS.x, RIG_POS.y + cy, RIG_POS.z)
    camera.lookAt(_look)
    camera.far = dist + BACKDROP_DIST + 0.2
    camera.updateProjectionMatrix()
    // backdrop: behind the drink, facing the camera
    backdrop.position.set(-_dir.x * BACKDROP_DIST, cy, -_dir.z * BACKDROP_DIST)
    backdrop.lookAt(camera.position.clone().sub(RIG_POS))

    scene.add(rig)
    const prevTarget = renderer.getRenderTarget()
    // The shadow pass is skipped ONLY once a shadow map exists: three settles
    // the shadow-map type (the PCFSoft → PCF conversion) and allocates the
    // depth texture inside that pass, and a lazy thumbnail (harness, no
    // warm-up) can be the first draw of the session. Skipping it then
    // compiled the tier's programs against a stale key with no depth texture
    // bound — every later draw of that tier failed (GL_INVALID_OPERATION
    // sampler mismatch: the drink rendered black). After the first real
    // frame the table's shadow map is already fitted, so re-rendering it
    // twelve times at warm-up would be pure waste.
    const prevAuto = renderer.shadowMap.autoUpdate
    if (sun.shadow.map !== null) renderer.shadowMap.autoUpdate = false
    try {
      renderer.setRenderTarget(rt)
      renderer.clear()
      renderer.render(scene, camera)
      renderer.readRenderTargetPixels(rt, 0, 0, THUMB_PX, THUMB_PX, half)
    } finally {
      renderer.setRenderTarget(prevTarget)
      renderer.shadowMap.autoUpdate = prevAuto
      scene.remove(rig)
      rig.remove(inst.group)
      if (inst.liquid) {
        ;(inst.liquid.volume.material as THREE.Material).dispose()
        ;(inst.liquid.cap.material as THREE.Material).dispose()
      }
    }

    const img = ctx2d.createImageData(THUMB_PX, THUMB_PX)
    const px = img.data
    const exposure = renderer.toneMappingExposure
    for (let y = 0; y < THUMB_PX; y++) {
      const srcRow = (THUMB_PX - 1 - y) * THUMB_PX // GL rows are bottom-up
      for (let x = 0; x < THUMB_PX; x++) {
        const si = (srcRow + x) * 4
        const di = (y * THUMB_PX + x) * 4
        for (let c = 0; c < 3; c++) {
          const lin = THREE.DataUtils.fromHalfFloat(half[si + c]) * exposure
          px[di + c] = Math.round(toSrgb(filmic(lin)) * 255)
        }
        px[di + 3] = 255
      }
    }
    ctx2d.putImageData(img, 0, 0)
    return canvas.toDataURL('image/png')
  }

  return {
    get(tier) {
      let url = cache.get(tier)
      if (url === undefined) {
        url = render(tier)
        if (url) cache.set(tier, url)
      }
      return url
    },
    prerender(onTier) {
      for (let t = 1; t <= 12; t++) {
        this.get(t as TierId)
        onTier?.(t as TierId)
      }
    },
    dispose() {
      rt.dispose()
      backdrop.geometry.dispose()
      backdropMat.dispose()
      cache.clear()
    },
  }
}
