// A held-out set is only worth having if the training never saw it and a wrong key cannot quietly
// produce a plausible score. Both are asserted here.

import { describe, expect, it } from 'vitest'
import { overlap, seal, unseal } from './held-out.ts'

const KEY = 'test-key-not-the-real-one'
const row = (id: string, prompt: string) => ({ id, prompt, category: 'household', seed: 1 })

describe('seal and unseal', () => {
  it('round-trips the prompts', () => {
    const plain = '{"id":"h001","prompt":"a copper kettle"}\n{"id":"h002","prompt":"a linen press"}\n'
    expect(unseal(seal(plain, KEY), KEY)).toBe(plain)
  })

  it('refuses another key instead of returning nonsense', () => {
    const sealed = seal('{"id":"h001","prompt":"a copper kettle"}', KEY)
    expect(() => unseal(sealed, 'the-wrong-key')).toThrow('the key does not open this file')
  })

  it('refuses a file that was never sealed', () => {
    expect(() => unseal(Buffer.from('{"id":"h001"}'), KEY)).toThrow('not a held-out file')
  })

  it('does not repeat its initialisation vector, so two seals of one file differ', () => {
    expect(seal('same text', KEY).equals(seal('same text', KEY))).toBe(false)
  })
})

describe('overlap', () => {
  it('finds a held-out prompt that the public set already carries, ignoring articles and case', () => {
    const held = [row('h001', 'A copper kettle'), row('h002', 'a painted birdhouse')]
    const published = [row('p001', 'a copper kettle'), row('p002', 'a stone well')]
    expect(overlap(held, published)).toEqual(['A copper kettle'])
  })

  it('treats two different objects as different', () => {
    expect(overlap([row('h001', 'a brass kettle')], [row('p001', 'a copper kettle')])).toEqual([])
  })
})
