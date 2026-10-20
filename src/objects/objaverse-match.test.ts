import { describe, expect, it } from 'vitest'
import { CUTOFF, matchRows, pickRow } from './objaverse-match'
import type { IndexRow } from './objaverse-index'

const row = (uid: string, title: string, caption: string): IndexRow => ({
  uid,
  title,
  caption,
  chunk: '000-000',
  author: 'Ada',
  licence: 'CC BY 4.0',
})

const rows: IndexRow[] = [
  row('a', 'Lighthouse', 'A tall white lighthouse on a rocky headland'),
  row('b', 'Teapot', 'A round brown teapot with a curved spout'),
  row('c', 'Guitar', 'An acoustic guitar with six strings'),
  row('d', 'Water tower', 'A lighthouse described as a lighthouse by an automatic captioner'),
  row('e', 'Sword', 'A medieval sword with a leather grip'),
]

describe('matchRows', () => {
  it('finds the row whose title names the thing', () => {
    const m = matchRows(rows, 'lighthouse')
    expect(m[0].row.uid).toBe('a')
    expect(m[0].score).toBe(1)
  })

  it('finds a row by a word only its caption holds', () => {
    const m = matchRows(rows, 'teapot')
    expect(m[0].row.uid).toBe('b')
  })

  it('puts the row whose title agrees first', () => {
    // both rows mention a lighthouse, but only one is called a lighthouse
    const m = matchRows(rows, 'lighthouse')
    expect(m.map((x) => x.row.uid)).toEqual(['a', 'd'])
    expect(m[0].agree).toBe(true)
    expect(m[1].agree).toBe(false)
  })

  it('answers a plural', () => {
    const m = matchRows(rows, 'guitars')
    expect(m[0].row.uid).toBe('c')
  })

  it('answers a multi-word prompt when most of it matches', () => {
    const m = matchRows(rows, 'white lighthouse')
    expect(m[0].row.uid).toBe('a')
  })

  it('refuses a weak match', () => {
    // nothing here holds two of the three words
    expect(matchRows(rows, 'red sports car')).toHaveLength(0)
  })

  it('returns nothing for a prompt with no searchable words', () => {
    expect(matchRows(rows, 'the of')).toHaveLength(0)
  })

  it('uses the documented cutoff', () => {
    expect(CUTOFF).toBeGreaterThan(0.5)
    expect(CUTOFF).toBeLessThan(1)
  })
})

describe('pickRow', () => {
  it('returns the first match at step zero', () => {
    const m = matchRows(rows, 'lighthouse')
    expect(pickRow(m, 0)?.uid).toBe('a')
  })

  it('steps to the next match, so a reroll gives a different model', () => {
    const m = matchRows(rows, 'lighthouse')
    expect(pickRow(m, 1)?.uid).toBe('d')
    expect(pickRow(m, 0)?.uid).not.toBe(pickRow(m, 1)?.uid)
  })

  it('wraps round, so every match comes round again', () => {
    const m = matchRows(rows, 'lighthouse')
    expect(pickRow(m, m.length)?.uid).toBe('a')
  })

  it('returns nothing when there are no matches', () => {
    expect(pickRow([], 0)).toBeNull()
  })
})
