import { describe, expect, it } from 'vitest'
import { checkContent, fold, isExplicit, isFanArt, makeGuard } from './content'

describe('fold', () => {
  it('folds accents and case to ascii', () => {
    expect(fold('Pokémon')).toBe('pokemon')
    expect(fold('Café')).toBe('cafe')
  })
})

describe('isFanArt', () => {
  it('catches a franchise name', () => {
    expect(isFanArt('Sonic the Hedgehog model')).toBe(true)
    expect(isFanArt('Pikachu figure')).toBe(true)
  })

  it('catches a stem inside a run of words', () => {
    expect(isFanArt('pokemon3d asset')).toBe(true)
    expect(isFanArt('fnafar animatronic')).toBe(true)
    expect(isFanArt('sonic_the_hedgehog')).toBe(true)
  })

  it('catches a fan art word standing alone', () => {
    expect(isFanArt('cosplay model')).toBe(true)
    expect(isFanArt('anime style bust')).toBe(true)
  })

  it('lets an ordinary object through', () => {
    expect(isFanArt('wooden chair')).toBe(false)
    expect(isFanArt('lighthouse')).toBe(false)
    expect(isFanArt('guitar')).toBe(false)
  })

  it('does not treat a ceiling fan as fan art', () => {
    expect(isFanArt('ceiling fan')).toBe(false)
    expect(isFanArt('electric fan')).toBe(false)
  })

  it('does not eat a word that merely contains a franchise name', () => {
    // 'pikachu' inside another word must not fire, and neither must 'sextant' or 'marionette'
    expect(isFanArt('sextant')).toBe(false)
    expect(isFanArt('marionette')).toBe(false)
    expect(isFanArt('panasonic radio')).toBe(false)
  })
})

describe('isExplicit', () => {
  it('catches an explicit stem inside one word', () => {
    expect(isExplicit('sexygirl')).toBe(true)
    expect(isExplicit('nsfw asset')).toBe(true)
    expect(isExplicit('nude sculpture')).toBe(true)
  })

  it('catches an explicit word standing alone', () => {
    expect(isExplicit('a bikini model')).toBe(true)
  })

  it('does not fire across word boundaries', () => {
    // 'sex' across two words would find 'happen is'
    expect(isExplicit('what is happening')).toBe(false)
  })

  it('lets an ordinary object through', () => {
    expect(isExplicit('wooden chair')).toBe(false)
    expect(isExplicit('bikini' as string)).toBe(true)
  })
})

describe('makeGuard', () => {
  it('reads a stem only inside a run of the given reach', () => {
    const one = makeGuard(['abc'], [], 1)
    const two = makeGuard(['abc'], [], 2)
    expect(one('abcd')).toBe(true)
    expect(one('ab cd')).toBe(false)
    expect(two('ab cd')).toBe(true)
  })

  it('reads a word only when it stands alone', () => {
    const g = makeGuard([], ['fan'], 3)
    expect(g('a fan')).toBe(true)
    expect(g('fantasy')).toBe(false)
  })
})

describe('checkContent', () => {
  it('passes ordinary text', () => {
    expect(checkContent('a red sports car')).toEqual({ ok: true })
  })

  it('refuses fan art without naming the word', () => {
    const verdict = checkContent('a pikachu model')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).not.toContain('pikachu')
  })

  it('refuses explicit text without naming the word', () => {
    const verdict = checkContent('a nsfw asset')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).not.toContain('nsfw')
  })

  it('takes a caller-supplied guard, so the app blocklist can join in', () => {
    const guard = makeGuard([], ['forbidden'], 1)
    expect(checkContent('a forbidden thing', { explicit: guard }).ok).toBe(false)
    expect(checkContent('a harmless thing', { explicit: guard }).ok).toBe(true)
  })
})
