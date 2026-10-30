import { describe, expect, it } from 'vitest'
import { inkTable, knownInk } from './ink'
import { CHARSETS } from '../engine/glyphs'

describe('glyph-ink.json', () => {
  it('carries a measurement for every character every built-in charset draws', () => {
    const missing: string[] = []
    for (const set of Object.values(CHARSETS)) {
      for (const ch of new Set(set.chars)) if (knownInk(ch) === undefined) missing.push(ch)
    }
    expect(missing).toEqual([])
  })

  it('orders a ramp the way the atlas expects: punctuation faint, blocks and # heavy', () => {
    expect(knownInk('.')!).toBeLessThan(knownInk('+')!)
    expect(knownInk('+')!).toBeLessThan(knownInk('#')!)
    expect(knownInk('#')!).toBeLessThanOrEqual(knownInk('@')!)
  })

  it('is the same table on every machine: it is committed, not measured in the page', () => {
    expect(Object.keys(inkTable).length).toBeGreaterThan(150)
    expect(knownInk('\u{10FFFD}')).toBeUndefined()
  })
})
