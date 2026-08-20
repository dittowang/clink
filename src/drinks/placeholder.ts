import * as THREE from 'three'
import { TIERS, type TierId } from '../config/tiers'
import type { DrinkVisual } from './types'

/**
 * Placeholder builder: a generic shouldered lathe tinted by tier hue.
 * Exists only so scenes run before the real drinks land. Every real tier
 * file in ./tiers replaces its call to this.
 */
export function placeholderDrink(tier: TierId): DrinkVisual {
  const def = TIERS[tier]
  const r = def.radius
  const h = def.height
  const pts: THREE.Vector2[] = []
  const prof: Array<[number, number]> = [
    [0.0, 0.0], [0.82, 0.0], [0.95, 0.02], [1.0, 0.08], [1.0, 0.55],
    [0.92, 0.72], [0.62, 0.84], [0.58, 0.94], [0.6, 1.0],
  ]
  for (const [pr, py] of prof) pts.push(new THREE.Vector2(pr * r, py * h))
  const geo = new THREE.LatheGeometry(pts, 48)
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(def.hue / 360, 0.5, 0.55),
    roughness: 0.5,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  mesh.receiveShadow = true
  const template = new THREE.Group()
  template.add(mesh)
  return { template, height: h, radius: r, liquid: null }
}
