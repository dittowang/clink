import * as THREE from 'three'
import type { LightingPreset } from './presets'

/**
 * Sea shading shared by the far sea (beach.ts) and the near shore water
 * (shore.ts) so the two planes are indistinguishable where they overlap.
 * Fragment-cheap: three directional sines for the swell normal, a fresnel
 * near/far mix, a hashed-cell glitter, and a FogExp2-compatible fade.
 *
 * Two planes rather than one because the shore water is alpha-blended (it
 * thins to a see-through film at the foam line) while the far sea stays
 * opaque — a 385 m blended disc would cost fill for nothing.
 */

export const SEA_UNIFORMS_GLSL = /* glsl */ `
  uniform float uTime, uGlitter, uFogDensity;
  uniform vec3 uSunDir, uNear, uFar, uGlitterColor, uFogColor, uFoam;
`

export const SEA_FUNCS_GLSL = /* glsl */ `
  float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  // gentle swell: three directional sines perturb the normal
  vec3 seaNormal(vec2 p, float t) {
    float w1 = cos(dot(p, vec2(0.05, 0.55)) + t * 0.8);
    float w2 = cos(dot(p, vec2(1.25, 1.05)) + t * 1.5);
    float w3 = cos(dot(p, vec2(-2.2, 1.7)) + t * 2.3);
    return normalize(vec3(
      -(w2 * 0.10 + w3 * 0.06),
      1.0,
      -(w1 * 0.22 + w2 * 0.08 + w3 * 0.05)
    ));
  }
  // water colour before fog: fresnel near/far mix + sun glitter path
  vec3 seaColor(vec3 world, vec3 V, vec3 N, float t) {
    vec2 p = world.xz;
    float fres = pow(1.0 - max(dot(V, N), 0.0), 3.0);
    float dist = length(cameraPosition - world);
    float horiz = smoothstep(18.0, 230.0, dist);
    vec3 col = mix(uNear, uFar, clamp(fres * 0.7 + horiz * 0.7, 0.0, 1.0));
    // sun glitter: tight animated spec, twinkled by a hashed cell,
    // plus a broad soft sun path
    vec3 R = reflect(-V, N);
    float rs = max(dot(R, uSunDir), 0.0);
    float spec = pow(rs, 260.0);
    float tw = 0.35 + 1.3 * hash2(floor(p * 6.0) + floor(t * 4.0));
    // the 17 cm twinkle cells read as squares inside ~10 m (the near
    // shore water): fade the cell sparkle in with distance, keep the path
    float nearK = smoothstep(5.0, 18.0, dist);
    col += uGlitterColor * (spec * uGlitter * tw * 3.0 * nearK);
    col += uGlitterColor * pow(rs, 22.0) * uGlitter * 0.22;
    return col;
  }
  // FogExp2-compatible aerial fade (fog:false on the material; folded here)
  vec3 seaFog(vec3 col, float dist) {
    float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    return mix(col, uFogColor, f);
  }
`

export const SEA_VERTEX_GLSL = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

export type SeaUniforms = Record<string, THREE.IUniform>

export function makeSeaUniforms(): SeaUniforms {
  return {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uNear: { value: new THREE.Color(0x2b5f7e) },
    uFar: { value: new THREE.Color(0xd9905a) },
    uGlitter: { value: 0.8 },
    uGlitterColor: { value: new THREE.Color(0xffc984) },
    uFogColor: { value: new THREE.Color(0xe7b083) },
    uFogDensity: { value: 0.009 },
    uFoam: { value: new THREE.Color(0xbfc4c4) },
  }
}

const _glint = new THREE.Vector3()

/** preset → shared sea uniforms. Glint direction: sun azimuth, elevation
 *  clamped low so a sparkle path exists even at noon (a grazing camera can
 *  never catch a 72° sun off gentle swell — the stylized cheat that sells
 *  "glitter"). Foam follows the key: pale surf by day, faint at night. */
export function applySeaUniforms(u: SeaUniforms, p: LightingPreset, sunDir: THREE.Vector3): void {
  _glint.copy(sunDir)
  const horiz = Math.hypot(_glint.x, _glint.z)
  const maxY = horiz * Math.tan(THREE.MathUtils.degToRad(18))
  if (_glint.y > maxY) _glint.y = maxY
  _glint.normalize()
  ;(u.uSunDir.value as THREE.Vector3).copy(_glint)
  ;(u.uNear.value as THREE.Color).setHex(p.seaNear)
  ;(u.uFar.value as THREE.Color).setHex(p.seaFar)
  ;(u.uGlitterColor.value as THREE.Color).setHex(p.glitterColor)
  ;(u.uFogColor.value as THREE.Color).setHex(p.fogColor)
  ;(u.uFoam.value as THREE.Color).setHex(p.glitterColor).multiplyScalar(p.moon ? 0.18 : 0.75)
  u.uGlitter.value = p.glitter
  u.uFogDensity.value = p.fogDensity
}
