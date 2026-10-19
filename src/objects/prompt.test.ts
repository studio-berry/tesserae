import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mulberry32 } from '../engine/core'
import { REFUSAL } from '../safety'
import { fromPrompt, normalisePrompt } from './prompt'
import { svgObject } from './svg'

type Reply = { json?: unknown; text?: string; buffer?: ArrayBuffer; status?: number }

const stubFetch = (route: (url: string) => Reply | null) => {
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
      arrayBuffer: async () => reply.buffer ?? (new TextEncoder().encode(reply.text ?? '').buffer as ArrayBuffer),
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn as unknown as typeof fetch)
  return calls
}

const page = (name: string, url: string, mime: string, meta: Record<string, { value: string }>) => ({
  query: {
    pages: {
      7: {
        title: `File:${name}`,
        index: 1,
        imageinfo: [{ url, descriptionurl: 'https://commons.wikimedia.org/wiki/File:Thing', size: 900, mime, extmetadata: meta }],
      },
    },
  },
})

const TRIANGLE = `solid t
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid t`

afterEach(() => vi.unstubAllGlobals())

describe('normalisePrompt', () => {
  it('folds case, accents, punctuation and spacing', () => {
    expect(normalisePrompt("  A  Café, DON'T!  ")).toBe('a cafe dont')
  })

  it('returns an empty string when nothing is left', () => {
    expect(normalisePrompt('  ...  ')).toBe('')
  })

  it('caps the prompt at 80 characters', () => {
    expect(normalisePrompt('x'.repeat(120))).toHaveLength(80)
  })
})

