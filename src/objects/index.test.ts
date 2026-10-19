import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { R, mulberry32 } from '../engine/core'
import { glyphSizeFor, lru, prepare } from './index'
import { LIBRARY } from './library'
import { sampleSoup } from './sample'
import { surfaceFrom } from './soup'
import { build } from './worker'

const COUNT = 400

// one flatten and one sample per built-in, shared by the assertions below
const objects = LIBRARY.map((item) => {
  const built = item.build(mulberry32(1), 0)
  const { soup } = surfaceFrom(built.object)
  return { id: item.id, sample: soup ? sampleSoup(soup, COUNT, mulberry32(2)) : null }
})

describe('library surfaces', () => {
  it('builds a surface for every object', () => {
    expect(objects).toHaveLength(9)
    for (const o of objects) expect(o.sample, o.id).not.toBeNull()
  })

  it('spreads the requested samples over the surface at radius R', () => {
    for (const o of objects) {
      const s = o.sample!
      let far = 0, skew = 0
      for (let i = 0; i < s.count; i++) {
        far = Math.max(far, Math.hypot(s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]))
        skew = Math.max(skew, Math.abs(Math.hypot(s.nrm[i * 3], s.nrm[i * 3 + 1], s.nrm[i * 3 + 2]) - 1))
      }
      expect(s.count, o.id).toBe(COUNT)
      expect(far, o.id).toBeLessThanOrEqual(R * 1.0001)
      expect(skew, o.id).toBeLessThan(1e-4)
      expect(s.spacing, o.id).toBeGreaterThan(0)
    }
  })
})

describe('glyphSizeFor', () => {
  it('sizes the glyph to the tightest surface at that density', () => {
    const tightest = Math.min(...objects.map((o) => o.sample!.spacing))
    expect(glyphSizeFor(COUNT)).toBeGreaterThanOrEqual(tightest * 1.1)
    expect(glyphSizeFor(COUNT)).toBeLessThanOrEqual(tightest * 1.2)
  })

  it('depends on density alone', () => {
    for (const n of [1500, 6000, 12000]) expect(glyphSizeFor(n) * Math.sqrt(n)).toBeCloseTo(4.8, 6)
  })
})

describe('lru', () => {
  it('drops the least recently used entry and disposes it', () => {
    const dropped: string[] = []
    const c = lru<string, string>(3, (v) => dropped.push(v))
    c.set('a', 'A'); c.set('b', 'B'); c.set('c', 'C')
    expect(c.get('a')).toBe('A')
    c.set('d', 'D')
    expect(dropped).toEqual(['B'])
    expect(c.get('b')).toBeUndefined()
    expect(c.get('a')).toBe('A')
    expect(c.size).toBe(3)
  })

  it('keeps a replaced key and stays within capacity', () => {
    const dropped: number[] = []
    const c = lru<string, number>(2, (v) => dropped.push(v))
    c.set('a', 1); c.set('b', 2); c.set('a', 3)
    expect(c.size).toBe(2)
    expect(c.get('a')).toBe(3)
    c.set('c', 4)
    expect(dropped).toEqual([2])
  })
})

describe('worker payload', () => {
  it('carries a library surface through a structured clone', async () => {
    const packed = await build({ kind: 'library', id: 'knot' }, 0)
    const copy = structuredClone(packed)
    expect(copy.title).toBe('Trefoil knot')
    expect(copy.soup?.tris).toBe(packed.soup?.tris)
    expect(copy.soup?.pos.length).toBe(packed.soup?.pos.length)
    expect(copy.soup?.mats.every((m) => m.tex === null)).toBe(true)
  })
})

describe('prepare', () => {
  it('fills the frozen shape fields', async () => {
    const s = await prepare({ kind: 'library', id: 'teapot' }, 120, 0)
    expect(s.kind).toBe('library')
    expect(s.title).toBe('Utah teapot')
    expect(s.pose).toBe('spin')
    expect(s.flat).toBe(false)
    expect(s.source).toBeNull()
    expect(s.glyphSize).toBe(glyphSizeFor(120))
    expect(s.across).toBeGreaterThan(0)
    expect(s.up).toBeGreaterThan(0)
    expect(s.triangles).toBeGreaterThan(0)
    expect(s.occluder).not.toBeNull()
  })

  it('gives every source the same glyph size at one density', async () => {
    const a = await prepare({ kind: 'library', id: 'teapot' }, 120, 0)
    const b = await prepare({ kind: 'library', id: 'donut' }, 120, 0)
    expect(a.glyphSize).toBe(b.glyphSize)
    expect(a.key).not.toBe(b.key)
  })

  it('hands back the same finished work when asked twice', async () => {
    const a = await prepare({ kind: 'library', id: 'teapot' }, 120, 0)
    const b = await prepare({ kind: 'library', id: 'teapot' }, 120, 0)
    expect(b.pos).toBe(a.pos)
    expect(b.occluder).toBe(a.occluder)
  })

  it('keeps a density of its own, since the sample set belongs to it', async () => {
    const a = await prepare({ kind: 'library', id: 'teapot' }, 120, 0)
    const b = await prepare({ kind: 'library', id: 'teapot' }, 60, 0)
    expect(b.count).toBe(60)
    expect(b.pos).not.toEqual(a.pos)
    expect(b.occluder).not.toBe(a.occluder)
  })

  it('takes a dropped model on the main thread', async () => {
    const object = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
    const s = await prepare({ kind: 'file', name: 'box.stl', object, bytes: 2048 }, 80, 0)
    expect(s.title).toBe('box.stl')
    expect(s.detail).toBe('2 KB')
    expect(s.pose).toBe('spin')
    expect(s.source).toBeNull()
    expect(s.count).toBe(80)
  })
})
