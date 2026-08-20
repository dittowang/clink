import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Draw-call diet (docs/PERF.md §3): collapse a drink template's static
 * same-material sub-meshes into one mesh per (material, shadow flags,
 * attribute layout) bucket. Drinks are drawn up to 3× per frame (shadow +
 * transmission + main pass), so every template mesh removed cuts multiple
 * draw calls per instance.
 *
 * Conservative by construction — a mesh is only merged when:
 * - it is a plain THREE.Mesh (no Points/Lines/skinning/morphs),
 * - its userData is EMPTY (liquid volume/cap and any tier-flagged mesh are
 *   driven per-instance and must survive as separate nodes),
 * - it has a single material and the default (full) drawRange — geometry
 *   groups are fine to drop: with a single material the renderer ignores
 *   them and always draws the full buffer (they only split material arrays),
 * - its world transform preserves winding (no negative scale),
 * - its attribute layout + indexing matches the bucket (mergeGeometries
 *   requires identical layouts).
 * Transforms are baked into the merged geometry in template-root space; the
 * shared material is NOT cloned, so material sharing across templates stays
 * intact. On any mergeGeometries failure the originals are left untouched.
 */
export interface MergeStats {
  before: number
  after: number
}

function countMeshes(root: THREE.Object3D): number {
  let n = 0
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) n++
  })
  return n
}

function attributeSignature(geo: THREE.BufferGeometry): string {
  const names = Object.keys(geo.attributes).sort()
  const parts = names.map((n) => {
    const a = geo.attributes[n]
    return `${n}:${a.itemSize}${a.normalized ? 'n' : ''}`
  })
  parts.push(geo.index ? 'indexed' : 'unindexed')
  return parts.join('|')
}

const _rel = new THREE.Matrix4()
const _rootInv = new THREE.Matrix4()

export function mergeStaticMeshes(root: THREE.Object3D): MergeStats {
  const before = countMeshes(root)
  root.updateWorldMatrix(true, true)
  _rootInv.copy(root.matrixWorld).invert()

  interface Bucket {
    material: THREE.Material
    castShadow: boolean
    receiveShadow: boolean
    renderOrder: number
    meshes: THREE.Mesh[]
  }
  const buckets = new Map<string, Bucket>()

  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    if ((o as Partial<THREE.SkinnedMesh>).isSkinnedMesh) return
    if (Object.keys(o.userData).length > 0) return // per-instance driven
    if (!o.visible) return
    if (Array.isArray(o.material)) return
    const geo = o.geometry
    if (!(geo instanceof THREE.BufferGeometry)) return
    // a non-default drawRange deliberately hides triangles; merging (which
    // drops ranges) would expose them
    if (geo.drawRange.start !== 0 || geo.drawRange.count !== Infinity) return
    if (Object.keys(geo.morphAttributes).length > 0) return
    // negative determinant would flip winding when baked into the geometry
    _rel.multiplyMatrices(_rootInv, o.matrixWorld)
    if (_rel.determinant() <= 0) return

    const key = [
      o.material.uuid,
      o.castShadow ? 'c1' : 'c0',
      o.receiveShadow ? 'r1' : 'r0',
      o.renderOrder,
      attributeSignature(geo),
    ].join('/')
    let b = buckets.get(key)
    if (!b) {
      b = {
        material: o.material,
        castShadow: o.castShadow,
        receiveShadow: o.receiveShadow,
        renderOrder: o.renderOrder,
        meshes: [],
      }
      buckets.set(key, b)
    }
    b.meshes.push(o)
  })

  for (const b of buckets.values()) {
    if (b.meshes.length < 2) continue
    const geos: THREE.BufferGeometry[] = []
    for (const m of b.meshes) {
      const g = m.geometry.clone()
      _rel.multiplyMatrices(_rootInv, m.matrixWorld)
      g.applyMatrix4(_rel) // handles position + normal + tangent
      geos.push(g)
    }
    let merged: THREE.BufferGeometry | null = null
    try {
      merged = mergeGeometries(geos, false)
    } catch {
      merged = null
    }
    if (!merged) {
      for (const g of geos) g.dispose()
      continue // leave the originals in place
    }
    for (const g of geos) g.dispose() // CPU-only temporaries
    const mesh = new THREE.Mesh(merged, b.material)
    mesh.castShadow = b.castShadow
    mesh.receiveShadow = b.receiveShadow
    mesh.renderOrder = b.renderOrder
    for (const m of b.meshes) m.removeFromParent()
    root.add(mesh)
  }

  return { before, after: countMeshes(root) }
}
