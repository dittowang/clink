import * as THREE from 'three'
import type { BootCtx, SceneHandle } from '../../main'
import { TIERS, type TierId } from '../../config/tiers'
import { instantiateDrink } from '../../drinks/index'
import type { DrinkInstance } from '../../drinks/types'
import { registerHarness } from '../api'
import { makeCanvasTexture } from '../../drinks/lib/canvas'

/**
 * Single-drink turntable close-up: ?scene=probe&tier=N (required; falls back
 * to 5 with a warning). Neutral warm PMREM built inline — this scene must
 * NOT import src/render (built in parallel). One key light with shadow onto
 * a round pedestal; the drink rotates at 30°/s under stepTo. Optional
 * &tilt=deg leans the drink while the liquid plane stays world-level, to
 * verify the clip rig.
 */
const ROT_SPEED = (30 * Math.PI) / 180 // rad/s

function readTier(): TierId {
  const p = new URLSearchParams(window.location.search).get('tier')
  const n = Number(p)
  if (p !== null && Number.isInteger(n) && n >= 1 && n <= 12) return n as TierId
  console.warn('[probe] &tier=N (1..12) is required — defaulting to 5')
  return 5
}

function readTiltRad(): number {
  const p = new URLSearchParams(window.location.search).get('tilt')
  const n = Number(p)
  return p !== null && Number.isFinite(n) ? (n * Math.PI) / 180 : 0
}

/** optional lighting overrides for iteration: &env=0.2&key=6 */
function readNum(name: string, fallback: number): number {
  const p = new URLSearchParams(window.location.search).get(name)
  const n = Number(p)
  return p !== null && Number.isFinite(n) ? n : fallback
}

/** warm studio: gradient sky sphere + two softbox cards → PMREM */
function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const envScene = new THREE.Scene()
  const skyTex = makeCanvasTexture(64, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0.0, '#fff6e8') // zenith: bright warm white
    g.addColorStop(0.42, '#ffddb2') // warm mid
    g.addColorStop(0.55, '#d9ab7a') // horizon
    g.addColorStop(0.72, '#7a6148') // floor falloff — dark enough for contrast
    g.addColorStop(1.0, '#463526') // ground
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  })
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide })
  )
  ;(sky.material as THREE.MeshBasicMaterial).color = new THREE.Color(1.25, 1.2, 1.1)
  envScene.add(sky)

  // key softbox: the big vertical streak every glass/label highlight reads from
  const key = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 5),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(13, 12.5, 11.5), side: THREE.DoubleSide })
  )
  key.position.set(-3.4, 2.6, 2.6)
  key.lookAt(0, 0.5, 0)
  envScene.add(key)

  // cooler rim card on the right for edge separation
  const rim = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 3.2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.6, 4.2), side: THREE.DoubleSide })
  )
  rim.position.set(3.6, 1.8, -1.8)
  rim.lookAt(0, 0.4, 0)
  envScene.add(rim)

  const pmrem = new THREE.PMREMGenerator(renderer)
  const rt = pmrem.fromScene(envScene, 0.035)
  pmrem.dispose()
  skyTex.dispose()
  return rt.texture
}

