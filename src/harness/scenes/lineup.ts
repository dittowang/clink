import type { BootCtx, SceneHandle } from '../../main'

/** PLACEHOLDER — real lineup scene arrives with the drinks milestone. */
export async function createLineupScene(ctx: BootCtx): Promise<SceneHandle> {
  const { createGameScene } = await import('../../levels/gameScene')
  return createGameScene(ctx)
}
