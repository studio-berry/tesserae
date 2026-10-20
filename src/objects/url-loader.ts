import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

// A model fetched from a URL has to meet the same ceilings the Commons path holds a download to,
// and it has to arrive through the same decoders the dropped-file path uses.
//
// The ceilings are the app's, not the source's: a model bigger than this would cost the browser
// more than the render is worth, and a model with too many triangles cannot be sampled evenly
// within the glyph budget.
export const MAX_BYTES = 8_000_000
export const MAX_TRIS = 200_000

export type Loaded = { object: THREE.Object3D; name: string; bytes: number }

// The decoders a GLB may need, built once and shared. The Draco decoder fetches its wasm from the
// copy that ships with this version of three, and the meshopt decoder is bundled, so a GLB that
// uses either compression still loads.
let draco: DRACOLoader | null = null

const decoder = () => {
  if (!draco) {
    draco = new DRACOLoader()
      .setDecoderPath(`https://cdn.jsdelivr.net/npm/three@0.${THREE.REVISION}.0/examples/jsm/libs/draco/gltf/`)
  }
  return draco
}

// Fetches a model file with a timeout and a size cap, so a slow or huge source cannot hold the
// page. The size is checked while the body streams, not after it lands, so an oversized file is
// abandoned rather than buffered.
export async function fetchModel(url: string, ms = 20000, maxBytes = MAX_BYTES): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) })
  if (!res.ok) throw new Error(`model ${res.status}`)
  const len = res.headers.get('content-length')
  if (len && Number(len) > maxBytes) throw new Error('model too large')
  if (!res.body) return res.arrayBuffer()
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('model too large')
    }
    parts.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out.buffer
}

// The triangles a model holds, so the ceiling can be checked before it is sampled. A mesh with no
// index has one triangle per three vertices.
export const countTriangles = (root: THREE.Object3D) => {
  let tris = 0
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !m.geometry) return
    const g = m.geometry
    tris += Math.floor((g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3)
  })
  return tris
}

// Parses a GLB, with the Draco and Meshopt decoders attached, and holds it to the app's
// ceilings. A model over them is refused rather than drawn, because sampling it would either
// cost too much or come out uneven.
export async function parseGlb(buf: ArrayBuffer): Promise<THREE.Object3D> {
  const loader = new GLTFLoader()
    .setDRACOLoader(decoder())
    .setMeshoptDecoder(MeshoptDecoder)
  const gltf = await loader.parseAsync(buf, '')
  const tris = countTriangles(gltf.scene)
  if (tris > MAX_TRIS) {
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose?.()
    })
    throw new Error(`too many triangles (${tris})`)
  }
  return gltf.scene
}

// Fetches a model from a URL and parses it. The name is what the caller shows, so it is the
// caller's to pass rather than guessed from the URL.
//
// The hub can reset a connection the first time it is asked for a file, so a failure is tried
// again rather than given up on. The second attempt has its own timeout, so a source that is
// genuinely down costs two short waits rather than one long one.
export async function loadUrl(url: string, name: string, ms = 12000): Promise<Loaded> {
  let buf: ArrayBuffer | null = null
  for (let attempt = 0; attempt < 2 && !buf; attempt++) {
    try {
      buf = await fetchModel(url, ms)
    } catch {
      // the next attempt gets a turn
    }
  }
  if (!buf) throw new Error('the model could not be fetched')
  const object = await parseGlb(buf)
  return { object, name, bytes: buf.byteLength }
}
