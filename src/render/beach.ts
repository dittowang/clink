import * as THREE from 'three'
import { BILLBOARD_DIST, type LightingPreset } from './presets'
import { createSkyMaterial, applySkyUniforms } from './environment'
import { makeSandMaps, makeSunSprite, makeMoonSprite } from './textures'
import {
  SEA_UNIFORMS_GLSL, SEA_FUNCS_GLSL, SEA_VERTEX_GLSL,
  makeSeaUniforms, applySeaUniforms,
} from './seaShading'

/**
 * The visible beach around the table: sand disc, animated sea out to the
 * horizon, gradient sky dome, sun/moon billboard. All shader work is
 * fragment-cheap (a few sines) — the sea is one draw call.
 */

/** the sand disc: centre pushed behind the camera so the FAR water wraps
 *  the sides at a distance (lineup side view); the near shoreline the game
 *  camera sees is cut into it by shore.ts at z ≈ -2.8 */
export const SAND_R = 14
export const SAND_CENTER_Z = 6
const SKY_R = 400

export interface Beach {
  group: THREE.Group
  apply(preset: LightingPreset, sunDir: THREE.Vector3): void
  /** advance the sea swell; timeSec is accumulated render time */
  update(timeSec: number): void
  dispose(): void
}

export function createBeach(maxAniso: number): Beach {
  const group = new THREE.Group()
  group.name = 'beach'

  // --- sand ---------------------------------------------------------------
  const sandMaps = makeSandMaps(maxAniso)
  sandMaps.map.repeat.set(16, 16)
  sandMaps.gray.repeat.set(16, 16)
  const sandMat = new THREE.MeshStandardMaterial({
    map: sandMaps.map,
    bumpMap: sandMaps.gray,
    bumpScale: 0.25,
    roughness: 1.0,
    metalness: 0,
  })
  const sand = new THREE.Mesh(new THREE.CircleGeometry(SAND_R, 48), sandMat)
  sand.rotation.x = -Math.PI / 2
  sand.position.set(0, 0, SAND_CENTER_Z)
  sand.receiveShadow = true
  group.add(sand)

  // --- sea ----------------------------------------------------------------
  const seaMat = new THREE.ShaderMaterial({
    fog: false, // fog folded into the shader (FogExp2-compatible)
    uniforms: {
      ...makeSeaUniforms(),
      uShoreCenter: { value: new THREE.Vector2(0, SAND_CENTER_Z) },
      uShoreR: { value: SAND_R },
    },
    vertexShader: SEA_VERTEX_GLSL,
    fragmentShader: /* glsl */ `
      ${SEA_UNIFORMS_GLSL}
      uniform float uShoreR;
      uniform vec2 uShoreCenter;
      varying vec3 vWorld;
      ${SEA_FUNCS_GLSL}
      void main() {
        vec3 V = normalize(cameraPosition - vWorld);
        vec2 p = vWorld.xz;
        float t = uTime;
        vec3 N = seaNormal(p, t);
        vec3 col = seaColor(vWorld, V, N, t);
        // foam just seaward of the sand disc edge (the distant wrap-around
        // shoreline; the near bay foam is shore.ts)
        float sd = length(p - uShoreCenter) - uShoreR;
        float wob = sin(p.x * 0.7 + t * 0.7) * 0.5 + sin(p.y * 0.9 - t * 0.5) * 0.4;
        float foam = smoothstep(1.1, 0.0, abs(sd - 0.7 + wob)) * step(0.0, sd);
        col = mix(col, uFoam, foam * 0.4);
        col = seaFog(col, length(cameraPosition - vWorld));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
  const sea = new THREE.Mesh(new THREE.CircleGeometry(SKY_R - 15, 64), seaMat)
  sea.rotation.x = -Math.PI / 2
  sea.position.y = -0.06
  group.add(sea)

  // --- sky dome -----------------------------------------------------------
  const skyMat = createSkyMaterial()
  const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_R, 40, 24), skyMat)
  group.add(sky)

  // --- sun / moon billboard -----------------------------------------------
  const sunTex = makeSunSprite()
  const moonTex = makeMoonSprite()
  // fog:false — at 330 m the scene fog would otherwise swallow the discs
  const sunMat = new THREE.SpriteMaterial({ map: sunTex, depthWrite: false, transparent: true, fog: false })
  const moonMat = new THREE.SpriteMaterial({ map: moonTex, depthWrite: false, transparent: true, fog: false })
  const sunSprite = new THREE.Sprite(sunMat)
  const moonSprite = new THREE.Sprite(moonMat)
  group.add(sunSprite, moonSprite)

  return {
    group,
    apply(p, sunDir) {
      applySeaUniforms(seaMat.uniforms, p, sunDir)

      applySkyUniforms(skyMat, p, sunDir)

      const active = p.moon ? moonSprite : sunSprite
      const idle = p.moon ? sunSprite : moonSprite
      idle.visible = false
      active.visible = true
      active.position.copy(sunDir).multiplyScalar(BILLBOARD_DIST)
      active.scale.setScalar(p.discRadius * 2)
      const mat = p.moon ? moonMat : sunMat
      mat.color.setHex(p.sunColor).multiplyScalar(p.discIntensity)

      sandMat.color.setHex(p.sandTint)
    },
    update(timeSec) {
      seaMat.uniforms.uTime.value = timeSec
    },
    dispose() {
      sand.geometry.dispose()
      sandMat.dispose()
      sandMaps.map.dispose()
      sandMaps.gray.dispose()
      sea.geometry.dispose()
      seaMat.dispose()
      sky.geometry.dispose()
      skyMat.dispose()
      sunMat.dispose()
      moonMat.dispose()
      sunTex.dispose()
      moonTex.dispose()
    },
  }
}
