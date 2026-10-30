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

import { Cloud, Samples } from './sample'
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

const unit = (n: Float32Array, i: number) => {
  const l = Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]) || 1
  n[i * 3] /= l; n[i * 3 + 1] /= l; n[i * 3 + 2] /= l
}

// 4,096 points onto a 24,000-dot pool. Each pool dot takes a source point in order and carries a
// fixed offset, so dot i is the same point in every frame and the springs between frames carry the
// motion without a correspondence step. The offset is fixed per dot rather than per frame for the
// same reason: a jitter that re-rolled every frame would jitter every dot, every frame.
export function repeatCloud(cloud: Cloud, count: number, seed: number): Samples {
  const rng = mulberry32(seed)
  const n = Math.max(1, cloud.n)
  const spacing = Math.sqrt((2 * Math.PI * R * R) / Math.max(1, count))
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    // the offset is drawn once from a seeded stream, in dot order, so it is identical across frames
    const jx = (rng() - 0.5) * spacing * 0.7, jy = (rng() - 0.5) * spacing * 0.7, jz = (rng() - 0.5) * spacing * 0.7
    const src = i % n
    pos[i * 3] = cloud.pos[src * 3] + jx
    pos[i * 3 + 1] = cloud.pos[src * 3 + 1] + jy
    pos[i * 3 + 2] = cloud.pos[src * 3 + 2] + jz
    if (cloud.nrm) {
      nrm[i * 3] = cloud.nrm[src * 3]; nrm[i * 3 + 1] = cloud.nrm[src * 3 + 1]; nrm[i * 3 + 2] = cloud.nrm[src * 3 + 2]
    }
  }
  if (cloud.nrm) for (let i = 0; i < count; i++) unit(nrm, i)
  return { count, pos, nrm, col: null, spacing }
}
