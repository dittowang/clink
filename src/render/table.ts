import * as THREE from 'three'
import { TABLE, SURFACE_Y, NEAR_Z, FAR_Z } from '../config/table'
import { makeWoodMaps } from './textures'

/**
 * The beach table. The physics playfield is x ∈ [-halfW, halfW],
 * z ∈ [FAR_Z, NEAR_Z]; the visual plank extends past the three railed edges
 * by the rail thickness so the rails' INNER faces sit exactly on the
 * playfield boundary. The near (+Z) edge stays open and flush.
 *
 * Level modifiers (all optional, defaults reproduce the classic table):
 *  - halfW narrows the plank + rails (noon chapter)
 *  - slopeDeg tilts the WHOLE table with one rotation around X at the table
 *    centre (0, SURFACE_Y, 0), matching the physics colliders exactly; legs
 *    are extended downward so the downhill pair reads as sunk into the sand
 *  - removeRails omits side rail visuals (their colliders are omitted too)
 */

export interface TableBuildOpts {
  halfW?: number
  slopeDeg?: number
  removeRails?: ('left' | 'right')[]
}

const OVERHANG = TABLE.RAIL_T + 0.005
/** classic visual plank extents (kept exported for framing math) */
export const PLANK_W = TABLE.HALF_W * 2 + OVERHANG * 2
export const PLANK_L = TABLE.HALF_L * 2 + OVERHANG
const PLANK_CZ = (NEAR_Z + (FAR_Z - OVERHANG)) / 2

export function createTable(maxAniso: number, opts: TableBuildOpts = {}): THREE.Group {
  const halfW = opts.halfW ?? TABLE.HALF_W
  const slopeRad = ((opts.slopeDeg ?? 0) * Math.PI) / 180
  const removed = opts.removeRails ?? []
  const plankW = halfW * 2 + OVERHANG * 2

  // outer group pivots at the table centre so rotation.x matches the physics
  // tilt; inner holds the classic world-coordinate build offset down by -Sy.
  const group = new THREE.Group()
  group.name = 'table'
  group.position.y = SURFACE_Y
  group.rotation.x = slopeRad
  const inner = new THREE.Group()
  inner.position.y = -SURFACE_Y
  group.add(inner)

  const wood = makeWoodMaps(maxAniso)
  const woodMat = new THREE.MeshStandardMaterial({
    map: wood.map,
    bumpMap: wood.gray,
    bumpScale: 0.6,
    roughnessMap: wood.gray,
    roughness: 1.0,
    metalness: 0,
  })
  // legs + rails + plank edges: same canvas, darker tint so structure reads
  // as separate stock from the top planks
  const frameMat = woodMat.clone()
  frameMat.color.setHex(0xa08767)

  const addBox = (
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    mat: THREE.Material | THREE.Material[]
  ): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    m.position.set(x, y, z)
    m.castShadow = true
    m.receiveShadow = true
    inner.add(m)
    return m
  }

  // plank top: wood on the top face, darker frame stock on the edge faces so
  // the squashed edge UVs never read as a pale band (+x,-x,+y,-y,+z,-z)
  addBox(plankW, TABLE.THICKNESS, PLANK_L, 0, SURFACE_Y - TABLE.THICKNESS / 2, PLANK_CZ,
    [frameMat, frameMat, woodMat, frameMat, frameMat, frameMat])

  // legs: sturdy posts inset from the corners + two cross stretchers. On a
  // tilted table they are EXTENDED downward so every leg still reaches the
  // sand — the downhill pair sinks in, selling the "one leg sank" story.
  const legS = 0.062
  const legExt = slopeRad > 0 ? TABLE.HALF_L * Math.sin(slopeRad) + 0.03 : 0
  const legH = SURFACE_Y - TABLE.THICKNESS + legExt
  const lx = plankW / 2 - legS / 2 - 0.05
  const lzNear = NEAR_Z - legS / 2 - 0.06
  const lzFar = FAR_Z - OVERHANG + legS / 2 + 0.06
  for (const sx of [-1, 1]) {
    for (const z of [lzNear, lzFar]) {
      addBox(legS, legH, legS, sx * lx, legH / 2 - legExt, z, frameMat)
    }
  }
  for (const z of [lzNear, lzFar]) {
    addBox(lx * 2 - legS, 0.05, legS, 0, 0.16, z, frameMat)
  }

  // rails: far end + both sides only — the near edge is OPEN.
  const railBoxH = TABLE.RAIL_H + 0.012 // embedded slightly into the top
  const railY = SURFACE_Y + TABLE.RAIL_H - railBoxH / 2
  // far rail spans the full plank width, inner face at FAR_Z
  addBox(plankW, railBoxH, TABLE.RAIL_T, 0, railY, FAR_Z - TABLE.RAIL_T / 2, frameMat)
  // side rails run from the near edge to the far rail, inner faces at ±halfW
  const sideLen = NEAR_Z - FAR_Z
  for (const sx of [-1, 1] as const) {
    if (removed.includes(sx < 0 ? 'left' : 'right')) continue
    addBox(TABLE.RAIL_T, railBoxH, sideLen, sx * (halfW + TABLE.RAIL_T / 2), railY, (NEAR_Z + FAR_Z) / 2, frameMat)
  }

  return group
}

/** dispose a table group produced by createTable (geometry, materials, maps) */
export function disposeTable(group: THREE.Group): void {
  const textures = new Set<THREE.Texture>()
  const materials = new Set<THREE.Material>()
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    o.geometry.dispose()
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) materials.add(m)
  })
  for (const m of materials) {
    const sm = m as THREE.MeshStandardMaterial
    if (sm.map) textures.add(sm.map)
    if (sm.bumpMap) textures.add(sm.bumpMap)
    if (sm.roughnessMap) textures.add(sm.roughnessMap)
    m.dispose()
  }
  for (const t of textures) t.dispose()
}
