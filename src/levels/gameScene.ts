import * as THREE from 'three'
import type { BootCtx, SceneHandle } from '../main'
import {
  SURFACE_Y,
  NEAR_Z,
  CRADLE_Z,
  FOUL_Z,
  FOUL_GRACE_S,
  SETTLE_SPEED,
} from '../config/table'
import { TIERS, type TierId } from '../config/tiers'
import { levelById, levelSeed, LEVELS, starsToUnlockChapter, type LevelDef } from '../config/levels'
import { bus } from '../core/events'
import { Rng, seedFromUrl } from '../core/rng'
import { resetDrinkIds, type Drink } from '../core/drink'
import { t, tierName, setLocale, getLocale } from '../core/strings'
import { PhysicsWorld } from '../physics/world'
import { applyLaunch, launchImpulse } from '../physics/impulse'
import { applyInterpolatedPose } from '../physics/interpolate'
import { updateFeel } from '../physics/feel'
import { SlingshotController } from '../physics/slingshot'
import { tableFriction } from '../physics/materials'
import { createStage } from '../render/stage'
import { instantiateDrink } from '../drinks'
import { subscribe as subscribeAudio, resumeOnGesture, audio } from '../audio/engine'
import { registerHarness, type HarnessApi } from '../harness/api'
import { MergeSystem, mergeSurface } from '../merge/merge'
import { TurnManager } from './turns'
import { SpawnDirector } from './director'
import { SandPuff } from './sandPuff'
import { WindField, WindDrift } from './wind'
import { createDressing, type Dressing } from './dressing'
import { loadSave, persistSave, wipeSave, recordLevelStars, recordEndlessScore, totalStars } from './save'
import { createHud } from '../ui/hud'
import { createMenus } from '../ui/menus'

/**
 * The playable game scene — the full docs/GAME.md game: 24 levels + endless
 * around the verified core turn loop (spawn drop → aim → launch → clinks +
 * merges with chain ×1.5 → next drink on settle-or-timeout; foul past FOUL_Z
 * ends the run; the open near edge eats drinks into the sand).
 *
 * One stage/slingshot/HUD/menu layer lives for the whole session; each level
 * rebuilds the physics world, table visuals, dressing (umbrella, string
 * lights, wet decal), director and turn manager. Menus pause the fixed-step
 * sim; the sea keeps breathing underneath because stage.render still runs.
 *
 * Fixed-step order (after world.step so pose/contact data is current):
 * wind + slope-creep forces → foul + sand bookkeeping → merge system → goal
 * resolution → turn manager. Render order: interpolate poses → wobble/liquid
 * → slingshot + particles + dressing sway → sequences → stage.
 */

/**
 * Camera-nudge force gate, in newtons of HORIZONTAL contact force
 * (force · |normal_xz|). Calibrated from harness impact telemetry:
 *   cradle drop landing ≈ 0 N horizontal (total ~54 N but the normal is +Y),
 *   0.5 m/s can-on-can tap ≈ 18 N, full-pull can-on-can slam ≈ 68 N,
 *   full-pull can into a side rail ≈ 117 N, pitcher/keg shoves ≥ 100 N.
 * Gate at 40 N: taps and every routine landing stay still; only genuine
 * slams move the camera, proportionally.
 */
const NUDGE_MIN_FORCE = 40
/** horizontal force (N above the gate) that maps to a full-strength nudge */
const NUDGE_FULL_FORCE = 160

/** sand corpse lifetime after the thud, fade tail, and the corpse cap */
const CORPSE_TTL_S = 2.5
const CORPSE_FADE_S = 0.5
const MAX_CORPSES = 8

/** in-world tray (next-drink preview) placement + scale */
const TRAY_Z = CRADLE_Z - 0.02
const TRAY_SCALE = 0.8

/** goal met → the completion sequence starts after this beat (lets pops land) */
const COMPLETE_DELAY_S = 1.1

/** the game-over panel waits for the camera rise to (mostly) finish */
const END_MENU_DELAY_S = 1.15
/** foul rise / complete drift durations (s) */
const FOUL_RISE_S = 1.4
const COMPLETE_DRIFT_S = 1.6

