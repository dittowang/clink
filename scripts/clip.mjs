#!/usr/bin/env node
/**
 * Assemble a capture.mjs frame sequence (NNNN.png) into an mp4 plus a small
 * gif using the system ffmpeg. Zero npm deps. If ffmpeg is not on PATH we
 * say so clearly and exit 0 so pipelines without it don't fail.
 *
 * Usage:
 *   node scripts/clip.mjs --dir=captures/seq --out=captures/clip.mp4 --fps=60
 *
 * Flags:
 *   --dir=frames_dir   directory of NNNN.png frames (required)
 *   --out=clip.mp4     output video (default <dir>/../clip.mp4)
 *   --fps=N            input framerate, typically 30 or 60 (default 60)
 *   --no-gif           skip the gif companion (default writes out with .gif ext)
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    return m ? [m[1], m[2] ?? true] : [a, true]
  })
)

const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' })
if (probe.error || probe.status !== 0) {
  console.log(
    'ffmpeg not found on PATH — skipping clip assembly. Install it (e.g. `brew install ffmpeg`) to build mp4/gif clips from frame sequences.'
  )
  process.exit(0)
}

if (!args.dir) {
  console.error('usage: node scripts/clip.mjs --dir=captures/seq [--out=captures/clip.mp4] [--fps=60] [--no-gif]')
  process.exit(1)
}

const dir = resolve(process.cwd(), String(args.dir))
const frames = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => /^\d+\.png$/.test(f))
      .sort()
  : []
if (frames.length === 0) {
  console.error(`no frame PNGs (NNNN.png) found in ${dir}`)
  process.exit(1)
}

const padWidth = frames[0].length - '.png'.length
const startNumber = String(Number.parseInt(frames[0], 10))
const fps = String(args.fps ?? 60)
const out = resolve(process.cwd(), String(args.out ?? join(dir, '..', 'clip.mp4')))
mkdirSync(dirname(out), { recursive: true })
const pattern = join(dir, `%0${padWidth}d.png`)
const inputArgs = ['-y', '-framerate', fps, '-start_number', startNumber, '-i', pattern]

function run(argv, { allowFail = false } = {}) {
  const r = spawnSync('ffmpeg', argv, { stdio: ['ignore', 'ignore', 'pipe'] })
  if (r.status !== 0 && !allowFail) {
    console.error(r.stderr?.toString() ?? 'ffmpeg failed')
    process.exit(1)
  }
  return r.status === 0
}

// mp4 — prefer libx264; fall back to mpeg4 for minimal ffmpeg builds
const x264 = [...inputArgs, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', out]
if (!run(x264, { allowFail: true })) {
  run([...inputArgs, '-c:v', 'mpeg4', '-q:v', '4', out])
  console.log('(libx264 unavailable — encoded with mpeg4)')
}
console.log(`wrote ${out} (${frames.length} frames @ ${fps} fps)`)

if (!args['no-gif']) {
  const gif = out.replace(/\.[^.]+$/, '.gif')
  const vf =
    'fps=15,scale=420:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4'
  run([...inputArgs, '-vf', vf, gif])
  console.log(`wrote ${gif}`)
}
