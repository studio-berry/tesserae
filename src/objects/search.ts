import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { passesContent } from './credit'
import { standUpright } from './orient'
import { tidyName } from './objaverse-index'
import type { PromptResult, Provenance } from './prompt'

// Wikimedia Commons is the only public 3d library with usable provenance and CORS, so both
// searched backends read from the same api.
const API = 'https://commons.wikimedia.org/w/api.php'
const MAX_MODEL = 8_000_000
const MAX_SVG = 1_500_000
const MAX_TRIS = 200_000

export type Hit = {
  name: string
  title: string
  description: string
  url: string
  page: string
  author: string
  licence: string
  bytes: number
}

export type Drawing = {
  svg: string
  title: string
  licence: string
  source: Provenance
}

type Meta = { value?: string }

type Page = {
  title?: string
  index?: number
  imageinfo?: {
    url?: string
    descriptionurl?: string
    size?: number
    mime?: string
    extmetadata?: Record<string, Meta>
  }[]
}

type Api = { query?: { pages?: Record<string, Page> } }

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole
    }
    return NAMED[e.toLowerCase()] ?? whole
  })

const text = (value: string | undefined, cap = 80) =>
  decode((value ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, cap)

// the title cleaner is shared with the objaverse index, so a title reads the same from either
// source
const cleanTitle = tidyName

const scrape = (page: Page): Hit | null => {
  const info = page.imageinfo?.[0]
  if (!info?.url || !page.title) return null
  const meta = info.extmetadata ?? {}
  const name = page.title.replace(/^File:/i, '')
  return {
    name,
    title: cleanTitle(name),
    // the description is read in full: a hit can hide in the second sentence
    description: text(meta.ImageDescription?.value, 300),
    url: info.url,
    page: info.descriptionurl ?? info.url,
    author: text(meta.Artist?.value) || text(meta.Credit?.value) || 'unknown',
    licence: text(meta.LicenseShortName?.value, 40) || text(meta.UsageTerms?.value, 40) || 'unknown',
    bytes: info.size ?? 0,
  }
}

const apiUrl = (query: string, type: '3d' | 'drawing') => {
  const p = new URLSearchParams()
  p.set('action', 'query')
  p.set('format', 'json')
  p.set('origin', '*')
  p.set('generator', 'search')
  p.set('gsrnamespace', '6')
  p.set('gsrlimit', '12')
  p.set('gsrsearch', `${query} ${type === '3d' ? 'filetype:3d' : 'filetype:drawing filemime:image/svg+xml'}`)
  p.set('prop', 'imageinfo')
  p.set('iiprop', 'url|size|mime|extmetadata')
  return `${API}?${p}`
}

async function get(url: string, ms: number) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) })
  if (!res.ok) throw new Error(`commons ${res.status}`)
  return res
}

export async function findFiles(query: string, type: '3d' | 'drawing'): Promise<Hit[]> {
  const res = await get(apiUrl(query, type), 12000)
  const body = (await res.json()) as Api
  const pages = body.query?.pages ?? {}
  return Object.values(pages)
    .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
    .map(scrape)
    .filter((h): h is Hit => !!h)
}

const words = (text: string) => text.split(' ').filter((w) => w.length > 2)

const modelScore = (hit: Hit, keys: string[]) => {
  const name = hit.name.toLowerCase()
  let score = keys.reduce((n, key) => n + (name.includes(key) ? 3 : 0), 0)
  if (hit.bytes > 4_000_000) score--
  if (/full|high.?res|raw|scan/i.test(hit.name)) score -= 2
  return score
}

export async function findModel(query: string): Promise<PromptResult | null> {
  let hits: Hit[]
  try {
    hits = await findFiles(query, '3d')
  } catch {
    return null
  }
  const keys = words(query)
  const ranked = hits
    .filter((h) => /\.stl$/i.test(h.name) && h.bytes > 0 && h.bytes <= MAX_MODEL)
    // a hit whose title or description is refused is dropped before it is tried, so the search
    // moves on to the next one and a refused row never costs a download. The raw name is checked
    // as well, because the link the credit carries is built from it and a title is cut short
    .filter((h) => passesContent(h.title, h.description, h.name))
    .sort((a, b) => modelScore(b, keys) - modelScore(a, keys))
  for (const hit of ranked.slice(0, 3)) {
    try {
      const res = await get(hit.url, 20000)
      const geo = new STLLoader().parse(await res.arrayBuffer())
      const pos = geo.getAttribute('position')
      if (!pos || pos.count < 3 || pos.count / 3 > MAX_TRIS) {
        geo.dispose()
        continue
      }
      geo.computeVertexNormals()
      return {
        // an stl carries no up axis of its own, so whatever the uploader exported is what the
        // stage would draw. The contract says every source stands Y up, and this is the one
        // backend that never looked at the model it was handed.
        object: standUpright(new THREE.Mesh(geo, new THREE.MeshBasicMaterial())),
        title: hit.title,
        detail: `commons · ${hit.licence}`,
        twoSided: true,
        flat: false,
        source: { author: hit.author, licence: hit.licence, url: hit.page },
      }
    } catch {
      // a bad or truncated file should not stop the chain
    }
  }
  return null
}

const drawingScore = (hit: Hit, keys: string[]) => {
  const name = hit.name.toLowerCase()
  let score = keys.reduce((n, key) => n + (name.includes(key) ? 3 : 0), 0)
  if (/icon|pictogram|symbol/.test(name)) score += 3
  if (/diagram|logo|wordmark|map|flag|chart|table|cover|screenshot/.test(name)) score -= 3
  if (hit.bytes < 200_000) score++
  return score
}

export async function findDrawing(query: string): Promise<Drawing | null> {
  let hits: Hit[]
  try {
    hits = await findFiles(query, 'drawing')
  } catch {
    return null
  }
  const keys = words(query)
  const ranked = hits
    .filter((h) => /\.svg$/i.test(h.name) && h.bytes > 0 && h.bytes <= MAX_SVG)
    // the same rule as the model path: a refused row is dropped before it is tried, and the raw
    // name is checked too, because the credit's link is built from it
    .filter((h) => passesContent(h.title, h.description, h.name))
    .sort((a, b) => drawingScore(b, keys) - drawingScore(a, keys))
  for (const hit of ranked.slice(0, 4)) {
    try {
      const res = await get(hit.url, 15000)
      const svg = await res.text()
      if (!svg.trim() || svg.length > 2_000_000) continue
      return {
        svg,
        title: hit.title,
        licence: hit.licence,
        source: { author: hit.author, licence: hit.licence, url: hit.page },
      }
    } catch {
      // try the next drawing
    }
  }
  return null
}
