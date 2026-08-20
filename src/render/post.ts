import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

/**
 * The one post chain: Render -> GTAO (subtle, clipped to the table zone) ->
 * UnrealBloom (threshold 0.95 so ONLY glints and the sun disc bloom) ->
 * SMAA -> Output (AgX + sRGB). `lowPower` drops GTAO for phone GPUs.
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
  const size = renderer.getSize(new THREE.Vector2())
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))

  let gtao: GTAOPass | null = null
  if (!opts.lowPower) {
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

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.25, 0.4, 0.95)
  composer.addPass(bloom)
  composer.addPass(new SMAAPass())
  composer.addPass(new OutputPass())

  return {
    render(dt) {
      composer.render(dt)
    },
    setSize(w, h) {
      composer.setSize(w, h)
    },
    dispose() {
      composer.dispose()
    },
  }
}