describe('fromPrompt', () => {
  it('uses a searched model and keeps its provenance', async () => {
    const calls = stubFetch((url) => {
      if (url.includes('filetype%3A3d')) {
        return { json: page('Tiny_pyramid.stl', 'https://upload.wikimedia.org/thing.stl', 'application/sla', {
          Artist: { value: '<a href="x">Ada</a>' },
          LicenseShortName: { value: 'CC0' },
        }) }
      }
      if (url.includes('upload.wikimedia.org')) return { text: TRIANGLE }
      return null
    })
    const result = await fromPrompt('the tiny pyramid', mulberry32(1))
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('origin=*')
    expect(decodeURIComponent(calls[0])).toContain('tiny+pyramid')
    expect(decodeURIComponent(calls[0])).toContain('filetype:3d')
    expect(result.title).toBe('Tiny pyramid')
    expect(result.detail).toBe('commons · CC0')
    expect(result.flat).toBe(false)
    expect(result.twoSided).toBe(true)
    expect(result.source).toEqual({ author: 'Ada', licence: 'CC0', url: 'https://commons.wikimedia.org/wiki/File:Thing' })
    const mesh = result.object as THREE.Mesh
    expect(mesh.geometry.getAttribute('position').count).toBe(3)
  })

  it('falls from a model search to a drawing and makes it flat', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8"/></svg>'
    const calls = stubFetch((url) => {
      if (url.includes('filetype%3A3d')) return { json: { query: { pages: {} } } }
      if (url.includes('filetype%3Adrawing')) {
        return { json: page('Box.svg', 'https://upload.wikimedia.org/box.svg', 'image/svg+xml', {
          Artist: { value: 'Bo' },
          LicenseShortName: { value: 'CC BY 4.0' },
        }) }
      }
      if (url.includes('upload.wikimedia.org')) return { text: svg }
      return null
    })
    const result = await fromPrompt('box', mulberry32(2))
    expect(calls).toHaveLength(3)
    expect(decodeURIComponent(calls[0])).toContain('filetype:3d')
    expect(decodeURIComponent(calls[1])).toContain('filetype:drawing')
    expect(result.title).toBe('Box')
    expect(result.detail).toBe('flat svg · CC BY 4.0')
    expect(result.flat).toBe(true)
    expect(result.twoSided).toBe(true)
    expect(result.source?.author).toBe('Bo')
    expect((result.object as THREE.Mesh).geometry.getAttribute('position').count).toBeGreaterThan(0)
  })

  it('tries the next file when a model download fails', async () => {
    const file = (name: string, index: number, url: string) => ({
      title: `File:${name}`,
      index,
      imageinfo: [{ url, descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}`, size: 500, mime: 'application/sla', extmetadata: { LicenseShortName: { value: 'CC0' } } }],
    })
    const calls = stubFetch((url) => {
      if (url.includes('filetype%3A3d')) {
        return { json: { query: { pages: {
          1: file('Broken.stl', 1, 'https://upload.wikimedia.org/broken.stl'),
          2: file('Solid.stl', 2, 'https://upload.wikimedia.org/solid.stl'),
        } } } }
      }
      if (url.includes('broken.stl')) return { status: 404 }
      if (url.includes('solid.stl')) return { text: TRIANGLE }
      return null
    })
    const result = await fromPrompt('anvil', mulberry32(5))
    expect(calls).toHaveLength(3)
    expect(result.title).toBe('Solid')
    expect(result.detail).toBe('commons · CC0')
  })

  it('falls through to a built form when the drawing has no fill', async () => {
    stubFetch((url) => {
      if (url.includes('filetype%3A3d')) return { json: { query: { pages: {} } } }
      if (url.includes('filetype%3Adrawing')) {
        return { json: page('Lines.svg', 'https://upload.wikimedia.org/lines.svg', 'image/svg+xml', { LicenseShortName: { value: 'CC0' } }) }
      }
      if (url.includes('upload.wikimedia.org')) return { text: '<svg><path d="M0 0L10 10" fill="none"/></svg>' }
      return null
    })
    const result = await fromPrompt('donut', mulberry32(6))
    expect(result.source).toBeNull()
    expect(result.detail.startsWith('procedural · ')).toBe(true)
  })

  it('builds a procedural object when both searches fail', async () => {
    const calls = stubFetch(() => ({ status: 503 }))
    const result = await fromPrompt('velvet anvil', mulberry32(3))
    expect(calls).toHaveLength(2)
    expect(result.source).toBeNull()
    expect(result.flat).toBe(false)
    expect(result.detail.startsWith('procedural · ')).toBe(true)
    expect(result.object).toBeInstanceOf(THREE.Object3D)
  })

  it('builds a form without asking when the prompt has no searchable words', async () => {
    const calls = stubFetch(() => null)
    const result = await fromPrompt('the of', mulberry32(7))
    expect(calls).toHaveLength(0)
    expect(result.source).toBeNull()
    expect(result.detail.startsWith('procedural · ')).toBe(true)
  })

  it('refuses a blocked prompt before any request', async () => {
    const calls = stubFetch(() => ({ status: 500 }))
    await expect(fromPrompt('ass', mulberry32(4))).rejects.toThrow(REFUSAL)
    expect(calls).toHaveLength(0)
  })
})

describe('svgObject', () => {
  it('turns a filled rect into a flat mesh with y up', () => {
    const mesh = svgObject('<svg viewBox="0 0 10 10"><rect x="1" y="2" width="4" height="6"/></svg>') as THREE.Mesh
    expect(mesh).not.toBeNull()
    mesh.geometry.computeBoundingBox()
    const box = mesh.geometry.boundingBox!
    expect(box.min.x).toBeCloseTo(1)
    expect(box.max.x).toBeCloseTo(5)
    expect(box.min.y).toBeCloseTo(-8)
    expect(box.max.y).toBeCloseTo(-2)
  })

  it('applies group transforms and reads cubic curves', () => {
    const mesh = svgObject('<svg><g transform="translate(5 5) scale(2)"><path d="M0 0 C5 0 5 5 0 5 Z"/></g></svg>') as THREE.Mesh
    expect(mesh).not.toBeNull()
    mesh.geometry.computeBoundingBox()
    expect(mesh.geometry.boundingBox!.min.x).toBeCloseTo(5)
  })

  it('reads compact arc flags', () => {
    const mesh = svgObject('<svg><path d="M0 5a5 5 0 0110 0z"/></svg>') as THREE.Mesh
    expect(mesh).not.toBeNull()
    mesh.geometry.computeBoundingBox()
    const box = mesh.geometry.boundingBox!
    expect(box.max.x - box.min.x).toBeCloseTo(10, 5)
  })

  it('ignores stroke-only paths and definitions', () => {
    expect(svgObject('<svg><path d="M0 0L10 10" fill="none" stroke="#000"/></svg>')).toBeNull()
    expect(svgObject('<svg><path d="M0 0L10 10" style="fill:none"/></svg>')).toBeNull()
    expect(svgObject('<svg><defs><rect width="10" height="10"/></defs></svg>')).toBeNull()
  })

  it('returns null for anything it cannot read', () => {
    expect(svgObject('not an svg at all')).toBeNull()
    expect(svgObject('<svg><path d="M0 0 L"/></svg>')).toBeNull()
  })
})
