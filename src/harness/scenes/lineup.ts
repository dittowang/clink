import * as THREE from 'three'
import type { BootCtx, SceneHandle } from '../../main'
import { SURFACE_Y } from '../../config/table'
import { TIERS, TIER_IDS, type TierId } from '../../config/tiers'
import { instantiateDrink } from '../../drinks/index'
import { createStage, type Stage } from '../../render/stage'
import type { PresetName } from '../../render/presets'
import { registerHarness } from '../api'

/**
 * Product-shoot debug scene.
 *   ?scene=lineup                 all 12 drinks, two staggered rows, golden hour
 *   &only=3,5                     just those tiers, centered close-up
 *   &only=                       (empty) bare table — for judging presets
 *   &preset=morning|noon|golden|night
 *   &silhouette=1                 orthographic black-on-white ID test, no post
 */

interface Placed {
  tier: TierId
  key: string
  group: THREE.Group
  baseY: number
  scale: number
}

const PRESET_NAMES: readonly PresetName[] = ['morning', 'noon', 'golden', 'night']

export async function createLineupScene(ctx: BootCtx): Promise<SceneHandle> {
  const params = new URLSearchParams(window.location.search)
  const silhouette = params.get('silhouette') === '1'
  const onlyRaw = params.get('only')
  const presetRaw = params.get('preset')
  const preset: PresetName = PRESET_NAMES.includes(presetRaw as PresetName)
    ? (presetRaw as PresetName)
    : 'golden'

  const tiers: TierId[] =
    onlyRaw === null
      ? [...TIER_IDS]
      : onlyRaw
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n): n is TierId => Number.isInteger(n) && n >= 1 && n <= 12)

  const placed: Placed[] = []
  const size = new THREE.Vector2()
  ctx.renderer.getSize(size)

  let stage: Stage | null = null
  let scene: THREE.Scene
  let camera: THREE.Camera
  let lastDt = 1 / 60

  if (silhouette) {
    // ---- silhouette ID test: black fills on white, each drink ~128 px tall
    ctx.renderer.toneMapping = THREE.NoToneMapping
    scene = new THREE.Scene()
    scene.background = new THREE.Color(0xffffff)
    scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 })

    const TARGET_H = 0.3 // world metres that must map to ~128 px
    const GAP = 0.055
    let cursor = 0
    const entries: Array<{ tier: TierId; s: number; halfW: number }> = tiers.map((t) => {
      const def = TIERS[t]
      const s = TARGET_H / def.height
      return { tier: t, s, halfW: def.radius * s }
    })
    const total = entries.reduce((a, e) => a + e.halfW * 2, 0) + GAP * (entries.length - 1)
    cursor = -total / 2
    for (const e of entries) {
      const inst = instantiateDrink(e.tier)
      inst.group.scale.setScalar(e.s)
      inst.group.position.set(cursor + e.halfW, 0, 0)
      // static scene: level the liquid plane at the (scaled) fill height —
      // instantiateDrink hands out constant-0 planes for the game to drive
      if (inst.liquid) inst.liquid.plane.constant = e.s * inst.liquid.fillY
      scene.add(inst.group)
      placed.push({ tier: e.tier, key: TIERS[e.tier].key, group: inst.group, baseY: 0, scale: e.s })
      cursor += e.halfW * 2 + GAP
    }

    const orthoH = TARGET_H * (size.y / 128)
    const ortho = new THREE.OrthographicCamera(
      (-orthoH * (size.x / size.y)) / 2, (orthoH * (size.x / size.y)) / 2,
      orthoH / 2 + TARGET_H / 2, -orthoH / 2 + TARGET_H / 2,
      0.1, 20
    )
    ortho.position.set(0, 0, 5)
    ortho.lookAt(0, TARGET_H / 2, 0)
    // pure front view: keep the film plane vertical
    ortho.rotation.set(0, 0, 0)
    camera = ortho
  } else {
    // ---- the lit set: golden-hour beach stage
    // &lowpower=1 drops GTAO — used to A/B the AO contribution in captures
    stage = createStage(ctx.renderer, { preset, lowPower: params.get('lowpower') === '1' })
    scene = stage.scene
    camera = stage.camera

    const place = (tier: TierId, x: number, z: number, rotY: number): void => {
      const inst = instantiateDrink(tier)
      inst.group.position.set(x, SURFACE_Y, z)
      inst.group.rotation.y = rotY
      // static scene: level the liquid plane at the world fill height —
      // instantiateDrink hands out constant-0 planes for the game to drive
      if (inst.liquid) inst.liquid.plane.constant = SURFACE_Y + inst.liquid.fillY
      inst.group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true
          o.receiveShadow = true
        }
      })
      scene.add(inst.group)
      placed.push({ tier, key: TIERS[tier].key, group: inst.group, baseY: SURFACE_Y, scale: 1 })
    }

    if (onlyRaw === null) {
      // full lineup: two staggered rows of 6 along the table's LONG axis,
      // shot from the +X side like a product table
      const layRow = (row: TierId[], x: number, zShift: number): void => {
        const GAP = 0.075
        const total = row.reduce((a, t) => a + TIERS[t].radius * 2, 0) + GAP * (row.length - 1)
        let cursor = total / 2 // start at +Z (frame left), walk toward -Z
        row.forEach((t, i) => {
          const r = TIERS[t].radius
          place(t, x, cursor - r + zShift, i * 0.9)
          cursor -= r * 2 + GAP
        })
      }
      layRow([7, 8, 9, 10, 11, 12] as TierId[], -0.17, 0)
      layRow([1, 2, 3, 4, 5, 6] as TierId[], 0.18, 0.09) // staggered half a beat
      stage.camera.position.set(2.3, SURFACE_Y + 1.02, 0.05)
      stage.camera.lookAt(0, SURFACE_Y + 0.26, -0.02)
    } else if (tiers.length > 0) {
      // subset close-up: one row across X, camera pulled in from +Z
      const GAP = 0.06
      const total = tiers.reduce((a, t) => a + TIERS[t].radius * 2, 0) + GAP * (tiers.length - 1)
      let cursor = -total / 2
      let maxH = 0
      for (const t of tiers) {
        const r = TIERS[t].radius
        place(t, cursor + r, 0, 0.4)
        cursor += r * 2 + GAP
        maxH = Math.max(maxH, TIERS[t].height)
      }
      const extent = Math.max(total / 2, maxH)
      stage.camera.position.set(0, SURFACE_Y + 0.28 + extent * 0.9, 0.32 + extent * 2.3)
      stage.camera.lookAt(0, SURFACE_Y + maxH * 0.5, 0)
    }
    // tiers.length === 0 (&only=): bare table, stage default game framing
  }

  const proj = new THREE.Vector3()
  function state(): unknown {
    ctx.renderer.getSize(size)
    return {
      mode: silhouette ? 'silhouette' : onlyRaw === null ? 'lineup' : tiers.length ? 'subset' : 'empty',
      preset: silhouette ? null : preset,
      drinks: placed.map((p) => {
        const def = TIERS[p.tier]
        const r = def.radius * p.scale
        const h = def.height * p.scale
        const { x: px, z: pz } = p.group.position
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const cx of [-r, r]) {
          for (const cy of [0, h]) {
            for (const cz of [-r, r]) {
              proj.set(px + cx, p.baseY + cy, pz + cz).project(camera)
              const sx = (proj.x * 0.5 + 0.5) * size.x
              const sy = (1 - (proj.y * 0.5 + 0.5)) * size.y
              minX = Math.min(minX, sx); maxX = Math.max(maxX, sx)
              minY = Math.min(minY, sy); maxY = Math.max(maxY, sy)
            }
          }
        }
        return {
          tier: p.tier,
          key: p.key,
          box: {
            x: Math.round(minX), y: Math.round(minY),
            w: Math.round(maxX - minX), h: Math.round(maxY - minY),
          },
        }
      }),
    }
  }

  const handle: SceneHandle = {
    fixedUpdate() {},
    frameUpdate(_alpha, frameDt) {
      lastDt = frameDt
    },
    render() {
      if (stage) stage.render(lastDt)
      else ctx.renderer.render(scene, camera)
    },
    onResize(w, h) {
      if (stage) {
        stage.onResize(w, h)
      } else if (camera instanceof THREE.OrthographicCamera) {
        const orthoH = camera.top - camera.bottom
        camera.left = (-orthoH * (w / h)) / 2
        camera.right = (orthoH * (w / h)) / 2
        camera.updateProjectionMatrix()
      }
    },
    dispose() {
      stage?.dispose()
    },
  }

  registerHarness({
    spawn: () => 0,
    push: () => {},
    stepTo: (s) => ctx.scheduler.stepTo(s),
    capture: async () => {
      handle.render()
    },
    state,
  })
  // debug access for capture-harness experiments (nudge, presets, …)
  ;(window as unknown as Record<string, unknown>).__stage = stage

  return handle
}
