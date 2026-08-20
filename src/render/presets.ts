import * as THREE from 'three'

/**
 * The four lighting presets. Everything a preset touches lives here so the
 * look is tuned in ONE file: sun angle/color, sky gradient stops, sea colors
 * and glitter, hemisphere fill, fog, and the AgX exposure trim.
 *
 * Azimuth convention: degrees around +Y, 0 = +Z (behind the camera),
 * 90 = +X (player's right), 180 = -Z (out over the sea, past the far rail).
 */
export type PresetName = 'morning' | 'noon' | 'golden' | 'night'

export interface LightingPreset {
  name: PresetName
  /** key light (sun or moon) direction */
  elevDeg: number
  azimDeg: number
  sunColor: number
  sunIntensity: number
  /** HDR multiplier on the env-scene sun disc so PMREM bakes a hot specular */
  envSunBoost: number
  /** scene.environmentIntensity — trims IBL so the key stays the key */
  envIntensity: number
  // sky gradient stops
  zenith: number
  horizon: number
  /** below-horizon haze color in the dome */
  ground: number
  /** warm scatter around the sun disc */
  sunTint: number
  sunTintStrength: number
  /** 0 = none, 1 = full night stars */
  stars: number
  // hemisphere fill (sun stays the only shadow caster)
  hemiSky: number
  hemiGround: number
  hemiIntensity: number
  // sea
  seaNear: number
  seaFar: number
  /** specular glint strength; noon is the sparkliest */
  glitter: number
  glitterColor: number
  /** multiplied into the sand material color */
  sandTint: number
  /** AgX exposure trim, 0.8–1.2 */
  exposure: number
  fogColor: number
  fogDensity: number
  /** true = the key billboard is the moon, not the sun */
  moon: boolean
  /** billboard disc world radius (placed at BILLBOARD_DIST) and HDR punch */
  discRadius: number
  discIntensity: number
}

export const BILLBOARD_DIST = 330

export const PRESETS: Record<PresetName, LightingPreset> = {
  morning: {
    name: 'morning',
    // low eastern sun -> long cool shadows raking across the plank
    elevDeg: 17, azimDeg: 105,
    sunColor: 0xfff3de, sunIntensity: 2.6,
    envSunBoost: 26, envIntensity: 0.55,
    zenith: 0x5f9ede, horizon: 0xffe4c0, ground: 0xc9d4dc,
    sunTint: 0xffd9a4, sunTintStrength: 0.5, stars: 0,
    hemiSky: 0xb9d4ee, hemiGround: 0xd8c39a, hemiIntensity: 0.55,
    seaNear: 0x2e7092, seaFar: 0x9cc4da, glitter: 0.4, glitterColor: 0xfff2dd,
    sandTint: 0xf4eee2,
    exposure: 1.0, fogColor: 0xdfe8ef, fogDensity: 0.006,
    moon: false, discRadius: 13, discIntensity: 3.0,
  },
  noon: {
    name: 'noon',
    // near-overhead key, short hard shadows, maximum sea sparkle. Sun a touch
    // warm (pure white read gray on the plank) + a 5% exposure lift below.
    elevDeg: 72, azimDeg: 205,
    sunColor: 0xfff1dc, sunIntensity: 3.2,
    envSunBoost: 30, envIntensity: 0.7,
    zenith: 0x2965c9, horizon: 0xb9ddef, ground: 0xbfd3dd,
    sunTint: 0xffffff, sunTintStrength: 0.15, stars: 0,
    hemiSky: 0xa8cdf0, hemiGround: 0xd9c9a0, hemiIntensity: 0.65,
    seaNear: 0x1d6f9b, seaFar: 0x6ab8d8, glitter: 1.0, glitterColor: 0xffffff,
    sandTint: 0xf2ead8,
    exposure: 1.05, fogColor: 0xd6e7f0, fogDensity: 0.004,
    moon: false, discRadius: 9, discIntensity: 5.0,
  },
  golden: {
    name: 'golden',
    // THE hero look: low warm sun out over the sea, everything gilded
    elevDeg: 29, azimDeg: 187,
    sunColor: 0xffb45c, sunIntensity: 3.7,
    envSunBoost: 36, envIntensity: 0.45,
    zenith: 0x3f679f, horizon: 0xffa14f, ground: 0xd8946a,
    sunTint: 0xffb36b, sunTintStrength: 0.9, stars: 0,
    hemiSky: 0x93a9cc, hemiGround: 0xd9a677, hemiIntensity: 0.35,
    seaNear: 0x1f4d68, seaFar: 0x88a9ba, glitter: 0.8, glitterColor: 0xffc984,
    sandTint: 0xffe3bd,
    exposure: 1.12, fogColor: 0xdd9057, fogDensity: 0.0045,
    moon: false, discRadius: 16, discIntensity: 4.0,
  },
  night: {
    name: 'night',
    // deep blue, moon as the low-intensity key; practicals come later
    elevDeg: 46, azimDeg: 168,
    sunColor: 0xb9cdf5, sunIntensity: 0.85,
    envSunBoost: 9, envIntensity: 0.35,
    zenith: 0x060d22, horizon: 0x17304e, ground: 0x14283f,
    sunTint: 0x9db8e0, sunTintStrength: 0.3, stars: 1,
    hemiSky: 0x24365a, hemiGround: 0x1a2030, hemiIntensity: 0.32,
    seaNear: 0x0a2438, seaFar: 0x16395c, glitter: 0.3, glitterColor: 0xcfe0ff,
    sandTint: 0x93a2ba,
    exposure: 0.9, fogColor: 0x0d1a2c, fogDensity: 0.008,
    moon: true, discRadius: 8, discIntensity: 2.2,
  },
}

/** Unit vector FROM the origin TOWARD the sun. Env disc and the
 *  DirectionalLight both derive from this — they can never disagree. */
export function sunDirection(p: LightingPreset, out: THREE.Vector3): THREE.Vector3 {
  const el = THREE.MathUtils.degToRad(p.elevDeg)
  const az = THREE.MathUtils.degToRad(p.azimDeg)
  out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
  return out
}
