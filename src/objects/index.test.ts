import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { N, R, mulberry32 } from '../engine/core'
import { GLYPH_FILL, GLYPH_PITCH, glyphSizeFor, lru, prepare, zoomCount } from './index'
import { LIBRARY } from './library'
import { sampleSoup } from './sample'
import { hasSurface, surfaceFrom } from './soup'
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

describe('hasSurface', () => {
  // settle throws when a model has nothing to draw, and settle runs after the backend chain has
  // returned, where a throw ends the prompt instead of trying the next backend. The backend
  // asks first, so it has to answer the same way the sampler would.
  it('agrees with the sampler about what a model holds', () => {
    const material = new THREE.MeshBasicMaterial()

    const box = new THREE.Group()
    box.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material))
    expect(hasSurface(box)).toBe(true)

    // line geometry has positions, so a naive check says there is something there, but the
    // sampler skips it and nothing would reach the stage
    const lines = new THREE.Group()
    const edge = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)])
    lines.add(new THREE.LineSegments(edge, material))
    expect(hasSurface(lines)).toBe(false)
    expect(surfaceFrom(lines).soup).toBeNull()

    // a point cloud is drawable even without a triangle between its points
    const cloud = new THREE.Group()
    const pts = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1)])
    cloud.add(new THREE.Points(pts, material))
    expect(hasSurface(cloud)).toBe(true)

    // hidden meshes are skipped by the sampler, so they are not a surface either
    const hidden = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
    mesh.visible = false
    hidden.add(mesh)
    expect(hasSurface(hidden)).toBe(false)
    expect(surfaceFrom(hidden).soup).toBeNull()
  })
})

describe('glyphSizeFor', () => {
  it('covers the pitch of the tightest surface, so neighbouring glyphs meet', () => {
    const tightest = Math.min(...objects.map((o) => o.sample!.spacing))
    expect(glyphSizeFor(COUNT)).toBeGreaterThanOrEqual(tightest * 1.9)
    expect(glyphSizeFor(COUNT)).toBeLessThanOrEqual(tightest * 2.1)
  })

  it('depends on density alone', () => {
    for (const n of [1500, 6000, 12000]) expect(glyphSizeFor(n) * Math.sqrt(n)).toBeCloseTo(GLYPH_PITCH * GLYPH_FILL, 6)
  })
})

describe('zoomCount', () => {
  it('returns the base count at 1x', () => {
    expect(zoomCount(6000, 1)).toBe(6000)
  })

  it('caps at the pool the stage draws with', () => {
    expect(zoomCount(6000, 2.6)).toBe(N)
  })

  it('never drops below the base, even zoomed out', () => {
    expect(zoomCount(6000, 0.5)).toBe(6000)
  })

  it('moves in quarter-density steps, so a pinch costs a handful of samples', () => {
    expect(zoomCount(6000, 1.2) % 1500).toBe(0)
  })

  it('rises with the zoom', () => {
    let last = 0
    for (const z of [0.5, 0.8, 1, 1.2, 1.4, 1.8, 2.2, 2.6]) {
      const n = zoomCount(6000, z)
      expect(n).toBeGreaterThanOrEqual(last)
      last = n
    }
    expect(last).toBeGreaterThan(zoomCount(6000, 1))
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

  it('keeps one origin across counts, so the stage can tell a refine from a new object', async () => {
    const a = await prepare({ kind: 'library', id: 'teapot' }, 120, 0)
    const b = await prepare({ kind: 'library', id: 'teapot' }, 240, 0)
    expect(b.origin).toBe(a.origin)
    expect(b.key).not.toBe(a.key)
    expect(b.glyphSize).toBeLessThan(a.glyphSize)
  })

  it('hands back the same arrays at the zoom count, since the cache still holds them', async () => {
    const n = zoomCount(6000, 2.6)
    const a = await prepare({ kind: 'library', id: 'donut' }, n, 0)
    const b = await prepare({ kind: 'library', id: 'donut' }, n, 0)
    expect(a.count).toBe(N)
    expect(b.pos).toBe(a.pos)
    expect(b.origin).toBe(a.origin)
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

  it('refuses a blocked word wherever the source came from', async () => {
    // Two callers checked on the way in and the rest did not. A view arriving on a shared url
    // came with its text already set, so the effect that checks a keystroke read clean === text,
    // found them equal and returned without checking. The tab buttons called setSource
    // directly. A dropped file was never checked at all, while the readme promises that a typed
    // word, a prompt and a dropped file's name are all checked before anything is drawn.
    //
    // All three land here, so all three are refused, and the refusal is the same one the box
    // shows rather than a message naming the word.
    const word = 'fuck'
    await expect(prepare({ kind: 'text', text: word }, 60, 0), 'from the url').rejects.toThrow(
      'That word is blocked. Try another.',
    )
    await expect(prepare({ kind: 'prompt', text: word }, 60, 0), 'from the prompt').rejects.toThrow(
      'That word is blocked. Try another.',
    )
    const object = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
    await expect(
      prepare({ kind: 'file', name: `${word}.stl`, object, bytes: 2048 }, 60, 0),
      'from a dropped file',
    ).rejects.toThrow('That word is blocked. Try another.')
  })

  it('lets a name that merely holds a blocked word through', async () => {
    // The typed rule is the whole-token one, so a place name is never refused for the letters
    // inside it. The gate at the draw boundary has to keep that promise too, or a dropped model
    // called seabass.stl would be refused by a check the prompt box would pass.
    const object = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
    const s = await prepare({ kind: 'file', name: 'seabass.stl', object, bytes: 2048 }, 60, 0)
    expect(s.title).toBe('seabass.stl')
  })
})
