import { describe, expect, it } from 'vitest'
import { PALETTES, TINTS, paletteInk, paletteName } from './core'
import { LIBRARY } from '../objects/library'

describe('palettes', () => {
  it('names a tint token the shaders already have', () => {
    const ids = TINTS.map((t) => t.id) as readonly string[]
    for (const p of PALETTES) expect(ids, p.name).toContain(p.id)
  })

  it('gives every palette a name of its own, written lower case', () => {
    const names = PALETTES.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) expect(n).toBe(n.toLowerCase())
  })

  it('reads its ink from the token, on paper and in the dark', () => {
    for (const token of TINTS) {
      expect(paletteInk(token.id, 'dark')).toBe(token.dark)
      expect(paletteInk(token.id, 'light')).toBe(token.light)
    }
  })

  it('falls back to the first tint for an id it does not know', () => {
    expect(paletteInk('chartreuse' as never, 'dark')).toBe(TINTS[0].dark)
    expect(paletteInk('chartreuse' as never, 'light')).toBe(TINTS[0].light)
  })

  it('names a palette that exists for every design in the library', () => {
    const ids = PALETTES.map((p) => p.id) as readonly string[]
    for (const item of LIBRARY) expect(ids, item.id).toContain(item.palette)
  })

  it('has a name for every palette, and the id when it has none', () => {
    for (const p of PALETTES) expect(paletteName(p.id)).toBe(p.name)
  })
})
