import * as THREE from 'three'
import { mulberry32 } from '../engine/core'
import { LIBRARY } from './library'
import { Cloud, Samples, Soup, normalize, sampleCloud, sampleSoup } from './sample'
import { soupFrom } from './soup'
import { textObject } from './text'

export type Source =
  | { kind: 'library'; id: string }
  | { kind: 'text'; text: string }
  | { kind: 'file'; name: string; object: THREE.Object3D; bytes: number }

// What the stage draws: N evenly spread surface samples plus everything needed to light them
export type Shape = Samples & {
  key: string
  kind: Source['kind']
  title: string
  detail: string
  twoSided: boolean // open surfaces show their inside, so both faces are lit
  occluder: THREE.BufferGeometry | null // the surface itself, drawn into depth only, hides what is behind it
  triangles: number
  // half extents seen by the turntable: across (radius about the vertical axis) and up (with the usual tilt)
  across: number
  up: number
}

// how much screen the object needs as it turns: its widest radius about the spin axis, and its
// height under the default tilt
function extents(pos: Float32Array, n: number) {
  let across = 0, up = 0
  const c = Math.cos(0.32), s = Math.sin(0.32)
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
    across = Math.max(across, Math.hypot(x, z))
    up = Math.max(up, Math.abs(y * c) + Math.abs(z * s))
  }
  return { across, up }
}

// Type is read from the front: its faces get the full share of glyphs, the side walls (which
// hold most of the area but are seen edge-on) a quarter, and the back none
function frontWeighted(s: Soup): Soup {
  const weight = new Float32Array(s.tris)
  for (let t = 0; t < s.tris; t++) {
    const nz = (s.nrm[t * 9 + 2] + s.nrm[t * 9 + 5] + s.nrm[t * 9 + 8]) / 3
    weight[t] = nz > 0.7 ? 1 : nz < -0.7 ? 0 : 0.25
  }
  return { ...s, weight }
}

type Prepared = { soup: Soup | null; cloud: Cloud | null; title: string; detail: string; twoSided: boolean; occluder: THREE.BufferGeometry | null }

// parsing and flattening is the slow part; sampling again at another density or seed is cheap
const cache = new Map<string, Prepared>()
const remember = (k: string, p: Prepared) => {
  cache.set(k, p)
  while (cache.size > 8) {
    const [old, v] = cache.entries().next().value!
    v.occluder?.dispose()
    cache.delete(old)
  }
  return p
}

const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)

export const sourceKey = (s: Source, seed: number) =>
  s.kind === 'library' ? `lib:${s.id}:${seed}` : s.kind === 'text' ? `text:${s.text}` : `file:${s.name}:${s.bytes}`

async function prepareSource(src: Source, seed: number): Promise<Prepared> {
  const key = sourceKey(src, seed), hit = cache.get(key)
  if (hit) return hit
  let object: THREE.Object3D, title: string, detail: string, twoSided = false
  if (src.kind === 'library') {
    const item = LIBRARY.find((l) => l.id === src.id) ?? LIBRARY[0]
    const built = item.build(mulberry32(seed * 9973 + 1), seed)
    object = built.object; title = built.title; detail = built.detail; twoSided = !!built.twoSided
  } else if (src.kind === 'text') {
    object = await textObject(src.text)
    title = `“${src.text}”`; detail = 'extruded type'
  } else {
    // a model can be open or closed; light both faces and let the occluder sort out visibility
    object = src.object; title = src.name; detail = kb(src.bytes); twoSided = true
  }
  const { soup, cloud } = soupFrom(object)
  if (soup && soup.tris > 0) {
    normalize(soup.pos)
    const occluder = new THREE.BufferGeometry()
    occluder.setAttribute('position', new THREE.BufferAttribute(soup.pos, 3))
    occluder.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2)
    const sampled = src.kind === 'text' ? frontWeighted(soup) : soup
    return remember(key, { soup: sampled, cloud: null, title, detail, twoSided, occluder })
  }
  if (cloud && cloud.n > 0) {
    normalize(cloud.pos)
    return remember(key, { soup: null, cloud, title, detail: `${detail} · point cloud`, twoSided: false, occluder: null })
  }
  throw new Error('That model has no surfaces or points to draw.')
}

export async function prepare(src: Source, count: number, seed: number): Promise<Shape> {
  const p = await prepareSource(src, seed)
  const rng = mulberry32(seed * 7919 + count)
  const s = p.soup ? sampleSoup(p.soup, count, rng) : sampleCloud(p.cloud!, count, rng)
  return {
    ...s,
    key: `${sourceKey(src, seed)}:${count}:${seed}`,
    kind: src.kind,
    title: p.title,
    detail: p.detail,
    twoSided: p.twoSided,
    occluder: p.occluder,
    triangles: p.soup?.tris ?? 0,
    ...extents(s.pos, s.count),
  }
}
