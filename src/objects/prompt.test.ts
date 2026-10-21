import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { mulberry32 } from '../engine/core'
import { REFUSAL, blockedRun } from '../safety'
import { Hud } from '../ui/Hud'
import { creditText } from './credit'
import { exportText } from '../ui/Export'
import { fromPrompt, normalisePrompt } from './prompt'
import { resultPasses } from '../safety/result'
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
      // the hub sits between the model search and the drawing, and it has no index here
      if (url.includes('objaverse')) return { status: 404 }
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
    expect(calls).toHaveLength(4)
    expect(decodeURIComponent(calls[0])).toContain('filetype:3d')
    expect(calls[1]).toContain('objaverse')
    expect(decodeURIComponent(calls[2])).toContain('filetype:drawing')
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

// The prompt path answers without a key, and that is a promise the docs make. This holds it to the
// promise: a hosted backend, a stored credential or a second host has to fail here before it can
// ship, so the claim in README can be trusted.
describe('the prompt path stays keyless', () => {
  const sources = import.meta.glob('./{prompt,search,svg}.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const source = (file: string) => sources[`./${file}`]

  it('reads no key, no endpoint and no browser storage', () => {
    expect(Object.keys(sources)).toHaveLength(3)
    for (const [path, text] of Object.entries(sources)) {
      const file = path.replace('./', '')
      for (const forbidden of ['localStorage', 'sessionStorage', 'apiKey', 'api_key', 'Authorization', 'import.meta.env', 'fetch(']) {
        if (file === 'search.ts' && forbidden === 'fetch(') continue // search is where the one network call lives
        expect(text, `${file} mentions ${forbidden}`).not.toContain(forbidden)
      }
    }
  })

  it('talks to Wikimedia Commons and to nothing else', () => {
    const hosts = [...source('search.ts').matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1])
    expect(hosts.length).toBeGreaterThan(0)
    expect([...new Set(hosts)].every((h) => h.endsWith('wikimedia.org'))).toBe(true)
  })
})

