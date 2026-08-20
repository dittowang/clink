import * as THREE from 'three'
import type { BootCtx, SceneHandle } from '../main'
import {
  TABLE,
  SURFACE_Y,
  NEAR_Z,
  CRADLE_Z,
  FOUL_Z,
  FOUL_GRACE_S,
  SETTLE_SPEED,
} from '../config/table'
import { type TierId } from '../config/tiers'
import { bus } from '../core/events'
import { Rng, seedFromUrl } from '../core/rng'
import { resetDrinkIds, type Drink } from '../core/drink'
import { t } from '../core/strings'
import { PhysicsWorld } from '../physics/world'
import { applyLaunch, launchImpulse } from '../physics/impulse'
import { applyInterpolatedPose } from '../physics/interpolate'
import { updateFeel } from '../physics/feel'
import { SlingshotController } from '../physics/slingshot'
import { createStage } from '../render/stage'
import { instantiateDrink } from '../drinks'
import { subscribe as subscribeAudio, resumeOnGesture } from '../audio/engine'
import { registerHarness, type HarnessApi } from '../harness/api'
import { MergeSystem } from '../merge/merge'
import { TurnManager } from './turns'
import { SandPuff } from './sandPuff'
import { createHud } from '../ui/hud'

/**
 * The playable game scene — endless-lite v1 of the docs/GAME.md turn loop:
 * spawn drop into the cradle → aim (slingshot) → launch → clinks + merges
 * (chain x1.5 within 1 s) → next drink on settle-or-timeout. Foul past
 * FOUL_Z ends the run; drinks over the open near edge die into the sand.
 *
 * Fixed-step order (all after world.step so pose/contact data is current):
 * foul + sand bookkeeping → merge system → turn manager. Render order:
 * interpolate poses → wobble/liquid → slingshot + particles → stage.
 */

/** endless-lite draw pool (uniform for v1 — the director comes later) */
const POOL: readonly TierId[] = [1, 2, 3, 4, 5]

/** impacts below this force (N) don't nudge the camera */
const NUDGE_MIN_FORCE = 8
/** force (N above the gate) that maps to a full-strength nudge */
const NUDGE_FULL_FORCE = 70

/** sand corpse lifetime after the thud, fade tail, and the corpse cap */
const CORPSE_TTL_S = 2.5
const CORPSE_FADE_S = 0.5
const MAX_CORPSES = 8

/** in-world tray (next-drink preview) placement + scale */
const TRAY_X = 0.31
const TRAY_Z = CRADLE_Z - 0.02
const TRAY_SCALE = 0.8

const _nudge2 = new THREE.Vector2()
const _down = new THREE.Vector3(0, -1, 0)
const _tmp = new THREE.Vector3()

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

interface Corpse {
  drink: Drink
  thudded: boolean
  thudAt: number
  fading: boolean
  mats: Array<{ mat: THREE.Material; o0: number }>
}

interface LogEntry {
  t: number
  ev: string
  [k: string]: unknown
}

