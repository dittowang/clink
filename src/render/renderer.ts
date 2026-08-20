import * as THREE from 'three'
import { initQuality } from './quality'

/**
 * One renderer for the whole app. AgX tone mapping, soft shadows, reduced-res
 * transmission pass (glass tiers only use transmission). Pixel ratio cap and
 * transmission resolution come from the boot quality tier (render/quality.ts):
 * dpr ≤ 2 / transmission 0.6 on high, dpr ≤ 1.5 / 0.5 on mid, dpr ≤ 1.25 with
 * an internal 0.8× render scale / 0.5 on low.
 */
export function createRenderer(container: HTMLElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: false, // SMAA in the composer handles edges
    powerPreference: 'high-performance',
    stencil: false,
  })
  initQuality(renderer) // sets pixel ratio + transmissionResolutionScale
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.AgXToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.localClippingEnabled = true // per-drink liquid planes
  container.appendChild(renderer.domElement)
  return renderer
}
