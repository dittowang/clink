import * as THREE from 'three'
import { SURFACE_Y } from '../config/table'
import { PRESETS, sunDirection, type PresetName, type LightingPreset } from './presets'
import { createEnvironment } from './environment'
import { createBeach } from './beach'
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
  dispose(): void
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
  // fitted to table + enough margin that the low-sun table shadow on the
  // sand is never clipped (morning elev 17° throws ~2.4 m) — 2 mm/texel
  const sc = sun.shadow.camera
  sc.left = -2.1; sc.right = 2.1
  sc.top = 2.1; sc.bottom = -2.1
  sc.near = SUN_DIST - 4
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
    env.apply(p, sunDir)
  }
  applyPreset(PRESETS[current])

  return {
    scene,
    camera: rig.camera,
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
    dispose() {
      post.dispose()
      env.dispose()
      beach.dispose()
    },
  }
}
