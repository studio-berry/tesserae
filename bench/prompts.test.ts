import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const rows = readFileSync('bench/prompts.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l) as {
  id: string; prompt: string; category: string; seed: number
})

describe('bench/prompts.jsonl', () => {
  it('holds 1000 prompts in ten categories of one hundred', () => {
    expect(rows).toHaveLength(1000)
    const counts: Record<string, number> = {}
    for (const r of rows) counts[r.category] = (counts[r.category] ?? 0) + 1
    expect(Object.keys(counts)).toHaveLength(10)
    expect(Object.values(counts).every((n) => n === 100)).toBe(true)
  })

  it('has one prompt per row, with a stable id and a seed', () => {
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
    expect(new Set(rows.map((r) => r.prompt)).size).toBe(rows.length)
    for (const r of rows) {
      expect(r.id).toMatch(/^p\d{3,4}$/)
      expect(r.prompt.length).toBeGreaterThan(2)
      expect(Number.isInteger(r.seed)).toBe(true)
      expect(r.seed).toBeGreaterThanOrEqual(0)
      expect(r.seed).toBeLessThan(1_000_000)
    }
  })

  it('names every category the plan asks for', () => {
    const want = ['household', 'tool', 'vehicle', 'building', 'animal', 'plant', 'food', 'abstract', 'scene', 'motion']
    expect([...new Set(rows.map((r) => r.category))].sort()).toEqual(want.slice().sort())
  })
})
