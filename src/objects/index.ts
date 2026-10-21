import * as THREE from 'three'
import { N, mulberry32 } from '../engine/core'
import { checkTyped } from '../safety'
import { fromPrompt, normalisePrompt, type Provenance } from './prompt'
import { Cloud, Samples, Soup, sampleCloud, sampleSoup } from './sample'
import { frontWeighted, surfaceFrom } from './soup'
import type { Answer, Packed, Threaded } from './worker'

export type { Provenance }

export type Source =
  | { kind: 'library'; id: string }
  | { kind: 'text'; text: string }
  | { kind: 'prompt'; text: string }
  | { kind: 'file'; name: string; object: THREE.Object3D; bytes: number }

// What the stage draws: N evenly spread surface samples plus everything needed to light them
export type Shape = Samples & {
  key: string // source, seed and count, so a re-sample of the same object is a different key
  origin: string // source and seed only, so the stage can tell a re-sample from a new object
  kind: Source['kind']
  title: string
  detail: string
  twoSided: boolean // open surfaces show their inside, so both faces are lit
  occluder: THREE.BufferGeometry | null // the surface itself, drawn into depth only, hides what is behind it
  triangles: number
  // half extents seen by the turntable: across (radius about the vertical axis) and up (with the usual tilt)
  across: number
  up: number
  glyphSize: number // object-space units, identical for every source at one density; the stage scales it with the model
  pose: 'spin' | 'face' // spin: turntable. face: rock toward the viewer
  flat: boolean // 2D sources face the viewer and get no depth
  source: Provenance | null // where a searched model came from
}

// Glyph size depends on density alone, never on the object's own area, so the type does not
// change when the object does. The cell covers the pitch the samples sit at, 4.17/sqrt(count) for
// the tightest library surface, so neighbouring glyphs' ink meets: the atlas measures 0.42 of a
// tile wide and 0.50 high, which leaves a gap at 1.0 and just meets at 2.0.
export const GLYPH_PITCH = 4.17
export const GLYPH_FILL = 2
export const glyphSizeFor = (count: number) => (GLYPH_PITCH * GLYPH_FILL) / Math.sqrt(Math.max(1, count))

// The surface grows with the square of the zoom, so a zoom needs more glyphs rather than bigger
// gaps. Quarter-density steps mean a pinch costs a handful of samples, and `cap` is the fixed
// pool the stage has to draw with.
export const zoomCount = (base: number, zoom: number, cap = N) => {
  const step = Math.max(1, Math.round(base / 4))
  const want = Math.round((base * zoom * zoom) / step) * step
  return Math.min(cap, Math.max(base, want))
}

// how much screen the object needs as it turns: its widest radius about the spin axis, and its
// height under the default tilt
const extents = (pos: Float32Array, n: number) => {
  let across = 0, up = 0
  const c = Math.cos(0.32), s = Math.sin(0.32)
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
    across = Math.max(across, Math.hypot(x, z))
    up = Math.max(up, Math.abs(y * c) + Math.abs(z * s))
  }
  return { across, up }
}

// Least recently used first out, so coming back to an object is free and the stalest surface goes
export const lru = <K, V>(capacity: number, drop: (v: V) => void) => {
  const map = new Map<K, V>()
  return {
    get size() { return map.size },
    get(k: K) {
      const v = map.get(k)
      if (v === undefined) return undefined
      map.delete(k)
      map.set(k, v)
      return v
    },
    set(k: K, v: V) {
      map.delete(k)
      map.set(k, v)
      while (map.size > capacity) {
        const [old, dead] = map.entries().next().value!
        map.delete(old)
        drop(dead)
      }
      return v
    },
  }
}

type Made = Packed & { samples: Samples; source: Provenance | null }
type Prepared = Made & { occluder: THREE.BufferGeometry | null }

// every cache entry is a finished sample set, so switching back to an object costs nothing at all
const cache = lru<string, Prepared>(8, (p) => p.occluder?.dispose())

const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)

export const sourceKey = (s: Source, seed: number) => {
  if (s.kind === 'library') return `lib:${s.id}:${seed}`
  if (s.kind === 'text') return `text:${s.text}`
  if (s.kind === 'prompt') return `prompt:${normalisePrompt(s.text)}:${seed}`
  return `file:${s.object.uuid}`
}

// the surface drawn into the depth buffer only; it shares the soup's array, so it costs nothing
const occluderOf = (pos: Float32Array) => {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2)
  return g
}

const settle = (m: Made): Prepared => {
  const base = { title: m.title, detail: m.detail, twoSided: m.twoSided, flat: m.flat, source: m.source, samples: m.samples }
  if (m.soup) return { ...base, soup: m.soup, cloud: null, occluder: occluderOf(m.soup.pos) }
  if (m.cloud && m.cloud.n > 0) return { ...base, detail: `${m.detail} · point cloud`, twoSided: false, soup: null, cloud: m.cloud, occluder: null }
  throw new Error('That model has no surfaces or points to draw.')
}

