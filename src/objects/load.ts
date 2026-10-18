import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { MODEL_EXT } from './formats'

const ext = (name: string) => name.split('.').pop()!.toLowerCase()
const base = (url: string) => decodeURIComponent(url.split(/[\\/]/).pop()!.split('?')[0])

// Waits for every texture the loaders queued through this manager, so colours can be sampled
function tracked(blobs: Map<string, string>) {
  const manager = new THREE.LoadingManager()
  // a .gltf or .obj names its buffers and textures by relative path; serve the dropped files instead
  manager.setURLModifier((url) => blobs.get(base(url)) ?? url)
  let loading = false, wake: (() => void) | null = null
  manager.onStart = () => { loading = true }
  manager.onLoad = () => { loading = false; wake?.() }
  const settled = () => new Promise<void>((res) => {
    if (!loading) return res()
    wake = res
    setTimeout(res, 8000) // never hang on a texture that will not come
  })
  return { manager, settled }
}

export type Loaded = { object: THREE.Object3D; name: string; bytes: number }

// Takes everything the user dropped or picked, finds the model among it, and parses it
export async function loadFiles(files: File[]): Promise<Loaded> {
  const main = MODEL_EXT.map((e) => files.find((f) => ext(f.name) === e)).find(Boolean)
  if (!main) throw new Error(`No model found. Drop a ${MODEL_EXT.join(', ')} file.`)
  const blobs = new Map(files.map((f) => [f.name, URL.createObjectURL(f)] as const))
  const { manager, settled } = tracked(blobs)
  try {
    const buf = await main.arrayBuffer()
    const kind = ext(main.name)
    let object: THREE.Object3D
    if (kind === 'glb' || kind === 'gltf') {
      // the Draco decoder is only fetched for compressed models, from the copy that ships with this three version
      const draco = new DRACOLoader(manager).setDecoderPath(`https://cdn.jsdelivr.net/npm/three@0.${THREE.REVISION}.0/examples/jsm/libs/draco/gltf/`)
      const loader = new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder)
      const gltf = await loader.parseAsync(buf, '')
      draco.dispose()
      object = gltf.scene
    } else if (kind === 'obj') {
      const loader = new OBJLoader(manager)
      const mtl = files.find((f) => ext(f.name) === 'mtl')
      if (mtl) {
        const mats = new MTLLoader(manager).parse(await mtl.text(), '')
        mats.preload()
        loader.setMaterials(mats)
      }
      object = loader.parse(new TextDecoder().decode(buf))
    } else if (kind === 'stl') {
      const g = new STLLoader(manager).parse(buf)
      object = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: !!g.attributes.color }))
    } else if (kind === 'ply') {
      const g = new PLYLoader(manager).parse(buf)
      // scans often arrive as bare vertices, without faces
      object = g.index ? new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: !!g.attributes.color })) : new THREE.Points(g, new THREE.PointsMaterial())
    } else {
      object = new FBXLoader(manager).parse(buf, '')
    }
    await settled()
    return { object, name: main.name, bytes: main.size }
  } finally {
    // textures have been decoded into images by now; the blob URLs are no longer needed
    setTimeout(() => blobs.forEach((u) => URL.revokeObjectURL(u)), 10000)
  }
}
