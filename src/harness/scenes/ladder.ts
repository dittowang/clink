import * as THREE from 'three'
import type { BootCtx, SceneHandle } from '../../main'
import { TABLE, SURFACE_Y, CRADLE_Z, FAR_Z, FOUL_Z, SETTLE_SPEED } from '../../config/table'
import { TIERS, TIER_IDS, type TierId } from '../../config/tiers'
import { PhysicsWorld } from '../../physics/world'
import { applyLaunch, predictStopDistance } from '../../physics/impulse'
import { applyInterpolatedPose } from '../../physics/interpolate'
import { updateFeel } from '../../physics/feel'
import { SlingshotController } from '../../physics/slingshot'
import { instantiateDrink } from '../../drinks'
import { registerHarness, type HarnessApi } from '../api'
import { bus } from '../../core/events'
import type { Drink } from '../../core/drink'

/**
 * ?scene=ladder — THE feel calibration harness. Launches every tier from the
 * cradle with an identical full pull and logs where it stops, so the mass
 * ladder can be tuned against numbers instead of vibes.
 *
 *   node scripts/capture.mjs --scene=ladder --settle=75 --state
 *
 * Camera is a high SIDE view (whole table length across the screen) so the
 * stop stripes drawn per tier are directly comparable. Extra params:
 *   &tier=N   run only tier N, repeatedly
 *   &sling=1  don't auto-launch; wire the SlingshotController instead and
 *             drive it with __game.slingDrag/slingRelease (synthetic pointer
 *             events through the real input path)
 */

interface LadderLog {
  tier: TierId
  launchZ: number
  stopZ: number
  /** planar launch→stop distance (m) */
  distance: number
  /** predictStopDistance(tier, pull) — the aim-marker formula */
  predicted: number
  /** distance / predicted, for at-a-glance honesty checks */
  ratio: number
  hitFarRail: boolean
  crossedMidline: boolean
}

type Phase = 'settle-in' | 'aim' | 'sliding' | 'finished'

/** max slide wait before force-logging (s) */
const SLIDE_TIMEOUT = 6
/** let the spawn drop settle before launching (s) */
const SETTLE_IN = 0.35
/** ignore the settle check just after launch while speed ramps in (s) */
const MIN_SLIDE = 0.25

