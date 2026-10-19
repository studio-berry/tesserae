import { describe, expect, it } from 'vitest'
import { REFUSAL, blockedRun, blockedToken, checkTyped, maskName, normalise, scanLine } from './index'
import { BLOCKED } from './words'

const RAMP = ".,:;'-~=+*^!/|<>abcdefghijklmnopqrstuvwxyz#%&@$"
const BLOCKS = '·░▒▓█'

describe('normalise', () => {
  it('folds case and accents', () => {
    expect(normalise('Níçe')).toBe('nice')
    expect(normalise('\u00c9COLE')).toBe('ecole')
  })

  it('reads digits, symbols and lookalike letters as the letters they stand for', () => {
    expect(normalise('sh1t')).toBe('shit')
    expect(normalise('b!tch')).toBe('bitch')
    expect(normalise('\u0430ss')).toBe('ass')
  })

  it('keeps a double letter but eats padding', () => {
    expect(normalise('ass')).toBe('ass')
    expect(normalise('fuuuck')).toBe('fuck')
  })

  it('turns separators into single spaces', () => {
    expect(normalise('  Hello,   World  ')).toBe('hello world')
    expect(normalise('a...b')).toBe('a b')
  })

  it('leaves a trailing mark as a separator', () => {
    expect(normalise('ass!')).toBe('ass')
  })
})

describe('blockedToken', () => {
  it('passes words that merely contain a blocked one', () => {
    expect(blockedToken('class')).toBeNull()
    expect(blockedToken('assassin')).toBeNull()
    expect(blockedToken('scunthorpe')).toBeNull()
  })

  it('catches a whole word whatever its case or disguise', () => {
    expect(blockedToken('you ass.')).toBe('profane')
    expect(blockedToken('FUCK')).toBe('profane')
    expect(blockedToken('sh1t')).toBe('profane')
    expect(blockedToken('a faggot')).toBe('slur')
  })

  it('leaves a word split by punctuation to the run scan', () => {
    expect(blockedToken('a.s.s')).toBeNull()
  })
})

describe('blockedRun', () => {
  it('finds a word inside a longer run', () => {
    expect(blockedRun('assassin')).toBe('profane')
    expect(blockedRun('xxfaggotxx')).toBe('slur')
  })

  it('joins letters held apart by separators', () => {
    expect(blockedRun('a.s.s')).toBe('profane')
    expect(blockedRun('s hit')).toBe('profane')
  })

  it('does not read across a line break', () => {
    expect(blockedRun('as\ns')).toBeNull()
  })

  it('passes clean text', () => {
    expect(blockedRun('the quick brown fox')).toBeNull()
  })
})

describe('checkTyped', () => {
  it('accepts ordinary text', () => {
    expect(checkTyped('a bowl of soup')).toEqual({ ok: true })
    expect(checkTyped('   ')).toEqual({ ok: true })
  })

  it('refuses without echoing the word back', () => {
    const verdict = checkTyped('you fuck')
    expect(verdict).toEqual({ ok: false, reason: REFUSAL })
    expect(JSON.stringify(verdict)).not.toContain('fuck')
  })

  it('refuses a word whose letters were held apart, or typed twice', () => {
    expect(checkTyped('f u c k').ok).toBe(false)
    expect(checkTyped('f.u.c.k').ok).toBe(false)
    expect(checkTyped('fuckfuck').ok).toBe(false)
  })

  it('still accepts a place name that contains a shorter blocked word', () => {
    for (const place of ['Scunthorpe', 'Penistone', 'Cockburn', 'Lightwater', 'therapist', 'assassin', 'classic']) {
      expect(checkTyped(place)).toEqual({ ok: true })
    }
  })
})

describe('scanLine', () => {
  it('leaves a clean line alone', () => {
    expect(scanLine('hello world', RAMP)).toBe('hello world')
  })

  it('swaps one letter of a hit for the next glyph in the ramp', () => {
    expect(scanLine('you ass', RAMP)).toBe('you ats')
    expect(scanLine('you ass', RAMP)).toHaveLength(7)
  })

  it('breaks a word whose letters are held apart', () => {
    const out = scanLine('a.s.s', RAMP)
    expect(out).toBe('a.t.s')
    expect(blockedRun(out)).toBeNull()
  })

  it('steps to the middle weight when the ramp has no letters', () => {
    const out = scanLine('ass', BLOCKS)
    expect(out).toBe('a▒s')
    expect(blockedRun(out)).toBeNull()
  })

  it('blanks the hit rather than leave it, when the ramp has nothing else to offer', () => {
    const out = scanLine('ass', '#')
    expect(out).toBe('a#s')
    expect(blockedRun(out)).toBeNull()
    expect(scanLine('ass', ' ')).not.toContain('ass')
  })

  it('clears every hit on the line', () => {
    const out = scanLine('ass and shit', RAMP)
    expect(blockedRun(out)).toBeNull()
    expect(out).toBe('ats and shjt')
  })

  it('fixes a hit at the very edge of a line', () => {
    expect(scanLine('ass', RAMP)).toBe('ats')
  })

  it('leaves an exported block with nothing for the run scan to find', () => {
    const block = ['...ass...', '..sh it..'].map((line) => scanLine(line, RAMP)).join('\n')
    expect(block).toBe('...ats...\n..sh jt..')
    expect(blockedRun(block)).toBeNull()
  })

  it('holds its size over a whole grid of random letters', () => {
    const letters = RAMP.slice(RAMP.indexOf('a'))
    let seed = 7
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const grid = Array.from({ length: 96 }, () => Array.from({ length: 96 }, () => letters[next() * letters.length | 0]).join(''))
    const block = grid.map((line) => scanLine(line, RAMP)).join('\n')
    expect(block.replace(/\n/g, '')).toHaveLength(96 * 96)
    expect(blockedRun(block)).toBeNull()
  })
})

describe('maskName', () => {
  it('keeps the ends and the extension', () => {
    expect(maskName('model.glb')).toBe('m•••l.glb')
    expect(maskName('Model.glb')).toBe('M•••l.glb')
    expect(maskName('snoopy')).toBe('s••••y')
  })

  it('masks a short name whole', () => {
    expect(maskName('a.glb')).toBe('•.glb')
    expect(maskName('ab')).toBe('a•')
    expect(maskName('scan')).toBe('s••n')
  })
})

describe('the list', () => {
  it('holds plain lowercase words that survive normalisation', () => {
    const words = BLOCKED.map((b) => b.word)
    expect(new Set(words).size).toBe(words.length)
    for (const word of words) {
      expect(word).toMatch(/^[a-z]+$/)
      expect(normalise(word)).toBe(word)
    }
  })

  it('refuses every listed word, typed or accidental', () => {
    for (const { word, kind } of BLOCKED) {
      expect(blockedToken(word.toUpperCase())).toBe(kind)
      expect(blockedRun(`x${word}y`)).toBe(kind)
      expect(checkTyped(`say ${word}`).ok).toBe(false)
    }
  })
})
