import { describe, expect, it } from 'vitest'
import { fromHalf, npy, srgbByte, stripTextures, toHalf } from './objaverse-export-format.ts'

describe('toHalf', () => {
  it('writes the exact values half precision holds', () => {
    expect(toHalf(0)).toBe(0x0000)
    expect(toHalf(-0)).toBe(0x8000)
    expect(toHalf(1)).toBe(0x3c00)
    expect(toHalf(-2)).toBe(0xc000)
    expect(toHalf(0.5)).toBe(0x3800)
    expect(toHalf(65504)).toBe(0x7bff)
    expect(toHalf(2 ** -24)).toBe(0x0001)
  })

  it('saturates past the range and keeps nan a nan', () => {
    expect(toHalf(1e6)).toBe(0x7c00)
    expect(toHalf(-Infinity)).toBe(0xfc00)
    expect(Number.isNaN(fromHalf(toHalf(NaN)))).toBe(true)
    expect(toHalf(1e-9)).toBe(0)
  })

  it('holds a unit-sphere coordinate to within half precision', () => {
    for (let i = 0; i <= 2000; i++) {
      const v = -1 + i / 1000 + 0.000123
      // the step between halves near 1 is 2^-10, so a round trip is within half of it
      expect(Math.abs(fromHalf(toHalf(v)) - v)).toBeLessThanOrEqual(2 ** -11)
    }
  })

  it('rounds a carry into the next exponent', () => {
    // just under 2, past the last half below it, rounds up to 2
    expect(toHalf(1.99995)).toBe(0x4000)
  })
})

describe('npy', () => {
  const read = (bytes: Uint8Array) => {
    const len = new DataView(bytes.buffer).getUint16(8, true)
    return { header: new TextDecoder().decode(bytes.subarray(10, 10 + len)), start: 10 + len }
  }

  it('writes the magic, a dict numpy reads, and data on a 64 byte boundary', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6])
    const bytes = npy('|u1', [2, 3], data)
    expect([...bytes.subarray(0, 8)]).toEqual([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0])
    const { header, start } = read(bytes)
    expect(header).toMatch(/^\{'descr': '\|u1', 'fortran_order': False, 'shape': \(2, 3\), \} *\n$/)
    expect(start % 64).toBe(0)
    expect([...bytes.subarray(start)]).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('writes a one dimensional shape as a python tuple', () => {
    expect(read(npy('<f2', [4], new Uint8Array(8))).header).toContain("'shape': (4,)")
  })

  it('writes an empty shard that still opens', () => {
    const { header } = read(npy('<f2', [0, 4096, 6], new Uint8Array(0)))
    expect(header).toContain("'shape': (0, 4096, 6)")
  })
})

// A minimal GLB: a json chunk and a binary chunk.
const glb = (json: object, bin = new Uint8Array([9, 9, 9, 9])) => {
  let text = JSON.stringify(json)
  text += ' '.repeat((4 - (text.length % 4)) % 4)
  const body = new TextEncoder().encode(text)
  const out = new Uint8Array(12 + 8 + body.length + 8 + bin.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, 0x46546c67, true)
  v.setUint32(4, 2, true)
  v.setUint32(8, out.length, true)
  v.setUint32(12, body.length, true)
  v.setUint32(16, 0x4e4f534a, true)
  out.set(body, 20)
  v.setUint32(20 + body.length, bin.length, true)
  v.setUint32(24 + body.length, 0x004e4942, true)
  out.set(bin, 28 + body.length)
  return out.buffer
}

const jsonOf = (buf: ArrayBuffer) => {
  const v = new DataView(buf)
  const len = v.getUint32(12, true)
  return { json: JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len))), len, total: v.getUint32(8, true) }
}

describe('stripTextures', () => {
  const textured = {
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_texture_transform', 'KHR_materials_emissive_strength', 'EXT_meshopt_compression'],
    extensionsRequired: ['KHR_texture_basisu', 'EXT_meshopt_compression'],
    images: [{ bufferView: 0, mimeType: 'image/png' }],
    samplers: [{}],
    textures: [{ source: 0, sampler: 0 }],
    materials: [
      {
        pbrMetallicRoughness: { baseColorFactor: [0.5, 0.2, 0.1, 1], baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 0 } },
        normalTexture: { index: 0 },
        occlusionTexture: { index: 0 },
        emissiveTexture: { index: 0 },
        extensions: { KHR_materials_emissive_strength: { emissiveStrength: 2 } },
      },
    ],
  }

  it('drops the textures and every reference to them, and keeps the material colour', () => {
    const out = stripTextures(glb(textured))
    expect(out.textured).toBe(true)
    expect(out.draco).toBe(false)
    const { json } = jsonOf(out.glb)
    expect(json.images).toBeUndefined()
    expect(json.textures).toBeUndefined()
    expect(json.samplers).toBeUndefined()
    const m = json.materials[0]
    expect(m.pbrMetallicRoughness).toEqual({ baseColorFactor: [0.5, 0.2, 0.1, 1] })
    expect(m.normalTexture ?? m.occlusionTexture ?? m.emissiveTexture ?? m.extensions).toBeUndefined()
  })

  it('keeps the geometry extensions and drops the texture ones', () => {
    const { json } = jsonOf(stripTextures(glb(textured)).glb)
    expect(json.extensionsUsed).toEqual(['EXT_meshopt_compression'])
    expect(json.extensionsRequired).toEqual(['EXT_meshopt_compression'])
  })

  it('writes a glb whose lengths add up and whose binary chunk is untouched', () => {
    const out = stripTextures(glb(textured))
    const { len, total } = jsonOf(out.glb)
    expect(len % 4).toBe(0)
    expect(total).toBe(out.glb.byteLength)
    const tail = new DataView(out.glb, 20 + len)
    expect(tail.getUint32(0, true)).toBe(4)
    expect(tail.getUint32(4, true)).toBe(0x004e4942)
    expect([...new Uint8Array(out.glb, 28 + len)]).toEqual([9, 9, 9, 9])
  })

  it('says when a model is draco compressed', () => {
    const out = stripTextures(glb({ asset: { version: '2.0' }, extensionsUsed: ['KHR_draco_mesh_compression'] }))
    expect(out.draco).toBe(true)
    expect(out.textured).toBe(false)
  })

  it('refuses a file that is not a glb', () => {
    expect(() => stripTextures(new TextEncoder().encode('{"asset":{}}  ').buffer)).toThrow('not a glb')
  })
})

describe('srgbByte', () => {
  it('maps the ends and keeps dark steps apart', () => {
    expect(srgbByte(0)).toBe(0)
    expect(srgbByte(1)).toBe(255)
    expect(srgbByte(-1)).toBe(0)
    expect(srgbByte(2)).toBe(255)
    // two dark linear values that a straight linear byte would merge into one
    expect(srgbByte(0.001)).not.toBe(srgbByte(0.002))
  })
})
