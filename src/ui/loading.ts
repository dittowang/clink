import { t } from '../core/strings'
import { wordmark } from './menus'

/**
 * Boot loading overlay — the wordmark over a thin progress bar, opaque, in
 * #ui. It covers the canvas while the warm-up (drink templates, shader
 * precompile, texture upload, one hidden real frame) runs, then fades out and
 * the title menu takes over. Opaque on purpose: the warm-up frame draws every
 * tier on the table in the camera's view (the transmission pass and the
 * per-instance clip-plane variants only compile for objects actually in the
 * frustum) and nobody should see that.
 *
 * The shimmer on the bar is a compositor-driven transform animation so the
 * overlay reads as alive even while a synchronous chunk (stage creation,
 * PMREM) blocks the main thread; the fill width is the real progress.
 */
export interface LoadingOverlay {
  /** resolves once the overlay has painted (two frames) */
  shown(): Promise<void>
  setProgress(k01: number): void
  /** fade out + remove; resolves when gone */
  finish(): Promise<void>
}

const FADE_MS = 380

export function createLoadingOverlay(): LoadingOverlay {
  const ui = document.getElementById('ui') ?? document.body
  const root = document.createElement('div')
  // clickable: absorbs taps so a press during loading never reaches the
  // slingshot on the canvas underneath
  root.className = 'clickable'
  root.style.cssText =
    // z-index: the HUD and menu layers are appended to #ui after this and
    // must not paint over it
    'position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;gap:26px;color:#fff;text-align:center;' +
    'background:radial-gradient(120% 90% at 50% 110%,#1b4560 0%,#0e2a3d 55%,#081b2a 100%);' +
    `opacity:1;transition:opacity ${FADE_MS}ms ease-out;`

  const style = document.createElement('style')
  style.textContent =
    '@keyframes clink-shimmer{from{transform:translateX(-100%)}to{transform:translateX(350%)}}'
  root.appendChild(style)

  root.appendChild(wordmark(76))

  const track = document.createElement('div')
  track.style.cssText =
    'position:relative;width:min(240px,62vw);height:4px;border-radius:999px;' +
    'background:rgba(255,255,255,.14);overflow:hidden;'
  const fill = document.createElement('div')
  fill.setAttribute('data-loading-bar', '')
  fill.style.cssText =
    'position:absolute;left:0;top:0;bottom:0;width:0%;border-radius:999px;' +
    'background:#ffb45c;transition:width .18s ease-out;'
  const shimmer = document.createElement('div')
  shimmer.style.cssText =
    'position:absolute;left:0;top:0;bottom:0;width:40%;border-radius:999px;' +
    'background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.35),rgba(255,255,255,0));' +
    'animation:clink-shimmer 1.1s linear infinite;'
  track.append(fill, shimmer)
  root.appendChild(track)

  const label = document.createElement('div')
  label.style.cssText = 'font-size:13px;letter-spacing:.08em;opacity:.7;margin-top:-14px;'
  label.textContent = t('loading')
  root.appendChild(label)

  ui.appendChild(root)

  let finished = false
  return {
    shown() {
      return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
    },
    setProgress(k01) {
      const pct = Math.round(Math.max(0, Math.min(1, k01)) * 100)
      fill.style.width = `${pct}%`
    },
    finish() {
      if (finished) return Promise.resolve()
      finished = true
      fill.style.width = '100%'
      return new Promise((resolve) => {
        let done = false
        const end = (): void => {
          if (done) return
          done = true
          root.remove()
          resolve()
        }
        root.addEventListener('transitionend', end, { once: true })
        // the transition only starts after a paint; a hidden tab never paints
        setTimeout(end, FADE_MS + 200)
        requestAnimationFrame(() => {
          root.style.opacity = '0'
        })
      })
    },
  }
}
