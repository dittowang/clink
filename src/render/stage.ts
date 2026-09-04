import * as THREE from 'three'
import { SURFACE_Y } from '../config/table'
import { PRESETS, sunDirection, type PresetName, type LightingPreset } from './presets'
import { createEnvironment } from './environment'
import { createBeach } from './beach'
import { createShore } from './shore'
import { createScenery } from './scenery'
import { createTable, disposeTable, type TableBuildOpts } from './table'
import { createPost } from './post'
import { createCameraRig } from './camera'
import { getQuality } from './quality'
import { createDynRes } from './dynres'

/**
 * The beach render stage — owns the scene, the one sun, the beach, the
 * table, the IBL environment, the camera rig and the post chain. Everything
 * lighting-related routes through setPreset().
 */
export interface StageOptions {
  /** skip GTAO (phones) */
  lowPower?: boolean
  preset?: PresetName
}

export interface Stage {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  /** canonical camera pose (no nudge/sequence); refreshed on resize */
  cameraBase: { pos: THREE.Vector3; quat: THREE.Quaternion }
  sun: THREE.DirectionalLight
  tableGroup: THREE.Group
  setPreset(p: PresetName): void
  /**
   * Swap the table visuals for a level's build (narrow / tilted / railless).
   * Additive: never called → the classic table from construction stands.
   */
  rebuildTable(opts: TableBuildOpts): void
  /** renders through the composer; dt in seconds drives sea + nudge springs */
  render(dt: number): void
  onResize(w: number, h: number): void
  /** impact nudge: <= 5 px along the impact axis, critically damped return */
  nudge(dir: THREE.Vector2, strength01: number): void
  preset(): PresetName
  /**
   * Boot warm-up (first-spawn hitch): with `extra` temporarily in the scene,
   * precompile every program against the composer's render-target variant,
   * upload every texture, and (unless `render: false`) run two real composer
   * frames — they allocate the transmission + post targets and compile the
   * shadow-depth and per-instance clip-plane variants only a real draw
   * reaches. `sync` = no async compile (harness). Removes `extra` after.
   * `render: false` is the compile-only mode the deferred fade-variant pass
   * uses while the title screen is already up (nothing may be drawn then).
   */
  warmup(extra: THREE.Object3D[], opts: WarmupOptions): Promise<WarmupReport>
  dispose(): void
}

export type WarmupPhase = 'compile' | 'textures' | 'render'

export interface WarmupOptions {
  sync: boolean
  /** default true; false = precompile + texture upload only, no frames */
  render?: boolean
  onPhase?: (phase: WarmupPhase) => void
  /** compile only the `extra` objects (against the scene's lights/env) —
   *  the deferred fade pass uses this so a level load mid-compile can't hand
   *  compileAsync a disposed material */
  onlyExtra?: boolean
}

export interface WarmupReport {
  compileMs: number
  textureMs: number
  textures: number
  /** first (compiles leftovers, allocates targets) and second (steady) frame */
  renderMs: [number, number]
  programs: number
}

/** distance of the light along the sun direction from the table centre */
const SUN_DIST = 9