export async function createLadderScene(ctx: BootCtx): Promise<SceneHandle> {
  const params = new URLSearchParams(window.location.search)
  const tierParam = Number(params.get('tier'))
  const singleTier: TierId | null =
    tierParam >= 1 && tierParam <= 12 ? ((tierParam | 0) as TierId) : null
  const slingMode = params.get('sling') === '1'

  // ---- stage (deliberately minimal: no src/render import, it is being
  // built in parallel — bare plank, rails, sand, one key light) ----
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x9fd0e6)

  const camera = new THREE.PerspectiveCamera(
    40,
    window.innerWidth / window.innerHeight,
    0.05,
    50
  )
  camera.position.set(1.62, SURFACE_Y + 1.05, 0)
  camera.lookAt(0, SURFACE_Y + 0.02, 0)

  const sun = new THREE.DirectionalLight(0xfff3dc, 2.6)
  sun.position.set(1.5, 3.2, 1.2)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.left = -1.2
  sun.shadow.camera.right = 1.2
  sun.shadow.camera.top = 1.4
  sun.shadow.camera.bottom = -1.4
  scene.add(sun)
  scene.add(new THREE.HemisphereLight(0xbcd9ec, 0xcbb188, 0.75))

  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: 0xdcc59b, roughness: 1 })
  )
  sand.rotation.x = -Math.PI / 2
  sand.receiveShadow = true
  scene.add(sand)

  const woodMat = new THREE.MeshStandardMaterial({ color: 0xa9835a, roughness: 0.8 })
  const railMat = new THREE.MeshStandardMaterial({ color: 0x8d6a45, roughness: 0.8 })
  const plank = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE.HALF_W * 2, TABLE.THICKNESS, TABLE.HALF_L * 2),
    woodMat
  )
  plank.position.y = SURFACE_Y - TABLE.THICKNESS / 2
  plank.receiveShadow = true
  scene.add(plank)

  const railFar = new THREE.Mesh(
    new THREE.BoxGeometry((TABLE.HALF_W + TABLE.RAIL_T) * 2, TABLE.RAIL_H, TABLE.RAIL_T),
    railMat
  )
  railFar.position.set(0, SURFACE_Y + TABLE.RAIL_H / 2, FAR_Z - TABLE.RAIL_T / 2)
  scene.add(railFar)
  for (const s of [-1, 1] as const) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(TABLE.RAIL_T, TABLE.RAIL_H, TABLE.HALF_L * 2),
      railMat
    )
    rail.position.set(s * (TABLE.HALF_W + TABLE.RAIL_T / 2), SURFACE_Y + TABLE.RAIL_H / 2, 0)
    scene.add(rail)
  }
  // simple legs so the side view doesn't show a floating plank
  for (const sx of [-1, 1] as const)
    for (const sz of [-1, 1] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, SURFACE_Y, 0.05), railMat)
      leg.position.set(sx * (TABLE.HALF_W - 0.06), SURFACE_Y / 2, sz * (TABLE.HALF_L - 0.08))
      scene.add(leg)
    }

  // reference lines on the plank: midline (tier 12 must cross), foul line,
  // cradle tick — all part of what the stop stripes are read against
  const lineGeo = new THREE.PlaneGeometry(TABLE.HALF_W * 2 - 0.02, 0.008)
  lineGeo.rotateX(-Math.PI / 2)
  const addLine = (z: number, color: number, opacity: number): void => {
    const m = new THREE.Mesh(
      lineGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
    )
    m.position.set(0, SURFACE_Y + 0.0008, z)
    scene.add(m)
  }
  addLine(0, 0x333333, 0.5) // midline
  addLine(FOUL_Z, 0xaa3322, 0.4) // foul line
  addLine(CRADLE_Z, 0x226699, 0.4) // cradle

  // ---- physics ----
  const physics = new PhysicsWorld()

  // ---- ladder state machine ----
  const logs: LadderLog[] = []
  let phase: Phase = 'settle-in'
  let seqIndex = 0
  let active: Drink | null = null
  const extras: Drink[] = [] // debug spawns via __game.spawn
  let phaseT = 0
  let launchX = 0
  let launchZ = 0
  let minZ = Infinity
  let hitFarRail = false
  let launchedPull = 1

  const stripeGeo = new THREE.PlaneGeometry(TABLE.HALF_W * 2 - 0.06, 0.014)
  stripeGeo.rotateX(-Math.PI / 2)
  const tickGeo = new THREE.PlaneGeometry(0.1, 0.01)
  tickGeo.rotateX(-Math.PI / 2)
  let stripeCount = 0

  function attachVisuals(drink: Drink): void {
    const inst = instantiateDrink(drink.tier)
    inst.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true
    })
    drink.visual.add(inst.group)
    if (inst.liquid) drink.liquid = inst.liquid
    scene.add(drink.root)
  }

  function currentTier(): TierId {
    return singleTier ?? TIER_IDS[Math.min(seqIndex, TIER_IDS.length - 1)]
  }

  function spawnNext(): void {
    const tier = currentTier()
    const drink = physics.spawnDrink(tier, 0, CRADLE_Z, { state: 'cradle' })
    attachVisuals(drink)
    active = drink
    phase = 'settle-in'
    phaseT = 0
    minZ = Infinity
    hitFarRail = false
    if (slingMode) sling?.setActiveDrink(drink)
  }

  function doLaunch(angle: number, pull01: number): void {
    if (!active) return
    launchX = active.currPos.x
    launchZ = active.currPos.z
    launchedPull = pull01
    applyLaunch(active, angle, pull01)
    active.state = 'live'
    phase = 'sliding'
    phaseT = 0
  }

  function finishTier(): void {
    const d = active
    if (!d) return
    const stopZ = d.currPos.z
    const dx = d.currPos.x - launchX
    const dz = d.currPos.z - launchZ
    const distance = Math.hypot(dx, dz)
    const predicted = predictStopDistance(d.tier, launchedPull)
    logs.push({
      tier: d.tier,
      launchZ: round4(launchZ),
      stopZ: round4(stopZ),
      distance: round4(distance),
      predicted: round4(predicted),
      ratio: round4(predicted > 0 ? distance / predicted : 0),
      hitFarRail,
      crossedMidline: minZ < 0,
    })
    if (logs.length > 60) logs.shift()

    // stop stripe in the tier hue + a small grey predicted-tick at the left
    // edge, so a capture shows measured-vs-predicted without reading JSON
    const hue = TIERS[d.tier].hue
    const stripe = new THREE.Mesh(
      stripeGeo,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(hue / 360, 0.75, 0.5),
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      })
    )
    stripe.position.set(0, SURFACE_Y + 0.001 + stripeCount * 0.0004, stopZ)
    scene.add(stripe)
    const tick = new THREE.Mesh(
      tickGeo,
      new THREE.MeshBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.8 })
    )
    tick.position.set(
      -TABLE.HALF_W + 0.07,
      SURFACE_Y + 0.0012 + stripeCount * 0.0004,
      launchZ - predicted
    )
    scene.add(tick)
    stripeCount++

    physics.removeDrink(d)
    active = null

    if (singleTier !== null || slingMode) {
      spawnNext() // repeat forever in single-tier / interactive mode
      return
    }
    seqIndex++
    if (seqIndex >= TIER_IDS.length) {
      phase = 'finished'
      return
    }
    spawnNext()
  }

  // ---- slingshot (interactive verification mode) ----
  let sling: SlingshotController | null = null
  let unsubLaunch: (() => void) | null = null
  if (slingMode) {
    sling = new SlingshotController(camera, ctx.renderer.domElement, bus)
    scene.add(sling.group)
    unsubLaunch = bus.on('launch', () => {
      // the controller already applied the impulse; record and track
      if (!active) return
      launchX = active.currPos.x
      launchZ = active.currPos.z
      launchedPull = lastPull
      phase = 'sliding'
      phaseT = 0
    })
  }
  let lastPull = 1
  const unsubPull = bus.on('pullMove', (p) => {
    if (p.pull01 > 0) lastPull = p.pull01
  })

  // impact telemetry so captures can assert the event plumbing end-to-end
  let impactCount = 0
  let lastImpact: { force: number; matA: string; matB: string } | null = null
  const unsubImpact = bus.on('impact', (i) => {
    impactCount++
    lastImpact = { force: round4(i.force), matA: i.matA, matB: i.matB }
  })

  spawnNext()
  if (slingMode) phase = 'aim'

  // ---- scene handle ----
  const handle: SceneHandle = {
    fixedUpdate(dt: number): void {
      physics.step(bus)
      phaseT += dt
      switch (phase) {
        case 'settle-in':
          if (phaseT >= SETTLE_IN) {
            if (slingMode) phase = 'aim'
            else doLaunch(0, 1)
          }
          break
        case 'aim':
          break // waits for the slingshot (or __game.push)
        case 'sliding': {
          const d = active
          if (!d) break
          minZ = Math.min(minZ, d.currPos.z)
          if (physics.contactPairs.has(physics.pairKey(d.collider.handle, physics.farRailHandle)))
            hitFarRail = true
          if ((phaseT >= MIN_SLIDE && d.speed < SETTLE_SPEED) || phaseT >= SLIDE_TIMEOUT)
            finishTier()
          break
        }
        case 'finished':
          break
      }
    },

    frameUpdate(alpha: number, frameDt: number): void {
      if (active) {
        applyInterpolatedPose(active, alpha)
        updateFeel(active, frameDt)
      }
      for (const d of extras) {
        applyInterpolatedPose(d, alpha)
        updateFeel(d, frameDt)
      }
      sling?.update(frameDt)
    },

    render(): void {
      ctx.renderer.render(scene, camera)
    },

    onResize(w: number, h: number): void {
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    },

    dispose(): void {
      unsubLaunch?.()
      unsubPull()
      unsubImpact()
      sling?.dispose()
      physics.dispose()
    },
  }

  // ---- harness API ----
  // slingDrag/slingRelease drive the REAL pointer path with synthetic events
  // so captures verify the controller end-to-end (raycast → pull → visuals).
  let lastClientX = 0
  let lastClientY = 0
  function toClient(x: number, z: number): { cx: number; cy: number } {
    const v = new THREE.Vector3(x, SURFACE_Y, z).project(camera)
    const el = ctx.renderer.domElement
    return {
      cx: ((v.x + 1) / 2) * el.clientWidth,
      cy: ((1 - v.y) / 2) * el.clientHeight,
    }
  }
  function firePointer(type: string, cx: number, cy: number): void {
    lastClientX = cx
    lastClientY = cy
    ctx.renderer.domElement.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 7,
        clientX: cx,
        clientY: cy,
        isPrimary: true,
        bubbles: true,
      })
    )
  }

  const api = {
    spawn: (tier: TierId, x?: number, z?: number): number => {
      const d = physics.spawnDrink(tier, x ?? 0, z ?? CRADLE_Z)
      attachVisuals(d)
      extras.push(d)
      return d.id
    },
    push: (angle: number, power: number): void => {
      if (active && (phase === 'settle-in' || phase === 'aim')) doLaunch(angle, power)
    },
    stepTo: (s: number): void => ctx.scheduler.stepTo(s),
    capture: async (): Promise<void> => {
      handle.render()
    },
    state: () => ({
      mode: slingMode ? 'sling' : singleTier !== null ? `single-${singleTier}` : 'sequence',
      phase,
      tier: active ? active.tier : null,
      completed: logs.length,
      done: phase === 'finished',
      impacts: impactCount,
      lastImpact,
      active: active
        ? {
            x: round4(active.currPos.x),
            z: round4(active.currPos.z),
            speed: round4(active.speed),
            pull01: sling ? round4(sling.currentPull) : null,
            leanDegX: round4((active.lean.rx * 180) / Math.PI),
            leanDegZ: round4((active.lean.rz * 180) / Math.PI),
          }
        : null,
    }),
    logs: () => logs,
    // extras beyond HarnessApi, reachable from --eval
    slingDrag: (backM: number, sideM = 0, steps = 8): void => {
      const start = toClient(0, CRADLE_Z)
      firePointer('pointerdown', start.cx, start.cy)
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const p = toClient(sideM * t, CRADLE_Z + backM * t)
        firePointer('pointermove', p.cx, p.cy)
      }
    },
    slingRelease: (): void => {
      firePointer('pointerup', lastClientX, lastClientY)
    },
  }
  registerHarness(api as HarnessApi)

  return handle
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000
}
