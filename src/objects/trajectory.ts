// A sampling trajectory: every frame of a model's walk from noise to shape, which the stage replays
// as the assembly animation. `ml/cloudgen/traj.py` writes the file; this reads it.
//
// The format is a fixed 20-byte header and float32 frames, little endian:
//
//   magic    char[4]   "GATJ"
//   version  uint32    1
//   frames   uint32    steps + 1, the noise included
//   points   uint32    4096
//   channels uint32    6 (x, y, z, nx, ny, nz)
//
// The counts are checked rather than trusted: a reader that guesses at a layout draws the wrong
// thing and looks like a model that failed.

import { Cloud, Samples } from '../core/sample'
import { R, mulberry32 } from '../engine/core'

export const MAGIC = 'GATJ'
export const VERSION = 1
export const CHANNELS = 6
export const HEADER_BYTES = 20

export type Trajectory = { frames: number; points: number; steps: Float32Array[] }

export function readTraj(buffer: ArrayBuffer): Trajectory {
  if (buffer.byteLength < HEADER_BYTES) throw new Error('that trajectory file is too short to be one')
  const view = new DataView(buffer)
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
  if (magic !== MAGIC) throw new Error('that file is not a trajectory')
  const version = view.getUint32(4, true)
  if (version !== VERSION) throw new Error(`that trajectory is version ${version}; this reader knows ${VERSION}`)
  const frames = view.getUint32(8, true)
  const points = view.getUint32(12, true)
  const channels = view.getUint32(16, true)
  if (channels !== CHANNELS) throw new Error(`that trajectory has ${channels} channels; this reader wants ${CHANNELS}`)
  const need = frames * points * channels
  if (buffer.byteLength - HEADER_BYTES !== need * 4) {
    throw new Error(`that trajectory says ${frames}x${points}x${channels} and holds ${(buffer.byteLength - HEADER_BYTES) / 4} floats`)
  }
  const all = new Float32Array(buffer, HEADER_BYTES, need)
  const steps: Float32Array[] = []
  for (let f = 0; f < frames; f++) steps.push(all.subarray(f * points * channels, (f + 1) * points * channels))
  return { frames, points, steps }
}

export async function fetchTraj(url: string): Promise<Trajectory> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`could not fetch ${url}`)
  return readTraj(await res.arrayBuffer())
}

// The same rule the sampler applies to every other source: centred on the bounding box and scaled so
// the farthest point sits at radius R. The last frame decides the box for every frame, and only the
// positions move: a per-frame scale would make the object breathe as it assembles.
export function normalizeSteps(steps: Float32Array[]): void {
  const last = steps[steps.length - 1]
  const points = last.length / CHANNELS
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
  for (let i = 0; i < points; i++) {
    const x = last[i * CHANNELS], y = last[i * CHANNELS + 1], z = last[i * CHANNELS + 2]
    if (x < x0) x0 = x; if (x > x1) x1 = x
    if (y < y0) y0 = y; if (y > y1) y1 = y
    if (z < z0) z0 = z; if (z > z1) z1 = z
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2
  let far = 0
  for (let i = 0; i < points; i++) {
    far = Math.max(far, (last[i * CHANNELS] - cx) ** 2 + (last[i * CHANNELS + 1] - cy) ** 2 + (last[i * CHANNELS + 2] - cz) ** 2)
  }
  const s = far > 0 ? R / Math.sqrt(far) : 1
  for (const step of steps) {
    for (let i = 0; i < points; i++) {
      step[i * CHANNELS] = (step[i * CHANNELS] - cx) * s
      step[i * CHANNELS + 1] = (step[i * CHANNELS + 1] - cy) * s
      step[i * CHANNELS + 2] = (step[i * CHANNELS + 2] - cz) * s
    }
  }
}

// One frame as the sampler's own cloud, before any thinning
export const cloudOf = (step: Float32Array, points: number): Cloud => {
  const pos = new Float32Array(points * 3), nrm = new Float32Array(points * 3)
  for (let i = 0; i < points; i++) {
    pos[i * 3] = step[i * CHANNELS]; pos[i * 3 + 1] = step[i * CHANNELS + 1]; pos[i * 3 + 2] = step[i * CHANNELS + 2]
    nrm[i * 3] = step[i * CHANNELS + 3]; nrm[i * 3 + 1] = step[i * CHANNELS + 4]; nrm[i * 3 + 2] = step[i * CHANNELS + 5]
  }
  return { n: points, pos, nrm, col: null }
}

// 4,096 points onto a 24,000-dot pool. Dot i takes source point i % points and carries a fixed
// offset drawn once from a seeded stream, in dot order. Fixed per dot rather than per frame, because
// a jitter that re-rolled would shake every dot on every commit: the walk would boil, not move.
export type PoolMap = { count: number; points: number; jitter: Float32Array }

export function poolMap(count: number, points: number, spread: number, seed: number): PoolMap {
  const rng = mulberry32(seed), jitter = new Float32Array(count * 3)
  for (let i = 0; i < count * 3; i++) jitter[i] = (rng() - 0.5) * spread
  return { count, points: Math.max(1, points), jitter }
}

// One frame into the pool's arrays. `frame` is the file's interleaved xyz + unit normal per point,
// so this is the only place that knows the two layouts are different.
export function mapFrame(frame: Float32Array, map: PoolMap, pos: Float32Array, nrm: Float32Array): void {
  for (let i = 0; i < map.count; i++) {
    const src = (i % map.points) * CHANNELS, i3 = i * 3
    pos[i3] = frame[src] + map.jitter[i3]
    pos[i3 + 1] = frame[src + 1] + map.jitter[i3 + 1]
    pos[i3 + 2] = frame[src + 2] + map.jitter[i3 + 2]
    const l = Math.hypot(frame[src + 3], frame[src + 4], frame[src + 5]) || 1
    nrm[i3] = frame[src + 3] / l
    nrm[i3 + 1] = frame[src + 4] / l
    nrm[i3 + 2] = frame[src + 5] / l
  }
}

// The pool for a static cloud. A cloud is the same shape of data as a frame with one point per dot,
// so it goes through the same mapping rather than a second copy of it.
export function repeatCloud(cloud: Cloud, count: number, seed: number, spread?: number): Samples {
  const spacing = Math.sqrt((2 * Math.PI * R * R) / Math.max(1, count))
  const points = Math.max(1, cloud.n)
  const map = poolMap(count, points, spread ?? spacing * 0.7, seed)
  const frame = new Float32Array(points * CHANNELS)
  for (let i = 0; i < points; i++) {
    frame[i * CHANNELS] = cloud.pos[i * 3]
    frame[i * CHANNELS + 1] = cloud.pos[i * 3 + 1]
    frame[i * CHANNELS + 2] = cloud.pos[i * 3 + 2]
    if (cloud.nrm) {
      frame[i * CHANNELS + 3] = cloud.nrm[i * 3]
      frame[i * CHANNELS + 4] = cloud.nrm[i * 3 + 1]
      frame[i * CHANNELS + 5] = cloud.nrm[i * 3 + 2]
    }
  }
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3)
  mapFrame(frame, map, pos, nrm)
  return { count, pos, nrm, col: null, spacing }
}