/**
 * Slope creep — vibration-assisted stick-slip. Static friction (μ ≈ 0.31)
 * would pin drinks on a 2–4° plank forever, so while a live drink is slower
 * than the per-level creep speed it gets a downslope force that just beats
 * friction (modelling the micro-jitter of a busy beach table); above that
 * speed the force vanishes and friction takes over, so the net effect is a
 * slow, speed-capped slide toward the foul line. Deterministic, impulse-only.
 */
const CREEP_SPEED_PER_DEG = 0.006 // m/s of creep per degree of slope
const CREEP_FORCE_MARGIN = 1.35 // fraction of the friction-beating force applied

const _nudge2 = new THREE.Vector2()
const _down = new THREE.Vector3(0, -1, 0)
const _up = new THREE.Vector3(0, 1, 0)
const _tmp = new THREE.Vector3()
const _m4 = new THREE.Matrix4()
const _imp = { x: 0, y: 0, z: 0 }

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

type Outcome = 'playing' | 'complete' | 'failed' | 'foul'
type MenuScreen = 'none' | 'title' | 'chapters' | 'pause' | 'end'

export async function createGameScene(ctx: BootCtx): Promise<SceneHandle> {
  const save = loadSave()
  setLocale(save.locale)
  audio.setMuted(save.muted)

  const baseSeed = seedFromUrl()
  const stage = createStage(ctx.renderer, { preset: 'golden' })
  const sling = new SlingshotController(stage.camera, ctx.renderer.domElement, bus)
  stage.scene.add(sling.group)
  const hud = createHud()
  const puff = new SandPuff()
  stage.scene.add(puff.points)

  const unsubAudio = subscribeAudio(bus)
  const unsubGesture = resumeOnGesture(ctx.renderer.domElement)

  const camBasePos = stage.camera.position.clone()
  const camBaseQuat = stage.camera.quaternion.clone()

  // ---- per-level state (rebuilt by loadLevel) ----

  let def: LevelDef = levelById(0)!
  let world = new PhysicsWorld() // placeholder, replaced on first loadLevel
  let merge: MergeSystem
  let turn: TurnManager
  let director: SpawnDirector
  let dressing: Dressing | null = null
  let windField: WindField | null = null
  let windDrift: WindDrift | null = null
  let cradle: Drink | null = null

  let score = 0
  let outcome: Outcome = 'playing'
  let paused = false
  let menuScreen: MenuScreen = 'none'
  let goalDone = false
  let completeAt = Infinity
  let usedPushes = 0
  let pushesLeft: number | null = null
  let awaitingFinal = false
  let maxTierMade = 0
  let earnedStars = 0
  let seqT = 0 // drives the foul rise-tilt AND the complete drift-in
  // end-sequence camera pose: BOTH position and orientation blend from the
  // base pose to this — a raw lookAt() on frame 0 was a visible camera cut
  const seqEndPos = new THREE.Vector3()
  const seqEndQuat = new THREE.Quaternion()
  let pendingEndMenu: (() => void) | null = null

  /** aim the end-sequence pose: camera at `pos`, looking at (tx, ty, tz) */
  function setSeqEndPose(px: number, py: number, pz: number, tx: number, ty: number, tz: number): void {
    seqEndPos.set(px, py, pz)
    _m4.lookAt(seqEndPos, _tmp.set(tx, ty, tz), _up)
    seqEndQuat.setFromRotationMatrix(_m4)
  }

  const foulWarned = new Set<number>()
  const corpses: Corpse[] = []
  let pulseMats: THREE.Material[] = []
  let pulseEmissive: Array<THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial> = []

  const logs: LogEntry[] = []
  function log(ev: string, fields: Record<string, unknown>): void {
    logs.push({ t: round3(world.time), ev, ...fields })
    if (logs.length > 50) logs.shift()
  }

  // harness-only impact telemetry (payload is reused — copy fields).
  // hForce = force projected on the table plane: the camera-nudge gate input.
  interface ImpactSample {
    t: number
    force: number
    hForce: number
    nx: number
    ny: number
    nz: number
    matA: string
    matB: string
  }
  const impactSamples: ImpactSample[] = []

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

  // ---- goal helpers ----

  function goalText(): string {
    const g = def.goal
    switch (g.kind) {
      case 'makeTier':
        return t('goalMakeTier', { tier: tierName(g.tier) })
      case 'score':
        return def.pushes !== null
          ? t('goalScoreIn', { n: g.score, m: def.pushes })
          : t('goalScore', { n: g.score })
      case 'survive':
        return t('goalSurvive', { n: g.pushes })
      case 'endless':
        return t('endless')
    }
  }

  function computeStars(): number {
    if (def.goal.kind === 'endless') return 0
    let s = 1
    if (score >= def.stars[1]) s++
    if (score >= def.stars[2]) s++
    return s
  }

  function chapterUnlocked(ch: number): boolean {
    return totalStars(save) >= starsToUnlockChapter(ch)
  }

  function resumeTarget(): number {
    for (const lv of LEVELS) {
      if (chapterUnlocked(lv.chapter) && (save.stars[lv.id] ?? 0) === 0) return lv.id
    }
    for (const lv of LEVELS) {
      if (chapterUnlocked(lv.chapter) && (save.stars[lv.id] ?? 0) < 3) return lv.id
    }
    return LEVELS[LEVELS.length - 1].id
  }

  function nextPlayableId(): number | null {
    const next = LEVELS.find((lv) => lv.id === def.id + 1)
    if (next && chapterUnlocked(next.chapter)) return next.id
    return null
  }

  // ---- level lifecycle ----

  function unloadLevel(): void {
    for (const c of corpses) {
      for (const e of c.mats) e.mat.dispose()
    }
    corpses.length = 0
    foulWarned.clear()
    for (const m of pulseMats) m.dispose()
    pulseMats = []
    pulseEmissive = []
    for (const d of [...world.all]) {
      if (d.state !== 'dead') remove(d)
    }
    cradle = null
    if (trayDrink) {
      trayGroup.remove(trayDrink)
      for (const m of trayLiquidMats) m.dispose()
      trayLiquidMats = []
      trayDrink = null
    }
    dressing?.dispose()
    dressing = null
    if (windDrift) {
      stage.scene.remove(windDrift.points)
      windDrift.dispose()
      windDrift = null
    }
    windField = null
    world.dispose()
  }

  function loadLevel(id: number): void {
    const nextDef = levelById(id) ?? levelById(0)!
    unloadLevel()
    def = nextDef
    const mods = def.mods ?? {}

    resetDrinkIds()
    const rng = new Rng(levelSeed(baseSeed, def.id))
    world = new PhysicsWorld({
      halfW: mods.tableHalfW,
      slopeDeg: mods.slopeDeg,
      removeRails: mods.removeRails,
      wetPatch: mods.wetPatch,
    })
    mergeSurface.yAt = (z) => world.surfaceYAt(z)
    merge = new MergeSystem(world, bus, { attach, remove })
    director = new SpawnDirector(rng, def.pool, world)
    turn = new TurnManager(() => director.draw())

    stage.setPreset(def.preset)
    stage.rebuildTable({
      halfW: mods.tableHalfW,
      slopeDeg: mods.slopeDeg,
      removeRails: mods.removeRails,
    })
    sling.setSlope(mods.slopeDeg ?? 0)
    sling.setTableHalfW(world.halfW)
    sling.setActiveDrink(null)

    dressing = createDressing(def, world.halfW)
    stage.scene.add(dressing.group)
    if (mods.umbrella) world.addPole(mods.umbrella.x, mods.umbrella.z, 0.022)
    if (mods.wind) {
      windField = new WindField(levelSeed(baseSeed, def.id) ^ 0x5eed, mods.wind.amp)
      windDrift = new WindDrift(SURFACE_Y)
      stage.scene.add(windDrift.points)
    }

    // preplaced drinks: at rest before the first turn
    if (mods.preplaced) {
      for (const p of mods.preplaced) {
        const d = world.spawnDrink(p.tier, p.x, p.z, { dropHeight: 0.001, state: 'live' })
        attach(d)
      }
    }

    score = 0
    outcome = 'playing'
    goalDone = false
    completeAt = Infinity
    usedPushes = 0
    awaitingFinal = false
    maxTierMade = 0
    earnedStars = 0
    seqT = 0
    pendingEndMenu = null
    hud.setFoulWarning(false)
    pushesLeft = def.goal.kind === 'survive' ? def.goal.pushes : def.pushes

    hud.setScore(0)
    hud.setPushes(pushesLeft)
    hud.setObjective(def.goal.kind === 'endless' ? null : goalText(), false)

    // reset any sequence camera motion
    stage.camera.position.copy(camBasePos)
    stage.camera.quaternion.copy(camBaseQuat)

    trayGroup.position.set(world.halfW - 0.09, world.surfaceYAt(TRAY_Z), TRAY_Z)
    refreshTray()
    spawnCradle()
    log('levelLoad', { level: def.id })
  }

  // ---- outcomes ----

  function doComplete(): void {
    if (outcome !== 'playing') return
    outcome = 'complete'
    seqT = 0
    // gentle drift 14% of the way toward the table centre while the tally runs
    _tmp.set(0, SURFACE_Y + 0.1, 0).sub(camBasePos).multiplyScalar(0.14).add(camBasePos)
    setSeqEndPose(_tmp.x, _tmp.y, _tmp.z, 0, SURFACE_Y + 0.05, -0.55)
    hud.setFoulWarning(false)
    turn.end()
    sling.cancel()
    sling.setActiveDrink(null)
    earnedStars = computeStars()
    bus.emit('levelComplete', { stars: earnedStars, score })
    recordLevelStars(save, def.id, earnedStars)
    persistSave(save)
    log('levelComplete', { level: def.id, stars: earnedStars, score })
    menuScreen = 'end'
    menus.setPauseButtonVisible(false)
    menus.showLevelComplete({ level: def, stars: earnedStars, score, nextId: nextPlayableId() })
  }

  function doFail(): void {
    if (outcome !== 'playing') return
    outcome = 'failed'
    hud.setFoulWarning(false)
    turn.end()
    sling.cancel()
    sling.setActiveDrink(null)
    log('levelFailed', { level: def.id, score })
    menuScreen = 'end'
    menus.setPauseButtonVisible(false)
    menus.showLevelFailed(score)
  }

  function startOffenderPulse(offender: Drink): void {
    offender.visual.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const src = o.material
      const mats = Array.isArray(src) ? src : [src]
      const clones = mats.map((m) => {
        const clone = (m as THREE.Material).clone()
        pulseMats.push(clone)
        if (clone instanceof THREE.MeshStandardMaterial || clone instanceof THREE.MeshPhysicalMaterial) {
          clone.emissive.setHex(0xff4a26)
          pulseEmissive.push(clone)
        }
        return clone
      })
      // liquid materials were per-instance clones — release the originals
      if (o.userData.liquidVolume || o.userData.liquidCap) {
        for (const m of mats) (m as THREE.Material).dispose()
      }
      o.material = Array.isArray(src) ? clones : clones[0]
    })
  }

  function triggerGameOver(offender: Drink): void {
    if (outcome !== 'playing') return
    outcome = 'foul'
    seqT = 0
    // rise + tilt-down over the table; blended in frameUpdate, never cut
    setSeqEndPose(
      camBasePos.x, camBasePos.y + 0.55, camBasePos.z + 0.15,
      0, SURFACE_Y, 0.3
    )
    hud.setFoulWarning(false)
    turn.end()
    sling.cancel()
    sling.setActiveDrink(null)
    bus.emit('foul', { id: offender.id, tier: offender.tier })
    bus.emit('gameOver', { score, reason: 'foul' })
    log('gameOver', { score, offender: offender.id })
    startOffenderPulse(offender)
    menuScreen = 'end'
    menus.setPauseButtonVisible(false)
    // the panel waits for the camera rise — a full-opacity overlay one frame
    // after play was the "hard cut" a smooth rise cannot hide
    if (def.goal.kind === 'endless') {
      const rank = recordEndlessScore(save, score)
      persistSave(save)
      pendingEndMenu = () => menus.showEndlessGameOver(score, rank)
    } else {
      pendingEndMenu = () => menus.showFoulGameOver(score)
    }
  }

  // ---- turn loop ----

  /** clearance between the spawn's footprint and any resident drink (m) */
  const CRADLE_CLEAR_M = 0.012
  /** true when a drink of radius r can drop at (x, z) without overlap */
  function cradleSpotFree(x: number, z: number, r: number): boolean {
    for (const d of world.all) {
      if (d.state === 'dead') continue
      const dx = d.currPos.x - x
      const dz = d.currPos.z - z
      if (Math.hypot(dx, dz) < r + d.def.radius + CRADLE_CLEAR_M) return false
    }
    return true
  }

  // sidestep candidates when a drink is parked on the cradle spot — dropping
  // the spawn into it popped the solver. Lateral first, all a few cm, all
  // between the foul line and the open edge.
  const CRADLE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [0.07, 0], [-0.07, 0], [0.13, 0], [-0.13, 0],
    [0.07, 0.05], [-0.07, 0.05], [0, 0.06], [0.2, 0], [-0.2, 0],
  ]

  function spawnCradle(): void {
    const tier = turn.currentTier
    const r = TIERS[tier].radius
    let sx = 0
    let sz = CRADLE_Z
    if (!cradleSpotFree(sx, sz, r)) {
      for (const [ox, oz] of CRADLE_OFFSETS) {
        const cx = ox
        const cz = CRADLE_Z + oz
        if (Math.abs(cx) > world.halfW - r - 0.01) continue
        if (cz > NEAR_Z - r - 0.01 || cz < FOUL_Z + 0.03) continue
        if (cradleSpotFree(cx, cz, r)) {
          sx = cx
          sz = cz
          break
        }
      }
      // all candidates blocked: fall back to the pad (pre-fix behaviour)
    }
    const d = world.spawnDrink(tier, sx, sz, {
      dropHeight: 0.05, // per the brief: 5 cm drop into the cradle
      state: 'cradle',
    })
    attach(d)
    cradle = d
    bus.emit('spawnDrop', { id: d.id, tier: d.tier })
    log('spawnDrop', { id: d.id, tier: d.tier, x: round3(sx), z: round3(sz) })
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
  trayGroup.position.set(0.31, SURFACE_Y, TRAY_Z)
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
      const fillWorldY = trayGroup.position.y + 0.014 + inst.liquid.fillY * TRAY_SCALE
      inst.liquid.plane.setFromNormalAndCoplanarPoint(
        _down,
        _tmp.set(trayGroup.position.x, fillWorldY, TRAY_Z)
      )
      trayLiquidMats.push(
        inst.liquid.volume.material as THREE.Material,
        inst.liquid.cap.material as THREE.Material
      )
    }
    trayGroup.add(inst.group)
    trayDrink = inst.group
  }

  // ---- wind + slope creep (fixed step forces) ----

  function applyLevelForces(dt: number): void {
    if (windField) {
      windField.update(world.time)
      const s = windField.strength01
      if (s > 0.02) {
        for (const d of world.all) {
          if (d.state !== 'live' || d.body.isSleeping()) continue
          const f = windField.forceOn(d.def.radius, d.def.height)
          _imp.x = windField.dirX * f * dt
          _imp.y = 0
          _imp.z = windField.dirZ * f * dt
          d.body.applyImpulse(_imp, false)
        }
      }
    }
    if (world.slopeRad > 0) {
      const vCreep = ((def.mods?.slopeDeg ?? 0) * CREEP_SPEED_PER_DEG)
      const sin = Math.sin(world.slopeRad)
      const cos = Math.cos(world.slopeRad)
      for (const d of world.all) {
        if (d.state !== 'live') continue
        // only assist drinks that are ON the plank and (nearly) at rest
        if (d.speed >= vCreep) continue
        if (d.currPos.z > NEAR_Z || d.currPos.y > world.surfaceYAt(d.currPos.z) + d.def.height) continue
        const m = d.body.mass()
        const mu = tableFriction(d.def.material)
        // beat static friction by a margin; gravity already supplies mg·sinθ
        const f = Math.max(0, m * 9.81 * (mu * cos - sin)) * CREEP_FORCE_MARGIN
        _imp.x = 0
        _imp.y = 0
        _imp.z = f * dt
        d.body.applyImpulse(_imp, true)
      }
    }
  }

  // ---- foul + sand ----

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
    let foulDanger = false
    for (let i = world.all.length - 1; i >= 0; i--) {
      const d = world.all[i]
      if (d.state !== 'live') continue

      // off the table: over the open near edge, out a side gap (or a removed
      // rail), or already below the local surface (tunnel insurance)
      if (
        d.currPos.z > NEAR_Z ||
        Math.abs(d.currPos.x) > world.halfW + 0.05 ||
        d.currPos.y < world.surfaceYAt(d.currPos.z) - 0.02
      ) {
        d.state = 'sand'
        d.body.setEnabledRotations(true, true, true, true)
        bus.emit('fellOff', { id: d.id, tier: d.tier, position: d.currPos.clone() })
        log('fellOff', { id: d.id, tier: d.tier })
        corpses.push({ drink: d, thudded: false, thudAt: 0, fading: false, mats: [] })
        continue
      }

      // foul: at rest past the line (suspended once the goal is met — the
      // completion beat must never be stolen by a teetering drink)
      if (outcome === 'playing' && !goalDone && d.currPos.z > FOUL_Z && d.speed < SETTLE_SPEED) {
        d.foulTime += dt
        if (d.foulTime >= FOUL_GRACE_S * 0.4) {
          foulDanger = true
          if (!foulWarned.has(d.id)) {
            foulWarned.add(d.id)
            bus.emit('foulWarning', { id: d.id, remaining: FOUL_GRACE_S - d.foulTime })
            log('foulWarning', { id: d.id })
          }
        }
        if (d.foulTime >= FOUL_GRACE_S) triggerGameOver(d)
      } else {
        d.foulTime = 0
        foulWarned.delete(d.id)
      }
    }
    // pill stays up (pulsing) for the whole tail of the grace window; the
    // outcome handlers clear it the moment the consequence takes the screen
    if (outcome === 'playing') hud.setFoulWarning(foulDanger)

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

  // ---- pause / menus ----

  function pauseIntoMenu(screen: 'title' | 'pause' | 'chapters'): void {
    paused = true
    menuScreen = screen
    sling.cancel()
    sling.setActiveDrink(null)
    menus.setPauseButtonVisible(false)
    hud.setVisible(screen === 'pause')
    if (screen === 'title') menus.showTitle()
    else if (screen === 'chapters') menus.showChapters()
    else menus.showPause()
  }

  function resumePlay(): void {
    paused = false
    menuScreen = 'none'
    menus.hideAll()
    hud.setVisible(true)
    menus.setPauseButtonVisible(outcome === 'playing')
    if (outcome === 'playing' && cradle && turn.phase === 'aim') sling.setActiveDrink(cradle)
  }

  const menus = createMenus({
    onPlay(levelId) {
      menus.hideAll()
      loadLevel(levelId)
      paused = false
      menuScreen = 'none'
      hud.setVisible(true)
      menus.setPauseButtonVisible(true)
    },
    onResume: () => resumePlay(),
    onRestart() {
      menus.hideAll()
      loadLevel(def.id)
      paused = false
      menuScreen = 'none'
      hud.setVisible(true)
      menus.setPauseButtonVisible(true)
    },
    onQuit: () => pauseIntoMenu('title'),
    onPauseRequest() {
      if (outcome === 'playing' && !paused) pauseIntoMenu('pause')
    },
    onToggleSound() {
      save.muted = !save.muted
      persistSave(save)
      bus.emit('muteChange', { muted: save.muted })
      return save.muted
    },
    onToggleLocale() {
      const next = getLocale() === 'en' ? 'zh-CN' : 'en'
      setLocale(next)
      save.locale = next
      persistSave(save)
      hud.relabel()
      if (outcome === 'playing') {
        hud.setObjective(def.goal.kind === 'endless' ? null : goalText(), goalDone)
        hud.setPushes(pushesLeft)
      }
    },
    resumeTarget: () => resumeTarget(),
    save: () => save,
  })

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return
    if (outcome !== 'playing') return
    if (!paused) pauseIntoMenu('pause')
    else if (menuScreen === 'pause') resumePlay()
  }
  window.addEventListener('keydown', onKeyDown)

  // ---- event wiring (global; handlers consult the current run) ----

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
      if (e.tier > maxTierMade) maxTierMade = e.tier
      if (outcome !== 'playing' || goalDone) return
      const g = def.goal
      if (
        (g.kind === 'makeTier' && e.tier >= g.tier) ||
        (g.kind === 'score' && score >= g.score)
      ) {
        goalDone = true
        completeAt = world.time + COMPLETE_DELAY_S
        hud.setObjective(goalText(), true)
      }
    })
  )
  unsubs.push(
    bus.on('launch', (e) => {
      turn.onLaunch()
      cradle = null
      refreshTray()
      usedPushes++
      if (pushesLeft !== null) {
        pushesLeft = Math.max(0, pushesLeft - 1)
        hud.setPushes(pushesLeft)
      }
      log('launch', { id: e.id, tier: e.tier, impulse: round3(e.impulse) })
    })
  )
  unsubs.push(
    bus.on('impact', (e) => {
      // payload is REUSED by the physics layer — read fields, never retain
      const nh = Math.hypot(e.normal.x, e.normal.z)
      const hForce = e.force * nh
      if (ctx.harness) {
        impactSamples.push({
          t: round3(world.time),
          force: round3(e.force),
          hForce: round3(hForce),
          nx: round3(e.normal.x),
          ny: round3(e.normal.y),
          nz: round3(e.normal.z),
          matA: e.matA,
          matB: e.matB,
        })
        if (impactSamples.length > 120) impactSamples.shift()
      }
      // nudge gate: HORIZONTAL force only, so a vertical cradle-drop landing
      // (normal ≈ ±Y, huge total force) never shakes the screen. Strength is
      // proportional above the gate — light clinks stay still, only genuine
      // slams move the camera.
      if (outcome !== 'playing' || paused || hForce < NUDGE_MIN_FORCE) return
      _nudge2.set(e.normal.x, -e.normal.z) // horizontal normal → screen axes
      if (_nudge2.lengthSq() < 1e-8) return
      stage.nudge(_nudge2, Math.min(1, (hForce - NUDGE_MIN_FORCE) / NUDGE_FULL_FORCE))
    })
  )

  // ---- boot ----

  const params = new URLSearchParams(window.location.search)
  const urlLevel = params.get('level')
  if (urlLevel !== null) {
    loadLevel(Number(urlLevel) || 0)
    menus.setPauseButtonVisible(!ctx.harness)
  } else if (ctx.harness) {
    loadLevel(0) // deterministic captures: straight into endless, no menus
  } else {
    loadLevel(resumeTarget())
    pauseIntoMenu('title')
  }

  let lastDt = 1 / 60

  const handle: SceneHandle = {
    fixedUpdate(dt: number): void {
      if (paused) return
      world.step(bus)
      applyLevelForces(dt)
      updateFoulAndSand(dt)
      merge.fixedUpdate(dt)

      if (outcome === 'playing') {
        let settled = !merge.busy
        if (settled) {
          for (const d of world.all) {
            if (d.state === 'live' && d.speed >= SETTLE_SPEED) {
              settled = false
              break
            }
          }
        }

        // goal met → completion beat (waits out the merge animations);
        // no new turns spawn while the beat runs
        if (goalDone) {
          if (world.time >= completeAt && !merge.busy) doComplete()
          return
        }
        // final push resolved without the goal → failed (waits for settle)
        if (awaitingFinal) {
          if (settled) doFail()
          return
        }

        const action = turn.update(dt, settled)
        if (action === 'spawn') {
          const g = def.goal
          if (g.kind === 'survive' && usedPushes >= g.pushes) {
            goalDone = true
            hud.setObjective(goalText(), true)
            doComplete()
          } else if (g.kind !== 'survive' && g.kind !== 'endless' && pushesLeft !== null && pushesLeft <= 0 && !goalDone) {
            awaitingFinal = true // resolve on true settle, not the turn timeout
          } else {
            spawnCradle()
          }
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
      if (paused) return
      for (const d of world.all) {
        applyInterpolatedPose(d, alpha)
        updateFeel(d, frameDt)
      }
      sling.update(frameDt)
      puff.update(frameDt)
      if (windField && windDrift) windDrift.update(frameDt, windField)
      dressing?.update(frameDt, world.time, windField?.strength01 ?? 0, windField?.dirX ?? 1)

      if (outcome === 'foul') {
        // rise + tilt-down over the table; the offender pulses, the sea rolls.
        // Position AND orientation ease from the base pose — a lookAt() from
        // frame 0 snapped the pitch instantly (a camera teleport).
        seqT += frameDt
        const k = Math.min(1, seqT / FOUL_RISE_S)
        const e = k * k * (3 - 2 * k) // smoothstep: the camera LIFTS off, no jolt
        stage.camera.position.lerpVectors(camBasePos, seqEndPos, e)
        stage.camera.quaternion.slerpQuaternions(camBaseQuat, seqEndQuat, e)
        const pulse = 0.5 + 0.5 * Math.sin(seqT * Math.PI * 2 * 1.4)
        for (const m of pulseEmissive) m.emissiveIntensity = 0.15 + 0.85 * pulse
        if (pendingEndMenu && seqT >= END_MENU_DELAY_S) {
          const show = pendingEndMenu
          pendingEndMenu = null
          show()
        }
      } else if (outcome === 'complete') {
        // brief drift-in toward the table centre while the tally runs
        seqT += frameDt
        const k = Math.min(1, seqT / COMPLETE_DRIFT_S)
        const e = k * k * (3 - 2 * k)
        stage.camera.position.lerpVectors(camBasePos, seqEndPos, e)
        stage.camera.quaternion.slerpQuaternions(camBaseQuat, seqEndQuat, e)
      }
    },

    render(): void {
      stage.render(lastDt)
    },

    onResize(w: number, h: number): void {
      // mid-pull resize/orientation change: cancel the pull cleanly
      sling.cancel()
      stage.onResize(w, h)
    },

    dispose(): void {
      for (const u of unsubs) u()
      window.removeEventListener('keydown', onKeyDown)
      unsubAudio()
      unsubGesture()
      unloadLevel()
      menus.dispose()
      sling.dispose()
      hud.dispose()
      puff.dispose()
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
      level: def.id,
      score,
      chain: merge.chain,
      current: cradle ? cradle.tier : turn.currentTier,
      next: turn.nextTier,
      phase: turn.phase,
      outcome,
      paused,
      gameOver: outcome === 'foul',
      pushesLeft,
      stars: earnedStars,
      goalProgress: (() => {
        const g = def.goal
        switch (g.kind) {
          case 'makeTier':
            return { kind: g.kind, target: g.tier, value: maxTierMade, done: goalDone }
          case 'score':
            return { kind: g.kind, target: g.score, value: score, done: goalDone }
          case 'survive':
            return { kind: g.kind, target: g.pushes, value: usedPushes, done: goalDone }
          case 'endless':
            return { kind: g.kind, target: null, value: score, done: false }
        }
      })(),
      wind: windField ? round3(windField.strength01 * windField.amp) : 0,
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
    /** ring buffer (120) of impact events with horizontal-force breakdown */
    impacts: () => impactSamples.slice(),
    loadLevel: (id: number): void => loadLevel(id),
    save: () => JSON.parse(JSON.stringify(save)) as unknown,
    wipeSave: (): void => {
      wipeSave()
      save.stars = {}
      save.endless = []
    },
    // extras beyond HarnessApi, reachable from --eval:
    /** launch an arbitrary spawned drink (merge tests need a same-tier pusher) */
    shove: (id: number, angle: number, power: number): void => {
      const d = world.all.find((x) => x.id === id)
      if (!d || d.state !== 'live') return
      applyLaunch(d, angle, power)
    },
    /** QA: draw histogram + weight row against the current table state */
    directorStats: (n: number) => director.stats(n),
    /** QA: override wind amplitude (0 disables); same seed → same gust curve */
    setWind: (amp: number): void => {
      windField = amp > 0 ? new WindField(levelSeed(baseSeed, def.id) ^ 0x5eed, amp) : null
      if (windField && !windDrift) {
        windDrift = new WindDrift(SURFACE_Y)
        stage.scene.add(windDrift.points)
      }
    },
    /** QA: open a menu screen without pointer input */
    ui: (screen: 'title' | 'chapters' | 'pause' | 'none'): void => {
      if (screen === 'none') resumePlay()
      else pauseIntoMenu(screen)
    },
  }
  registerHarness(api as unknown as HarnessApi)

  return handle
}
