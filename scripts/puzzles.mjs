#!/usr/bin/env node
/**
 * Puzzle regression — `npm run puzzles`.
 *
 * Boots the game in harness mode once per campaign level
 * (?harness=1&scene=game&level=N&seed=1), replays the level's `solution`
 * (src/config/levels.ts) through `__game.push(angleRad, 1)` with exactly the
 * waits a player gets — the next shot fires only when the turn phase is back
 * to 'aim' (spawn drop settled), plus any per-shot `waitBefore` — and asserts:
 *   goal reached (outcome 'complete'), pushes used ≤ par, no foul.
 * Prints a table and exits non-zero on any failure.
 *
 * `--lessons` additionally replays each level's documented FAILURE path
 * (straight into the pitcher, waiting out the creep, drifting in the wind…)
 * and asserts it does NOT solve the level, so the lesson is real.
 *
 * Flags: --level=N (one level), --lessons, --seed=N (default 1).
 */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=([\s\S]*))?$/)
    return m ? [m[1], m[2] ?? true] : [a, true]
  })
)
const PORT = Number(process.env.CLINK_PORT || 5300 + Math.floor(Math.random() * 600))
const SEED = Number(args.seed ?? 1)
const ONLY = args.level ? Number(args.level) : null
/** seconds of settle after the last shot before the run is judged */
const SETTLE_S = 14

/**
 * The lessons: what the level is teaching, expressed as a path that must FAIL.
 * `pre` = seconds to wait before the first shot; `shots` in degrees.
 * expect: 'unsolved' (goal not met inside the replay) or 'foul' (game over).
 */
const LESSONS = {
  2: { why: 'straight at the pair stops dead on the pitcher', shots: [-10], expect: 'unsolved' },
  5: { why: 'a straight shot stops dead on the pole', shots: [0], expect: 'unsolved' },
  6: { why: 'rail ride and centre lane die on the pitcher', shots: [-12, -9], expect: 'unsolved' },
  8: { why: 'waiting 12 s: the pair creeps over the line', pre: 12, shots: [0], expect: 'foul' },
  9: { why: 'straight: bounces off the pitcher, slides the slick over the line', shots: [0], expect: 'foul' },
  11: { why: 'a straight shot drifts right past the pair', shots: [0], expect: 'unsolved' },
  '11b': { level: 11, why: 'too far into the wind drops off the open edge', shots: [-25], expect: 'unsolved' },
}

function startServer() {
  return new Promise((ok, fail) => {
    const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
      cwd: resolve(import.meta.dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let ready = false
    const onData = (d) => {
      const s = d.toString()
      if (!ready && (s.includes('Local:') || s.includes('ready in'))) {
        ready = true
        setTimeout(() => ok(proc), 150)
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('exit', (code) => {
      if (!ready) fail(new Error(`vite exited early (${code})`))
    })
    setTimeout(() => {
      if (!ready) fail(new Error('vite start timeout'))
    }, 20000)
  })
}

/** replay `shots` on the loaded level with player-equivalent waits; returns the judged state */
function replay(page, { shots, pre, settleS }) {
  return page.evaluate(
    ({ shots, pre, settleS }) => {
      const g = window.__game
      const waitAim = () => {
        for (let i = 0; i < 600; i++) {
          const s = g.state()
          if (s.outcome !== 'playing' || s.phase === 'aim') return s
          g.stepTo(0.05)
        }
        return g.state()
      }
      const fired = []
      if (pre > 0) g.stepTo(pre)
      for (const shot of shots) {
        const a = typeof shot === 'number' ? { angle: shot } : shot
        let s = waitAim()
        if (s.outcome !== 'playing') break
        if (a.waitBefore) g.stepTo(a.waitBefore)
        s = g.state()
        if (s.outcome !== 'playing' || s.phase !== 'aim') break
        g.push((a.angle * Math.PI) / 180, 1)
        fired.push(a.angle)
      }
      for (let i = 0; i < settleS / 0.05; i++) {
        if (g.state().outcome !== 'playing') break
        g.stepTo(0.05)
      }
      const s = g.state()
      const logs = g.logs()
      return {
        outcome: s.outcome,
        pushes: s.pushesUsed,
        par: s.par,
        stars: s.stars,
        goal: s.goalProgress,
        fired,
        fouled: s.outcome === 'foul' || logs.some((l) => l.ev === 'gameOver' || l.ev === 'foul'),
        merges: logs.filter((l) => l.ev === 'mergeDone').map((l) => l.tier),
      }
    },
    { shots, pre: pre ?? 0, settleS }
  )
}

async function main() {
  const server = await startServer()
  const browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--no-sandbox'],
  })
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } })
  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(err.message))

  const rows = []
  let failed = 0
  const load = async (level) => {
    await page.goto(`http://localhost:${PORT}/?harness=1&scene=game&level=${level}&seed=${SEED}&quality=low`)
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 })
    return page.evaluate(() => window.__game.levelDef(window.__game.state().level))
  }

  const levels = ONLY !== null ? [ONLY] : Array.from({ length: 12 }, (_, i) => i + 1)
  for (const level of levels) {
    const def = await load(level)
    if (!def || !def.solution) {
      rows.push([`L${level}`, '-', '-', '-', 'FAIL no solution'])
      failed++
      continue
    }
    const r = await replay(page, { shots: def.solution, settleS: SETTLE_S })
    const ok = r.outcome === 'complete' && r.pushes <= def.par && !r.fouled
    if (!ok) failed++
    const why = ok
      ? `ok  ${r.stars}★  merges ${r.merges.join('→') || '-'}`
      : `FAIL outcome=${r.outcome} goal=${r.goal.value}/${r.goal.target}${r.fouled ? ' FOUL' : ''}`
    rows.push([`L${level} ${def.name.en}`, String(r.pushes), String(def.par), JSON.stringify(def.solution), why])
  }

  if (args.lessons) {
    rows.push(['— lessons (must fail) —', '', '', '', ''])
    for (const [key, L] of Object.entries(LESSONS)) {
      const level = L.level ?? Number(key)
      if (ONLY !== null && level !== ONLY) continue
      await load(level)
      const r = await replay(page, { shots: L.shots, pre: L.pre, settleS: SETTLE_S })
      const solved = r.outcome === 'complete'
      const ok = L.expect === 'foul' ? r.fouled && !solved : !solved
      if (!ok) failed++
      rows.push([
        `L${level} ${L.why}`,
        String(r.pushes),
        '-',
        `${L.pre ? `wait ${L.pre}s, ` : ''}${JSON.stringify(L.shots)}`,
        ok ? `ok  ${r.outcome}${r.fouled ? ' (foul)' : ''}` : `FAIL solved=${solved} outcome=${r.outcome}`,
      ])
    }
  }

  await browser.close()
  server.kill('SIGTERM')

  const widths = [0, 0, 0, 0]
  for (const r of rows) for (let i = 0; i < 4; i++) widths[i] = Math.max(widths[i], r[i].length)
  const head = ['level', 'pushes', 'par', 'shots (deg)', 'result']
  for (let i = 0; i < 4; i++) widths[i] = Math.max(widths[i], head[i].length)
  const line = (r) => r.map((c, i) => (i < 4 ? c.padEnd(widths[i]) : c)).join('  ')
  console.log(line(head))
  console.log(line(widths.map((w) => '-'.repeat(w)).concat(['------'])))
  for (const r of rows) console.log(line(r))
  if (pageErrors.length) {
    console.error('page errors:', pageErrors)
    failed++
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed')
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
