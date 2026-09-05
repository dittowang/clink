import * as THREE from 'three'
import { t, tierName } from '../core/strings'
import type { TierId } from '../config/tiers'
import { TIME_WARN_S, MISS_FLASH_S } from '../config/orders'

/**
 * In-game HUD — plain HTML in #ui, system font. Score top-left (with the
 * Endless "Served N" tally under it), pushes top-right (offset left of the
 * pause button the menu layer owns), the Endless ORDER CARD top-centre
 * (thumbnail + tier name + a draining clock bar), objective chip bottom-left,
 * pooled score pops positioned via Vector3.project, a centre toast, and the
 * foul-warning chip. All strings via t(). Menus/overlays live in ui/menus.ts.
 *
 * #ui is pointer-events:none by CSS; only .clickable elements receive input,
 * so the HUD never eats slingshot drags.
 */

const POP_POOL = 6
const POP_LIFE_MS = 950
const TOAST_LIFE_MS = 1900

export interface OrderCard {
  tier: TierId
  /** data URL from the thumbnailer ('' → the tier hue swatch stands in) */
  thumb: string
  /** seconds on the clock */
  budget: number
  /** seconds left */
  remaining: number
}

export interface Hud {
  setScore(score: number): void
  /** pushes-left text top-right; null hides it (endless / unlimited) */
  setPushes(n: number | null): void
  /** objective chip bottom-left; done tints it green with a check */
  setObjective(text: string | null, done?: boolean): void
  /** floating score pop at the projection of a world point */
  pop(text: string, world: THREE.Vector3, camera: THREE.Camera, opts?: { gold?: boolean; sub?: string }): void
  /**
   * Persistent foul-warning pill: ON (pulsing) while any drink is inside the
   * grace window, OFF the moment the danger clears or the consequence fires —
   * the scene drives it every fixed step, so it can never silently time out
   * before the foul lands.
   */
  setFoulWarning(on: boolean): void
  /** the Endless order card; null hides it (campaign) */
  setOrder(card: OrderCard | null): void
  /** seconds left on the active order → the clock bar; the last TIME_WARN_S pulse the card */
  setOrderRemaining(remaining: number): void
  /** the order was served: green tick state until the next setOrder */
  setOrderDone(): void
  /** customer left: shake + red flash for MISS_FLASH_S with the given line */
  flashOrderMissed(text: string): void
  /** "Served N" under the score; null hides it (campaign) */
  setServed(n: number | null): void
  /** brief centred toast (pool shift etc.) */
  toast(text: string): void
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

  const style = document.createElement('style')
  style.textContent =
    '@keyframes clinkFoulPulse{0%,100%{transform:translateX(-50%) scale(1)}' +
    '50%{transform:translateX(-50%) scale(1.07)}}' +
    '@keyframes clinkOrderPulse{0%,100%{transform:translateX(-50%) scale(1)}' +
    '50%{transform:translateX(-50%) scale(1.035)}}' +
    '@keyframes clinkOrderShake{0%,100%{transform:translateX(-50%)}' +
    '15%{transform:translateX(calc(-50% - 7px))}30%{transform:translateX(calc(-50% + 7px))}' +
    '45%{transform:translateX(calc(-50% - 5px))}60%{transform:translateX(calc(-50% + 5px))}' +
    '75%{transform:translateX(calc(-50% - 2px))}}' +
    '@keyframes clinkOrderIn{0%{transform:translateX(-50%) translateY(-10px) scale(.92);opacity:0}' +
    '100%{transform:translateX(-50%) translateY(0) scale(1);opacity:1}}' +
    '@keyframes clinkToast{0%{opacity:0;transform:translate(-50%,6px)}12%{opacity:1;transform:translate(-50%,0)}' +
    '80%{opacity:1}100%{opacity:0;transform:translate(-50%,-8px)}}'
  root.appendChild(style)

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
  const servedLine = document.createElement('div')
  servedLine.dataset.hud = 'served'
  servedLine.style.cssText =
    'font-size:12px;font-weight:600;opacity:.85;margin-top:2px;display:none;' +
    'font-variant-numeric:tabular-nums;'
  scoreBox.append(scoreLabel, scoreValue, servedLine)
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