// The credit of a searched model, and the export that carries it. CC BY and CC BY-SA both ask for
// the author, the licence, a link to the source and a note that the work was changed, so all four
// have to be in the caption and in the export.
describe('the credit of a searched model', () => {
  const RAMP = ".,:;'-~=+*^!/|<>abcdefghijklmnopqrstuvwxyz#%&@$"

  it('gives a prompt result a credited caption and a credited export header', async () => {
    stubFetch((url) => {
      if (url.includes('filetype%3A3d')) {
        return { json: page('Tiny_pyramid.stl', 'https://upload.wikimedia.org/thing.stl', 'application/sla', {
          Artist: { value: 'Ada' },
          LicenseShortName: { value: 'CC BY-SA 4.0' },
        }) }
      }
      if (url.includes('upload.wikimedia.org')) return { text: TRIANGLE }
      return null
    })
    const result = await fromPrompt('the tiny pyramid', mulberry32(1))
    expect(result.source).not.toBeNull()

    // the caption shows the author, the licence, the note and a link to the source
    const html = renderToStaticMarkup(createElement(Hud, {
      shape: {
        key: 'k', kind: 'prompt', title: result.title, detail: result.detail, twoSided: true,
        occluder: null, triangles: 3, across: 1, up: 1, glyphSize: 1, pose: 'spin', flat: false,
        pos: new Float32Array(0), nrm: new Float32Array(0), count: 0, spacing: 1, col: null,
        source: result.source,
      },
      status: '',
      error: '',
    }))
    expect(html).toContain('Ada')
    expect(html).toContain('CC BY-SA 4.0')
    expect(html).toContain('rendered as ASCII')
    expect(html).toContain('href="https://commons.wikimedia.org/wiki/File:Thing"')

    // and the export carries the same credit
    const caption = `${result.title} · letters · 6.0k · letters`
    const out = exportText('@@@', caption, result.source, RAMP)
    expect(out.split('\n')[0]).toContain('Tiny pyramid')
    expect(out.split('\n')[1]).toContain('Ada')
    expect(out.split('\n')[1]).toContain('CC BY-SA 4.0')
    expect(out.split('\n')[1]).toContain('rendered as ASCII')
    expect(out.split('\n')[1]).toContain('https://commons.wikimedia.org/wiki/File:Thing')
  })

  it('names the author, the licence, the note and the source', () => {
    const line = creditText({ author: 'Ada', licence: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Anchor' }, RAMP)
    expect(line).toContain('Ada')
    expect(line).toContain('CC BY-SA 4.0')
    expect(line).toContain('rendered as ASCII')
    expect(line).toContain('https://commons.wikimedia.org/wiki/File:Anchor')
  })

  it('is empty when the shape has no source', () => {
    expect(creditText(null, RAMP)).toBe('')
  })

  it('scans the credit, because the author comes from a third party', () => {
    // A name that really is a blocked word is repaired, because the word would otherwise be
    // shown in the caption.
    const line = creditText({ author: 'ass', licence: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/abc' }, RAMP)
    expect(line).not.toContain('ass ·')
    // the link is still there, because a repaired link points at nothing
    expect(line).toContain('https://sketchfab.com/3d-models/abc')
  })

  it('keeps a name that merely contains a blocked word, because the licence asks for the name', () => {
    // The credit and the title are held to the same rule, the whole-token one. The rule lets a
    // fish called Seabass through, so the credit must show it rather than corrupt it: CC BY asks
    // for the author, and a mangled name is the wrong author.
    for (const author of ['Seabass Studio', 'Compass Collective', 'Classic Models', 'Scunthorpe Museum']) {
      const line = creditText({ author, licence: 'CC BY 4.0', url: 'https://example.org/x' }, RAMP)
      expect(line).toContain(author)
      expect(resultPasses(author)).toBe(true)
    }
  })

  it('goes into the text export under the header', () => {
    const out = exportText('@@@\n###', 'Anchor · letters · 6.0k · letters', { author: 'Ada', licence: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Anchor' }, RAMP)
    const lines = out.split('\n')
    expect(lines[0]).toContain('Anchor')
    expect(lines[1]).toContain('Ada')
    expect(lines[1]).toContain('CC BY-SA 4.0')
    expect(lines[1]).toContain('rendered as ASCII')
    expect(lines[1]).toContain('https://commons.wikimedia.org/wiki/File:Anchor')
  })

  it('leaves the link alone, because a repaired link points at nothing', () => {
    const url = 'https://commons.wikimedia.org/wiki/File:Anchor'
    const out = exportText('@@@', 'Anchor · letters · 6.0k · letters', { author: 'Ada', licence: 'CC BY 4.0', url }, RAMP)
    expect(out).toContain(url)
  })
})

// The header of an export carries the title, and for a prompt that title came from a third party,
// so the header is scanned the same way the art is.
describe('the export header is scanned', () => {
  const RAMP = ".,:;'-~=+*^!/|<>abcdefghijklmnopqrstuvwxyz#%&@$"

  it('keeps a blocked word out of the header', () => {
    const out = exportText('@@@', 'Bad Ass · letters · 6.0k · letters', null, RAMP)
    expect(out.split('\n')[0]).not.toContain('Ass')
    expect(blockedRun(out.split('\n')[0])).toBeNull()
  })

  it('never lets a blocked title reach an export', () => {
    const out = exportText('@@@', 'a pile of shit · letters · 6.0k · letters', null, RAMP)
    expect(blockedRun(out)).toBeNull()
  })

  it('leaves a clean header alone', () => {
    expect(exportText('@@@', 'Anchor · letters · 6.0k · letters', null, RAMP).split('\n')[0])
      .toBe('# gen-ascii · Anchor · letters · 6.0k · letters')
  })

  it('scans the credit words too', () => {
    const out = exportText('@@@', 'Anchor · letters · 6.0k · letters', { author: 'Bad Ass', licence: 'CC BY 4.0', url: 'https://x.test/a' }, RAMP)
    expect(blockedRun(out)).toBeNull()
  })
})
