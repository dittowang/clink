import * as THREE from 'three'
import type { LightingPreset } from './presets'
import { SAND_R, SAND_CENTER_Z } from './beach'
import {
  SEA_UNIFORMS_GLSL, SEA_FUNCS_GLSL, SEA_VERTEX_GLSL,
  makeSeaUniforms, applySeaUniforms,
} from './seaShading'

/**
 * The near shoreline the game camera actually sees. The table-fit camera
 * (42°, FOV 36) puts the sand at z ≈ -3.75 on the top edge of a landscape
 * frame and never shows the horizon, so the beach has to come to the table:
 * a shallow bay whose water's edge sits ~1.9 m past the far rail. Three
 * pieces, all sitting a few mm above the sand disc:
 *
 *  - shore water: one alpha-blended plane. Signed distance to an animated
 *    shoreline (bay parabola + wave excursion + wobble, smooth-unioned with
 *    the far sand-disc edge so the two coastlines meet without a corner);
 *    thin see-through film at the edge, a noisy foam fringe that rides the
 *    wave, trailing foam streaks behind it; otherwise the shared sea shading.
 *  - wet sand: a glossy dark strip under the foam's reach (low roughness so
 *    the sky reflects), alpha fading into dry sand, nudged with the wave.
 *
 * Wave: ±0.30 m on a 7 s cycle plus a 0.08 m / 23 s drift, driven from the
 * stage's accumulated render time — deterministic under harness stepTo.
 * Water never reaches z > -2.3 (table far rail is at -0.93).
 */

/** mean water's edge on the table axis (x = 0) */
const EDGE_Z = -2.8
/** bay curvature: edge recedes seaward as -BAY_K·x² */
const BAY_K = 0.03
const WAVE_AMP = 0.3
const WAVE_PERIOD = 7
const DRIFT_AMP = 0.08
const DRIFT_PERIOD = 23
/** y offsets above the sand disc (y = 0): wet strip below the water */
const WET_Y = 0.004
const WATER_Y = 0.009
const HALF_W = 14.5

export interface Shore {
  group: THREE.Group
  apply(preset: LightingPreset, sunDir: THREE.Vector3): void
  update(timeSec: number): void
  dispose(): void
}

/** alpha for the wet strip: v = 0 landward edge (dry) → 1 seaward (wet),
 *  landward edge broken by a tiling noise so it never reads as a ruler */
function wetAlphaTexture(): THREE.CanvasTexture {
  const W = 256, H = 128
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(W, H)
  const d = img.data
  const TAU = Math.PI * 2
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1)
    for (let x = 0; x < W; x++) {
      // integer cycles across W so RepeatWrapping tiles seamlessly
      const n =
        0.06 * Math.sin((TAU * 3 * x) / W) +
        0.04 * Math.sin((TAU * 7 * x) / W + 1.3) +
        0.03 * Math.sin((TAU * 13 * x) / W + 2.1)
      const a = THREE.MathUtils.smoothstep(v + n, 0.08, 0.5)
      const i = (y * W + x) * 4
      d[i] = d[i + 1] = d[i + 2] = Math.round(a * 255)
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.ClampToEdgeWrapping
  return t
}