  // ---- order card, top-centre (Endless) ----
  // Fits between the score and the pause button on a 375 px phone:
  // 56 px thumb + ~100 px text column + padding ≈ 176 px.
  const CARD_BG = 'rgba(10,26,38,.58)'
  const CARD_BG_DONE = 'rgba(38,120,66,.78)'
  const CARD_BG_MISS = 'rgba(190,44,32,.9)'
  const orderCard = document.createElement('div')
  orderCard.dataset.hud = 'order'
  orderCard.style.cssText =
    'position:absolute;top:10px;left:50%;transform:translateX(-50%);display:none;' +
    'align-items:center;gap:9px;padding:5px 12px 5px 5px;border-radius:15px;' +
    `background:${CARD_BG};color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.28);` +
    'transition:background .25s;will-change:transform;'
  const thumb = document.createElement('img')
  thumb.alt = ''
  thumb.draggable = false
  thumb.style.cssText =
    'width:56px;height:56px;border-radius:11px;background:#f1dcbd;display:block;' +
    'object-fit:cover;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18);'
  const col = document.createElement('div')
  col.style.cssText = 'display:flex;flex-direction:column;min-width:88px;max-width:120px;'
  const orderLabel = document.createElement('div')
  orderLabel.style.cssText =
    'font-size:10px;letter-spacing:.14em;text-transform:uppercase;opacity:.78;line-height:1.2;'
  orderLabel.textContent = t('order')
  const orderName = document.createElement('div')
  orderName.style.cssText =
    'font-size:13px;font-weight:700;line-height:1.25;white-space:nowrap;overflow:hidden;' +
    'text-overflow:ellipsis;'
  const pipRow = document.createElement('div')
  pipRow.style.cssText = 'display:flex;gap:6px;margin-top:5px;align-items:center;height:12px;'
  const bar = document.createElement('div')
  bar.style.cssText =
    'position:relative;flex:1;min-width:72px;height:5px;border-radius:3px;background:rgba(255,255,255,.22);' +
    'overflow:hidden;'
  const barFill = document.createElement('div')
  barFill.style.cssText =
    'position:absolute;left:0;top:0;bottom:0;width:100%;background:#ffce54;border-radius:3px;' +
    'transition:width .12s linear,background .3s;'
  bar.appendChild(barFill)
  const secs = document.createElement('div')
  secs.style.cssText =
    'font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;min-width:26px;text-align:right;' +
    'opacity:.92;line-height:1;'
  col.append(orderLabel, orderName, pipRow)
  orderCard.append(thumb, col)
  root.appendChild(orderCard)

  let card: OrderCard | null = null
  let cardMode: 'open' | 'done' | 'miss' = 'open'
  let missTimer = 0

  let shownSecond = -1
  function renderPips(): void {
    if (!card) return
    if (!pipRow.contains(bar)) pipRow.replaceChildren(bar, secs)
    const frac = card.budget > 0 ? Math.max(0, Math.min(1, card.remaining / card.budget)) : 0
    barFill.style.width = `${100 * frac}%`
    barFill.style.background = card.remaining <= TIME_WARN_S ? '#ff6b57' : '#ffce54'
    const sec = Math.ceil(card.remaining)
    if (sec !== shownSecond) {
      shownSecond = sec
      secs.textContent = `${sec}s`
      pipRow.title = t('orderSeconds', { n: sec })
    }
  }

