import * as THREE from 'three'
import { BILLBOARD_DIST, type LightingPreset } from './presets'
import { createSkyMaterial, applySkyUniforms } from './environment'
import { makeSandMaps, makeSunSprite, makeMoonSprite } from './textures'

/**
 * The visible beach around the table: sand disc, animated sea out to the
 * horizon, gradient sky dome, sun/moon billboard. All shader work is
 * fragment-cheap (a few sines) — the sea is one draw call.
 */

/** shoreline: sand disc centre is pushed behind the camera so the water
 *  starts ~7 m past the far rail and wraps the sides at a distance */
const SAND_R = 14
const SAND_CENTER_Z = 6
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
    fog: false, // fog folded into the shader below (FogExp2-compatible)
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uNear: { value: new THREE.Color(0x2b5f7e) },
      uFar: { value: new THREE.Color(0xd9905a) },
      uGlitter: { value: 0.8 },
      uGlitterColor: { value: new THREE.Color(0xffc984) },
      uFogColor: { value: new THREE.Color(0xe7b083) },
      uFogDensity: { value: 0.009 },
      uShoreCenter: { value: new THREE.Vector2(0, SAND_CENTER_Z) },
      uShoreR: { value: SAND_R },
      uFoam: { value: new THREE.Color(0xbfc4c4) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uGlitter, uFogDensity, uShoreR;
      uniform vec3 uSunDir, uNear, uFar, uGlitterColor, uFogColor, uFoam;
      uniform vec2 uShoreCenter;
      varying vec3 vWorld;
      float hash2(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      void main() {
        vec3 V = normalize(cameraPosition - vWorld);
        vec2 p = vWorld.xz;
        float t = uTime;
        // gentle swell: three directional sines perturb the normal
        float w1 = cos(dot(p, vec2(0.05, 0.55)) + t * 0.8);
        float w2 = cos(dot(p, vec2(1.25, 1.05)) + t * 1.5);
        float w3 = cos(dot(p, vec2(-2.2, 1.7)) + t * 2.3);
        vec3 N = normalize(vec3(
          -(w2 * 0.10 + w3 * 0.06),
          1.0,
          -(w1 * 0.22 + w2 * 0.08 + w3 * 0.05)
        ));
        float fres = pow(1.0 - max(dot(V, N), 0.0), 3.0);
        float dist = length(cameraPosition - vWorld);
        float horiz = smoothstep(18.0, 230.0, dist);
        vec3 col = mix(uNear, uFar, clamp(fres * 0.7 + horiz * 0.7, 0.0, 1.0));
        // sun glitter: tight animated spec, twinkled by a hashed cell,
        // plus a broad soft sun path
        vec3 R = reflect(-V, N);
        float rs = max(dot(R, uSunDir), 0.0);
        float spec = pow(rs, 260.0);
        float tw = 0.35 + 1.3 * hash2(floor(p * 6.0) + floor(t * 4.0));
        col += uGlitterColor * (spec * uGlitter * tw * 3.0);
        col += uGlitterColor * pow(rs, 22.0) * uGlitter * 0.22;
        // shoreline foam just seaward of the sand edge — tinted per preset so
        // it dims with the scene instead of glowing at night
        float sd = length(p - uShoreCenter) - uShoreR;
        float wob = sin(p.x * 0.7 + t * 0.7) * 0.5 + sin(p.y * 0.9 - t * 0.5) * 0.4;
        float foam = smoothstep(1.1, 0.0, abs(sd - 0.7 + wob)) * step(0.0, sd);
        col = mix(col, uFoam, foam * 0.4);
        // FogExp2-compatible aerial fade
        float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        col = mix(col, uFogColor, f);
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

  const glintDir = new THREE.Vector3()

  return {
    group,
    apply(p, sunDir) {
      const u = seaMat.uniforms
      // glint direction: sun azimuth, but elevation clamped low so a sparkle
      // path exists even at noon (a grazing camera can never catch a 72° sun
      // off gentle swell — this is the stylized cheat that sells "glitter")
      glintDir.copy(sunDir)
      const horiz = Math.hypot(glintDir.x, glintDir.z)
      const maxY = horiz * Math.tan(THREE.MathUtils.degToRad(18))
      if (glintDir.y > maxY) glintDir.y = maxY
      glintDir.normalize()
      ;(u.uSunDir.value as THREE.Vector3).copy(glintDir)
      ;(u.uNear.value as THREE.Color).setHex(p.seaNear)
      ;(u.uFar.value as THREE.Color).setHex(p.seaFar)
      ;(u.uGlitterColor.value as THREE.Color).setHex(p.glitterColor)
      ;(u.uFogColor.value as THREE.Color).setHex(p.fogColor)
      // foam brightness follows the key: pale surf by day, faint at night
      ;(u.uFoam.value as THREE.Color)
        .setHex(p.glitterColor)
        .multiplyScalar(p.moon ? 0.18 : 0.75)
      u.uGlitter.value = p.glitter
      u.uFogDensity.value = p.fogDensity

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
