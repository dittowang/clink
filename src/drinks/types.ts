import type * as THREE from 'three'

/**
 * What a drink builder produces: a template group (origin at BASE CENTER,
 * +Y up) plus the liquid rig spec. Templates are cached; instances clone the
 * group and clone ONLY liquid materials (they carry per-instance clipping
 * planes). Mark liquid meshes with userData.liquidVolume / userData.liquidCap.
 */
export interface LiquidSpec {
  /** local fill height above drink origin (m) */
  fillY: number
  /** inner radius at fill height (m) — the cap disc radius */
  capRadius: number
}

export interface DrinkVisual {
  template: THREE.Group
  height: number
  radius: number
  liquid: LiquidSpec | null
}

export type DrinkBuilder = () => DrinkVisual

export interface DrinkInstance {
  group: THREE.Group
  liquid: {
    volume: THREE.Mesh
    cap: THREE.Mesh
    fillY: number
    capRadius: number
    plane: THREE.Plane
  } | null
}