export function createStage(renderer: THREE.WebGLRenderer, opts: StageOptions = {}): Stage {
  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0xe7b083, 0.009)

  const size = renderer.getSize(new THREE.Vector2())
  const rig = createCameraRig(size.x, size.y)
  scene.add(rig.camera)

  // ONE directional light; hemisphere is fill only, never a shadow caster.
  const sun = new THREE.DirectionalLight(0xffffff, 3)
  sun.castShadow = true
  // 2048 on the high tier; 1024 on mid/low (docs/PERF.md)
  const shadowSize = getQuality().shadowMapSize
  sun.shadow.mapSize.set(shadowSize, shadowSize)
  // fitted to table + margin. Was ±2.1 (2 mm/texel): the edge decor's
  // shadows land on sand out to |u|,|v| ≈ 2.8 in light space (palm fronds
  // beside the palms at noon, by the table sides at night), so the high and
  // mid tiers widen to keep them — 2.7 mm/texel at 2048, 5.1 mm at 1024.
  // Low keeps the tight fit: its decor casts nothing. near pulled in so a
  // 4 m palm crown (7 m up the sun axis) is inside the caster range.
  const shadowHalf = { high: 2.8, mid: 2.6, low: 2.1 }[getQuality().tier]
  const sc = sun.shadow.camera
  sc.left = -shadowHalf; sc.right = shadowHalf
  sc.top = shadowHalf; sc.bottom = -shadowHalf
  sc.near = SUN_DIST - 7.5
  sc.far = SUN_DIST + 8
  sun.shadow.bias = -0.00018
  sun.shadow.normalBias = 0.0025
  sun.target.position.set(0, SURFACE_Y * 0.5, 0)
  scene.add(sun, sun.target)

  const hemi = new THREE.HemisphereLight(0xb9d4ee, 0xd8c39a, 0.5)
  scene.add(hemi)

  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  const beach = createBeach(maxAniso)
  scene.add(beach.group)
  // near shoreline + edge decor: the beach the table-fit camera can see
  const shore = createShore()
  scene.add(shore.group)
  const scenery = createScenery(maxAniso)
  scene.add(scenery.group)

  let tableGroup = createTable(maxAniso)
  scene.add(tableGroup)

  const env = createEnvironment(renderer, scene)
  const post = createPost(renderer, scene, rig.camera, { lowPower: opts.lowPower })

  // dynamic resolution: steps the renderer pixel ratio 0.7–1.0× of the tier
  // dpr on sustained over/under budget, resizing the composer through the
  // same post.setSize path a window resize takes (camera aspect unchanged)
  const dynres = createDynRes(renderer, () => {
    const s = renderer.getSize(new THREE.Vector2())
    post.setSize(s.x, s.y)
  })

  const sunDir = new THREE.Vector3()
  let current: PresetName = opts.preset ?? 'golden'
  let time = 0

  function applyPreset(p: LightingPreset): void {
    sunDirection(p, sunDir)
    sun.position.copy(sun.target.position).addScaledVector(sunDir, SUN_DIST)
    sun.color.setHex(p.sunColor)
    sun.intensity = p.sunIntensity
    hemi.color.setHex(p.hemiSky)
    hemi.groundColor.setHex(p.hemiGround)
    hemi.intensity = p.hemiIntensity
    const fog = scene.fog as THREE.FogExp2
    fog.color.setHex(p.fogColor)
    fog.density = p.fogDensity
    renderer.toneMappingExposure = p.exposure
    beach.apply(p, sunDir)
    shore.apply(p, sunDir)
    env.apply(p, sunDir)
  }
  applyPreset(PRESETS[current])

  return {
    scene,
    camera: rig.camera,
    cameraBase: { pos: rig.basePos, quat: rig.baseQuat },
    sun,
    get tableGroup() {
      return tableGroup
    },
    setPreset(p) {
      current = p
      applyPreset(PRESETS[p])
    },
    rebuildTable(tableOpts) {
      scene.remove(tableGroup)
      disposeTable(tableGroup)
      tableGroup = createTable(maxAniso, tableOpts)
      scene.add(tableGroup)
    },
    preset: () => current,
    render(dt) {
      dynres.update()
      time += dt
      beach.update(time)
      shore.update(time)
      rig.update(dt)
      post.render(dt)
    },
    onResize(w, h) {
      rig.onResize(w, h)
      post.setSize(w, h)
    },
    nudge(dir, strength01) {
      rig.nudge(dir, strength01)
    },
    async warmup(extra, opts) {
      const report: WarmupReport = {
        compileMs: 0, textureMs: 0, textures: 0, renderMs: [0, 0], programs: 0,
      }
      for (const o of extra) scene.add(o)
      // the composer's RenderPass draws into a HalfFloat target and the
      // program cache key depends on the bound target (no tone mapping,
      // linear output) — compiling against the canvas would build variants
      // that never run. A 1×1 target of the same type stands in.
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })
      const compile = async (): Promise<void> => {
        renderer.setRenderTarget(rt)
        let pending: Promise<unknown> | null = null
        try {
          const targets: THREE.Object3D[] = opts.onlyExtra ? extra : [scene]
          if (opts.sync || typeof renderer.compileAsync !== 'function') {
            for (const o of targets) renderer.compile(o, rig.camera, scene)
          } else {
            // compileAsync issues every compile synchronously and only the
            // readiness polling is deferred — unbind the target before
            // awaiting so a game frame in the meantime draws normally
            pending = Promise.all(targets.map((o) => renderer.compileAsync(o, rig.camera, scene)))
          }
        } finally {
          renderer.setRenderTarget(null)
        }
        if (pending) await pending
      }
      try {
        let t = performance.now()
        await compile()
        report.compileMs = performance.now() - t
        opts.onPhase?.('compile')

        // texture upload: every texture reachable from any material in the
        // scene (canvas labels, table + beach maps) — first draw would
        // otherwise upload them one frame at a time
        t = performance.now()
        const seen = new Set<THREE.Texture>()
        scene.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
          if (!m) return
          for (const mat of Array.isArray(m) ? m : [m]) {
            for (const v of Object.values(mat) as unknown[]) {
              const tex = v as THREE.Texture | null
              if (tex && typeof tex === 'object' && tex.isTexture && !seen.has(tex)) {
                seen.add(tex)
                renderer.initTexture(tex)
              }
            }
          }
        })
        report.textures = seen.size
        report.textureMs = performance.now() - t
        opts.onPhase?.('textures')

        // real frames through the composer
        if (opts.render !== false) {
          t = performance.now()
          post.render(0)
          report.renderMs[0] = performance.now() - t
          t = performance.now()
          post.render(0)
          report.renderMs[1] = performance.now() - t
          opts.onPhase?.('render')
        }
      } finally {
        for (const o of extra) scene.remove(o)
        rt.dispose()
      }
      report.programs = renderer.info.programs?.length ?? 0
      return report
    },
    dispose() {
      post.dispose()
      env.dispose()
      beach.dispose()
      shore.dispose()
      scenery.dispose()
    },
  }
}