export async function createProbeScene(ctx: BootCtx): Promise<SceneHandle> {
  const scene = new THREE.Scene()
  const envTex = buildEnvironment(ctx.renderer)
  scene.environment = envTex
  scene.environmentIntensity = readNum('env', 0.65)
  scene.background = envTex
  scene.backgroundBlurriness = 0.55
  scene.backgroundIntensity = 0.55

  // ---- pedestal -----------------------------------------------------------
  let tier = readTier()
  const tiltRad = readTiltRad()
  const pedestalMat = new THREE.MeshPhysicalMaterial({ color: 0x8f7355, roughness: 0.85 })
  let pedestal: THREE.Mesh | null = null

  // ---- key light ----------------------------------------------------------
  const key = new THREE.DirectionalLight(0xfff0dc, readNum('key', 5.8))
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.normalBias = readNum('nbias', 0.005)
  scene.add(key)
  scene.add(key.target)

  // ---- drink + turntable --------------------------------------------------
  const turntable = new THREE.Group()
  scene.add(turntable)
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.02, 30)

  let instance: DrinkInstance | null = null
  let angle = -0.4
  const qTilt = new THREE.Quaternion()
  const qCapBase = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
  const qScratch = new THREE.Quaternion()

  function frameCamera(): void {
    const def = TIERS[tier]
    const fov = (camera.fov * Math.PI) / 180
    // drink height fills ~70% of the frame
    const dByH = def.height / 0.7 / (2 * Math.tan(fov / 2))
    const dByW = (def.radius * 2 * 2.1) / (2 * Math.tan(fov / 2) * camera.aspect)
    const d = Math.max(dByH, dByW) + def.radius * 0.5
    const targetY = def.height * 0.48
    camera.position.set(d * 0.13, targetY + d * 0.32, d)
    camera.lookAt(0, targetY, 0)
    // key from the upper camera-left (~33° elevation): rakes the front-left
    // form while the cast shadow falls right where the wide pedestal shows it.
    key.position.set(-2.3, 1.5, 0.35)
    key.target.position.set(0, 0, 0)
    const ext = Math.max(0.3, def.radius * 3.5, def.height * 1.5)
    key.shadow.camera.left = -ext
    key.shadow.camera.right = ext
    key.shadow.camera.top = ext
    key.shadow.camera.bottom = -ext
    key.shadow.camera.near = 1.0
    key.shadow.camera.far = 4.5
    key.shadow.camera.updateProjectionMatrix()
  }

  function setDrink(t: TierId): void {
    tier = t
    if (instance) turntable.remove(instance.group)
    if (pedestal) scene.remove(pedestal)
    const def = TIERS[tier]

    const pedR = Math.max(0.11, def.radius * 2.2) // wide enough to catch the shadow
    pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(pedR, pedR * 1.06, 0.035, 64),
      pedestalMat
    )
    pedestal.position.y = -0.0175 // top face at y = 0
    pedestal.receiveShadow = true
    scene.add(pedestal)

    instance = instantiateDrink(tier)
    instance.group.rotation.z = tiltRad
    turntable.add(instance.group)
    if (instance.liquid) {
      // world-level surface: normal (0,-1,0) keeps y <= constant
      instance.liquid.plane.normal.set(0, -1, 0)
      instance.liquid.plane.constant = instance.liquid.fillY * Math.cos(tiltRad)
    }
    frameCamera()
  }

  setDrink(tier)

  // temporary debug: &shadowhelper=1 shows the shadow frustum from afar
  if (new URLSearchParams(window.location.search).get('shadowhelper') === '1') {
    scene.add(new THREE.CameraHelper(key.shadow.camera))
  }

  function applyPose(): void {
    turntable.rotation.y = angle
    if (instance && instance.liquid && tiltRad !== 0) {
      // keep the cap disc lying in the (world-horizontal) liquid plane
      qTilt.setFromEuler(new THREE.Euler(0, angle, tiltRad, 'YXZ')) // parent world rot ≈ yaw ∘ tilt
      qScratch.copy(qTilt).invert().multiply(qCapBase)
      instance.liquid.cap.quaternion.copy(qScratch)
    }
  }

  registerHarness({
    spawn: (t) => {
      setDrink(t)
      return 1
    },
    push: () => {},
    stepTo: (s) => ctx.scheduler.stepTo(s),
    capture: async () => {
      handle.render()
    },
    state: () => {
      const def = TIERS[tier]
      return {
        scene: 'probe',
        tier,
        key: def.key,
        radius: def.radius,
        height: def.height,
        angleDeg: Math.round(((angle * 180) / Math.PI) * 10) / 10,
        tiltDeg: (tiltRad * 180) / Math.PI,
        hasLiquid: instance?.liquid != null,
        fillY: instance?.liquid?.fillY ?? null,
      }
    },
  })

  const handle: SceneHandle = {
    fixedUpdate(dt) {
      angle += ROT_SPEED * dt
    },
    frameUpdate() {
      applyPose()
    },
    render() {
      ctx.renderer.render(scene, camera)
    },
    onResize(w, h) {
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      frameCamera()
    },
    dispose() {},
  }
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  frameCamera()
  applyPose()
  return handle
}
