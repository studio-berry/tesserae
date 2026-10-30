// The scorer's two pure steps: which cloud answers which prompt, and what a pile of rows adds up to.
// The browser half is verified by running it against the shipped baselines.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { plan, summariseScores } from './score.ts'
import type { Result } from './report.ts'

// inside the repository on purpose: the URL the app fetches is the file's path under the repo root,
// so a directory outside it would prove the mapping with paths that cannot happen
const DIR = join(process.cwd(), '.cache', 'score-test')

const row = (id: string, over: Partial<Result> = {}): Result => ({
  id, prompt: `prompt ${id}`, category: '', seed: 0, source: 'ply',
  drawn: true, error: '', title: '', firstGlyphMs: 400, navMs: 900,
  reads: true, readsThumb: false, reason: '', shot: '', thumb: '', ...over,
})

afterEach(() => rmSync(DIR, { recursive: true, force: true }))

describe('plan', () => {
  it('pairs each prompt with its cloud and the url the dev server serves it at', () => {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(join(DIR, 'p001.ply'), 'x')
    writeFileSync(join(DIR, 'p002.ply'), 'x')
    const prompts = join(DIR, 'prompts.jsonl')
    writeFileSync(prompts, ['{"id":"p001","prompt":"a teapot"}', '{"id":"p002","prompt":"a knot"}'].join('\n'))

    expect(plan(DIR, prompts)).toEqual({
      rows: [
        { id: 'p001', prompt: 'a teapot', file: join(DIR, 'p001.ply'), url: '/.cache/score-test/p001.ply' },
        { id: 'p002', prompt: 'a knot', file: join(DIR, 'p002.ply'), url: '/.cache/score-test/p002.ply' },
      ],
      missing: [],
    })
  })

  it('names a prompt whose cloud is absent rather than scoring the ones that happen to exist', () => {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(join(DIR, 'p001.ply'), 'x')
    const prompts = join(DIR, 'prompts.jsonl')
    writeFileSync(prompts, ['{"id":"p001","prompt":"a teapot"}', '{"id":"p007","prompt":"a shell"}'].join('\n'))

    const got = plan(DIR, prompts)
    expect(got.rows.map((r) => r.id)).toEqual(['p001'])
    expect(got.missing).toEqual(['p007'])
  })

  it('takes the extension, so a walk can be scored as easily as a cloud', () => {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(join(DIR, 'p001.traj'), 'x')
    const prompts = join(DIR, 'prompts.jsonl')
    writeFileSync(prompts, '{"id":"p001","prompt":"a teapot"}')

    expect(plan(DIR, prompts, 'traj').rows[0].url).toBe('/.cache/score-test/p001.traj')
  })
})

describe('summariseScores', () => {
  it('counts reads over the judged rows only, and reports a row that never drew', () => {
    const rows = [
      row('p001'),
      row('p002', { reads: false, readsThumb: false }),
      row('p003', { drawn: false, reads: null, readsThumb: null, navMs: null }),
      row('p004'),
    ]

    const got = summariseScores(rows, 8000)
    expect(got.drawn).toBe(3)
    expect(got.judged).toBe(3)
    expect(got.read).toBe(67)
    expect(got.thumb).toBe(0)
    expect(got.wallP50).toBe(900)
    expect(got.perImageMs).toBe(2000)
  })

  it('does not divide by zero on an empty pile', () => {
    expect(summariseScores([], 0)).toMatchObject({ read: 0, judged: 0, drawn: 0, wallP50: null, perImageMs: 0 })
  })
})
