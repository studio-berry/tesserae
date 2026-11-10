import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../src/engine/core.ts'
import { LIBRARY } from '../src/objects/library.ts'
import { captionFor, words } from './procedural-captions.ts'

describe('words', () => {
  it('names the counts the captions use', () => {
    expect(words(0)).toBe('zero')
    expect(words(8)).toBe('eight')
    expect(words(12)).toBe('twelve')
    expect(words(20)).toBe('twenty')
    expect(words(21)).toBe('twenty-one')
    expect(words(26)).toBe('twenty-six')
    expect(words(40)).toBe('forty')
    expect(words(100)).toBe('100')
  })
})

describe('captionFor', () => {
  it('names a platonic solid by its sides, not its triangles', () => {
    expect(captionFor('crystal', { title: 'Dodecahedron', detail: 'platonic solid · 36 faces' }, 0)).toBe(
      'a faceted twelve-sided crystal',
    )
    expect(captionFor('crystal', { title: 'Icosahedron', detail: 'platonic solid · 20 faces' }, 0)).toBe(
      'a faceted twenty-sided crystal',
    )
  })

  it('tells a trefoil from the other knots, and counts the other knots', () => {
    expect(captionFor('knot', { title: 'Trefoil knot', detail: '(2, 3) torus knot' }, 0)).toBe('a tight trefoil knot')
    expect(captionFor('knot', { title: 'Torus knot', detail: '(3, 5) torus knot' }, 0)).toBe(
      'a tight torus knot wound three times around the ring and five times through its hole',
    )
  })

  it('reads the build it was given, so the words match the shape', () => {
    expect(captionFor('teapot', { title: 'Utah teapot', detail: 'Martin Newell, 1975' }, 0)).toContain('lid on')
    expect(captionFor('teapot', { title: 'Utah teapot', detail: 'Martin Newell, 1975 · lid off' }, 0)).toContain('lid off')
    expect(captionFor('donut', { title: 'Donut', detail: 'torus · R 1 · r 0.45' }, 0)).toBe('an even torus with a thick tube')
    expect(captionFor('donut', { title: 'Donut', detail: 'torus · R 1 · r 0.28' }, 0)).toContain('a thin tube')
    expect(captionFor('shell', { title: 'Seashell', detail: 'logarithmic spiral · 2.6 turns' }, 0)).toContain('three turns')
    expect(captionFor('helix', { title: 'Double helix', detail: '26 base pairs · ACGTACGTACGT…' }, 0)).toContain('twenty-six base pairs')
    expect(captionFor('asteroid', { title: 'Asteroid', detail: '9 craters · #00a' }, 0)).toContain('nine craters')
    expect(captionFor('supershape', { title: 'Supershape', detail: 'm 8 · n 1.5 4 8 / m 4 · n 1.6 3 3' }, 0)).toContain(
      'eight-lobed rim',
    )
  })

  it('falls back to the item name for a form it has no sentence for', () => {
    expect(captionFor('blob', { title: 'Strange blob', detail: '' }, 0)).toBe('a strange blob')
  })
})

describe('the library captioned', () => {
  const seeds = [0, 1, 2, 3, 4, 5]
  const built = LIBRARY.map((item) => ({
    item,
    captions: seeds.map((seed) => {
      const b = item.build(mulberry32(seed), seed)
      return captionFor(item.id, b, seed)
    }),
  }))

  it('gives every form a plausible English phrase', () => {
    for (const { item, captions } of built) {
      for (const caption of captions) {
        const [article, first] = caption.split(' ')
        expect(article, item.id).toBe(/^[aeiou]/.test(first) ? 'an' : 'a')
        expect(caption, item.id).not.toMatch(/\d|NaN|undefined|Infinity/)
        expect(caption, item.id).not.toContain('  ')
      }
    }
  })

  it('varies the phrase across seeds', () => {
    for (const { item, captions } of built) {
      expect(new Set(captions).size, item.id).toBeGreaterThanOrEqual(3)
    }
  })
})
