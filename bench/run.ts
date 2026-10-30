// The prompt benchmark: 200 prompts through the app, a screenshot each, a vision judge on every
// one, and a markdown report.
//
//   npm run bench -- --sources prompt,chat
//
// It starts the dev server and headless Chrome itself, so a rerun is one command with no setup. The
// numbers it writes are the instrument the rest of the plan reports against, so it measures the
// stage's own phase rather than a fixed sleep, and it saves the picture it judged next to the
// verdict.

import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { Tab, alive, launchChrome } from './lib/cdp.ts'
import { arg, flag, num } from './lib/args.ts'
import { judge, judgeFrom, readEnv, type Judge } from './judge.ts'
import { markdown, type Meta, type Result } from './report.ts'

const ROOT = process.cwd()

const SOURCES = arg('sources', 'prompt').split(',').map((s) => s.trim()).filter(Boolean)
const LIMIT = Math.round(num('limit', 0))
const CONCURRENCY = Math.round(num('concurrency', 3))
const THUMB = { w: 256, h: 160 }
const DENSITY = Math.round(num('density', 12000))
const THEME = arg('theme', 'dark')
const PORT = Math.round(num('port', 5181))
const CHROME_PORT = Math.round(num('cdp', 9333))
const OUT = arg('out', `${ROOT}/bench/results/${new Date().toISOString().slice(0, 10)}`)
const PROFILE = `${process.env.TEMPDIR ?? process.env.LOCALAPPDATA ?? ROOT}/Temp/gen-ascii-bench-profile`

type Prompt = { id: string; prompt: string; category: string; seed: number }

const prompts: Prompt[] = readFileSync(`${ROOT}/bench/prompts.jsonl`, 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l))
const chosen = LIMIT ? prompts.slice(0, LIMIT) : prompts

const urlFor = (source: string, p: Prompt) => {
  const q = new URLSearchParams({ theme: THEME, n: String(DENSITY), seed: String(p.seed) })
  if (source === 'prompt') q.set('prompt', p.prompt)
  else if (source === 'chat') q.set('chat', p.prompt)
  else if (source === 'ply') q.set('ply', arg('ply', '') || `/bench/samples/${p.id}.ply`)
  else throw new Error(`unknown source ${source}`)
  return `http://127.0.0.1:${PORT}/?${q}`
}

async function pool<T, R>(items: T[], size: number, run: (item: T, worker: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async (_, worker) => {
    while (next < items.length) {
      const i = next++
      out[i] = await run(items[i], worker)
    }
  }))
  return out
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')