export async function createGameScene(ctx: BootCtx): Promise<SceneHandle> {
  resetDrinkIds()
  const rng = new Rng(seedFromUrl())

  const stage = createStage(ctx.renderer, { preset: 'golden' })
  const world = new PhysicsWorld()
  const sling = new SlingshotController(stage.camera, ctx.renderer.domElement, bus)
  stage.scene.add(sling.group)
  const hud = createHud()
  const puff = new SandPuff()
  stage.scene.add(puff.points)

  const unsubAudio = subscribeAudio(bus)
  const unsubGesture = resumeOnGesture(ctx.renderer.domElement)

  // ---- entity plumbing ----

  function attach(drink: Drink): void {
    const inst = instantiateDrink(drink.tier)
    inst.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true
    })
    drink.visual.add(inst.group)
    if (inst.liquid) drink.liquid = inst.liquid
    stage.scene.add(drink.root)
  }

  function remove(drink: Drink): void {
    // instantiateDrink clones liquid materials per instance — dispose them
    if (drink.liquid) {
      const vm = drink.liquid.volume.material as THREE.Material
      const cm = drink.liquid.cap.material as THREE.Material
      vm.dispose()
      cm.dispose()
    }
    world.removeDrink(drink)
  }

  const merge = new MergeSystem(world, bus, { attach, remove })

  // ---- score, logs, game-over ----

  let score = 0
  let gameOver = false
  let gameOverT = 0
  const camBase = stage.camera.position.clone()

  const logs: LogEntry[] = []
  function log(ev: string, fields: Record<string, unknown>): void {
    logs.push({ t: round3(world.time), ev, ...fields })
    if (logs.length > 50) logs.shift()
  }

  function triggerGameOver(offender: Drink): void {
    if (gameOver) return
    gameOver = true
    gameOverT = 0
    turn.end()
    sling.setActiveDrink(null)
    bus.emit('foul', { id: offender.id, tier: offender.tier })
    bus.emit('gameOver', { score, reason: 'foul' })
    log('gameOver', { score, offender: offender.id })
    hud.showGameOver(score, () => window.location.reload())
  }

  // ---- turn loop ----

  const turn = new TurnManager(rng, POOL)
  let cradle: Drink | null = null

  function spawnCradle(): void {
    const d = world.spawnDrink(turn.currentTier, 0, CRADLE_Z, {
      dropHeight: 0.05, // per the brief: 5 cm drop into the cradle
      state: 'cradle',
    })
    attach(d)
    cradle = d
    bus.emit('spawnDrop', { id: d.id, tier: d.tier })
    log('spawnDrop', { id: d.id, tier: d.tier })
  }

  // ---- in-world next-drink tray (visual only, no physics) ----

  const trayGroup = new THREE.Group()
  const trayMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.085, 0.014, 28),
    new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 0.75 })
  )
  trayMesh.position.y = 0.007
  trayMesh.castShadow = true
  trayMesh.receiveShadow = true
  trayGroup.add(trayMesh)
  trayGroup.position.set(TRAY_X, SURFACE_Y, TRAY_Z)
  stage.scene.add(trayGroup)

  let trayDrink: THREE.Group | null = null
  let trayLiquidMats: THREE.Material[] = []
  function refreshTray(): void {
    if (trayDrink) {
      trayGroup.remove(trayDrink)
      for (const m of trayLiquidMats) m.dispose()
      trayLiquidMats = []
    }
    const inst = instantiateDrink(turn.nextTier)
    inst.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true
    })
    inst.group.scale.setScalar(TRAY_SCALE)
    inst.group.position.y = 0.014
    if (inst.liquid) {
      // static world clip plane at the scaled fill height (no slosh on the tray)
      const fillWorldY = SURFACE_Y + 0.014 + inst.liquid.fillY * TRAY_SCALE
      inst.liquid.plane.setFromNormalAndCoplanarPoint(_down, _tmp.set(TRAY_X, fillWorldY, TRAY_Z))
      trayLiquidMats.push(
        inst.liquid.volume.material as THREE.Material,
        inst.liquid.cap.material as THREE.Material
      )
    }
    trayGroup.add(inst.group)
    trayDrink = inst.group
  }

  // ---- foul + sand ----

  const foulWarned = new Set<number>()
  const corpses: Corpse[] = []

  function startFade(c: Corpse): void {
    c.fading = true
    c.drink.visual.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const src = o.material
      const mats = Array.isArray(src) ? src : [src]
      const clones = mats.map((m) => {
        const clone = (m as THREE.Material).clone()
        clone.transparent = true
        c.mats.push({ mat: clone, o0: clone.opacity })
        return clone
      })
      // liquid materials were already per-instance clones — release them
      if (o.userData.liquidVolume || o.userData.liquidCap) {
        for (const m of mats) (m as THREE.Material).dispose()
      }
      o.material = Array.isArray(src) ? clones : clones[0]
    })
  }

  function applyFade(c: Corpse, k: number): void {
    for (const e of c.mats) e.mat.opacity = e.o0 * (1 - k)
  }

  function disposeCorpse(c: Corpse): void {
    for (const e of c.mats) e.mat.dispose()
    if (c.drink.state !== 'dead') remove(c.drink)
  }

  function updateFoulAndSand(dt: number): void {
    for (let i = world.all.length - 1; i >= 0; i--) {
      const d = world.all[i]
      if (d.state !== 'live') continue

      // off the table: over the open near edge, out a side gap, or already
      // below the surface (tunnel insurance) → free-fall with rotations
      if (
        d.currPos.z > NEAR_Z ||
        Math.abs(d.currPos.x) > TABLE.HALF_W + 0.05 ||
        d.currPos.y < SURFACE_Y - 0.02
      ) {
        d.state = 'sand'
        d.body.setEnabledRotations(true, true, true, true)
        bus.emit('fellOff', { id: d.id, tier: d.tier, position: d.currPos.clone() })
        log('fellOff', { id: d.id, tier: d.tier })
        corpses.push({ drink: d, thudded: false, thudAt: 0, fading: false, mats: [] })
        continue
      }

      // foul: at rest past the line
      if (!gameOver && d.currPos.z > FOUL_Z && d.speed < SETTLE_SPEED) {
        d.foulTime += dt
        if (d.foulTime >= FOUL_GRACE_S * 0.4 && !foulWarned.has(d.id)) {
          foulWarned.add(d.id)
          bus.emit('foulWarning', { id: d.id, remaining: FOUL_GRACE_S - d.foulTime })
          log('foulWarning', { id: d.id })
        }
        if (d.foulTime >= FOUL_GRACE_S) triggerGameOver(d)
      } else {
        d.foulTime = 0
        foulWarned.delete(d.id)
      }
    }

    // corpses: thud on first sand contact, fade out, despawn
    for (let i = corpses.length - 1; i >= 0; i--) {
      const c = corpses[i]
      if (c.drink.state === 'dead') {
        corpses.splice(i, 1)
        continue
      }
      if (!c.thudded) {
        if (world.contactPairs.has(world.pairKey(c.drink.collider.handle, world.sandHandle))) {
          c.thudded = true
          c.thudAt = world.time
          const pos = c.drink.currPos.clone()
          bus.emit('sandThud', { position: pos })
          log('sandThud', { id: c.drink.id, tier: c.drink.tier })
          puff.burst(pos)
          hud.pop(t('lostToSand'), pos, stage.camera)
        } else if (c.drink.currPos.y < -0.5) {
          c.thudded = true // tunneled below the slab somehow: still expire it
          c.thudAt = world.time
        }
        continue
      }
      const age = world.time - c.thudAt
      if (!c.fading && age >= CORPSE_TTL_S - CORPSE_FADE_S) startFade(c)
      if (c.fading) applyFade(c, Math.min(1, (age - (CORPSE_TTL_S - CORPSE_FADE_S)) / CORPSE_FADE_S))
      if (age >= CORPSE_TTL_S) {
        disposeCorpse(c)
        corpses.splice(i, 1)
      }
    }
    // cap the corpse count — oldest first
    while (corpses.length > MAX_CORPSES) {
      const c = corpses.shift()!
      disposeCorpse(c)
    }
  }

  // ---- event wiring ----

  const unsubs: Array<() => void> = []

  unsubs.push(
    bus.on('mergeStart', (e) => {
      log('mergeStart', { ids: e.ids.slice(), tier: e.tier, chain: e.chain })
    })
  )
  unsubs.push(
    bus.on('mergeDone', (e) => {
      score += e.score
      log('mergeDone', { id: e.newId, tier: e.tier, chain: e.chain, score: e.score, total: score })
      hud.setScore(score)
      const label = e.chain > 1 ? `+${e.score} ${t('chain', { n: e.chain })}` : `+${e.score}`
      hud.pop(label, e.centroid, stage.camera)
      bus.emit('scoreChange', { score, delta: e.score, worldPos: e.centroid })
    })
  )
  unsubs.push(
    bus.on('launch', (e) => {
      turn.onLaunch()
      cradle = null
      refreshTray()
      log('launch', { id: e.id, tier: e.tier, impulse: round3(e.impulse) })
    })
  )
  unsubs.push(bus.on('foulWarning', () => hud.flashFoulWarning()))
  unsubs.push(
    bus.on('impact', (e) => {
      // payload is REUSED by the physics layer — read fields, never retain
      if (gameOver || e.force < NUDGE_MIN_FORCE) return
      _nudge2.set(e.normal.x, -e.normal.z) // horizontal normal → screen axes
      if (_nudge2.lengthSq() < 1e-8) return
      stage.nudge(_nudge2, Math.min(1, (e.force - NUDGE_MIN_FORCE) / NUDGE_FULL_FORCE))
    })
  )

  // ---- boot the loop ----

  refreshTray()
  spawnCradle()

  let lastDt = 1 / 60

  const handle: SceneHandle = {
    fixedUpdate(dt: number): void {
      world.step(bus)
      updateFoulAndSand(dt)
      merge.fixedUpdate(dt)

      if (!gameOver) {
        let settled = !merge.busy
        if (settled) {
          for (const d of world.all) {
            if (d.state === 'live' && d.speed >= SETTLE_SPEED) {
              settled = false
              break
            }
          }
        }
        const action = turn.update(dt, settled)
        if (action === 'spawn') {
          spawnCradle()
        } else if (action === 'aimReady' && cradle) {
          sling.setActiveDrink(cradle)
          bus.emit('turnReady', {})
        }
      }
    },

    frameUpdate(alpha: number, frameDt: number): void {
      // stage.render(dt) drives the camera-nudge spring (omega 50, damping
      // c = 2*omega; its semi-implicit Euler needs c*dt < 2, i.e. dt < 20 ms,
      // or the spring detonates and NaNs the camera). Harness stepTo hands
      // 0.1 s accumulator slices as frameDt — clamp what the render side
      // sees to 1/60 s so nudges stay stable at any wall-clock rate.
      if (frameDt > 0) lastDt = Math.min(frameDt, 1 / 60)
      for (const d of world.all) {
        applyInterpolatedPose(d, alpha)
        updateFeel(d, frameDt)
      }
      sling.update(frameDt)
      puff.update(frameDt)
      if (gameOver) {
        // simple rise + tilt-down over the table
        gameOverT += frameDt
        const k = Math.min(1, gameOverT / 1.4)
        const e = 1 - (1 - k) * (1 - k)
        stage.camera.position.set(camBase.x, camBase.y + 0.55 * e, camBase.z + 0.15 * e)
        stage.camera.lookAt(0, SURFACE_Y, 0.3)
      }
    },

    render(): void {
      stage.render(lastDt)
    },

    onResize(w: number, h: number): void {
      stage.onResize(w, h)
    },

    dispose(): void {
      for (const u of unsubs) u()
      unsubAudio()
      unsubGesture()
      sling.dispose()
      hud.dispose()
      puff.dispose()
      world.dispose()
      stage.dispose()
    },
  }

  // ---- harness ----

  const api = {
    /** spawn a live drink directly on the table (cradle spot if x,z omitted) */
    spawn: (tier: TierId, x?: number, z?: number): number => {
      const d = world.spawnDrink(tier, x ?? 0, z ?? CRADLE_Z, { state: 'live' })
      attach(d)
      return d.id
    },
    /** launch the CURRENT cradle drink (same path as a slingshot release) */
    push: (angle: number, power: number): void => {
      const d = cradle
      if (!d || (turn.phase !== 'aim' && turn.phase !== 'drop')) return
      sling.setActiveDrink(null)
      d.state = 'live'
      applyLaunch(d, angle, power)
      bus.emit('launch', { id: d.id, tier: d.tier, impulse: launchImpulse(d.tier, power) })
    },
    stepTo: (s: number): void => ctx.scheduler.stepTo(s),
    capture: async (): Promise<void> => {
      handle.render()
    },
    state: () => ({
      score,
      chain: merge.chain,
      current: cradle ? cradle.tier : turn.currentTier,
      next: turn.nextTier,
      phase: turn.phase,
      gameOver,
      drinks: world.all.map((d) => ({
        id: d.id,
        tier: d.tier,
        x: round3(d.currPos.x),
        y: round3(d.currPos.y),
        z: round3(d.currPos.z),
        speed: round3(d.speed),
        state: d.state,
      })),
    }),
    /** ring buffer (50) of merge/score/turn events */
    logs: () => logs.slice(),
    // extras beyond HarnessApi, reachable from --eval:
    /** launch an arbitrary spawned drink (merge tests need a same-tier pusher) */
    shove: (id: number, angle: number, power: number): void => {
      const d = world.all.find((x) => x.id === id)
      if (!d || d.state !== 'live') return
      applyLaunch(d, angle, power)
    },
  }
  registerHarness(api as HarnessApi)

  return handle
}