/** a band following the static bay curve: v=0 at zEdge+land, v=1 at zEdge-sea */
function bandGeometry(land: number, sea: number, segs: number): THREE.BufferGeometry {
  const pos = new Float32Array((segs + 1) * 2 * 3)
  const uv = new Float32Array((segs + 1) * 2 * 2)
  const idx: number[] = []
  for (let i = 0; i <= segs; i++) {
    const x = -HALF_W + (2 * HALF_W * i) / segs
    const zEdge = EDGE_Z - BAY_K * x * x
    const k = i * 2
    pos.set([x, 0, zEdge + land], k * 3)
    pos.set([x, 0, zEdge - sea], (k + 1) * 3)
    // u tiles the alpha noise ~every 1.8 m
    uv.set([x / 1.8, 0], k * 2)
    uv.set([x / 1.8, 1], (k + 1) * 2)
    if (i < segs) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

export function createShore(): Shore {
  const group = new THREE.Group()
  group.name = 'shore'

  // --- wet sand -----------------------------------------------------------
  const wetAlpha = wetAlphaTexture()
  const wetMat = new THREE.MeshStandardMaterial({
    color: 0x5e4d3a,
    roughness: 0.22,
    metalness: 0,
    envMapIntensity: 1.1,
    transparent: true,
    opacity: 0.62,
    alphaMap: wetAlpha,
    depthWrite: false,
  })
  // landward reach = max wave + wobble (~0.5 m) + a damp halo; seaward under
  // the water where the plane is opaque anyway
  const wetGeo = bandGeometry(0.62, 1.2, 64)
  const wet = new THREE.Mesh(wetGeo, wetMat)
  wet.position.y = WET_Y
  wet.receiveShadow = true
  wet.renderOrder = 1
  group.add(wet)

  // --- shore water ----------------------------------------------------------
  const waterMat = new THREE.ShaderMaterial({
    fog: false,
    transparent: true,
    depthWrite: false,
    uniforms: {
      ...makeSeaUniforms(),
      uEdgeZ: { value: EDGE_Z },
      uBayK: { value: BAY_K },
      uWave: { value: 0 },
      uAdvance: { value: 0.5 },
      uShallow: { value: new THREE.Color(0x6f9fae) },
      uShoreCenter: { value: new THREE.Vector2(0, SAND_CENTER_Z) },
      uShoreR: { value: SAND_R },
    },
    vertexShader: SEA_VERTEX_GLSL,
    fragmentShader: /* glsl */ `
      ${SEA_UNIFORMS_GLSL}
      uniform float uEdgeZ, uBayK, uWave, uAdvance, uShoreR;
      uniform vec2 uShoreCenter;
      uniform vec3 uShallow;
      varying vec3 vWorld;
      ${SEA_FUNCS_GLSL}
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash2(i), b = hash2(i + vec2(1.0, 0.0));
        float c = hash2(i + vec2(0.0, 1.0)), d = hash2(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      // smooth max: union of the two water regions with a rounded join
      float smax(float a, float b, float k) {
        float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
        return mix(b, a, h) + k * h * (1.0 - h);
      }
      void main() {
        vec3 V = normalize(cameraPosition - vWorld);
        vec2 p = vWorld.xz;
        float t = uTime;
        // shoreline: bay parabola + wave + along-shore wobble
        float wob = 0.12 * sin(0.9 * p.x + 0.3 * t)
                  + 0.07 * sin(2.3 * p.x - 0.5 * t)
                  + 0.04 * sin(5.1 * p.x + 1.1 * t);
        float zEdge = uEdgeZ - uBayK * p.x * p.x + uWave + wob;
        float sdBay = zEdge - p.y;                       // + = seaward
        float sdDisc = length(p - uShoreCenter) - uShoreR;
        float sd = smax(sdBay, sdDisc, 1.5);

        vec3 N = seaNormal(p, t);
        vec3 col = seaColor(vWorld, V, N, t);
        // shallow film at the edge: sand shows through, colour lifts
        float deep = smoothstep(0.0, 0.9, sd);
        col = mix(uShallow, col, deep);
        float alpha = smoothstep(-0.02, 0.22, sd) * (0.5 + 0.5 * deep);

        // foam fringe riding the edge (brighter while the wave advances) +
        // trailing streaks left behind it
        float n1 = vnoise(p * 7.0 + vec2(t * 0.35, -t * 0.2));
        float n2 = vnoise(p * 2.5 + vec2(-t * 0.15, t * 0.1));
        float band = 1.0 - abs(sd - 0.08) / 0.22;
        float foam = smoothstep(0.25, 0.75, band + n1 * 0.45 - 0.2) * (0.55 + 0.45 * uAdvance);
        float trail = smoothstep(0.62, 0.85, n2 * 0.7 + n1 * 0.3)
                    * smoothstep(1.4, 0.35, sd) * step(0.25, sd) * 0.45;
        foam = clamp(foam + trail, 0.0, 1.0);
        col = mix(col, uFoam, foam);
        alpha = max(alpha, foam * 0.92);

        col = seaFog(col, length(cameraPosition - vWorld));
        gl_FragColor = vec4(col, alpha);
      }
    `,
  })
  // covers every part of the sand disc seaward of the bay (|x| < 11.6 at
  // z < -1.9) and overlaps the far sea beyond it with identical shading
  const waterGeo = new THREE.PlaneGeometry(HALF_W * 2, 8.0)
  const water = new THREE.Mesh(waterGeo, waterMat)
  water.rotation.x = -Math.PI / 2
  water.position.set(0, WATER_Y, -1.9 - 4.0)
  water.renderOrder = 2
  group.add(water)

  const shallow = waterMat.uniforms.uShallow.value as THREE.Color
  const tmp = new THREE.Color()

  return {
    group,
    apply(p, sunDir) {
      applySeaUniforms(waterMat.uniforms, p, sunDir)
      // shallow tint: near colour lifted toward the key (a little at night)
      shallow.setHex(p.seaNear).lerp(tmp.setHex(p.glitterColor), p.moon ? 0.06 : 0.2)
      // wet sand darkens with the preset's sand tint so night stays night
      wetMat.color.setHex(0x5e4d3a).multiply(tmp.setHex(p.sandTint))
    },
    update(t) {
      const ph = (2 * Math.PI * t) / WAVE_PERIOD
      const wave = WAVE_AMP * Math.sin(ph) + DRIFT_AMP * Math.sin((2 * Math.PI * t) / DRIFT_PERIOD)
      waterMat.uniforms.uTime.value = t
      waterMat.uniforms.uWave.value = wave
      waterMat.uniforms.uAdvance.value = 0.5 + 0.5 * Math.cos(ph)
      // the wet line lags the water and only creeps: the sand stays dark
      // after the wave has gone back
      wet.position.z = 0.35 * wave + 0.1
    },
    dispose() {
      wetGeo.dispose()
      wetMat.dispose()
      wetAlpha.dispose()
      waterGeo.dispose()
      waterMat.dispose()
    },
  }
}