async function main() {
  // a worktree does not carry the ignored .env, so the judge key may simply be absent here: the run
  // still takes its screenshots, and says so rather than dying on a missing file
  const envPath = arg('env', `${ROOT}/.env`)
  const env = existsSync(envPath) ? readEnv(readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '')) : {}
  const judgeCfg: Judge | null = flag('no-judge') ? null : judgeFrom(env)
  if (!judgeCfg && !flag('no-judge')) {
    console.log('no OPENCODE_ZEN_API_KEY in .env: screenshots are taken and nothing is judged')
  }

  mkdirSync(OUT, { recursive: true })
  const at = new Date().toISOString()

  let server: ChildProcess | null = null
  if (!flag('reuse')) {
    server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
      cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32',
    })
  }
  const comeUp = await alive(`http://127.0.0.1:${PORT}/`)
  if (!comeUp) throw new Error(`nothing answered at http://127.0.0.1:${PORT}/`)
  // one browser per worker: a tab in a shared browser is a background tab, and a background tab does
  // not ask for frames, so the stage it measures never advances. Each worker gets its own window and
  // its own port, and one render job per browser keeps prompt 1 off prompt 2's timing.
  const browsers = Array.from({ length: CONCURRENCY }, (_, i) =>
    launchChrome(CHROME_PORT + i, `${PROFILE}-${i}`))
  const clean = () => {
    for (const b of browsers) b.close()
    try { server?.kill() } catch { /* already gone */ }
  }
  process.on('exit', clean)

  for (let i = 0; i < CONCURRENCY; i++) {
    if (!(await alive(`http://127.0.0.1:${CHROME_PORT + i}/json/version`, 60))) throw new Error(`headless Chrome ${i} never came up`)
  }

  const results: Result[] = []
  const run = stamp()
  mkdirSync(`${OUT}/shots/${run}`, { recursive: true })

  for (const source of SOURCES) {
    const started = Date.now()
    let done = 0
    const rows = await pool(chosen, CONCURRENCY, async (p, worker) => {
      let tab: Tab | null = null
      const fail = (why: string): Result => {
        const row: Result = {
          id: p.id, prompt: p.prompt, category: p.category, seed: p.seed, source,
          drawn: false, error: why, title: '', firstGlyphMs: null, navMs: null, reads: null, readsThumb: null,
          reason: '', shot: '', thumb: '',
        }
        appendFileSync(`${OUT}/results-${run}.jsonl`, JSON.stringify(row) + '\n')
        console.log(`${source} ${p.id} FAILED ${why}`)
        return row
      }
      try {
        tab = await Tab.open(CHROME_PORT + worker)
        await tab.installClock()
        // a fresh tab per prompt keeps one prompt's work off another's timing, but the first paint
        // pays for the atlas and the font, so every tab warms up on the plain app first
        await tab.navigate(`http://127.0.0.1:${PORT}/?theme=${THEME}&n=${DENSITY}`)
        await tab.settled(60_000)
        const navAt = Date.now()
        await tab.navigate(urlFor(source, p))
        const settled = await tab.settled(source === 'chat' ? 120_000 : 60_000)
        // the page's own clock is the sharper measurement, but it restarts with the document: a source
        // that takes fifteen seconds to answer reports a few hundred milliseconds when the tab is
        // replaced under it. The runner's wall clock cannot be fooled that way, so both are recorded.
        const navMs = Date.now() - navAt
        const clock = await tab.clock()
        const shotName = `${source}-${p.id}.png`, thumbName = `${source}-${p.id}.thumb.png`
        let reads: boolean | null = null, readsThumb: boolean | null = null, reason = ''
        if (settled.done) {
          const png = await tab.screenshot()
          const thumb = await tab.downscale(png, THUMB.w, THUMB.h)
          writeFileSync(`${OUT}/shots/${run}/${shotName}`, png)
          writeFileSync(`${OUT}/shots/${run}/${thumbName}`, thumb)
          if (judgeCfg) {
            const verdict = await judge(judgeCfg, png, thumb, p.prompt)
            reads = verdict.reads; readsThumb = verdict.readsThumb; reason = verdict.reason
          }
        }
        const row: Result = {
          id: p.id, prompt: p.prompt, category: p.category, seed: p.seed, source,
          drawn: settled.done, error: settled.error ?? '', title: settled.title ?? '',
          firstGlyphMs: clock.firstGlyphMs, navMs, reads, readsThumb, reason,
          shot: settled.done ? `shots/${run}/${shotName}` : '',
          thumb: settled.done ? `shots/${run}/${thumbName}` : '',
        }
        const n = ++done
        // appended as it lands: a run of 200 prompts is an hour of work, and a crash at prompt 190
        // must not lose the 189 that were measured
        appendFileSync(`${OUT}/results-${run}.jsonl`, JSON.stringify(row) + '\n')
        console.log(`${String(n).padStart(3)} ${source} ${p.id} ${settled.done ? (row.firstGlyphMs ?? '?') + 'ms' : 'FAILED'} ${reads === null ? '' : reads ? 'READ' : 'not'} ${p.prompt}`)
        return row
      } catch (err) {
        // one prompt that will not load is a failed row, not the end of an hour's run
        return fail(err instanceof Error ? err.message : String(err))
      } finally {
        await tab?.close()
      }
    })
    results.push(...rows)
    const ok = rows.filter((r) => r.drawn)
    const read = rows.filter((r) => r.reads).length
    console.log(`\n${source}: ${ok.length}/${rows.length} drawn, ${read} read, ${Math.round((Date.now() - started) / 1000)}s\n`)
  }

  const meta: Meta = { at, judge: judgeCfg?.model ?? 'none', density: DENSITY, theme: THEME, prompts: chosen.length, sources: SOURCES }
  writeFileSync(`${OUT}/report.md`, markdown(results, meta))
  writeFileSync(`${OUT}/meta-${run}.json`, JSON.stringify(meta, null, 2))
  console.log(`wrote ${OUT}/report.md and ${results.length} rows`)
  clean()
  process.exit(0)
}

main().catch((err) => { console.error(err); process.exit(1) })
