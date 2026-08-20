import { t, getLocale } from '../core/strings'
import { CHAPTERS, levelsOfChapter, starsToUnlockChapter, type LevelDef } from '../config/levels'
import { totalStars, type SaveData } from '../levels/save'

/**
 * Menu layer — HTML overlays in #ui (system font, localized, ≥44 px tap
 * targets): title, chapter select, pause, level complete (stars pop in with a
 * stagger), level failed, foul game over, endless game over with the local
 * top-5. The scene pauses its fixed-step sim while any menu root is open —
 * sea/sky keep animating underneath, which is the whole point of the beach.
 */

export interface MenuCallbacks {
  onPlay(levelId: number): void
  onResume(): void
  onRestart(): void
  onQuit(): void
  onPauseRequest(): void
  /** returns the new muted state */
  onToggleSound(): boolean
  onToggleLocale(): void
  resumeTarget(): number
  save(): SaveData
}

export interface Menus {
  showTitle(): void
  showChapters(): void
  showPause(): void
  showLevelComplete(o: { level: LevelDef; stars: number; score: number; nextId: number | null }): void
  showLevelFailed(score: number): void
  showFoulGameOver(score: number): void
  showEndlessGameOver(score: number, rank: number | null): void
  hideAll(): void
  setPauseButtonVisible(v: boolean): void
  isOpen(): boolean
  dispose(): void
}

const BTN =
  'display:block;min-width:220px;min-height:48px;padding:12px 30px;border:none;' +
  'border-radius:999px;font-size:17px;font-weight:700;font-family:inherit;cursor:pointer;' +
  'transition:transform .12s, box-shadow .12s;'
const BTN_PRIMARY = BTN + 'background:#ffb45c;color:#25150a;box-shadow:0 4px 16px rgba(255,180,92,.35);'
const BTN_GHOST = BTN + 'background:rgba(255,255,255,.14);color:#fff;'
const BTN_SMALL =
  'min-height:44px;padding:10px 20px;border:none;border-radius:999px;font-size:14px;' +
  'font-weight:600;font-family:inherit;cursor:pointer;background:rgba(255,255,255,.14);color:#fff;'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  css: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.style.cssText = css
  if (text !== undefined) e.textContent = text
  return e
}

function button(label: string, css: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', css, label)
  b.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  return b
}

