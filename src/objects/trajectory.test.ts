import { describe, expect, it } from 'vitest'
import { HEADER_BYTES, normalizeSteps, readTraj, repeatCloud, cloudOf } from './trajectory'
import { R } from '../engine/core'

// A trajectory as ml/cloudgen/traj.py writes one
function file(frames: number, points: number, channels = 6, magic = 'GATJ', version = 1): ArrayBuffer {
  const buf = new ArrayBuffer(HEADER_BYTES + frames * points * channels * 4)
  const view = new DataView(buf)
  for (let i = 0; i < 4; i++) view.setUint8(i, magic.charCodeAt(i))
  view.setUint32(4, version, true)
  view.setUint32(8, frames, true)
  view.setUint32(12, points, true)
  view.setUint32(16, channels, true)
  const floats = new Float32Array(buf, HEADER_BYTES)
  for (let i = 0; i < floats.length; i++) floats[i] = i
  return buf
}

describe('readTraj', () => {
  it('reads the header and every frame', () => {
    const traj = readTraj(file(3, 4))
    expect(traj.frames).toBe(3)
    expect(traj.points).toBe(4)
    expect(traj.steps).toHaveLength(3)
    expect(Array.from(traj.steps[1].slice(0, 6))).toEqual([24, 25, 26, 27, 28, 29])
  })

  it('refuses a file that is not one, rather than drawing nonsense', () => {
    expect(() => readTraj(file(3, 4, 6, 'NOPE'))).toThrow(/not a trajectory/)
    expect(() => readTraj(file(3, 4, 6, 'GATJ', 2))).toThrow(/version 2/)
    expect(() => readTraj(file(3, 4, 5))).toThrow(/5 channels/)
    expect(() => readTraj(new ArrayBuffer(8))).toThrow(/too short/)
  })

  it('refuses a file whose header and length disagree', () => {
    const buf = file(3, 4)
    expect(() => readTraj(buf.slice(0, buf.byteLength - 4))).toThrow(/holds/)
  })
})

describe('normalizeSteps', () => {
  const step = (offset: number, n = 8) => {
    const f = new Float32Array(n * 6)
    for (let i = 0; i < n; i++) {
      f[i * 6] = Math.cos(i) * 0.5 + offset
      f[i * 6 + 1] = Math.sin(i) * 0.5
      f[i * 6 + 2] = i * 0.1
      f[i * 6 + 3] = 0; f[i * 6 + 4] = 1; f[i * 6 + 5] = 0
    }
    return f
  }

  it('puts the farthest point of the last frame at radius R and centres every frame', () => {
    const steps = [step(-1), step(0), step(1)]
    normalizeSteps(steps)
    const last = steps[steps.length - 1]
    let far = 0
    for (let i = 0; i < last.length / 6; i++) far = Math.max(far, Math.hypot(last[i * 6], last[i * 6 + 1], last[i * 6 + 2]))
    expect(far).toBeCloseTo(R, 4)
  })

  it('moves every frame by the same box, so the walk is not rescaled frame by frame', () => {
    const steps = [step(0), step(0)]
    const before = (s: Float32Array, i: number) => [s[i * 6], s[i * 6 + 1], s[i * 6 + 2]]
    const gapBefore = before(steps[1], 3)[0] - before(steps[0], 3)[0]
    normalizeSteps(steps)
    const gapAfter = before(steps[1], 3)[0] - before(steps[0], 3)[0]
    expect(gapAfter).toBeCloseTo(gapBefore, 1)
  })

  it('leaves the normals alone', () => {
    const steps = [step(0)]
    normalizeSteps(steps)
    expect(Array.from(steps[0].slice(3, 6))).toEqual([0, 1, 0])
  })
})

describe('repeatCloud', () => {
  const frame = (() => {
    const f = new Float32Array(4 * 6)
    for (let i = 0; i < 4; i++) { f[i * 6] = i; f[i * 6 + 1] = 0; f[i * 6 + 2] = 0; f[i * 6 + 4] = 1 }
    return f
  })()
  const cloud = cloudOf(frame, 4)

  it('fills the pool and keeps each source point in order', () => {
    const s = repeatCloud(cloud, 10, 1)
    expect(s.count).toBe(10)
    expect(s.pos).toHaveLength(30)
    // dot 5 takes source point 1, which sits at x = 1, and carries a jitter of at most the pitch
    expect(Math.abs(s.pos[5 * 3] - 1)).toBeLessThan(s.spacing * 0.5)
  })

  it('gives every pool dot the same offset on every call, so frames do not shake', () => {
    const a = repeatCloud(cloud, 8, 7)
    const b = repeatCloud(cloud, 8, 7)
    expect(Array.from(a.pos)).toEqual(Array.from(b.pos))
  })

  it('writes unit normals', () => {
    const s = repeatCloud(cloud, 6, 1)
    for (let i = 0; i < 6; i++) expect(Math.hypot(s.nrm[i * 3], s.nrm[i * 3 + 1], s.nrm[i * 3 + 2])).toBeCloseTo(1, 5)
  })
})
