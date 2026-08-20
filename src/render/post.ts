import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { getQuality } from './quality'

/**
 * The one post chain: Render -> GTAO (subtle, clipped to the table zone) ->
 * UnrealBloom (threshold 1.0 — critic r1: metal lids bloomed into lamps at 0.95) ->
 * SMAA -> Output (AgX + sRGB).
 *
 * Perf (docs/PERF.md): GTAO only runs on the high quality tier (≈ 5.4 ms at
 * dpr 2 — the biggest lever); `lowPower` still force-drops it for A/B
 * captures. The low tier runs the bloom chain at half the composer
 * resolution. setSize re-reads the renderer's pixel ratio so dynamic
 * resolution changes (dynres.ts) resize every pass target through the same
 * path a window resize takes.
 */
export interface PostOptions {
  lowPower?: boolean
}

export interface Post {
  render(dt: number): void
  setSize(w: number, h: number): void
  dispose(): void
}

export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  opts: PostOptions = {}
): Post {
  const quality = getQuality()
  const size = renderer.getSize(new THREE.Vector2())
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))

  let gtao: GTAOPass | null = null
  if (quality.gtao && !opts.lowPower) {
    gtao = new GTAOPass(scene, camera, size.x, size.y)
    // AO exists to seat drinks on the plank — small radius, gentle blend,
    // clipped to the table zone so the beach never collects dirty halos.
    gtao.updateGtaoMaterial({
      radius: 0.2,
      distanceExponent: 1,
      thickness: 1,
      scale: 0.8,
      samples: 12,
      distanceFallOff: 0.7,
    })
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 8 })
    gtao.blendIntensity = 0.8
    gtao.setSceneClipBox(new THREE.Box3(
      new THREE.Vector3(-1.6, -0.1, -1.8),
      new THREE.Vector3(1.6, 1.8, 1.8)
    ))
    composer.addPass(gtao)
  }

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.35, 1.0)
  if (quality.bloomHalfRes) {
    // low tier: the whole mip chain at half res — composer.setSize keeps
    // calling through here, so the ratio survives resizes and dynres steps
    const orig = bloom.setSize.bind(bloom)
    bloom.setSize = (w: number, h: number) =>
      orig(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)))
    bloom.setSize(size.x, size.y)
  }
  composer.addPass(bloom)
  composer.addPass(new SMAAPass())
  composer.addPass(new OutputPass())

  return {
    render(dt) {
      composer.render(dt)
    },
    setSize(w, h) {
      // sync the composer to the renderer's CURRENT pixel ratio first —
      // dynres changes it between resizes
      composer.setPixelRatio(renderer.getPixelRatio())
      composer.setSize(w, h)
    },
    dispose() {
      composer.dispose()
    },
  }
}
