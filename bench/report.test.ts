import { describe, expect, it } from 'vitest'
import { categoryTable, markdown, pct, quantile, summarise, type Result } from './report.ts'

const row = (over: Partial<Result>): Result => ({
  id: 'p001', prompt: 'a teapot', category: 'household', seed: 1, source: 'prompt',
  drawn: true, error: '', title: 'teapot', firstGlyphMs: 1000, reads: true, readsThumb: true,
  reason: 'spout and handle', shot: '', thumb: '', ...over,
})

describe('quantile', () => {
  it('is nearest-rank, not interpolated', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2)
    expect(quantile([1, 2, 3, 4], 0.95)).toBe(4)
    expect(quantile([7], 0.95)).toBe(7)
    expect(quantile([], 0.5)).toBeNull()
  })
})

describe('summarise', () => {
  it('counts reads against judged rows and times against drawn ones', () => {
    const rows = [
      row({ id: 'a', firstGlyphMs: 100, reads: true }),
      row({ id: 'b', firstGlyphMs: 200, reads: false }),
      row({ id: 'c', firstGlyphMs: 300, reads: true, readsThumb: false }),
      row({ id: 'd', drawn: false, firstGlyphMs: null, reads: null, readsThumb: null, error: 'refused' }),
    ]
    const s = summarise(rows)
    expect(s.tested).toBe(4)
    expect(s.drawn).toBe(3)
    expect(s.judged).toBe(3)
    expect(s.read).toBe(2)
    expect(s.readRate).toBe(67)
    expect(s.thumbRate).toBe(67)
    expect(s.p50).toBe(200)
    expect(s.p95).toBe(300)
  })

  it('reports no time at all rather than zero when nothing was drawn', () => {
    const s = summarise([row({ drawn: false, firstGlyphMs: null, reads: null })])
    expect(s.p50).toBeNull()
    expect(s.readRate).toBe(0)
    expect(pct(0, 0)).toBe(0)
  })
})

describe('markdown', () => {
  const rows = [
    row({ id: 'a', source: 'prompt', reads: true }),
    row({ id: 'b', source: 'prompt', reads: false, reason: 'a cube with a spout' }),
    row({ id: 'c', source: 'chat', reads: true, readsThumb: false }),
  ]
  const md = markdown(rows, { at: '2026-10-29T00:00:00.000Z', judge: 'a-model', density: 12000, theme: 'dark', prompts: 3, sources: ['prompt', 'chat'] })

  it('states both sources with their own read rates', () => {
    expect(md).toContain('| prompt (search backends) | 2 | 2 | 50% (1/2) |')
    expect(md).toContain('| chat (scene writer) | 1 | 1 | 100% (1/1) |')
  })

  it('carries the judge, the date and the misses', () => {
    expect(md).toContain('Judge: `a-model`')
    expect(md).toContain('# Prompt benchmark, 2026-10-29')
    expect(md).toContain('a cube with a spout')
  })

  it('shows a category a source did not run as a dash', () => {
    const table = categoryTable(rows, ['prompt', 'ply'])
    expect(table).toContain('| household |')
    expect(table).toContain('— | — |')
  })
})
