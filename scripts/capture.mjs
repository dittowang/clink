#!/usr/bin/env node
/**
 * Clink capture harness.
 *
 * Boots a vite dev server, drives the game in deterministic harness mode
 * (?harness=1) through headless Chromium with SwiftShader WebGL, and captures
 * stills, frame sequences, and state logs. Every feel claim gets verified
 * against output from this script — never against assumptions.
 *
 * Usage:
 *   node scripts/capture.mjs --scene=lineup --out=captures/lineup.png
 *   node scripts/capture.mjs --scene=ladder --eval="__game.push(0,1)" --settle=6 --state
 *   node scripts/capture.mjs --scene=game --eval="__game.spawn(3)" \
 *       --frames=90 --fps=60 --outdir=captures/push-seq
 *   node scripts/capture.mjs --scene=game --audio=impacts --out=captures/audio.json
 *
 * Flags:
 *   --scene=game|lineup|ladder   scene to load (default game)
 *   --seed=N                     PRNG seed (default 1337)
 *   --url-extra="&foo=1"         extra query params
 *   --eval="js"                  evaluated in page after ready (await-able)
 *   --settle=S                   stepTo(S) seconds before capturing
 *   --out=path.png|.json         single still / state / audio output
 *   --frames=N --fps=F           frame sequence into --outdir
 *   --outdir=dir                 sequence directory (frames as %04d.png)
 *   --state                      print __game.state() JSON to stdout
 *   --size=WxH                   viewport (default 1280x720)
 *   --keep-open                  don't close (debugging)
 *   --audio=SPEC                 offline audio probe via window.__audio.
 *                                SPEC: "impact:<mat>:<forceN>" | "merge:<tier>[:chain]"
 *                                | "pileup" | "surf" | "matrix" (full verification
 *                                sweep) | comma-separated list of the above.
 *                                JSON goes to --out (or stdout). Screenshot/state
 *                                capture is skipped in this mode.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    // [\s\S] not (.*): a multi-line --eval must not silently truncate
    const m = a.match(/^--([^=]+)(?:=([\s\S]*))?$/)
    return m ? [m[1], m[2] ?? true] : [a, true]
  })
)

// random port per run so parallel captures never collide
const PORT = Number(process.env.CLINK_PORT || 5200 + Math.floor(Math.random() * 600))
const scene = args.scene ?? 'game'
const seed = args.seed ?? '1337'
const size = String(args.size ?? '1280x720').split('x').map(Number)

function startServer() {
  return new Promise((resolveP, reject) => {
    const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
      cwd: resolve(import.meta.dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let ready = false
    const onData = (d) => {
      const s = d.toString()
      if (!ready && (s.includes('Local:') || s.includes('ready in'))) {
        ready = true
        setTimeout(() => resolveP(proc), 150)
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('exit', (code) => {
      if (!ready) reject(new Error(`vite exited early (${code})`))
    })
    setTimeout(() => { if (!ready) reject(new Error('vite start timeout')) }, 20000)
  })
}

async function main() {
  const server = await startServer()
  const browser = await chromium.launch({
    args: [
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--disable-gpu-sandbox',
      '--no-sandbox',
    ],
  })
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } })
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[page]', msg.text())
  })
  page.on('pageerror', (err) => console.error('[pageerror]', err.message))

  const extra = args['url-extra'] ?? ''
  const url = `http://localhost:${PORT}/?harness=1&scene=${scene}&seed=${seed}${extra}`
  await page.goto(url)
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 })

  if (args.eval) {
    await page.evaluate(async (code) => {
      // eslint-disable-next-line no-new-func
      await new Function('__game', `return (async () => { ${code} })()`)(window.__game)
    }, String(args.eval))
  }

  if (args.settle) {
    await page.evaluate((s) => window.__game.stepTo(Number(s)), String(args.settle))
  }

  const outPath = args.out ? resolve(process.cwd(), String(args.out)) : null
  if (outPath) mkdirSync(dirname(outPath), { recursive: true })

  if (args.audio) {
    // window.__audio lives in src/audio/offline.ts; inject it as a module so
    // the boot path stays untouched (vite transforms the TS on demand)
    await page.addScriptTag({ type: 'module', content: `import '/src/audio/offline.ts'` })
    await page.waitForFunction(() => !!window.__audio, null, { timeout: 15000 })
    const result = await page.evaluate(async (spec) => {
      const A = window.__audio
      const one = async (s) => {
        const [kind, a, b] = s.split(':')
        if (kind === 'impact') return A.renderImpact(a, Number(b ?? 10))
        if (kind === 'merge') return A.renderMerge(Number(a ?? 3), Number(b ?? 1))
        if (kind === 'pileup') return A.renderPileup()
        if (kind === 'surf') return A.renderSurf()
        if (kind === 'levels') return A.renderLevels()
        if (kind === 'pan') return A.renderPan(Number(a ?? 0))
        throw new Error(`unknown --audio spec: ${s}`)
      }
      if (spec === 'matrix') {
        const out = {}
        for (const mat of ['paper', 'aluminum', 'glass', 'husk', 'rind', 'steel']) {
          for (const force of [2, 8, 25]) {
            out[`impact:${mat}:${force}`] = await one(`impact:${mat}:${force}`)
          }
        }
        for (const tier of [2, 5, 9]) out[`merge:${tier}`] = await one(`merge:${tier}`)
        out['merge:5:4'] = await one('merge:5:4')
        for (const x of [-0.4, 0, 0.4]) out[`pan:${x}`] = await one(`pan:${x}`)
        out['pileup'] = await one('pileup')
        out['surf'] = await one('surf')
        out['levels'] = await one('levels')
        return out
      }
      if (spec.includes(',')) {
        const out = {}
        for (const s of spec.split(',')) out[s] = await one(s)
        return out
      }
      return one(spec)
    }, String(args.audio))
    const json = JSON.stringify(result, null, 2)
    if (outPath) {
      writeFileSync(outPath, json)
      console.log(`wrote ${outPath}`)
    } else {
      console.log(json)
    }
  } else if (args.frames) {
    const n = Number(args.frames)
    const fps = Number(args.fps ?? 60)
    const outdir = resolve(process.cwd(), String(args.outdir ?? 'captures/seq'))
    mkdirSync(outdir, { recursive: true })
    for (let i = 0; i < n; i++) {
      await page.evaluate((dt) => window.__game.stepTo(dt), 1 / fps)
      await page.evaluate(() => window.__game.capture())
      await page.screenshot({ path: `${outdir}/${String(i).padStart(4, '0')}.png` })
    }
    console.log(`wrote ${n} frames to ${outdir}`)
  } else if (outPath && outPath.endsWith('.png')) {
    await page.evaluate(() => window.__game.capture())
    await page.screenshot({ path: outPath })
    console.log(`wrote ${outPath}`)
  }

  if (!args.audio && (args.state || (outPath && outPath.endsWith('.json')))) {
    const state = await page.evaluate(() => ({
      state: window.__game.state(),
      logs: window.__game.logs ? window.__game.logs() : null,
    }))
    const json = JSON.stringify(state, null, 2)
    if (outPath && outPath.endsWith('.json')) {
      writeFileSync(outPath, json)
      console.log(`wrote ${outPath}`)
    } else {
      console.log(json)
    }
  }

  if (!args['keep-open']) {
    await browser.close()
    server.kill('SIGTERM')
    process.exit(0)
  }
}

// Retry the whole run once: concurrent agents editing source can trigger a
// vite reload mid-capture ("Execution context was destroyed").
main().catch((err) => {
  console.error('[capture] first attempt failed, retrying once:', err?.message ?? err)
  main().catch((err2) => {
    console.error(err2)
    process.exit(1)
  })
})
