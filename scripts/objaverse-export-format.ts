// The byte formats the training export writes and reads, kept apart from the script that runs
// the export so the tests can reach them without a network.
//
// Three pieces: a float32 to float16 conversion, a .npy writer, and a GLB rewrite that drops the
// textures before three parses the file.

// float32 to float16 bits, rounding to nearest. Half precision holds a unit-sphere coordinate to
// within about 0.0005, which is far finer than the spacing between 4,096 samples on a surface.
const f32 = new Float32Array(1)
const u32 = new Uint32Array(f32.buffer)

export const toHalf = (v: number): number => {
  f32[0] = v
  const x = u32[0]
  const sign = (x >>> 16) & 0x8000
  const raw = (x >>> 23) & 0xff
  let mant = x & 0x7fffff
  if (raw === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0)
  let exp = raw - 127 + 15
  if (exp >= 0x1f) return sign | 0x7c00
  if (exp <= 0) {
    if (exp < -10) return sign
    mant = (mant | 0x800000) >> (1 - exp)
    return sign | ((mant + 0x1000) >> 13)
  }
  mant += 0x1000
  if (mant & 0x800000) {
    mant = 0
    exp++
    if (exp >= 0x1f) return sign | 0x7c00
  }
  return sign | (exp << 10) | (mant >> 13)
}

// float16 bits back to a number, for the tests and for anyone checking a shard by hand.
export const fromHalf = (h: number): number => {
  const sign = h & 0x8000 ? -1 : 1
  const exp = (h >>> 10) & 0x1f
  const mant = h & 0x3ff
  if (exp === 0) return sign * mant * 2 ** -24
  if (exp === 0x1f) return mant ? NaN : sign * Infinity
  return sign * (1 + mant / 1024) * 2 ** (exp - 15)
}

export type NpyType = '<f2' | '|u1'

// A .npy file, version 1.0: the magic, a header that numpy reads as a python dict, padded so the
// data starts on a 64 byte boundary, then the raw little-endian data in C order.
export const npy = (descr: NpyType, shape: number[], data: Uint8Array): Uint8Array => {
  const dims = shape.length === 1 ? `${shape[0]},` : shape.join(', ')
  let header = `{'descr': '${descr}', 'fortran_order': False, 'shape': (${dims}), }`
  const pad = (64 - ((10 + header.length + 1) % 64)) % 64
  header += ' '.repeat(pad) + '\n'
  const out = new Uint8Array(10 + header.length + data.length)
  out.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0])
  new DataView(out.buffer).setUint16(8, header.length, true)
  out.set(new TextEncoder().encode(header), 10)
  out.set(data, 10 + header.length)
  return out
}

// The extensions that only matter to textures and texture-driven materials. Once the textures are
// gone, a file that still requires one of these would be refused by the loader for nothing.
const TEXTURE_EXTENSION = /^(KHR_texture|EXT_texture|MSFT_texture|KHR_materials)/

const MATERIAL_TEXTURES = ['normalTexture', 'occlusionTexture', 'emissiveTexture'] as const
const PBR_TEXTURES = ['baseColorTexture', 'metallicRoughnessTexture'] as const

type GltfJson = {
  images?: unknown[]
  textures?: unknown[]
  samplers?: unknown[]
  materials?: (Record<string, unknown> & { pbrMetallicRoughness?: Record<string, unknown> })[]
  extensionsUsed?: string[]
  extensionsRequired?: string[]
}

export type Stripped = { glb: ArrayBuffer; draco: boolean; textured: boolean }

const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a

// A GLB with its images, textures and samplers removed, and every material reference to them.
//
// Three decodes a texture through the DOM, which a Node export does not have, and an image that
// fails to decode fails the whole file. The export reads geometry, normals, vertex colours and
// material colours, none of which live in a texture, so dropping them loses only the texture
// colour and keeps every model that would otherwise be thrown away for it.
//
// The binary chunk is left as it is: the image bytes stay in the buffer, unreferenced, which
// costs nothing because nothing reads them.
export const stripTextures = (buf: ArrayBuffer): Stripped => {
  const view = new DataView(buf)
  if (buf.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a glb')
  if (view.getUint32(4, true) !== 2) throw new Error('not a version 2 glb')
  const jsonLength = view.getUint32(12, true)
  if (view.getUint32(16, true) !== JSON_CHUNK) throw new Error('the first chunk is not json')
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLength))) as GltfJson

  const used = json.extensionsUsed ?? []
  const draco = used.includes('KHR_draco_mesh_compression')
  const textured = !!json.textures?.length
  delete json.images
  delete json.textures
  delete json.samplers
  for (const m of json.materials ?? []) {
    for (const key of MATERIAL_TEXTURES) delete m[key]
    if (m.pbrMetallicRoughness) for (const key of PBR_TEXTURES) delete m.pbrMetallicRoughness[key]
    delete m.extensions
  }
  if (json.extensionsUsed) json.extensionsUsed = used.filter((e) => !TEXTURE_EXTENSION.test(e))
  if (json.extensionsRequired) json.extensionsRequired = json.extensionsRequired.filter((e) => !TEXTURE_EXTENSION.test(e))

  // the json chunk is padded with spaces to a four byte boundary, as the spec asks
  let text = JSON.stringify(json)
  text += ' '.repeat((4 - (text.length % 4)) % 4)
  const body = new TextEncoder().encode(text)
  const padded = body.length + ((4 - (body.length % 4)) % 4)
  const rest = new Uint8Array(buf, 20 + jsonLength)
  const out = new Uint8Array(20 + padded + rest.length)
  out.fill(0x20, 20, 20 + padded)
  out.set(body, 20)
  out.set(rest, 20 + padded)
  const o = new DataView(out.buffer)
  o.setUint32(0, GLB_MAGIC, true)
  o.setUint32(4, 2, true)
  o.setUint32(8, out.length, true)
  o.setUint32(12, padded, true)
  o.setUint32(16, JSON_CHUNK, true)
  return { glb: out.buffer, draco, textured }
}

// Linear rgb in 0..1 to an sRGB byte, so a dark colour keeps its steps when it is stored in eight
// bits.
export const srgbByte = (c: number) => {
  const v = c <= 0 ? 0 : c >= 1 ? 1 : c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
  return Math.round(v * 255)
}
