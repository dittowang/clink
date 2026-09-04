import type { TierId } from '../config/tiers'
import type * as THREE from 'three'

/**
 * The event bus: physics/merge/game emit, render/audio/UI listen.
 * Rule: the render layer (lean, slosh, camera nudge, particles) READS these
 * and never writes back into physics.
 */
export interface GameEvents {
  /** Rapier CONTACT_FORCE_EVENTS above threshold. force is totalForceMagnitude. */
  impact: { a: number; b: number; force: number; point: THREE.Vector3; normal: THREE.Vector3; tierA: TierId | null; tierB: TierId | null; matA: string; matB: string }
  /** per-fixed-step aggregate sliding speed of every awake drink (audio loop
   *  gate); x = speed-weighted centroid of the sliders (slide-loop pan) */
  sliding: { speed: number; count: number; x: number }
  launch: { id: number; tier: TierId; impulse: number }
  spawnDrop: { id: number; tier: TierId }
  /** three-of-a-kind fired: ids snapping to centroid, next tier appears */
  mergeStart: { ids: number[]; tier: TierId; centroid: THREE.Vector3; chain: number }
  mergeDone: { newId: number; tier: TierId; centroid: THREE.Vector3; chain: number; score: number }
  foulWarning: { id: number; remaining: number }
  foul: { id: number; tier: TierId }
  fellOff: { id: number; tier: TierId; position: THREE.Vector3 }
  sandThud: { position: THREE.Vector3 }
  scoreChange: { score: number; delta: number; worldPos: THREE.Vector3 | null }
  turnReady: {} // next drink arrives in cradle
  pullStart: {}
  pullMove: { pull01: number }
  pullCancel: {}
  levelComplete: { stars: number; score: number }
  gameOver: { score: number; reason: 'foul' }
  muteChange: { muted: boolean }
  // ---- orders (Endless pacing, src/levels/orders.ts) ----
  /** a new order card: serve one drink of `tier` within `budget` launches */
  orderNew: { tier: TierId; budget: number }
  /** the ordered drink appeared at rest and is being carried off */
  orderServed: { tier: TierId; score: number; tip: number; served: number }
  /** budget spent without a serve: customer left, junk tossed */
  orderMissed: { tier: TierId; missed: number }
}

type Handler<T> = (payload: T) => void

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<any>>>()

  on<K extends keyof GameEvents>(event: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(event)
    if (!set) { set = new Set(); this.handlers.set(event, set) }
    set.add(fn)
    return () => set!.delete(fn)
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(event)
    if (!set) return
    for (const fn of set) fn(payload)
  }

  clear(): void {
    this.handlers.clear()
  }
}

/** One global bus per running scene. Constructed in main, passed down. */
export const bus = new EventBus()
