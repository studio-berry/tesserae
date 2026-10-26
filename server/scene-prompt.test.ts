import { describe, expect, it } from 'vitest'
import { SYSTEM, parseReply, userTurn } from './scene-prompt'

// The reply's shape is the model's contract, and the parser is the half that has to survive a model
// that breaks it. These are the shapes measured replies actually arrived in.

describe('parseReply', () => {
  it('reads the two labelled lines', () => {
    expect(parseReply('TITLE: Brass Padlock\nCODE:\nconst g = new THREE.Group()\nreturn g')).toEqual({
      title: 'Brass Padlock',
      code: 'const g = new THREE.Group()\nreturn g',
    })
  })

  it('reads a body that arrives inside a fence', () => {
    const reply = 'TITLE: A Teapot\nCODE:\n```js\nconst g = new THREE.Group()\nreturn g\n```'
    expect(parseReply(reply)?.code).toBe('const g = new THREE.Group()\nreturn g')
  })

  it('reads a reply whose title came after the code', () => {
    // measured: one reply put its TITLE line last, and the label-first reading dropped the scene
    const reply = 'CODE:\nconst g = new THREE.Group()\nreturn g\n\nTITLE: Late Title'
    expect(parseReply(reply)).toEqual({ title: 'Late Title', code: 'const g = new THREE.Group()\nreturn g' })
  })

  it('reads a reply with no title at all, and leaves the naming to the caller', () => {
    // measured: one reply opened straight into CODE:
    const reply = 'CODE:\nconst g = new THREE.Group()\nreturn g'
    expect(parseReply(reply)).toEqual({ title: '', code: 'const g = new THREE.Group()\nreturn g' })
  })

  it('handles carriages from a reply that used them', () => {
    expect(parseReply('TITLE: Thing\r\nCODE:\r\nreturn new THREE.Group()')?.code).toBe('return new THREE.Group()')
  })

  it('strips the quotes a title sometimes wears', () => {
    expect(parseReply('TITLE: "Brass Padlock"\nCODE:\nreturn new THREE.Group()')?.title).toBe('Brass Padlock')
  })

  it('refuses a reply with no code, an empty one, or no code label', () => {
    expect(parseReply('TITLE: Nothing')).toBeNull()
    expect(parseReply('TITLE: Empty\nCODE:\n')).toBeNull()
    expect(parseReply('here is a scene: const g = new THREE.Group()')).toBeNull()
    expect(parseReply('')).toBeNull()
  })
})

describe('the brief', () => {
  it('names the two labels the parser reads', () => {
    expect(SYSTEM).toContain('TITLE:')
    expect(SYSTEM).toContain('CODE:')
  })

  it('asks for the return line, since a body that stops early is thrown away', () => {
    expect(SYSTEM).toContain('return group')
  })

  it('asks the model to move a reroll rather than repeat itself', () => {
    expect(userTurn('a fox', 0)).toBe('a fox')
    expect(userTurn('a fox', 2)).toContain('a fox')
    expect(userTurn('a fox', 2)).not.toBe('a fox')
  })
})
