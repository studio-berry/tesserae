import { describe, expect, it } from 'vitest'
import { readUrl, writeUrl } from './url'

const D = 6000

describe('readUrl', () => {
  it('falls back to the first object and the usual settings with nothing in the query', () => {
    const s = readUrl('', D, 'dark')
    expect(s.source).toEqual({ kind: 'library', id: 'teapot' })
    expect(s.density).toBe(D)
    expect([s.mode, s.theme, s.palette, s.charset]).toEqual(['letters', 'dark', null, 'letters'])
  })

  it('reads the source, density and styling out of a shared link', () => {
    const s = readUrl('?o=knot&mode=grid&theme=light&glyphs=classic&seed=3&n=9000&ink=jade', D, 'dark')
    expect(s.source).toEqual({ kind: 'library', id: 'knot' })
    expect([s.mode, s.theme, s.charset, s.seed, s.density, s.palette]).toEqual(['grid', 'light', 'classic', 3, 9000, 'jade'])
    expect(s.text).toBe('ascii')
  })

  it('takes a prompt or a typed word instead of an object', () => {
    expect(readUrl('?prompt=a lighthouse', D, 'dark').source).toEqual({ kind: 'prompt', text: 'a lighthouse' })
    expect(readUrl('?text=hello', D, 'dark').source).toEqual({ kind: 'text', text: 'hello' })
    expect(readUrl('?text=hello', D, 'dark').text).toBe('hello')
  })

  it('ignores an unknown object, mode, glyph set or ink rather than rendering nothing', () => {
    const s = readUrl('?o=nosuch&mode=wire&glyphs=runes&ink=chartreuse&theme=sepia', D, 'light')
    expect(s.source).toEqual({ kind: 'library', id: 'teapot' })
    expect([s.mode, s.charset, s.palette, s.theme]).toEqual(['letters', 'letters', null, 'light'])
  })

  it('leaves the palette to the design when the link names no ink, or one it does not know', () => {
    expect(readUrl('?o=teapot', D, 'dark').palette).toBeNull()
    expect(readUrl('?o=teapot&ink=', D, 'dark').palette).toBeNull()
    expect(readUrl('?o=teapot&ink=chartreuse', D, 'dark').palette).toBeNull()
  })

  it('reads a named palette, and the object\'s own colours, out of the link', () => {
    expect(readUrl('?o=teapot&ink=jade', D, 'dark').palette).toBe('jade')
    expect(readUrl('?o=teapot&ink=source', D, 'dark').palette).toBe('source')
  })

  it('clamps the density into the range the slider offers', () => {
    expect(readUrl('?n=99999', D, 'dark').density).toBe(12000)
    expect(readUrl('?n=10', D, 'dark').density).toBe(1500)
    expect(readUrl('?n=abc', D, 'dark').density).toBe(D)
  })

  it('follows the system theme when the link does not name one', () => {
    expect(readUrl('', D, 'light').theme).toBe('light')
    expect(readUrl('?theme=dark', D, 'light').theme).toBe('dark')
  })
})

describe('writeUrl', () => {
  it('survives a round trip for every source', () => {
    for (const search of ['?o=helix&seed=2', '?text=a word', '?prompt=a lighthouse', '?n=8000&mode=dots&ink=ember&glyphs=dense']) {
      const s = readUrl(search, D, 'dark')
      const again = readUrl(writeUrl(s, D), D, 'dark')
      expect(again.source).toEqual(s.source)
      expect([again.mode, again.palette, again.charset, again.density, again.seed]).toEqual([s.mode, s.palette, s.charset, s.density, s.seed])
    }
  })

  it('leaves the defaults out, so a plain link stays plain', () => {
    expect(writeUrl(readUrl('', D, 'dark'), D)).toBe('?o=teapot&theme=dark')
    expect(writeUrl(readUrl('?o=donut&n=9000&ink=jade', D, 'dark'), D)).toBe('?o=donut&n=9000&theme=dark&ink=jade')
  })

  it('keeps an explicit palette in the link, even the first token, so the choice survives', () => {
    // A knot's own palette is celadon, so an absent ink would bring celadon back; a sharer who
    // picked porcelain has to keep porcelain or the link shows a different picture.
    const s = { ...readUrl('?o=knot', D, 'dark'), palette: 'ivory' as const }
    expect(writeUrl(s, D)).toContain('ink=ivory')
    expect(readUrl(writeUrl(s, D), D, 'dark').palette).toBe('ivory')
  })

  it('encodes a prompt so the link can be pasted anywhere', () => {
    const s = { ...readUrl('', D, 'dark'), source: { kind: 'prompt' as const, text: 'a cat & a dog' } }
    expect(writeUrl(s, D)).toContain('prompt=a+cat+%26+a+dog')
    expect(readUrl(writeUrl(s, D), D, 'dark').source).toEqual(s.source)
  })
})
