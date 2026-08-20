import * as THREE from 'three'
import type { LightingPreset } from './presets'

/**
 * Sky gradient shader shared by the visible dome and the PMREM env scene.
 * Outputs linear color (OutputPass / PMREM handle transfer + tone mapping).
 */
export function createSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunTint: { value: new THREE.Color() },
      uSunTintK: { value: 0.5 },
      uStars: { value: 0 },
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
      uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunTint;
      uniform float uSunTintK, uStars;
      varying vec3 vWorld;
      float hash3(vec3 p) {
        return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      }
      void main() {
        vec3 dir = normalize(vWorld);
        float h = dir.y;
        vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
        vec3 col = mix(uGround, sky, smoothstep(-0.035, 0.006, h));
        // warm scatter around the sun: broad haze + tight halo
        float sa = max(dot(dir, uSunDir), 0.0);
        col += uSunTint * (pow(sa, 7.0) * 0.5 + pow(sa, 80.0) * 1.4) * uSunTintK;
        // stars (night only): sparse hashed points above the horizon
        if (uStars > 0.001 && h > 0.02) {
          vec3 sp = dir * 230.0;
          vec3 cell = floor(sp);
          float rnd = hash3(cell);
          vec3 f = fract(sp) - 0.5;
          float star = smoothstep(0.32, 0.0, length(f)) * step(0.9905, rnd);
          col += vec3(star * uStars * (0.7 + 1.1 * fract(rnd * 71.7)))
               * smoothstep(0.02, 0.15, h);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
}

export function applySkyUniforms(mat: THREE.ShaderMaterial, p: LightingPreset, sunDir: THREE.Vector3): void {
  const u = mat.uniforms
  ;(u.uZenith.value as THREE.Color).setHex(p.zenith)
  ;(u.uHorizon.value as THREE.Color).setHex(p.horizon)
  ;(u.uGround.value as THREE.Color).setHex(p.ground)
  ;(u.uSunTint.value as THREE.Color).setHex(p.sunTint)
  ;(u.uSunDir.value as THREE.Vector3).copy(sunDir)
  u.uSunTintK.value = p.sunTintStrength
  u.uStars.value = p.stars
}

export interface Environment {
  /** rebuild scene.environment for the preset; sunDir MUST be the light's dir */
  apply(preset: LightingPreset, sunDir: THREE.Vector3): void
  dispose(): void
}

/**
 * Tiny procedural beach rendered once per preset through PMREMGenerator:
 * gradient sky dome, HDR sun disc at the exact sun direction, a sea band at
 * the horizon and a sand floor. Never RoomEnvironment — reflections on glass
 * must read as "warm sky above, blue water at the horizon, sand below".
 */
export function createEnvironment(renderer: THREE.WebGLRenderer, target: THREE.Scene): Environment {
  const envScene = new THREE.Scene()

  const skyMat = createSkyMaterial()
  const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 20), skyMat)
  envScene.add(sky)

  const sunMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(7, 24), sunMat)
  envScene.add(sunDisc)

  // sea: an inward-facing band just below the horizon, all azimuths
  const seaMat = new THREE.MeshBasicMaterial({ color: 0x2e7092, side: THREE.BackSide })
  const sea = new THREE.Mesh(new THREE.CylinderGeometry(70, 70, 4.5, 32, 1, true), seaMat)
  sea.position.y = -2.25
  envScene.add(sea)

  // sand floor under everything
  const sandMat = new THREE.MeshBasicMaterial({ color: 0xd8c49c })
  const sand = new THREE.Mesh(new THREE.CircleGeometry(69, 32), sandMat)
  sand.rotation.x = -Math.PI / 2
  sand.position.y = -1.4
  envScene.add(sand)

  const pmrem = new THREE.PMREMGenerator(renderer)
  let rt: THREE.WebGLRenderTarget | null = null
  const baseSand = new THREE.Color(0xd8c49c)
  const tint = new THREE.Color()

  return {
    apply(p, sunDir) {
      applySkyUniforms(skyMat, p, sunDir)
      sunDisc.position.copy(sunDir).multiplyScalar(88)
      sunDisc.lookAt(0, 0, 0)
      sunMat.color.setHex(p.sunColor).multiplyScalar(p.envSunBoost)
      seaMat.color.setHex(p.seaFar)
      sandMat.color.copy(baseSand).multiply(tint.setHex(p.sandTint))
      const old = rt
      rt = pmrem.fromScene(envScene, 0.04, 0.5, 250)
      target.environment = rt.texture
      target.environmentIntensity = p.envIntensity
      old?.dispose()
    },
    dispose() {
      rt?.dispose()
      pmrem.dispose()
      sky.geometry.dispose()
      skyMat.dispose()
      sunDisc.geometry.dispose()
      sunMat.dispose()
      sea.geometry.dispose()
      seaMat.dispose()
      sand.geometry.dispose()
      sandMat.dispose()
    },
  }
}
