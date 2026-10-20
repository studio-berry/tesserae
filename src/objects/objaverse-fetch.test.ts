import { afterEach, describe, expect, it, vi } from 'vitest'
import { asText, objaverseIndex, resetObjaverseIndex } from './objaverse-fetch'
import type { Index } from './objaverse-index'

const index: Index = {
  version: 'test',
  rows: 1,
  revisions: { 'allenai/objaverse': 'abc' },
  data: [{ uid: 'a'.repeat(32), title: 'Lighthouse', caption: 'A lighthouse', chunk: '000-000', author: 'Ada', licence: 'CC BY 4.0' }],
}

// the gzip magic number, so the tests build a body a server would leave compressed
const gzip = async (text: string) => {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetObjaverseIndex()
})

describe('asText', () => {
  it('reads a body the server already decompressed', async () => {
    const res = new Response(JSON.stringify(index), { headers: { 'content-encoding': 'gzip' } })
    const text = await asText(res)
    expect(JSON.parse(text).data[0].title).toBe('Lighthouse')
  })

  it('reads a body that is still compressed', async () => {
    // a plain static host serves the bytes as they are, with no content-encoding, so the body
    // arrives still gzip
    const bytes = await gzip(JSON.stringify(index))
    const res = new Response(bytes)
    expect(res.headers.get('content-encoding')).toBeNull()
    const text = await asText(res)
    expect(JSON.parse(text).data[0].title).toBe('Lighthouse')
  })
})

describe('objaverseIndex', () => {
  it('reads an index the server left compressed', async () => {
    const bytes = await gzip(JSON.stringify(index))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)) as unknown as typeof fetch)
    const held = await objaverseIndex()
    expect(held).not.toBeNull()
    expect(held!.data[0].title).toBe('Lighthouse')
  })

  it('reads an index the server decompressed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(index))) as unknown as typeof fetch)
    const held = await objaverseIndex()
    expect(held!.data[0].title).toBe('Lighthouse')
  })

  it('fetches once and holds the index', async () => {
    const fn = vi.fn(async () => new Response(JSON.stringify(index)))
    vi.stubGlobal('fetch', fn as unknown as typeof fetch)
    await objaverseIndex()
    await objaverseIndex()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('answers null when the index is not there', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch)
    expect(await objaverseIndex()).toBeNull()
  })

  it('answers null when the body is not an index', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json')) as unknown as typeof fetch)
    expect(await objaverseIndex()).toBeNull()
  })
})
