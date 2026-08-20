#!/usr/bin/env node
/**
 * Tile capture PNGs into one contact sheet. Uses Playwright's bundled
 * Chromium as the compositor (blank page + canvas + toDataURL) so the repo
 * gains zero image deps.
 *
 * Usage:
 *   node scripts/montage.mjs --out=sheet.png img1.png img2.png ...
 *
 * Flags:
 *   --out=path.png   output sheet (required)
 *   --cols=N         grid columns (default 4)
 *   --cell=W         max cell width in px, images downscaled to fit (default 480)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { chromium } from 'playwright'

const flags = {}
const images = []
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/)
  if (m) flags[m[1]] = m[2] ?? true
  else images.push(a)
}

if (!flags.out || images.length === 0) {
  console.error('usage: node scripts/montage.mjs --out=sheet.png [--cols=4] [--cell=480] img1.png img2.png ...')
  process.exit(1)
}

const cols = Math.max(1, Number(flags.cols ?? 4))
const cellCap = Math.max(64, Number(flags.cell ?? 480))
const entries = images.map((p) => {
  const abs = resolve(process.cwd(), p)
  return { name: basename(p), data: `data:image/png;base64,${readFileSync(abs).toString('base64')}` }
})

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const dataUrl = await page.evaluate(
    async ({ entries, cols, cellCap }) => {
      const imgs = await Promise.all(
        entries.map(
          (e) =>
            new Promise((res, rej) => {
              const i = new Image()
              i.onload = () => res({ img: i, name: e.name })
              i.onerror = () => rej(new Error(`failed to decode ${e.name}`))
              i.src = e.data
            })
        )
      )
      const fit = (img) => Math.min(1, cellCap / img.naturalWidth)
      const cellW = Math.max(...imgs.map(({ img }) => Math.round(img.naturalWidth * fit(img))))
      const cellH = Math.max(...imgs.map(({ img }) => Math.round(img.naturalHeight * fit(img))))
      const CAPTION = 26
      const PAD = 8
      const gridCols = Math.min(cols, imgs.length)
      const rows = Math.ceil(imgs.length / gridCols)
      const W = gridCols * (cellW + PAD) + PAD
      const H = rows * (cellH + CAPTION + PAD) + PAD
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const g = canvas.getContext('2d')
      g.fillStyle = '#14161a'
      g.fillRect(0, 0, W, H)
      imgs.forEach(({ img, name }, i) => {
        const c = i % gridCols
        const r = Math.floor(i / gridCols)
        const x = PAD + c * (cellW + PAD)
        const y = PAD + r * (cellH + CAPTION + PAD)
        const s = fit(img)
        const w = Math.round(img.naturalWidth * s)
        const h = Math.round(img.naturalHeight * s)
        g.fillStyle = '#000'
        g.fillRect(x, y, cellW, cellH)
        g.drawImage(img, x + (cellW - w) / 2, y + (cellH - h) / 2, w, h)
        g.fillStyle = '#d8dce2'
        g.font = '13px system-ui, sans-serif'
        g.textBaseline = 'middle'
        g.fillText(name, x + 2, y + cellH + CAPTION / 2, cellW - 4)
      })
      return canvas.toDataURL('image/png')
    },
    { entries, cols, cellCap }
  )
  const out = resolve(process.cwd(), String(flags.out))
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log(`wrote ${out} (${entries.length} tiles, ${Math.min(cols, entries.length)} cols)`)
} finally {
  await browser.close()
}
