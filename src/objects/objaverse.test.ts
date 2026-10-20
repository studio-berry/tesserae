import { afterEach, describe, expect, it, vi } from 'vitest'
import { findObjaverse } from './objaverse'
import { resetObjaverseIndex } from './objaverse-fetch'
import type { Index } from './objaverse-index'

const row = (uid: string, title: string, caption: string) => ({
  uid,
  title,
  caption,
  chunk: '000-000',
  author: 'Ada',
  licence: 'CC BY 4.0',
})

const index: Index = {
  version: 'test',
  rows: 3,
  revisions: { 'allenai/objaverse': 'abc' },
  data: [
    row('a'.repeat(32), 'Lighthouse', 'A lighthouse on a headland'),
    row('b'.repeat(32), 'Lighthouse', 'Another lighthouse, also a lighthouse'),
    row('c'.repeat(32), 'Water tower', 'A water tower'),
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetObjaverseIndex()
})

describe('findObjaverse', () => {
  it('answers null when there is no index', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch)
    expect(await findObjaverse('lighthouse')).toBeNull()
  })

  it('answers null when nothing matches', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(index))) as unknown as typeof fetch)
    expect(await findObjaverse('red sports car')).toBeNull()
  })

  it('moves on to the next match when the first one is refused', async () => {
    // the first match holds a word the content rules refuse, so the second one gets a turn
    const refused: Index = {
      ...index,
      data: [
        row('a'.repeat(32), 'Lighthouse', 'A lighthouse, an ass of a model'),
        row('b'.repeat(32), 'Lighthouse', 'Another lighthouse on a headland'),
      ],
    }
    const asked: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('objaverse/index')) return new Response(JSON.stringify(refused))
      asked.push(url)
      // every model download fails, so the answer is null, but the urls asked for say which
      // models were tried
      return new Response('', { status: 500 })
    }) as unknown as typeof fetch)
    expect(await findObjaverse('lighthouse')).toBeNull()
    // the refused row is not downloaded at all, and the next match gets its turn
    expect(asked.some((u) => u.includes('a'.repeat(32)))).toBe(false)
    expect(asked[0]).toContain('b'.repeat(32))
  })

  it('moves on to the next match when a download fails', async () => {
    const asked: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('objaverse/index')) return new Response(JSON.stringify(index))
      asked.push(url)
      return new Response('', { status: 500 })
    }) as unknown as typeof fetch)
    expect(await findObjaverse('lighthouse')).toBeNull()
    // the first model was tried at two addresses, and then the next match got its turn
    expect(asked.length).toBeGreaterThan(2)
    expect(asked.some((u) => u.includes('b'.repeat(32)))).toBe(true)
  })
})
