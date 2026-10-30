import * as THREE from 'three'
import { mulberry32 } from '../engine/core'
import { LIBRARY } from './library'
import { Cloud, Samples, Soup, sampleCloud, sampleSoup } from '../core/sample'
import { surfaceFrom, frontWeighted } from './soup'
import { lockdown, runScene } from './scene.ts'
import { textObject } from './text'

// What the worker can build on its own: no DOM, no dropped files, no network. A written scene is
// code rather than a source, and only the scene worker runs it: no document, no page, locked down,
// and the ask is bounded on the other side.
export type Threaded =
  | { kind: 'library'; id: string }
  | { kind: 'text'; text: string }
  | { kind: 'scene'; code: string; title: string; detail: string }

// The flattened surface. Typed arrays cross the thread boundary, a BufferGeometry and a texture
// sampler cannot, so the occluder and the materials are rebuilt on the side that draws them.
export type Packed = {
  soup: Soup | null
  cloud: Cloud | null
  title: string
  detail: string
  twoSided: boolean
  flat: boolean
}

export type Job = { id: number; source: Threaded; seed: number; count: number }
export type Answer = { id: number; packed: Packed; samples: Samples } | { id: number; error: string }

export const build = async (source: Threaded, seed: number): Promise<Packed> => {
  let object: THREE.Object3D, title: string, detail: string, twoSided = false, flat = false
  if (source.kind === 'library') {
    const item = LIBRARY.find((l) => l.id === source.id) ?? LIBRARY[0]
    const built = item.build(mulberry32(seed * 9973 + 1), seed)
    object = built.object; title = built.title; detail = built.detail; twoSided = !!built.twoSided
  } else if (source.kind === 'scene') {
    // written code runs in the locked-down scene worker or nowhere: not in the builder, not on the page
    if (typeof document !== 'undefined' || typeof self === 'undefined' || self.name !== 'scene') throw new Error('a written scene runs only in the scene worker')
    object = runScene(source.code, seed).object
    title = source.title; detail = source.detail
  } else {
    object = await textObject(source.text)
    title = `“${source.text}”`; detail = 'extruded type'; flat = true
  }
  const { soup, cloud } = surfaceFrom(object)
  return { soup, cloud, title, detail, twoSided, flat }
}

// Thinning the flattened surface into evenly spread samples is the slowest step in the app, so it
// runs here rather than on the thread that has to keep the page responsive. Open surfaces get their
// glyphs weighted toward the front, the way type does, matching index.ts's localSample.
export const sample = (p: Packed, count: number, seed: number): Samples => {
  const rng = mulberry32(seed * 7919 + count)
  const soup = p.soup ? (p.flat ? frontWeighted(p.soup) : p.soup) : null
  if (soup && soup.tris > 0) return sampleSoup(soup, count, rng)
  return sampleCloud(p.cloud ?? { n: 0, pos: new Float32Array(0), nrm: null, col: null }, count, rng)
}

const buffers = (a: Answer) => {
  const out: Transferable[] = []
  const add = (v: Float32Array | Uint16Array | null) => { if (v) out.push(v.buffer as ArrayBuffer) }
  if ('error' in a) return out
  const p = a.packed
  if (p.soup) { add(p.soup.pos); add(p.soup.nrm); add(p.soup.uv); add(p.soup.vcol); add(p.soup.mat); add(p.soup.weight ?? null) }
  if (p.cloud) { add(p.cloud.pos); add(p.cloud.nrm); add(p.cloud.col) }
  add(a.samples.pos); add(a.samples.nrm); add(a.samples.col)
  return out
}

const send = (answer: Answer) => {
  const post = self.postMessage as unknown as (a: Answer, t: Transferable[]) => void
  post(answer, buffers(answer))
}

const run = async ({ data }: MessageEvent<Job>) => {
  try {
    const packed = await build(data.source, data.seed)
    send({ id: data.id, packed, samples: sample(packed, data.count, data.seed) })
  } catch (err) {
    send({ id: data.id, error: (err as Error).message || 'Could not build that object.' })
  }
}

// this module is also the main-thread fallback for the app's own sources; only a copy without a
// document listens for jobs. The copy named "scene" runs written code and nothing else, so it gives
// up the Function constructors and the network before its first job.
if (typeof self !== 'undefined' && typeof document === 'undefined') {
  if (self.name === 'scene') lockdown()
  self.onmessage = run
}
