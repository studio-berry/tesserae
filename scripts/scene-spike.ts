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

import { writeFileSync } from 'node:fs'
import { checkCode, runScene } from '../src/objects/scene.ts'
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
  const result = await writeScene(writer, prompt, { seed: i })
  if (!result.ok) {
    rows.push({ prompt, ok: false, why: result.why, ms: 0, raw: result.raw })
    console.log(`${i + 1}/${PROMPTS.length} ${prompt}: ${result.why}`)
    continue
  }
  const { title, code, ms } = result.scene
  const verdict = checkCode(code)
  let ran: { parts: number; tris: number } | null = null
  let why = verdict.ok ? '' : verdict.reason
  if (verdict.ok) {
    try {
      const scene = runScene(code, i)
      ran = { parts: scene.parts, tris: scene.tris }
    } catch (err) {
      why = (err as Error).message
    }
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
