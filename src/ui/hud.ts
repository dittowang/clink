import * as THREE from 'three'
import { t } from '../core/strings'

/**
 * In-game HUD — plain HTML in #ui, system font. Score top-left, pushes
 * top-right (offset left of the pause button the menu layer owns), objective
 * chip bottom-left, pooled score pops positioned via Vector3.project, and the
 * foul-warning chip. All strings via t(). Menus/overlays live in ui/menus.ts.
 *
 * #ui is pointer-events:none by CSS; only .clickable elements receive input,
 * so the HUD never eats slingshot drags.
 */

const POP_POOL = 6
const POP_LIFE_MS = 950

export interface Hud {
  setScore(score: number): void
  /** pushes-left text top-right; null hides it (endless / unlimited) */
  setPushes(n: number | null): void
  /** objective chip bottom-left; done tints it green with a check */
  setObjective(text: string | null, done?: boolean): void
  /** floating score pop at the projection of a world point */
  pop(text: string, world: THREE.Vector3, camera: THREE.Camera): void
  flashFoulWarning(): void
  /** re-apply static labels after a locale change */
  relabel(): void
  /** show/hide the whole in-game HUD (menus hide it on the title screen) */
  setVisible(v: boolean): void
  dispose(): void
}

const _v = new THREE.Vector3()

export function createHud(): Hud {
  const ui = document.getElementById('ui') ?? document.body
  const root = document.createElement('div')
  root.style.cssText = 'position:absolute;inset:0;overflow:hidden;'
  ui.appendChild(root)

  // ---- score, top-left ----
  const scoreBox = document.createElement('div')
  scoreBox.style.cssText =
    'position:absolute;top:14px;left:16px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.45);'
  const scoreLabel = document.createElement('div')
  scoreLabel.style.cssText =
    'font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.78;'
  scoreLabel.textContent = t('score')
  const scoreValue = document.createElement('div')
  scoreValue.style.cssText =
    'font-size:28px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums;'
  scoreValue.textContent = '0'
  scoreBox.append(scoreLabel, scoreValue)
  root.appendChild(scoreBox)

  // ---- pushes, top-right (pause button sits in the far corner) ----
  const pushBox = document.createElement('div')
  pushBox.style.cssText =
    'position:absolute;top:14px;right:64px;color:#fff;text-align:right;' +
    'text-shadow:0 1px 3px rgba(0,0,0,.45);'
  const pushLabel = document.createElement('div')
  pushLabel.style.cssText =
    'font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.78;'
  pushLabel.textContent = t('pushes')
  const pushValue = document.createElement('div')
  pushValue.style.cssText =
    'font-size:24px;font-weight:700;line-height:1.15;font-variant-numeric:tabular-nums;'
  pushBox.append(pushLabel, pushValue)
  root.appendChild(pushBox)
  pushBox.style.display = 'none'

  // ---- objective chip, bottom-left ----
  const objChip = document.createElement('div')
  objChip.style.cssText =
    'position:absolute;left:16px;bottom:calc(16px + env(safe-area-inset-bottom, 0px));' +
    'padding:8px 16px;border-radius:999px;background:rgba(10,26,38,.55);color:#fff;' +
    'font-size:14px;font-weight:600;display:none;' +
    'box-shadow:0 2px 8px rgba(0,0,0,.25);transition:background .3s;'
  root.appendChild(objChip)

  // ---- score pops (pooled) ----
  interface Pop {
    el: HTMLDivElement
    busyUntil: number
  }
  const pops: Pop[] = []
  for (let i = 0; i < POP_POOL; i++) {
    const el = document.createElement('div')
    el.style.cssText =
      'position:absolute;left:0;top:0;color:#fff;font-weight:700;font-size:20px;' +
      'text-shadow:0 1px 4px rgba(0,0,0,.55);white-space:nowrap;opacity:0;' +
      'transform:translate(-50%,-100%);will-change:transform,opacity;'
    root.appendChild(el)
    pops.push({ el, busyUntil: 0 })
  }

  function pop(text: string, world: THREE.Vector3, camera: THREE.Camera): void {
    _v.copy(world).project(camera)
    if (_v.z > 1) return // behind the camera
    const now = performance.now()
    let slot = pops.find((p) => p.busyUntil <= now)
    if (!slot) slot = pops.reduce((a, b) => (a.busyUntil < b.busyUntil ? a : b)) // steal oldest
    slot.busyUntil = now + POP_LIFE_MS
    const w = root.clientWidth || window.innerWidth
    const h = root.clientHeight || window.innerHeight
    const el = slot.el
    el.textContent = text
    el.style.transition = 'none'
    el.style.left = `${((_v.x + 1) / 2) * w}px`
    el.style.top = `${((1 - _v.y) / 2) * h}px`
    el.style.opacity = '1'
    el.style.transform = 'translate(-50%,-100%) translateY(0)'
    void el.offsetWidth // commit the start state before animating
    el.style.transition = `transform ${POP_LIFE_MS}ms cubic-bezier(.2,.7,.3,1), opacity ${POP_LIFE_MS}ms ease-in`
    el.style.transform = 'translate(-50%,-100%) translateY(-52px)'
    el.style.opacity = '0'
  }

  // ---- foul warning chip ----
  const foulChip = document.createElement('div')
  foulChip.style.cssText =
    'position:absolute;top:16px;left:50%;transform:translateX(-50%);padding:6px 14px;' +
    'border-radius:999px;background:rgba(190,44,32,.88);color:#fff;font-size:14px;' +
    'font-weight:600;opacity:0;transition:opacity .18s;'
  foulChip.textContent = t('foulWarn')
  root.appendChild(foulChip)
  let foulTimer = 0
  function flashFoulWarning(): void {
    foulChip.style.opacity = '1'
    clearTimeout(foulTimer)
    foulTimer = window.setTimeout(() => {
      foulChip.style.opacity = '0'
    }, 1300)
  }

  let objText: string | null = null
  let objDone = false

  return {
    setScore(score) {
      scoreValue.textContent = String(score)
    },
    setPushes(n) {
      if (n === null) {
        pushBox.style.display = 'none'
      } else {
        pushBox.style.display = ''
        pushValue.textContent = t('pushesLeft', { n })
      }
    },
    setObjective(text, done = false) {
      objText = text
      objDone = done
      if (text === null) {
        objChip.style.display = 'none'
        return
      }
      objChip.style.display = ''
      objChip.textContent = done ? `✓ ${text}` : text
      objChip.style.background = done ? 'rgba(38,120,66,.72)' : 'rgba(10,26,38,.55)'
    },
    pop,
    flashFoulWarning,
    relabel() {
      scoreLabel.textContent = t('score')
      pushLabel.textContent = t('pushes')
      foulChip.textContent = t('foulWarn')
      if (objText !== null) this.setObjective(objText, objDone)
    },
    setVisible(v) {
      root.style.display = v ? '' : 'none'
    },
    dispose() {
      clearTimeout(foulTimer)
      root.remove()
    },
  }
}
