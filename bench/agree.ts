// The judge is an instrument, and an instrument that has never been checked against a person is a
// guess. This draws a sample of the benchmark's own judgements, writes them as a checklist, and then
// scores a human verdict file against the judge's.
//
//   npm run bench:agree -- --run bench/results/<date> --sample 40
//   # a person fills human.jsonl with { id, source, human: true | false }
//   npm run bench:agree -- --run bench/results/<date> --human bench/results/<date>/human.jsonl

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { arg, num } from './lib/args.ts'
import { pct, type Result } from './report.ts'

const RUN = arg('run', '')
const SAMPLE = Math.round(num('sample', 40))
if (!RUN) throw new Error('--run <bench/results/date> is required')

const files = readdirSync(RUN).filter((f) => f.startsWith('results-') && f.endsWith('.jsonl'))
if (!files.length) throw new Error(`no results-*.jsonl in ${RUN}`)
const rows: Result[] = files
  .flatMap((f) => readFileSync(join(RUN, f), 'utf8').trim().split('\n'))
  .filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.reads !== null)

const humanPath = arg('human', '')

if (!humanPath) {
  // even spread over the file rather than the first N, so a source and a category are not
  // over-represented by where they happened to land
  const step = Math.max(1, Math.floor(rows.length / SAMPLE))
  const picked = rows.filter((_, i) => i % step === 0).slice(0, SAMPLE)
  const out = picked.map((r) => ({ id: r.id, source: r.source, prompt: r.prompt, shot: join(RUN, r.shot), judge: r.reads }))
  writeFileSync(join(RUN, 'hand-check.jsonl'), out.map((o) => JSON.stringify(o)).join('\n') + '\n')
  console.log(`${picked.length} images to look at: ${join(RUN, 'hand-check.jsonl')}`)
  console.log('write { id, source, human } lines to human.jsonl, then rerun with --human')
  process.exit(0)
}

if (!existsSync(humanPath)) throw new Error(`no such file: ${humanPath}`)
const human = readFileSync(humanPath, 'utf8').trim().split('\n').filter(Boolean)
  .map((l) => JSON.parse(l) as { id: string; source: string; human: boolean })

const key = (r: { id: string; source: string }) => `${r.source}:${r.id}`
const judgeBy = new Map(rows.map((r) => [key(r), r.reads as boolean]))
const agree = human.filter((h) => judgeBy.get(key(h)) === h.human).length
const rate = pct(agree, human.length)
console.log(`${agree}/${human.length} agree with the judge, ${rate}%`)
if (rate < 85) console.log('below 85 per cent: fix the judge prompt before any other number uses it')
