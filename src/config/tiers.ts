import { MASS_KG } from './massLadder'

export type TierId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12

export const TIER_IDS: readonly TierId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

/** Sound + contact material group. Drives synth recipe AND friction/restitution pair tables. */
export type SoundMaterial =
  | 'paper'    // juice box
  | 'aluminum' // slim can, cola can
  | 'glass'    // bottle, highball, mason jar, pitcher, dispenser
  | 'husk'     // coconut
  | 'rind'     // pineapple, watermelon
  | 'steel'    // ice bucket

export interface TierDef {
  id: TierId
  key: string
  massKg: number
  /** physics footprint radius, metres — MUST rise monotonically with tier */
  radius: number
  /** overall height, metres — visual + collider */
  height: number
  material: SoundMaterial
  /** cold drinks get the condensation map */
  cold: boolean
  /** dominant label/liquid hue for UI chips, score pops, particles */
  hue: number
}

/**
 * Footprints and heights are the *silhouette* contract: adjacent tiers must
 * differ in at least two of (height, footprint, top shape). Dimensions are
 * near-real-world so the mass ladder reads as honest density.
 */
export const TIERS: Readonly<Record<TierId, TierDef>> = {
  1:  { id: 1,  key: 'juiceBox',   massKg: MASS_KG[1],  radius: 0.026, height: 0.105, material: 'paper',    cold: false, hue: 275 },
  2:  { id: 2,  key: 'slimCan',    massKg: MASS_KG[2],  radius: 0.029, height: 0.134, material: 'aluminum', cold: true,  hue: 200 },
  3:  { id: 3,  key: 'colaCan',    massKg: MASS_KG[3],  radius: 0.033, height: 0.116, material: 'aluminum', cold: true,  hue: 355 },
  4:  { id: 4,  key: 'sodaBottle', massKg: MASS_KG[4],  radius: 0.037, height: 0.185, material: 'glass',    cold: true,  hue: 28 },
  5:  { id: 5,  key: 'highball',   massKg: MASS_KG[5],  radius: 0.041, height: 0.150, material: 'glass',    cold: true,  hue: 40 },
  6:  { id: 6,  key: 'masonJar',   massKg: MASS_KG[6],  radius: 0.048, height: 0.170, material: 'glass',    cold: true,  hue: 105 },
  7:  { id: 7,  key: 'coconut',    massKg: MASS_KG[7],  radius: 0.058, height: 0.140, material: 'husk',     cold: false, hue: 30 },
  8:  { id: 8,  key: 'pineapple',  massKg: MASS_KG[8],  radius: 0.066, height: 0.260, material: 'rind',     cold: false, hue: 50 },
  9:  { id: 9,  key: 'pitcher',    massKg: MASS_KG[9],  radius: 0.075, height: 0.240, material: 'glass',    cold: true,  hue: 25 },
  10: { id: 10, key: 'watermelon', massKg: MASS_KG[10], radius: 0.095, height: 0.200, material: 'rind',     cold: false, hue: 115 },
  11: { id: 11, key: 'iceBucket',  massKg: MASS_KG[11], radius: 0.110, height: 0.230, material: 'steel',    cold: true,  hue: 210 },
  12: { id: 12, key: 'dispenser',  massKg: MASS_KG[12], radius: 0.130, height: 0.360, material: 'glass',    cold: true,  hue: 15 },
}

export function tierDef(id: TierId): TierDef {
  return TIERS[id]
}

export function nextTier(id: TierId): TierId | null {
  return id < 12 ? ((id + 1) as TierId) : null
}
