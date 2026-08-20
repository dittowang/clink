import * as THREE from 'three'
import { TABLE, SURFACE_Y, NEAR_Z, FAR_Z } from '../config/table'
import { makeWoodMaps } from './textures'

/**
 * The beach table. The physics playfield is x ∈ [-HALF_W, HALF_W],
 * z ∈ [FAR_Z, NEAR_Z]; the visual plank extends past the three railed edges
 * by the rail thickness so the rails' INNER faces sit exactly on the
 * playfield boundary. The near (+Z) edge stays open and flush.
 */

const OVERHANG = TABLE.RAIL_T + 0.005
/** visual plank extents */
export const PLANK_W = TABLE.HALF_W * 2 + OVERHANG * 2
export const PLANK_L = TABLE.HALF_L * 2 + OVERHANG
const PLANK_CZ = (NEAR_Z + (FAR_Z - OVERHANG)) / 2

export function createTable(maxAniso: number): THREE.Group {
  const group = new THREE.Group()
  group.name = 'table'

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
    group.add(m)
    return m
  }

  // plank top: wood on the top face, darker frame stock on the edge faces so
  // the squashed edge UVs never read as a pale band (+x,-x,+y,-y,+z,-z)
  addBox(PLANK_W, TABLE.THICKNESS, PLANK_L, 0, SURFACE_Y - TABLE.THICKNESS / 2, PLANK_CZ,
    [frameMat, frameMat, woodMat, frameMat, frameMat, frameMat])

  // legs: sturdy posts inset from the corners + two cross stretchers
  const legS = 0.062
  const legH = SURFACE_Y - TABLE.THICKNESS
  const lx = PLANK_W / 2 - legS / 2 - 0.05
  const lzNear = NEAR_Z - legS / 2 - 0.06
  const lzFar = FAR_Z - OVERHANG + legS / 2 + 0.06
  for (const sx of [-1, 1]) {
    for (const z of [lzNear, lzFar]) {
      addBox(legS, legH, legS, sx * lx, legH / 2, z, frameMat)
    }
  }
  for (const z of [lzNear, lzFar]) {
    addBox(lx * 2 - legS, 0.05, legS, 0, 0.16, z, frameMat)
  }

  // rails: far end + both sides only — the near edge is OPEN.
  const railBoxH = TABLE.RAIL_H + 0.012 // embedded slightly into the top
  const railY = SURFACE_Y + TABLE.RAIL_H - railBoxH / 2
  // far rail spans the full plank width, inner face at FAR_Z
  addBox(PLANK_W, railBoxH, TABLE.RAIL_T, 0, railY, FAR_Z - TABLE.RAIL_T / 2, frameMat)
  // side rails run from the near edge to the far rail, inner faces at ±HALF_W
  const sideLen = NEAR_Z - FAR_Z
  for (const sx of [-1, 1]) {
    addBox(TABLE.RAIL_T, railBoxH, sideLen, sx * (TABLE.HALF_W + TABLE.RAIL_T / 2), railY, (NEAR_Z + FAR_Z) / 2, frameMat)
  }

  return group
}
