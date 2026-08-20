import * as THREE from 'three'
import { t } from '../core/strings'

/**
 * HUD v1 — plain HTML in #ui, system font, no menus. Score top-left, pooled
 * score pops positioned via Vector3.project, a foul-warning chip, and the
 * game-over overlay (dim + score + Retry). All strings via t().
 *
 * #ui is pointer-events:none by CSS; only elements with .clickable receive
 * input (the Retry button), so the HUD never eats slingshot drags.
 */

const POP_POOL = 6
const POP_LIFE_MS = 950

export interface Hud {
  setScore(score: number): void
  /** floating score pop at the projection of a world point */
  pop(text: string, world: THREE.Vector3, camera: THREE.Camera): void
  flashFoulWarning(): void
  showGameOver(score: number, onRetry: () => void): void
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

  // ---- game over ----
  let overlay: HTMLDivElement | null = null
  function showGameOver(score: number, onRetry: () => void): void {
    if (overlay) return
    overlay = document.createElement('div')
    overlay.className = 'clickable'
    overlay.style.cssText =
      'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;gap:12px;background:rgba(8,20,30,0);transition:background .7s;' +
      'color:#fff;text-align:center;'
    const title = document.createElement('div')
    title.style.cssText = 'font-size:34px;font-weight:800;text-shadow:0 2px 8px rgba(0,0,0,.5);'
    title.textContent = t('gameOver')
    const line = document.createElement('div')
    line.style.cssText = 'font-size:20px;opacity:.92;font-variant-numeric:tabular-nums;'
    line.textContent = `${t('score')} ${score}`
    const btn = document.createElement('button')
    btn.style.cssText =
      'margin-top:8px;padding:10px 30px;border:none;border-radius:999px;background:#fff;' +
      'color:#14303f;font-size:16px;font-weight:700;font-family:inherit;cursor:pointer;'
    btn.textContent = t('retry')
    btn.addEventListener('click', onRetry)
    overlay.append(title, line, btn)
    root.appendChild(overlay)
    requestAnimationFrame(() => {
      if (overlay) overlay.style.background = 'rgba(8,20,30,.55)'
    })
  }

  return {
    setScore(score) {
      scoreValue.textContent = String(score)
    },
    pop,
    flashFoulWarning,
    showGameOver,
    dispose() {
      clearTimeout(foulTimer)
      root.remove()
    },
  }
}