  function applyPulse(): void {
    if (!card || cardMode !== 'open') {
      orderCard.style.animation = ''
      return
    }
    orderCard.style.animation =
      card.remaining <= TIME_WARN_S ? 'clinkOrderPulse .9s ease-in-out infinite' : ''
  }

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
    main: HTMLSpanElement
    sub: HTMLDivElement
    busyUntil: number
  }
  const pops: Pop[] = []
  for (let i = 0; i < POP_POOL; i++) {
    const el = document.createElement('div')
    el.style.cssText =
      'position:absolute;left:0;top:0;color:#fff;font-weight:700;font-size:20px;' +
      'text-shadow:0 1px 4px rgba(0,0,0,.55);white-space:nowrap;opacity:0;text-align:center;' +
      'transform:translate(-50%,-100%);will-change:transform,opacity;'
    const main = document.createElement('span')
    const sub = document.createElement('div')
    sub.style.cssText = 'font-size:12px;font-weight:600;opacity:.9;margin-top:1px;display:none;'
    el.append(main, sub)
    root.appendChild(el)
    pops.push({ el, main, sub, busyUntil: 0 })
  }

  function pop(
    text: string,
    world: THREE.Vector3,
    camera: THREE.Camera,
    opts?: { gold?: boolean; sub?: string }
  ): void {
    _v.copy(world).project(camera)
    if (_v.z > 1) return // behind the camera
    const now = performance.now()
    let slot = pops.find((p) => p.busyUntil <= now)
    if (!slot) slot = pops.reduce((a, b) => (a.busyUntil < b.busyUntil ? a : b)) // steal oldest
    slot.busyUntil = now + POP_LIFE_MS
    const w = root.clientWidth || window.innerWidth
    const h = root.clientHeight || window.innerHeight
    const el = slot.el
    const gold = opts?.gold === true
    slot.main.textContent = gold ? `★ ${text}` : text
    el.style.color = gold ? '#ffce54' : '#fff'
    el.style.fontSize = gold ? '22px' : '20px'
    if (opts?.sub) {
      slot.sub.textContent = opts.sub
      slot.sub.style.display = ''
    } else {
      slot.sub.style.display = 'none'
    }
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

  // ---- toast (centre) ----
  const toastEl = document.createElement('div')
  toastEl.dataset.hud = 'toast'
  toastEl.style.cssText =
    'position:absolute;top:38%;left:50%;transform:translate(-50%,0);padding:9px 20px;' +
    'border-radius:999px;background:rgba(10,26,38,.62);color:#ffe9c9;font-size:15px;' +
    'font-weight:700;opacity:0;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,.3);'
  root.appendChild(toastEl)
  function toast(text: string): void {
    toastEl.textContent = `✦ ${text}`
    // restart the animation even mid-flight; `forwards` parks it at opacity 0
    toastEl.style.animation = 'none'
    void toastEl.offsetWidth
    toastEl.style.animation = `clinkToast ${TOAST_LIFE_MS}ms ease-out forwards`
  }

  // ---- foul warning chip (persistent + pulsing while the danger stands) ----
  // top-centre, under the order card when one is showing
  const foulChip = document.createElement('div')
  foulChip.style.cssText =
    'position:absolute;top:16px;left:50%;transform:translateX(-50%);padding:6px 14px;' +
    'border-radius:999px;background:rgba(190,44,32,.88);color:#fff;font-size:14px;' +
    'font-weight:600;opacity:0;transition:opacity .18s;'
  foulChip.textContent = t('foulWarn')
  root.appendChild(foulChip)
  let foulOn = false
  function setFoulWarning(on: boolean): void {
    if (on === foulOn) return
    foulOn = on
    foulChip.style.opacity = on ? '1' : '0'
    foulChip.style.animation = on ? 'clinkFoulPulse .55s ease-in-out infinite' : ''
  }

  let objText: string | null = null
  let objDone = false
  let servedN: number | null = null

  function setOrder(next: OrderCard | null): void {
    clearTimeout(missTimer)
    card = next
    cardMode = 'open'
    if (!next) {
      orderCard.style.display = 'none'
      orderCard.style.animation = ''
      foulChip.style.top = '16px'
      return
    }
    foulChip.style.top = '82px'
    orderCard.style.display = 'flex'
    orderCard.style.background = CARD_BG
    orderLabel.textContent = t('order')
    orderName.textContent = tierName(next.tier)
    orderName.style.color = ''
    if (next.thumb) {
      thumb.src = next.thumb
      thumb.style.display = 'block'
    } else {
      thumb.removeAttribute('src')
      thumb.style.display = 'block'
    }
    renderPips()
    // pop-in, then the pulse rule takes over
    orderCard.style.animation = 'clinkOrderIn .32s cubic-bezier(.34,1.4,.64,1)'
    window.setTimeout(() => {
      if (card === next) applyPulse()
    }, 340)
  }

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
    setFoulWarning,
    setOrder,
    setOrderRemaining(remaining) {
      if (!card) return
      card.remaining = Math.max(0, remaining)
      renderPips()
      applyPulse()
    },
    setOrderDone() {
      if (!card) return
      cardMode = 'done'
      orderCard.style.animation = ''
      orderCard.style.background = CARD_BG_DONE
      orderName.textContent = `✓ ${t('served')}`
    },
    flashOrderMissed(text) {
      if (!card) return
      cardMode = 'miss'
      orderCard.style.transition = 'none'
      orderCard.style.background = CARD_BG_MISS
      orderName.textContent = text
      orderCard.style.animation = 'none'
      void orderCard.offsetWidth
      orderCard.style.animation = `clinkOrderShake ${Math.round(MISS_FLASH_S * 1000)}ms ease-in-out`
      clearTimeout(missTimer)
      missTimer = window.setTimeout(() => {
        orderCard.style.transition = 'background .25s'
        orderCard.style.animation = ''
      }, MISS_FLASH_S * 1000)
    },
    setServed(n) {
      servedN = n
      if (n === null) {
        servedLine.style.display = 'none'
      } else {
        servedLine.style.display = ''
        servedLine.textContent = t('servedCount', { n })
      }
    },
    toast,
    relabel() {
      scoreLabel.textContent = t('score')
      pushLabel.textContent = t('pushes')
      foulChip.textContent = t('foulWarn')
      orderLabel.textContent = t('order')
      if (card && cardMode === 'open') {
        orderName.textContent = tierName(card.tier)
        renderPips()
      } else if (card && cardMode === 'done') {
        orderName.textContent = `✓ ${t('served')}`
      }
      if (servedN !== null) this.setServed(servedN)
      if (objText !== null) this.setObjective(objText, objDone)
    },
    setVisible(v) {
      root.style.display = v ? '' : 'none'
    },
    dispose() {
      clearTimeout(missTimer)
      root.remove()
    },
  }
}
