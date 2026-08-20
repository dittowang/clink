import type { BootCtx, SceneHandle } from '../../main'

/**
 * PLACEHOLDER probe scene — single-drink turntable close-up for iterating on
 * one tier (?scene=probe&tier=5). Replaced in the drinks milestone.
 */
export async function createProbeScene(ctx: BootCtx): Promise<SceneHandle> {
  const { createGameScene } = await import('../../levels/gameScene')
  return createGameScene(ctx)
}
