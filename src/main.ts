import RAPIER from '@dimforge/rapier3d-compat'
import { createRenderer } from './render/renderer'
import { Scheduler, type Steppable } from './core/scheduler'
import { sceneParam, isHarness, markReady } from './harness/api'
import { detectLocale, setLocale } from './core/strings'

/**
 * Boot: init Rapier BEFORE any world exists, create the renderer, route to
 * the requested scene (game | lineup | ladder), drive it from the fixed-step
 * scheduler. Scenes own everything else.
 */
export interface SceneHandle extends Steppable {
  dispose(): void
  onResize(w: number, h: number): void
  /** scenes render themselves so they can own composers */
  render(): void
}

export interface BootCtx {
  renderer: import('three').WebGLRenderer
  scheduler: Scheduler
  harness: boolean
}

async function boot(): Promise<void> {
  const stored = localStorage.getItem('clink.locale')
  setLocale(stored === 'zh-CN' || stored === 'en' ? stored : detectLocale())

  await RAPIER.init()

  const container = document.getElementById('app')!
  const renderer = createRenderer(container)

  let scene: SceneHandle | null = null
  const stepTarget: Steppable = {
    fixedUpdate: (dt) => scene?.fixedUpdate(dt),
    frameUpdate: (alpha, frameDt) => {
      scene?.frameUpdate(alpha, frameDt)
      scene?.render()
    },
  }
  const scheduler = new Scheduler(stepTarget)
  const harness = isHarness()
  scheduler.manual = harness
  const ctx: BootCtx = { renderer, scheduler, harness }

  const which = sceneParam()
  if (which === 'lineup') {
    const { createLineupScene } = await import('./harness/scenes/lineup')
    scene = await createLineupScene(ctx)
  } else if (which === 'ladder') {
    const { createLadderScene } = await import('./harness/scenes/ladder')
    scene = await createLadderScene(ctx)
  } else {
    const { createGameScene } = await import('./levels/gameScene')
    scene = await createGameScene(ctx)
  }

  window.addEventListener('resize', () => {
    const w = container.clientWidth, h = container.clientHeight
    renderer.setSize(w, h)
    scene?.onResize(w, h)
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduler.resetClock()
  })

  if (!harness) {
    const loop = (t: number) => {
      scheduler.tick(t)
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  } else {
    // harness mode: render one initial frame; time advances only via stepTo()
    scene.frameUpdate(0, 0)
    scene.render()
  }

  markReady()
}

boot().catch((err) => {
  console.error('[clink] boot failed', err)
  const el = document.createElement('pre')
  el.style.cssText = 'color:#fff;padding:24px;font-size:12px'
  el.textContent = String(err?.stack ?? err)
  document.body.appendChild(el)
})
