import type { BootCtx, SceneHandle } from '../../main'

/** PLACEHOLDER — real ladder scene arrives with the physics milestone. */
export async function createLadderScene(ctx: BootCtx): Promise<SceneHandle> {
  const { createGameScene } = await import('../../levels/gameScene')
  return createGameScene(ctx)
}
