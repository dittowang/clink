import * as THREE from 'three'

/**
 * One renderer for the whole app. AgX tone mapping, soft shadows, half-res
 * transmission pass (glass tiers only use transmission). Pixel ratio capped
 * at 2 for phone GPUs.
 */
export function createRenderer(container: HTMLElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: false, // SMAA in the composer handles edges
    powerPreference: 'high-performance',
    stencil: false,
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.AgXToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.transmissionResolutionScale = 0.6
  renderer.localClippingEnabled = true // per-drink liquid planes
  container.appendChild(renderer.domElement)
  return renderer
}
