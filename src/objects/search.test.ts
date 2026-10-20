import { afterEach, describe, expect, it, vi } from 'vitest'
import { findDrawing, findFiles, findModel } from './search'

// The stub is the same shape the prompt test uses, so both suites read the network the same way.
const stubFetch = (route: (url: string) => { json?: unknown; text?: string; status?: number } | null) => {
  const calls: string[] = []
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const reply = route(url)
    if (!reply) throw new Error(`unexpected request ${url}`)
    const status = reply.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => reply.json,
      text: async () => reply.text ?? '',
      arrayBuffer: async () => new TextEncoder().encode(reply.text ?? '').buffer as ArrayBuffer,
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn as unknown as typeof fetch)
  return calls
}

const file = (name: string, index: number, url: string, meta: Record<string, { value: string }> = {}) => ({
  title: `File:${name}`,
  index,
  imageinfo: [{ url, descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}`, size: 500, mime: 'application/sla', extmetadata: meta }],
})

const pages = (files: ReturnType<typeof file>[]) => ({ query: { pages: Object.fromEntries(files.map((f, i) => [i + 1, f])) } })

const TRIANGLE = `solid t
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid t`

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8"/></svg>'

afterEach(() => vi.unstubAllGlobals())

describe('findFiles', () => {
  it('reads the title and the description of every hit', async () => {
    stubFetch(() => ({
      json: pages([
        file('Anchor.stl', 1, 'https://upload.wikimedia.org/anchor.stl', {
          ImageDescription: { value: 'A heavy iron anchor from a wreck.' },
        }),
      ]),
    }))
    const hits = await findFiles('anchor', '3d')
    expect(hits).toHaveLength(1)
    expect(hits[0].title).toBe('Anchor')
    expect(hits[0].description).toBe('A heavy iron anchor from a wreck.')
  })

  it('leaves the description empty when the file has none', async () => {
    stubFetch(() => ({ json: pages([file('Anchor.stl', 1, 'https://upload.wikimedia.org/anchor.stl')]) }))
    const hits = await findFiles('anchor', '3d')
    expect(hits[0].description).toBe('')
  })
})

describe('findModel', () => {
  it('skips a hit whose title is refused and takes the next one', async () => {
    const calls = stubFetch((url) => {
      if (url.includes('filetype%3A3d')) {
        return { json: pages([
          file('Pikachu figure.stl', 1, 'https://upload.wikimedia.org/pikachu.stl'),
          file('Anchor.stl', 2, 'https://upload.wikimedia.org/anchor.stl'),
        ]) }
      }
      if (url.includes('upload.wikimedia.org')) return { text: TRIANGLE }
      return null
    })
    const result = await findModel('anchor')
    expect(result?.title).toBe('Anchor')
    // the refused hit is never downloaded, so the search moves on without paying for it
    expect(calls.filter((c) => c.includes('upload.wikimedia.org'))).toEqual(['https://upload.wikimedia.org/anchor.stl'])
  })

  it('skips a hit whose description is refused', async () => {
    stubFetch((url) => {
      if (url.includes('filetype%3A3d')) {
        return { json: pages([
          file('Anchor.stl', 1, 'https://upload.wikimedia.org/anchor.stl', {
            ImageDescription: { value: 'A model of Pikachu, the electric mouse.' },
          }),
          file('Anchor solid.stl', 2, 'https://upload.wikimedia.org/solid.stl'),
        ]) }
      }
      if (url.includes('upload.wikimedia.org')) return { text: TRIANGLE }
      return null
    })
    const result = await findModel('anchor')
    expect(result?.title).toBe('Anchor solid')
  })

  it('skips a hit the prompt box would refuse', async () => {
    stubFetch((url) => {
      if (url.includes('filetype%3A3d')) {
        return { json: pages([
          file('Bad Ass.stl', 1, 'https://upload.wikimedia.org/rude.stl'),
          file('Anchor.stl', 2, 'https://upload.wikimedia.org/anchor.stl'),
        ]) }
      }
      if (url.includes('upload.wikimedia.org')) return { text: TRIANGLE }
      return null
    })
    const result = await findModel('anchor')
    expect(result?.title).toBe('Anchor')
  })

  it('returns nothing when every hit is refused', async () => {
    const calls = stubFetch((url) => {
      if (url.includes('filetype%3A3d')) {
        return { json: pages([file('Pikachu figure.stl', 1, 'https://upload.wikimedia.org/pikachu.stl')]) }
      }
      return null
    })
    expect(await findModel('pikachu')).toBeNull()
    expect(calls.filter((c) => c.includes('upload.wikimedia.org'))).toHaveLength(0)
  })

  it('skips a hit whose raw name is refused, because the credit link is built from it', async () => {
    stubFetch((url) => {
      if (url.includes('filetype%3A3d')) {
        return { json: pages([
          file('Bad Ass.stl', 1, 'https://upload.wikimedia.org/rude.stl'),
          file('Anchor.stl', 2, 'https://upload.wikimedia.org/anchor.stl'),
        ]) }
      }
      if (url.includes('upload.wikimedia.org')) return { text: TRIANGLE }
      return null
    })
    const result = await findModel('anchor')
    expect(result?.title).toBe('Anchor')
  })

  it('keeps a hit the content rules accept', async () => {
    stubFetch((url) => {
      if (url.includes('filetype%3A3d')) {
        return { json: pages([file('Geodesic dome.stl', 1, 'https://upload.wikimedia.org/geodesic.stl')]) }
      }
      if (url.includes('upload.wikimedia.org')) return { text: TRIANGLE }
      return null
    })
    const result = await findModel('geodesic')
    expect(result?.title).toBe('Geodesic dome')
  })
})

describe('findDrawing', () => {
  it('skips a drawing whose title is refused and takes the next one', async () => {
    const calls = stubFetch((url) => {
      if (url.includes('filetype%3Adrawing')) {
        return { json: pages([
          file('Sonic the Hedgehog.svg', 1, 'https://upload.wikimedia.org/sonic.svg', { mime: 'image/svg+xml' } as never),
          file('Anchor.svg', 2, 'https://upload.wikimedia.org/anchor.svg', { mime: 'image/svg+xml' } as never),
        ]) }
      }
      if (url.includes('upload.wikimedia.org')) return { text: SVG }
      return null
    })
    const drawing = await findDrawing('anchor')
    expect(drawing?.title).toBe('Anchor')
    expect(calls.filter((c) => c.includes('upload.wikimedia.org'))).toEqual(['https://upload.wikimedia.org/anchor.svg'])
  })

  it('skips a drawing whose description is refused', async () => {
    stubFetch((url) => {
      if (url.includes('filetype%3Adrawing')) {
        return { json: pages([
          file('Anchor.svg', 1, 'https://upload.wikimedia.org/anchor.svg', { ImageDescription: { value: 'A nsfw drawing.' } }),
          file('Anchor rose.svg', 2, 'https://upload.wikimedia.org/rose.svg'),
        ]) }
      }
      if (url.includes('upload.wikimedia.org')) return { text: SVG }
      return null
    })
    const drawing = await findDrawing('anchor')
    expect(drawing?.title).toBe('Anchor rose')
  })
})
