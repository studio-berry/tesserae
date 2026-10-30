// Score a folder of sampled clouds the way the benchmark scores them, through one warm tab.
//
// A training run has to score its own samples thousands of times, and the benchmark's shape is wrong
// for that: it starts a browser per worker and pays a full app load per prompt. This reuses one tab,
// which is already warm, and takes the picture the same way (`bench/lib/capture.ts`), so a score
// taken here and a score taken by `bench/run.ts` mean the same thing.
//
//   node bench/score.ts --samples bench/samples --out bench/scores/base-9k
//
// Writes `scores.jsonl` (one row per cloud) and `score.json` (the summary a training loop reads).

import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { arg, flag, num } from './lib/args.ts'
import { capture, warm } from './lib/capture.ts'
import { Tab, alive, launchChrome } from './lib/cdp.ts'
import { judge, judgeFrom, readEnv, type Judge } from './judge.ts'
import { pct, quantile, type Result } from './report.ts'

const ROOT = process.cwd()

export type Planned = { id: string; prompt: string; file: string; url: string }
export type Planning = { rows: Planned[]; missing: string[] }

// What to score: one prompt per cloud, in the prompts file's order. A cloud the folder does not hold
// is reported rather than skipped quietly, because a read rate over the clouds that happened to
// exist is a different number from the one the caller thinks it asked for.
export function plan(samples: string, promptsFile: string, ext = 'ply'): Planning {
  const prompts: { id: string; prompt: string }[] = readFileSync(promptsFile, 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line))
  const rows: Planned[] = []
  const missing: string[] = []
  for (const p of prompts) {
    const file = join(samples, `${p.id}.${ext}`)
    if (!existsSync(file)) { missing.push(p.id); continue }
    // the dev server serves the repository root, so the URL is the file's path under it
    rows.push({ id: p.id, prompt: p.prompt, file, url: `/${relative(ROOT, file).split('\\').join('/')}` })
  }
  return { rows, missing }
}

export type Score = { read: number; thumb: number; judged: number; drawn: number; wallP50: number | null; perImageMs: number }

export function summariseScores(rows: Result[], elapsedMs: number): Score {
  const judged = rows.filter((r) => r.reads !== null)
  const drawn = rows.filter((r) => r.drawn)
  const walls = drawn.map((r) => r.navMs).filter((t): t is number => typeof t === 'number')
  return {
    read: pct(judged.filter((r) => r.reads).length, judged.length),
    thumb: pct(judged.filter((r) => r.readsThumb).length, judged.length),
    judged: judged.length,
    drawn: drawn.length,
    wallP50: quantile(walls, 0.5),
    perImageMs: rows.length ? Math.round(elapsedMs / rows.length) : 0,
  }
}

type Scorer = {
  score(one: Planned): Promise<Result>
  close(): Promise<void>
}

// One browser, one tab, warmed once. The tab is reused across clouds, which is the whole point: the
// app boots once and every later cloud costs a navigation and a render.
export async function openScorer(options: { port: number; cdp: number; profile: string; density: number; theme: string; judge: Judge | null }): Promise<Scorer> {
  const server = flag('reuse') ? null : spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(options.port), '--strictPort'], {
    cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32',
  })
  if (!(await alive(`http://127.0.0.1:${options.port}/`))) throw new Error(`nothing answered at http://127.0.0.1:${options.port}/`)
  const chrome = launchChrome(options.cdp, options.profile)
  if (!(await alive(`http://127.0.0.1:${options.cdp}/json/version`, 60))) throw new Error('headless Chrome never came up')
  const tab = await Tab.open(options.cdp)
  await warm(tab, `http://127.0.0.1:${options.port}/?theme=${options.theme}&n=${options.density}`)

  return {
    async score(one) {
      const url = `http://127.0.0.1:${options.port}/?theme=${options.theme}&n=${options.density}&ply=${one.url}`
      const shot = await capture(tab, url)
      const row: Result = {
        id: one.id, prompt: one.prompt, category: '', seed: 0, source: 'ply',
        drawn: shot.done, error: shot.error, title: shot.title,
        firstGlyphMs: shot.firstGlyphMs, navMs: shot.navMs,
        reads: null, readsThumb: null, reason: '', shot: '', thumb: '',
      }
      if (shot.done && shot.png && shot.thumb && options.judge) {
        const verdict = await judge(options.judge, shot.png, shot.thumb, one.prompt)
        row.reads = verdict.reads
        row.readsThumb = verdict.readsThumb
        row.reason = verdict.reason
      }
      return row
    },
    async close() {
      await tab.close()
      chrome.close()
      try { server?.kill() } catch { /* already gone */ }
    },
  }
}

async function main() {
  const samples = arg('samples', 'bench/samples')
  const prompts = arg('prompts', 'bench/prompts.jsonl')
  const out = arg('out', `bench/scores/${new Date().toISOString().slice(0, 10)}`)
  const limit = Math.round(num('limit', 0))
  // a worktree does not always carry the ignored .env, so the key may be absent: the score still
  // takes its pictures and says that nothing was judged
  const envPath = arg('env', `${ROOT}/.env`)
  const env = existsSync(envPath) ? readEnv(readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '')) : {}
  const judgeCfg = flag('no-judge') ? null : judgeFrom(env)
  if (!judgeCfg) console.log('no OPENCODE_ZEN_API_KEY: the clouds are drawn and nothing is judged')

  const { rows, missing } = plan(samples, prompts)
  const chosen = limit ? rows.slice(0, limit) : rows
  if (!chosen.length) throw new Error(`no clouds to score in ${samples}`)
  if (missing.length) console.log(`${missing.length} prompts have no cloud in ${samples}: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' …' : ''}`)

  mkdirSync(out, { recursive: true })
  const scorer = await openScorer({
    port: Math.round(num('port', 5181)), cdp: Math.round(num('cdp', 9333)),
    profile: `${process.env.TEMPDIR ?? process.env.LOCALAPPDATA ?? '.'}/Temp/gen-ascii-score-profile`,
    density: Math.round(num('density', 12000)), theme: arg('theme', 'dark'), judge: judgeCfg,
  })

  const started = Date.now()
  const results: Result[] = []
  try {
    for (const [i, one] of chosen.entries()) {
      const row = await scorer.score(one)
      results.push(row)
      appendFileSync(`${out}/scores.jsonl`, JSON.stringify(row) + '\n')
      console.log(`${String(i + 1).padStart(4)} ${row.drawn ? 'drawn' : 'FAILED'} ${row.reads === null ? '' : row.reads ? 'READ' : 'not'} ${one.id} ${one.prompt}`)
    }
  } finally {
    await scorer.close()
  }

  const summary = summariseScores(results, Date.now() - started)
  writeFileSync(`${out}/score.json`, JSON.stringify({ at: new Date().toISOString(), samples, prompts, judge: judgeCfg?.model ?? 'none', missing: missing.length, ...summary }, null, 2))
  console.log(`\n${summary.read}% read (${summary.judged} judged), ${summary.thumb}% at thumbnail, drawn ${summary.drawn}/${results.length}, ${summary.perImageMs} ms an image`)
  console.log(`wrote ${out}/score.json`)
}

if (import.meta.main) main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