// the same thinning the worker does, for the sources it cannot reach: open surfaces get their
// glyphs weighted toward the front, the way type does
const localSample = (soup: Soup | null, cloud: Cloud | null, flat: boolean, count: number, seed: number): Samples => {
  const rng = mulberry32(seed * 7919 + count)
  const s = soup ? (flat ? frontWeighted(soup) : soup) : null
  if (s && s.tris > 0) return sampleSoup(s, count, rng)
  return sampleCloud(cloud ?? { n: 0, pos: new Float32Array(0), nrm: null, col: null }, count, rng)
}

let thread: Worker | null = null
let threaded = typeof window !== 'undefined' && typeof Worker !== 'undefined'
let seq = 0
const waiting = new Map<number, { ok: (p: Packed & { samples: Samples }) => void; bad: (e: Error) => void }>()

const stop = (why: Error) => {
  for (const w of waiting.values()) w.bad(why)
  waiting.clear()
  thread?.terminate()
  thread = null
}

const start = () => {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = ({ data }: MessageEvent<Answer>) => {
    const job = waiting.get(data.id)
    if (!job) return
    waiting.delete(data.id)
    if ('error' in data) job.bad(new Error(data.error))
    else job.ok({ ...data.packed, samples: data.samples })
  }
  w.onerror = () => stop(new Error('The background builder stopped.'))
  return w
}

const ask = (source: Threaded, seed: number, count: number) =>
  new Promise<Packed & { samples: Samples }>((ok, bad) => {
    let w = thread
    if (!w) {
      try { w = thread = start() } catch {
        threaded = false
        bad(new Error('This browser cannot start the background builder.'))
        return
      }
    }
    const id = ++seq
    waiting.set(id, { ok, bad })
    try { w.postMessage({ id, source, seed, count }) } catch (err) { waiting.delete(id); bad(err as Error) }
  })

const offThread = (src: Source): src is Threaded => src.kind === 'library' || src.kind === 'text'

const build = async (src: Source, seed: number, count: number): Promise<Made> => {
  if (offThread(src)) {
    let packed: (Packed & { samples: Samples }) | null = null
    if (threaded) {
      try { packed = await ask(src, seed, count) } catch { /* fall through to the same build here */ }
    }
    if (!packed) {
      const plain = await (await import('./worker')).build(src, seed)
      packed = { ...plain, samples: localSample(plain.soup, plain.cloud, plain.flat, count, seed) }
    }
    return { ...packed, source: null }
  }
  if (src.kind === 'prompt') {
    // the seed is the reroll: a prompt result is cached by prompt and seed, so a new seed asks
    // the hub for the next model of the same prompt rather than the one it had before
    const r = await fromPrompt(src.text, mulberry32(seed * 9973 + 1), seed)
    const { soup, cloud } = surfaceFrom(r.object)
    return { soup, cloud, samples: localSample(soup, cloud, r.flat, count, seed), title: r.title, detail: r.detail, twoSided: !!r.twoSided, flat: r.flat, source: r.source }
  }
  // a model can be open or closed; light both faces and let the occluder sort out visibility
  const { soup, cloud } = surfaceFrom(src.object)
  return { soup, cloud, samples: localSample(soup, cloud, false, count, seed), title: src.name, detail: kb(src.bytes), twoSided: true, flat: false, source: null }
}

const prepareSource = async (src: Source, seed: number, count: number): Promise<Prepared> => {
  const key = `${sourceKey(src, seed)}:${count}`, hit = cache.get(key)
  if (hit) return hit
  return cache.set(key, settle(await build(src, seed, count)))
}

// The one gate a source passes before anything is drawn.
//
// The text box, the prompt box, the two tab buttons, a dropped file and a view arriving on a
// shared url all end up here, and only the two boxes checked on the way in. The url arrived
// already holding its own text, so the effect that checks a keystroke read `clean === text`,
// found them equal and returned without checking, and the tab buttons called setSource
// directly. Holding it here means a path added later cannot miss it.
//
// A refusal is thrown so it takes the same road as any other failure: the message shows and the
// previous object stays on screen. The message never names the word.
const gateSource = (src: Source) => {
  const checked = src.kind === 'library' ? '' : src.kind === 'file' ? src.name : src.text
  if (!checked) return
  const verdict = checkTyped(checked)
  if (!verdict.ok) throw new Error(verdict.reason)
}

export const prepare = async (src: Source, count: number, seed: number): Promise<Shape> => {
  gateSource(src)
  const p = await prepareSource(src, seed, count)
  const s = p.samples
  return {
    ...s,
    key: `${sourceKey(src, seed)}:${count}:${seed}`,
    origin: sourceKey(src, seed),
    kind: src.kind,
    title: p.title,
    detail: p.detail,
    twoSided: p.twoSided,
    occluder: p.occluder,
    triangles: p.soup?.tris ?? 0,
    ...extents(s.pos, s.count),
    glyphSize: glyphSizeFor(count),
    pose: p.flat ? 'face' : 'spin',
    flat: p.flat,
    source: p.source,
  }
}
