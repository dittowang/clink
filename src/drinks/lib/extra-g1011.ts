import * as THREE from 'three'
import { noiseCanvas, normalMapFromHeight } from './noise'

/**
 * Shared helpers for tiers 10–11 (watermelon keg, steel ice bucket).
 * Theme: making metal READ as metal, and heap ice read as ice.
 *
 * Metal has no diffuse term — its entire look is the environment it mirrors.
 * A metal with mid roughness under a soft warm env averages to one flat tone
 * and reads as PAINT (the critic's "gold-painted wood" / "matte ceramic").
 * The fix is always the same: drop roughness until real env features (softbox
 * streak, sky/sand gradient, sun) survive in the reflection, and let facets /
 * anisotropy shape them.
 */

export interface PolishedMetalOpts {
  color: THREE.ColorRepresentation
  roughness?: number
  envMapIntensity?: number
}

/** Machined bright metal (tap hardware, bucket accents). */
export function polishedMetal(opts: PolishedMetalOpts): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: opts.color,
    metalness: 1,
    roughness: opts.roughness ?? 0.12,
    envMapIntensity: opts.envMapIntensity ?? 1.7,
    specularIntensity: 1,
  })
}

/**
 * Hex nut / faceted collar: non-indexed → per-face normals, so each flat
 * catches its own env tone. The crisp value steps between facets are what
 * read as "machined", where a smooth cylinder shows one smeared gradient.
 * Axis along +Z (matches tap parts built down the local outward axis).
 */
export function hexNutGeometry(acrossCorners: number, thickness: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(acrossCorners, acrossCorners, thickness, 6).toNonIndexed()
  geo.computeVertexNormals() // non-indexed → flat facet normals
  geo.rotateX(Math.PI / 2)
  return geo
}

/** Tiling crinkle normal map (ice facet waviness, crushed-ice beds). */
export function crinkleNormal(seed: number, cells: number, strength: number): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(
    normalMapFromHeight(noiseCanvas(128, 128, 3, seed, { cellsX: cells, cellsY: cells }), strength)
  )
  tex.colorSpace = THREE.NoColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

/**
 * Display ice for an OPEN-AIR heap (never behind glass — transmission is
 * single-layer). Bright glassy transmissive cubes; slight internal waviness
 * so refraction glints break up instead of reading plastic.
 *
 * PAIR WITH AN OPAQUE BRIGHT BED BEHIND THEM: the transmission buffer holds
 * opaque objects only, so whatever is behind a cube IS its body. Over a dark
 * bucket interior the same cubes render as gray stones; over a frosted white
 * ice bed they render as ice.
 */
export function heapIceMaterial(size: number): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xf3faff,
    metalness: 0,
    roughness: 0.07,
    transmission: 0.9,
    ior: 1.31,
    thickness: size,
    attenuationColor: new THREE.Color(0xd4ecff),
    attenuationDistance: 0.055,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    specularIntensity: 1,
    envMapIntensity: 2.0,
  })
  m.normalMap = crinkleNormal(202, 9, 1.6)
  m.normalScale.set(0.3, 0.3)
  return m
}