export function createMenus(cb: MenuCallbacks): Menus {
  const ui = document.getElementById('ui') ?? document.body
  const root = el('div', 'position:absolute;inset:0;display:none;')
  root.className = 'clickable'
  ui.appendChild(root)

  // pause button — its own tiny layer so it stays clickable while root is hidden
  const pauseBtn = button('❚❚', '', cb.onPauseRequest)
  pauseBtn.className = 'clickable'
  pauseBtn.style.cssText =
    'position:absolute;top:10px;right:12px;width:44px;height:44px;border:none;' +
    'border-radius:50%;background:rgba(10,26,38,.5);color:#fff;font-size:13px;' +
    'font-family:inherit;cursor:pointer;display:none;'
  ui.appendChild(pauseBtn)

  let open = false
  const timers: number[] = []

  function later(fn: () => void, ms: number): void {
    timers.push(window.setTimeout(fn, ms))
  }

  function clear(): void {
    for (const id of timers) clearTimeout(id)
    timers.length = 0
    root.replaceChildren()
  }

  function panel(dim: number): HTMLDivElement {
    clear()
    open = true
    root.style.display = ''
    const p = el(
      'div',
      'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
        `justify-content:center;gap:14px;background:rgba(6,16,26,${dim});color:#fff;` +
        'text-align:center;overflow-y:auto;padding:24px 16px;' +
        'opacity:0;transition:opacity .28s ease-out;'
    )
    root.appendChild(p)
    // fade every panel in — a full-opacity same-frame appearance reads as a cut
    requestAnimationFrame(() => { p.style.opacity = '1' })
    return p
  }

  function wordmark(size: number): HTMLDivElement {
    const w = el('div', `font-size:${size}px;font-weight:800;letter-spacing:.01em;line-height:1;`)
    const grad =
      'background:linear-gradient(160deg,#fff 20%,#ffd9a0 55%,#ffb45c 100%);' +
      '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;'
    const c = el('span', grad + 'display:inline-block;transform:rotate(-6deg);', 'C')
    const rest = el('span', grad + 'display:inline-block;', 'link')
    const glint = el(
      'span',
      'display:inline-block;color:#ffe9c9;transform:translateY(-.55em);font-size:.34em;',
      '✦'
    )
    w.append(c, rest, glint)
    w.style.filter = 'drop-shadow(0 4px 18px rgba(255,180,92,.35))'
    return w
  }

  function starRow(stars: number, size: number, stagger: boolean): HTMLDivElement {
    const row = el('div', `display:flex;gap:${Math.round(size * 0.3)}px;justify-content:center;`)
    for (let i = 0; i < 3; i++) {
      const earned = i < stars
      const s = el(
        'span',
        `font-size:${size}px;line-height:1;color:${earned ? '#ffce54' : 'rgba(255,255,255,.22)'};` +
          (earned ? 'text-shadow:0 2px 12px rgba(255,206,84,.55);' : ''),
        '★'
      )
      if (stagger && earned) {
        s.style.transform = 'scale(0)'
        s.style.transition = 'transform .38s cubic-bezier(.34,1.56,.64,1)'
        later(() => {
          s.style.transform = 'scale(1)'
        }, 260 + i * 240)
      }
      row.appendChild(s)
    }
    return row
  }

  function tallyScore(target: number, into: HTMLElement): void {
    const dur = 700
    const t0 = performance.now()
    const step = (): void => {
      const k = Math.min(1, (performance.now() - t0) / dur)
      into.textContent = String(Math.round(target * (1 - (1 - k) * (1 - k))))
      if (k < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  function settingsRow(rerender: () => void): HTMLDivElement {
    const row = el('div', 'display:flex;gap:12px;margin-top:10px;')
    const soundBtn = button(`${t('sound')}: —`, BTN_SMALL, () => {
      const muted = cb.onToggleSound()
      soundBtn.textContent = `${t('sound')}: ${muted ? t('off') : t('on')}`
    })
    soundBtn.textContent = `${t('sound')}: ${cb.save().muted ? t('off') : t('on')}`
    const langBtn = button(getLocale() === 'en' ? '中文' : 'English', BTN_SMALL, () => {
      cb.onToggleLocale()
      rerender() // strings changed — rebuild this screen in the new locale
    })
    row.append(soundBtn, langBtn)
    return row
  }

  // ---- screens ----

  function showTitle(): void {
    const p = panel(0.34)
    p.appendChild(wordmark(76))
    const spacer = el('div', 'height:16px;')
    p.appendChild(spacer)
    const target = cb.resumeTarget()
    const play = button(t('play'), BTN_PRIMARY, () => cb.onPlay(target))
    const sub = el('div', 'font-size:13px;opacity:.75;margin-top:-8px;', `${t('level')} ${target}`)
    const endless = button(t('endless'), BTN_GHOST, () => cb.onPlay(0))
    const chapters = button(t('chapters'), BTN_GHOST, () => showChapters())
    p.append(play, sub, endless, chapters, settingsRow(showTitle))
  }

  function showChapters(): void {
    const p = panel(0.5)
    const save = cb.save()
    const total = totalStars(save)
    p.appendChild(el('div', 'font-size:26px;font-weight:800;', t('chapters')))
    p.appendChild(el('div', 'font-size:14px;opacity:.8;margin-top:-8px;', `★ ${total}`))
    const wrap = el(
      'div',
      'display:flex;flex-direction:column;gap:14px;width:min(520px,94vw);margin-top:6px;'
    )
    for (const ch of CHAPTERS) {
      const need = starsToUnlockChapter(ch)
      const locked = total < need
      const card = el(
        'div',
        'border-radius:16px;padding:12px 14px;background:rgba(255,255,255,.08);' +
          `${locked ? 'opacity:.55;' : ''}`
      )
      const head = el('div', 'display:flex;justify-content:space-between;align-items:center;')
      head.appendChild(
        el('div', 'font-size:16px;font-weight:700;', t(`chapter${ch}` as 'chapter1'))
      )
      if (locked) {
        head.appendChild(el('div', 'font-size:13px;opacity:.85;', t('starsToUnlock', { n: need })))
      }
      card.appendChild(head)
      const grid = el('div', 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;')
      for (const lv of levelsOfChapter(ch)) {
        const stars = save.stars[lv.id] ?? 0
        const cell = el(
          'button',
          'width:64px;height:56px;border:none;border-radius:12px;font-family:inherit;' +
            'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;' +
            `background:${stars > 0 ? 'rgba(255,206,84,.2)' : 'rgba(255,255,255,.12)'};color:#fff;` +
            `cursor:${locked ? 'default' : 'pointer'};`
        )
        cell.appendChild(el('div', 'font-size:16px;font-weight:700;', String(lv.id)))
        cell.appendChild(
          el(
            'div',
            `font-size:10px;letter-spacing:.06em;color:${stars > 0 ? '#ffce54' : 'rgba(255,255,255,.35)'};`,
            '★'.repeat(stars) + '☆'.repeat(3 - stars)
          )
        )
        if (!locked) {
          cell.addEventListener('click', () => cb.onPlay(lv.id))
        }
        grid.appendChild(cell)
      }
      card.appendChild(grid)
      wrap.appendChild(card)
    }
    p.appendChild(wrap)
    p.appendChild(button(t('back'), BTN_GHOST, () => showTitle()))
  }

  function showPause(): void {
    const p = panel(0.55)
    p.appendChild(el('div', 'font-size:30px;font-weight:800;', t('paused')))
    p.append(
      button(t('resume'), BTN_PRIMARY, cb.onResume),
      button(t('restart'), BTN_GHOST, cb.onRestart),
      button(t('quit'), BTN_GHOST, cb.onQuit),
      settingsRow(showPause)
    )
  }

  function showLevelComplete(o: {
    level: LevelDef
    stars: number
    score: number
    nextId: number | null
  }): void {
    const p = panel(0.42)
    p.appendChild(el('div', 'font-size:32px;font-weight:800;', t('levelComplete')))
    p.appendChild(starRow(o.stars, 46, true))
    const scoreLine = el('div', 'font-size:15px;opacity:.85;', t('score'))
    const scoreNum = el(
      'div',
      'font-size:34px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:-8px;',
      '0'
    )
    p.append(scoreLine, scoreNum)
    tallyScore(o.score, scoreNum)
    if (o.nextId !== null) {
      const next = o.nextId
      p.appendChild(button(t('nextLevel'), BTN_PRIMARY, () => cb.onPlay(next)))
    }
    p.append(button(t('retry'), BTN_GHOST, cb.onRestart), button(t('menu'), BTN_GHOST, cb.onQuit))
  }

  function showLevelFailed(score: number): void {
    const p = panel(0.5)
    p.appendChild(el('div', 'font-size:30px;font-weight:800;', t('levelFailed')))
    p.appendChild(
      el('div', 'font-size:18px;opacity:.9;font-variant-numeric:tabular-nums;', `${t('score')} ${score}`)
    )
    p.append(button(t('retry'), BTN_PRIMARY, cb.onRestart), button(t('quit'), BTN_GHOST, cb.onQuit))
  }

  function showFoulGameOver(score: number): void {
    const p = panel(0.45)
    p.appendChild(el('div', 'font-size:32px;font-weight:800;', t('gameOver')))
    p.appendChild(
      el('div', 'font-size:19px;opacity:.92;font-variant-numeric:tabular-nums;', `${t('score')} ${score}`)
    )
    p.append(button(t('retry'), BTN_PRIMARY, cb.onRestart), button(t('quit'), BTN_GHOST, cb.onQuit))
  }

  function showEndlessGameOver(score: number, rank: number | null): void {
    const p = panel(0.48)
    p.appendChild(el('div', 'font-size:32px;font-weight:800;', t('gameOverEndless')))
    if (rank === 0) p.appendChild(el('div', 'font-size:16px;color:#ffce54;font-weight:700;', t('newBest')))
    p.appendChild(
      el('div', 'font-size:19px;opacity:.92;font-variant-numeric:tabular-nums;', `${t('score')} ${score}`)
    )
    const list = cb.save().endless
    const board = el(
      'div',
      'min-width:240px;border-radius:14px;background:rgba(255,255,255,.08);padding:12px 18px;' +
        'margin-top:4px;'
    )
    board.appendChild(
      el('div', 'font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.75;margin-bottom:6px;', t('leaderboard'))
    )
    list.forEach((s, i) => {
      const row = el(
        'div',
        'display:flex;justify-content:space-between;gap:24px;font-size:15px;padding:3px 0;' +
          `font-variant-numeric:tabular-nums;${i === rank ? 'color:#ffce54;font-weight:700;' : 'opacity:.9;'}`
      )
      row.append(el('span', '', `${i + 1}.`), el('span', '', String(s)))
      board.appendChild(row)
    })
    // no header over an empty list — a merge-less first run charts nothing
    if (list.length > 0) p.appendChild(board)
    p.append(button(t('retry'), BTN_PRIMARY, cb.onRestart), button(t('quit'), BTN_GHOST, cb.onQuit))
  }

  function hideAll(): void {
    clear()
    open = false
    root.style.display = 'none'
  }

  return {
    showTitle,
    showChapters,
    showPause,
    showLevelComplete,
    showLevelFailed,
    showFoulGameOver,
    showEndlessGameOver,
    hideAll,
    setPauseButtonVisible(v) {
      pauseBtn.style.display = v ? '' : 'none'
    },
    isOpen: () => open,
    dispose() {
      hideAll()
      root.remove()
      pauseBtn.remove()
    },
  }
}
