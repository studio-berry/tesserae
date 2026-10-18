import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { R, mulberry32 } from '../engine/core'
import { dart, mortonOrder, normalize, planeNormal, sampleCloud, sampleSoup } from './sample'
import { soupFrom } from './soup'
import { wrap } from './text'

const sphereSoup = () => {
  const { soup } = soupFrom(new THREE.Mesh(new THREE.SphereGeometry(3, 64, 32), new THREE.MeshBasicMaterial()))
  normalize(soup!.pos)
  return soup!
}

describe('normalize', () => {
  it('centres the points and puts the farthest at radius R', () => {
    const rng = mulberry32(1), pos = Float32Array.from({ length: 300 }, () => rng() * 10 + 5)
    normalize(pos)
    let far = 0, cx = 0
    for (let i = 0; i < pos.length; i += 3) { far = Math.max(far, Math.hypot(pos[i], pos[i + 1], pos[i + 2])); cx += pos[i] }
    expect(far).toBeLessThanOrEqual(R + 1e-5)
    expect(far).toBeGreaterThan(R * 0.8)
    expect(Math.abs(cx / 100)).toBeLessThan(0.5)
  })
})

describe('dart', () => {
  it('keeps no two points closer than r', () => {
    const rng = mulberry32(2), n = 4000, cp = Float32Array.from({ length: n * 3 }, () => (rng() - 0.5) * 2)
    const kept = dart(cp, n, 0.12, n)
    expect(kept.length).toBeGreaterThan(100)
    let min = Infinity
    for (let a = 0; a < kept.length; a++) for (let b = a + 1; b < kept.length; b++) {
      const i = kept[a] * 3, j = kept[b] * 3
      min = Math.min(min, Math.hypot(cp[i] - cp[j], cp[i + 1] - cp[j + 1], cp[i + 2] - cp[j + 2]))
    }
    expect(min).toBeGreaterThanOrEqual(0.12)
  })
})

describe('sampleSoup', () => {
  it('spreads exactly count samples over the surface with outward normals', () => {
    const s = sampleSoup(sphereSoup(), 3000, mulberry32(3))
    expect(s.count).toBe(3000)
    for (let i = 0; i < s.count; i++) {
      const x = s.pos[i * 3], y = s.pos[i * 3 + 1], z = s.pos[i * 3 + 2], r = Math.hypot(x, y, z)
      expect(r).toBeGreaterThan(R * 0.98)
      expect(r).toBeLessThan(R * 1.001)
      expect((x * s.nrm[i * 3] + y * s.nrm[i * 3 + 1] + z * s.nrm[i * 3 + 2]) / r).toBeGreaterThan(0.95)
    }
    // spacing matches the sphere's area shared between the samples
    expect(s.spacing).toBeCloseTo(Math.sqrt((4 * Math.PI * R * R) / 3000), 1)
  })

  it('is deterministic for a seed', () => {
    const a = sampleSoup(sphereSoup(), 500, mulberry32(9)), b = sampleSoup(sphereSoup(), 500, mulberry32(9))
    expect(Array.from(a.pos)).toEqual(Array.from(b.pos))
  })

  it('carries material colours per part', () => {
    const g = new THREE.Group()
    const left = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ff0000' }))
    const right = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#0000ff' }))
    left.position.x = -2; right.position.x = 2
    g.add(left, right)
    const { soup } = soupFrom(g)
    expect(soup!.colored).toBe(true)
    normalize(soup!.pos)
    const s = sampleSoup(soup!, 800, mulberry32(4))
    for (let i = 0; i < s.count; i++) {
      const red = s.col![i * 3] > 0.5
      expect(red).toBe(s.pos[i * 3] < 0)
    }
  })
})

describe('mortonOrder', () => {
  it('returns a permutation', () => {
    const rng = mulberry32(5), n = 1000, pos = Float32Array.from({ length: n * 3 }, () => (rng() - 0.5) * 3)
    expect([...mortonOrder(pos, n)].sort((a, b) => a - b)).toEqual([...Array(n).keys()])
  })
})

describe('point clouds', () => {
  it('fits plane normals', () => {
    // points spread in x and y only: the normal is z
    const n = planeNormal([1, 0, 0, 1, 0, 0.0001])
    expect(Math.abs(n[2])).toBeCloseTo(1, 4)
    // a plane tilted 45 degrees about x
    const t = planeNormal([1, 0, 0, 0.5, 0.5, 0.5])
    expect(Math.abs(t[1] + t[2])).toBeLessThan(1e-4)
  })

  it('estimates outward normals for a scan without them', () => {
    const rng = mulberry32(6), n = 20000, pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const u = rng() * 2 - 1, a = rng() * Math.PI * 2, r = Math.sqrt(1 - u * u)
      pos.set([r * Math.cos(a) * R, u * R, r * Math.sin(a) * R], i * 3)
    }
    const s = sampleCloud({ n, pos, nrm: null, col: null }, 2000, mulberry32(7))
    let good = 0
    for (let i = 0; i < s.count; i++) {
      const d = (s.pos[i * 3] * s.nrm[i * 3] + s.pos[i * 3 + 1] * s.nrm[i * 3 + 1] + s.pos[i * 3 + 2] * s.nrm[i * 3 + 2]) / R
      if (d > 0.9) good++
    }
    expect(good / s.count).toBeGreaterThan(0.97)
  })
})

describe('wrap', () => {
  it('breaks long phrases onto short lines', () => {
    expect(wrap('ascii')).toBe('ascii')
    expect(wrap('render any object as text')).toBe('render any\nobject as\ntext')
  })
})
