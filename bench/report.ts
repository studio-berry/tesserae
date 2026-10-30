// The benchmark's arithmetic and its markdown. Kept pure so a test can hold the numbers to a
// hand-computed value: a report that quietly changes how it counts is worse than no report.

export type Result = {
  id: string
  prompt: string
  category: string
  seed: number
  source: string
  drawn: boolean
  error: string
  title: string
  firstGlyphMs: number | null
  reads: boolean | null
  readsThumb: boolean | null
  reason: string
  shot: string
  thumb: string
}

export const SOURCE_LABEL: Record<string, string> = {
  prompt: 'prompt (search backends)',
  chat: 'chat (scene writer)',
  ply: 'baseline (server model)',
}

export const label = (source: string) => SOURCE_LABEL[source] ?? source

export const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0)

// Nearest-rank: the smallest value at or above the q-th share. No interpolation, because a p95 of
// two samples is not a measurement and should not look like one.
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[i]
}

export type Summary = {
  tested: number
  drawn: number
  judged: number
  read: number
  readThumb: number
  readRate: number
  thumbRate: number
  p50: number | null
  p95: number | null
}

export function summarise(rows: Result[]): Summary {
  const drawn = rows.filter((r) => r.drawn)
  const judged = rows.filter((r) => r.reads !== null)
  const thumbs = rows.filter((r) => r.readsThumb !== null)
  const times = drawn.map((r) => r.firstGlyphMs).filter((t): t is number => typeof t === 'number')
  const read = judged.filter((r) => r.reads).length
  return {
    tested: rows.length,
    drawn: drawn.length,
    judged: judged.length,
    read,
    readThumb: thumbs.filter((r) => r.readsThumb).length,
    readRate: pct(read, judged.length),
    thumbRate: pct(thumbs.filter((r) => r.readsThumb).length, thumbs.length),
    p50: quantile(times, 0.5),
    p95: quantile(times, 0.95),
  }
}

export const bySource = (rows: Result[]) =>
  [...new Set(rows.map((r) => r.source))].map((source) => ({ source, summary: summarise(rows.filter((r) => r.source === source)) }))

export const categories = (rows: Result[]) => [...new Set(rows.map((r) => r.category))]

// One row per category, one pair of columns per source. A category a source did not run is a dash,
// never a zero: a missing measurement and a failing one are different things.
export function categoryTable(rows: Result[], sources: string[]): string {
  const head = ['| category | prompts |', ...sources.map((s) => ` ${s} reads | ${s} thumb |`), ''].join(' ')
  const rule = ['|---|', ...sources.map(() => '---|---|'), '---|'].join(' ')
  const lines = categories(rows).map((category) => {
    const here = rows.filter((r) => r.category === category)
    const cells = sources.map((source) => {
      const mine = here.filter((r) => r.source === source && r.reads !== null)
      const thumbs = here.filter((r) => r.source === source && r.readsThumb !== null)
      if (!mine.length) return '— | — |'
      return `${pct(mine.filter((r) => r.reads).length, mine.length)}% | ${pct(thumbs.filter((r) => r.readsThumb).length, thumbs.length)}% |`
    })
    return `| ${category} | ${here.length / Math.max(1, sources.length)} | ${cells.join(' ')}`
  })
  return [head, rule, ...lines].join('\n')
}

export type Meta = { at: string; judge: string; density: number; theme: string; prompts: number; sources: string[] }

export function markdown(rows: Result[], meta: Meta): string {
  const sources = meta.sources
  const overall = bySource(rows)
  const table = [
    '| source | tested | drawn | reads | thumbnail reads | first glyph p50 | p95 |',
    '|---|---|---|---|---|---|---|',
    ...overall.map(({ source, summary: s }) =>
      `| ${label(source)} | ${s.tested} | ${s.drawn} | ${s.readRate}% (${s.read}/${s.judged}) | ${s.thumbRate}% | ${s.p50 ?? '—'} ms | ${s.p95 ?? '—'} ms |`),
  ].join('\n')

  const misses = rows
    .filter((r) => r.reads === false)
    .slice(0, 12)
    .map((r) => `| ${r.id} | ${r.prompt} | ${r.source} | ${r.reason.replace(/\|/g, '/')} |`)

  return [
    `# Prompt benchmark, ${meta.at.slice(0, 10)}`,
    '',
    `${meta.prompts} prompts, ${sources.map(label).join(' and ')}, ${meta.density} glyphs, theme ${meta.theme}.`,
    `Judge: \`${meta.judge}\`, three calls per image at temperature 0.7, majority vote.`,
    '',
    '## Read rate and time to first glyph',
    '',
    table,
    '',
    '## By category',
    '',
    categoryTable(rows, sources),
    '',
    '## What the judge said about the misses',
    '',
    misses.length ? ['| id | prompt | source | reason |', '|---|---|---|---|', ...misses].join('\n') : 'No misses.',
    '',
  ].join('\n')
}
