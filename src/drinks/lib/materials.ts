import * as THREE from 'three'
import { noiseCanvas } from './noise'

/**
 * Material recipe factories. All MeshPhysicalMaterial so recipes can be
 * upgraded per-tier without swapping shader programs mid-family.
 *
 * TRANSMISSION LAYERING GOTCHA (load-bearing — read before changing):
 * three renders the transmission buffer from OPAQUE objects only. Anything
 * transmissive or transparent is INVISIBLE through a transmissive surface.
 * Therefore: liquid and ice that sit INSIDE a transmissive glass must be
 * opaque-pass materials (transmission 0) or the glass will show the
 * background where the drink should be. `liquid()` and ice default to the
 * opaque-pass recipe; pass `transmissive: true` only for surfaces with no
 * transmissive material in front of them (e.g. ice heaped above a steel
 * bucket's rim).
 */

export interface GlassOpts {
  /** tint color — applied via attenuation so thick parts read denser */
  tint?: THREE.ColorRepresentation
  /** REAL wall thickness in metres; drives refraction depth */
  wallThickness: number
  /** micro-roughness of the surface (ignored if roughnessMap given) */
  roughness?: number
  /** attenuation depth for tinted glass (m), default 0.06 */
  attenuationDistance?: number
  /** condensation / frost layering */
  roughnessMap?: THREE.Texture
  normalMap?: THREE.Texture
  normalScale?: number
  envMapIntensity?: number
}

/** Clear or tinted glass. transmission 1, ior 1.5, honest wall thickness. */
export function glass(opts: GlassOpts): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    transmission: 1,
    ior: 1.5,
    thickness: opts.wallThickness,
    specularIntensity: 1,
    envMapIntensity: opts.envMapIntensity ?? 1,
    side: THREE.FrontSide,
  })
  if (opts.roughnessMap) {
    // map carries absolute values (green channel); factor must be 1
    mat.roughness = 1
    mat.roughnessMap = opts.roughnessMap
  } else {
    mat.roughness = opts.roughness ?? 0.04
  }
  if (opts.normalMap) {
    mat.normalMap = opts.normalMap
    const s = opts.normalScale ?? 0.6
    mat.normalScale.set(s, s)
  }
  if (opts.tint !== undefined) {
    mat.attenuationColor = new THREE.Color(opts.tint)
    mat.attenuationDistance = opts.attenuationDistance ?? 0.06
  }
  return mat
}

export interface LiquidOpts {
  /** body color of the liquid (the primary read) */
  color: THREE.ColorRepresentation
  /** deep-body color; defaults to color darkened. Drives attenuation when transmissive. */
  attenuationColor?: THREE.ColorRepresentation
  /** metres of liquid that halve the light — 0.02 reads opaque-juicy, 0.2 reads watery */
  attenuationDistance?: number
  ior?: number
  roughness?: number
  /**
   * OPT-IN. true = real transmission (ONLY safe when nothing transmissive is
   * in front — see module comment). false (default) = opaque-pass recipe that
   * stays visible through glass walls.
   */
  transmissive?: boolean
  /** transmissive path only: refraction depth, default 0.03 */
  thickness?: number
}

/**
 * Liquid volume + cap material. clipShadows false / FrontSide /
 * clipIntersection false; the INSTANCE code assigns the world clipping plane
 * (instantiateDrink clones this material per instance).
 */
export function liquid(opts: LiquidOpts): THREE.MeshPhysicalMaterial {
  const color = new THREE.Color(opts.color)
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: opts.roughness ?? 0.08,
    ior: opts.ior ?? 1.33,
    specularIntensity: 0.7,
    clearcoat: 0.35,
    clearcoatRoughness: 0.1,
    side: THREE.FrontSide,
  })
  mat.clipShadows = false
  mat.clipIntersection = false
  if (opts.transmissive) {
    mat.transmission = 1
    mat.thickness = opts.thickness ?? 0.03
    mat.attenuationColor = new THREE.Color(opts.attenuationColor ?? opts.color)
    mat.attenuationDistance = opts.attenuationDistance ?? 0.02
  }
  return mat
}

export interface AluminumOpts {
  labelTexture?: THREE.Texture
  roughness?: number
}

/** Printed lacquered can body: metal under a clearcoat of ink. */
export function aluminum(opts: AluminumOpts = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: opts.labelTexture ?? null,
    metalness: 1,
    roughness: opts.roughness ?? 0.3,
    clearcoat: 0.6,
    clearcoatRoughness: 0.18,
    envMapIntensity: 1,
  })
}

export interface SteelOpts {
  /** MeshPhysicalMaterial anisotropy strength 0..1 (brushed streaks) */
  anisotropy?: number
  seed?: number
}

/** Brushed stainless: streaked roughness canvas + anisotropic highlight. */
export function steel(opts: SteelOpts = {}): THREE.MeshPhysicalMaterial {
  // streaks run around the drum: slow variation along u, fast along v
  const streaks = noiseCanvas(256, 256, 3, opts.seed ?? 7, {
    cellsX: 3,
    cellsY: 96,
    range: [-0.9, 2.6], // compress into a narrow mid-rough band
  })
  const tex = new THREE.CanvasTexture(streaks)
  tex.colorSpace = THREE.NoColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xdadde0,
    metalness: 1,
    roughness: 1, // absolute values live in the map
    roughnessMap: tex,
    envMapIntensity: 1,
  })
  mat.anisotropy = opts.anisotropy ?? 0.6
  mat.anisotropyRotation = 0
  return mat
}

export interface PaperboardOpts {
  labelTexture?: THREE.Texture
}

/** Juice-box card: matte, zero metal, soft speculars. */
export function paperboard(opts: PaperboardOpts = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: opts.labelTexture ?? null,
    metalness: 0,
    roughness: 0.85,
    specularIntensity: 0.3,
  })
}

export interface WaxRindOpts {
  map?: THREE.Texture
  normalMap?: THREE.Texture
  normalScale?: number
}

/** Watermelon / pineapple skin: matte body under a waxy clearcoat. */
export function waxRind(opts: WaxRindOpts = {}): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: opts.map ?? null,
    metalness: 0,
    roughness: 0.55,
    clearcoat: 0.9,
    clearcoatRoughness: 0.28,
  })
  if (opts.normalMap) {
    mat.normalMap = opts.normalMap
    const s = opts.normalScale ?? 0.5
    mat.normalScale.set(s, s)
  }
  return mat
}
