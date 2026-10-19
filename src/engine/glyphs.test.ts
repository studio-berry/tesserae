import { describe, expect, it } from 'vitest'
import {
  atlasGrid, CHARSETS, charsFor, gridRamp, MAX_TEXTURE, MAX_TILES, ORIENT_COUNT, orientIndex, rankGlyphs,
  sameTile, TILE,
} from './glyphs'

// the six sets the issue list names, plus the extras that came with them
const NEW_SETS = ['upper', 'braille', 'math', 'arrows', 'katakana', 'greek', 'hex', 'cyrillic', 'punct', 'slashes'] as const

describe('atlasGrid', () => {
  it('folds the dense ramp into a square well under the 4096 px limit', () => {
    const g = atlasGrid(91)
    expect(g).toEqual({ cols: 10, rows: 10 })
    expect(g.cols * TILE).toBe(640)
    expect(g.rows * TILE).toBe(640)
  })

  it('leaves room for the direction tiles', () => {
    const g = atlasGrid(91 + ORIENT_COUNT)
    expect(g).toEqual({ cols: 10, rows: 10 })
    expect(g.cols * g.rows).toBeGreaterThanOrEqual(91 + ORIENT_COUNT)
  })

  it('fills the largest grid the texture limit allows', () => {
    expect(MAX_TEXTURE).toBe(4096)
    expect(MAX_TILES).toBe(4096)
    const g = atlasGrid(MAX_TILES)
    expect(g).toEqual({ cols: 64, rows: 64 })
    expect(g.cols * TILE).toBe(MAX_TEXTURE)
    expect(g.rows * TILE).toBe(MAX_TEXTURE)
  })

  it('refuses a grid that would grow past the texture limit', () => {
    expect(() => atlasGrid(MAX_TILES + 1)).toThrow(RangeError)
    expect(() => atlasGrid(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('treats empty or broken counts as a single tile', () => {
    expect(atlasGrid(0)).toEqual({ cols: 1, rows: 1 })
    expect(atlasGrid(-5)).toEqual({ cols: 1, rows: 1 })
    expect(atlasGrid(Number.NaN)).toEqual({ cols: 1, rows: 1 })
  })

  it('always covers every tile with a square inside the limit', () => {
    for (let n = 1; n <= 400; n++) {
      const g = atlasGrid(n)
      expect(g.cols).toBe(g.rows)
      expect(g.cols * g.rows).toBeGreaterThanOrEqual(n)
      expect(g.cols * TILE).toBeLessThanOrEqual(MAX_TEXTURE)
      expect(g.rows * TILE).toBeLessThanOrEqual(MAX_TEXTURE)
    }
  })
})

describe('rankGlyphs', () => {
  it('orders by ink from least to most and drops blank glyphs', () => {
    expect(rankGlyphs([
      { ch: '@', ink: 300 },
      { ch: '.', ink: 4 },
      { ch: ' ', ink: 0 },
      { ch: 'x', ink: -2 },
      { ch: '#', ink: 180 },
    ])).toEqual(['.', '#', '@'])
  })

  it('keeps one tile per character', () => {
    expect(rankGlyphs([
      { ch: 'a', ink: 5 },
      { ch: 'b', ink: 2 },
      { ch: 'a', ink: 5 },
    ])).toEqual(['b', 'a'])
  })

  it('keeps first-seen order when glyphs leave equal ink', () => {
    expect(rankGlyphs([
      { ch: 'z', ink: 7 },
      { ch: 'a', ink: 7 },
      { ch: 'm', ink: 7 },
    ])).toEqual(['z', 'a', 'm'])
  })

  it('falls back to # when nothing leaves ink', () => {
    expect(rankGlyphs([])).toEqual(['#'])
    expect(rankGlyphs([{ ch: ' ', ink: 0 }, { ch: '\t', ink: 0 }])).toEqual(['#'])
  })
})

describe('CHARSETS', () => {
  it('keeps the original five and adds the six the issue asked for', () => {
    const first = Object.keys(CHARSETS).slice(0, 5)
    expect(first).toEqual(['letters', 'classic', 'dense', 'binary', 'blocks'])
    for (const id of ['upper', 'braille', 'math', 'arrows', 'katakana', 'greek']) expect(Object.keys(CHARSETS), id).toContain(id)
  })

  it('carries the characters each new set is meant to show', () => {
    expect(NEW_SETS.every((id) => id in CHARSETS)).toBe(true)
    expect([...CHARSETS.upper.chars]).toEqual([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'])
    expect(CHARSETS.math.chars).toContain('∑')
    expect([...CHARSETS.arrows.chars].length).toBe(8)
    expect(CHARSETS.katakana.chars).toContain('ｱ')
    expect(CHARSETS.braille.chars).toContain('⣿')
  })

  it('gives every set distinct characters and a positive jitter', () => {
    for (const [id, set] of Object.entries(CHARSETS)) {
      const chars = [...set.chars]
      expect(chars.length, id).toBeGreaterThan(1)
      expect(new Set(chars).size, id).toBe(chars.length)
      expect(set.jitter, id).toBeGreaterThan(0)
    }
  })

  it('keeps the densest set over the old single-row limit but inside the square grid', () => {
    const densest = Math.max(...Object.values(CHARSETS).map((s) => [...s.chars].length))
    expect(densest).toBe(91)
    expect(densest * TILE).toBeGreaterThan(MAX_TEXTURE)
    expect(atlasGrid(densest + ORIENT_COUNT).cols * TILE).toBeLessThanOrEqual(MAX_TEXTURE)
  })
})

describe('gridRamp', () => {
  it('drops a, e, i, o, u and y in both cases', () => {
    expect(gridRamp('aeiouy')).toBe('')
    expect(gridRamp('AEIOUY')).toBe('')
    expect(gridRamp('abcdefghijklmnopqrstuvwxyz')).toBe('bcdfghjklmnpqrstvwxz')
  })

  it('keeps punctuation, digits and symbols', () => {
    expect(gridRamp('.,:;+#%&@')).toBe('.,:;+#%&@')
    expect(gridRamp('0123456789')).toBe('0123456789')
    expect(gridRamp('/\\|-_=+<>')).toBe('/\\|-_=+<>')
  })

  it('drops vowels from a mixed ramp and leaves an empty one empty', () => {
    expect(gridRamp('0123456789ABCDEF')).toBe('0123456789BCDF')
    expect(gridRamp('')).toBe('')
  })
})

describe('sameTile', () => {
  it('compares the alpha channel only', () => {
    expect(sameTile(new Uint8ClampedArray([9, 9, 9, 10, 8, 8, 8, 0]), new Uint8ClampedArray([1, 2, 3, 10, 4, 5, 6, 0]))).toBe(true)
    expect(sameTile(new Uint8ClampedArray([9, 9, 9, 10]), new Uint8ClampedArray([9, 9, 9, 0]))).toBe(false)
  })

  it('treats a different tile size as a different tile', () => {
    expect(sameTile(new Uint8ClampedArray([9, 9, 9, 10]), new Uint8ClampedArray([9, 9, 9, 10, 9, 9, 9, 10]))).toBe(false)
  })
})

describe('charsFor', () => {
  it('returns a built-in set unchanged', () => {
    expect(charsFor('dense', 'ignored')).toBe(CHARSETS.dense)
    expect(charsFor('braille', 'ignored')).toBe(CHARSETS.braille)
  })

  it('dedupes a custom set, strips whitespace and falls back to #', () => {
    expect(charsFor('custom', ' aa b\tc!a').chars).toBe('abc!')
    expect(charsFor('custom', '   ').chars).toBe('#')
  })

  it('caps a custom set at 96 distinct characters', () => {
    const many = Array.from({ length: 140 }, (_, i) => String.fromCharCode(0x4e00 + i)).join('')
    const set = charsFor('custom', many)
    expect([...set.chars]).toHaveLength(96)
    expect(set.jitter).toBe(6)
  })

  it('keeps astral characters whole when it caps a custom set', () => {
    const many = Array.from({ length: 140 }, (_, i) => String.fromCodePoint(0x1f600 + i)).join('')
    const set = charsFor('custom', many)
    expect([...set.chars]).toHaveLength(96)
    expect([...set.chars].every((ch) => (ch.codePointAt(0) ?? 0) >= 0x10000)).toBe(true)
  })
})

describe('orientIndex', () => {
  it('maps a tangent angle to the matching direction tile over half a turn', () => {
    expect(ORIENT_COUNT).toBe(8)
    expect(orientIndex(0)).toBe(0)
    expect(orientIndex(Math.PI / 8)).toBe(1)
    expect(orientIndex(Math.PI / 4)).toBe(2)
    expect(orientIndex(Math.PI / 2)).toBe(4)
    expect(orientIndex(Math.PI * 0.999)).toBe(7)
    expect(orientIndex(Math.PI)).toBe(0)
  })

  it('wraps negative and oversized angles', () => {
    expect(orientIndex(-Math.PI / 8)).toBe(7)
    expect(orientIndex(-Math.PI)).toBe(0)
    expect(orientIndex(Math.PI * 3)).toBe(0)
  })

  it('moves to the next tile at each eighth of a half turn', () => {
    expect(orientIndex(Math.PI / 8 - 0.01)).toBe(0)
    expect(orientIndex(Math.PI / 8 + 0.01)).toBe(1)
  })

  it('falls back to the first tile for a broken angle', () => {
    expect(orientIndex(Number.NaN)).toBe(0)
    expect(orientIndex(Number.POSITIVE_INFINITY)).toBe(0)
  })
})
