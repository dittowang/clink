import type { TierId } from '../config/tiers'

/**
 * window.__game — the automation contract the Playwright harness drives.
 * Active scene registers an implementation via registerHarness().
 * Enabled by ?harness=1 (deterministic manual time) but always attached so
 * debug scenes can be poked from the console.
 */
export interface HarnessApi {
  /** spawn a drink of the given tier into the cradle (or at x,z if given) */
  spawn(tier: TierId, x?: number, z?: number): number
  /** pull-and-release in one call: angle radians in the table plane (0 = straight at the far rail), power 0..1 */
  push(angle: number, power: number): void
  /** advance simulated time deterministically and render one frame */
  stepTo(seconds: number): void
  /** render one frame and resolve when the frame is on screen */
  capture(): Promise<void>
  /** machine-readable scene state for assertions */
  state(): unknown
  /** stop-distance log for the ladder scene, metres from launch */
  logs?(): unknown
}

declare global {
  interface Window {
    __game?: HarnessApi
    __ready?: boolean
  }
}

export function registerHarness(api: HarnessApi): void {
  window.__game = api
}

export function markReady(): void {
  window.__ready = true
}

export function isHarness(): boolean {
  return new URLSearchParams(window.location.search).get('harness') === '1'
}

export function sceneParam(): string {
  return new URLSearchParams(window.location.search).get('scene') ?? 'game'
}
