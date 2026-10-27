// The spike the chat backend rests on: ten prompts, one scene each, and whether the scene comes
// back, parses, passes the sandbox's check and makes geometry.
//
// What this measures is the mechanical half: did the model produce code this app can run at all,
// how many triangles did it make, and how long did it take. Whether the scene reads as the prompt
// is judged by eye on a render, which docs/chat-scenes.md records separately.
//
//   OPENCODE_ZEN_API_KEY=... node scripts/scene-spike.ts --out spike.json [--model glm-5.3]
//
// `--out` is required: without it there is nothing to compare against and the funnel below is the
// only record, which is not a record.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Worker } from 'node:worker_threads'
import { checkCode } from '../src/objects/scene.ts'
import { writerFrom, writeScene } from '../server/zen.ts'

const PROMPTS = [
  'a lighthouse on a rocky island',
  'a coffee cup with a saucer',
  'a brass padlock',
  'a fox',
  'an acoustic guitar',
  'a bicycle',
  'a cactus in a pot',
  'a rocket on a launch pad',
  'an abstract spiral tower',
  'a teapot',
]

const args = process.argv.slice(2)
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`)
  return at < 0 ? undefined : args[at + 1]
}

const out = flag('out')
const model = flag('model')
const key = process.env.OPENCODE_ZEN_API_KEY
if (!key) throw new Error('OPENCODE_ZEN_API_KEY is not set')
if (!out) throw new Error('--out is required: the funnel alone is not a record')
// made before the first request, so ten scenes' worth of answers are never lost to a missing folder
mkdirSync(dirname(out), { recursive: true })

// The app's deadline for a scene, and the same reason for it: the code is untrusted, so it runs in a
// locked-down thread that is killed when the time is up, and the spike moves on to the next prompt.
const DEADLINE_MS = 8_000
type Ran = { ok: true; parts: number; tris: number } | { ok: false; why: string }
const runIn = (code: string, seed: number) =>
  new Promise<Ran>((done) => {
    const worker = new Worker(new URL('./scene-run.ts', import.meta.url), { workerData: { code, seed } })
    const timer = setTimeout(() => { void worker.terminate(); done({ ok: false, why: 'that scene took too long to build' }) }, DEADLINE_MS)
    const finish = (r: Ran) => { clearTimeout(timer); void worker.terminate(); done(r) }
    worker.once('message', finish)
    worker.once('error', (err: Error) => finish({ ok: false, why: err.message }))
    worker.once('exit', () => finish({ ok: false, why: 'the scene thread stopped' }))
  })

const writer = writerFrom({ ...process.env, ...(model ? { SCENE_MODEL: model } : {}) })!
// One row per prompt. A row that failed keeps the reason, and the raw reply when there was one, so
// a failure can be read back rather than guessed at.
type Row = {
  prompt: string
  title?: string
  ok: boolean
  why?: string
  ms: number
  raw?: string
  parts?: number
  tris?: number
  code?: string
}
const rows: Row[] = []

for (const [i, prompt] of PROMPTS.entries()) {
  const asked = Date.now()
  const result = await writeScene(writer, prompt, { seed: i })
  if (!result.ok) {
    // the time a failed request took is part of the measurement, not zero
    rows.push({ prompt, ok: false, why: result.why, ms: Date.now() - asked, raw: result.raw })
    console.log(`${i + 1}/${PROMPTS.length} ${prompt}: ${result.why}`)
    continue
  }
  const { title, code, ms } = result.scene
  const verdict = checkCode(code)
  let ran: { parts: number; tris: number } | null = null
  let why = verdict.ok ? '' : verdict.reason
  if (verdict.ok) {
    const r = await runIn(code, i)
    if (r.ok) ran = { parts: r.parts, tris: r.tris }
    else why = r.why
  }
  rows.push({ prompt, title, ok: !!ran, why, ms, ...(ran ?? {}), code })
  console.log(`${i + 1}/${PROMPTS.length} ${prompt} → ${title} ${ran ? `· ${ran.parts} parts, ${ran.tris} tris` : `· FAILED ${why}`} · ${(ms / 1000).toFixed(1)}s`)
}

const wrote = rows.filter((r) => r.ok)
const times = wrote.map((r) => r.ms).sort((a, b) => a - b)
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : 'n/a')
const median = times.length ? times[times.length >> 1] : 0

console.log('')
console.log(`model ${writer.model}`)
console.log(`attempted ${rows.length}`)
console.log(`ran ${wrote.length} (${pct(wrote.length, rows.length)})`)
console.log(`median ${(median / 1000).toFixed(1)}s, slowest ${((times.at(-1) ?? 0) / 1000).toFixed(1)}s`)
const tris = wrote.map((r) => r.tris ?? 0)
console.log(`triangles ${tris.length ? `${Math.min(...tris)}-${Math.max(...tris)}` : 'none'}`)

writeFileSync(out, JSON.stringify({ model: writer.model, at: new Date().toISOString(), rows }, null, 2))
console.log(`wrote ${rows.length} rows to ${out}`)
