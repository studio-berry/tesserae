#!/usr/bin/env node
// gen-ascii, in a terminal.
//
//   npx gen-ascii teapot               spin a library object in your terminal
//   npx gen-ascii knot --text          one frame, plain text, for a pipe or a file
//   npx gen-ascii "a lighthouse"       the prompt sources, through the app's own code
//
// The renderer is the app's: the same sampler, the same lighting model, the same raster the browser
// snapshot and the text export use. Nothing here is a second drawing of the same idea.

import { writeFileSync } from 'node:fs'
import * as THREE from 'three'
import { LIBRARY } from '../src/objects/library.ts'
import { surfaceFrom } from '../src/objects/soup.ts'
import { sampleSoup } from '../src/core/sample.ts'
import { ansiLines, diffFrame } from '../src/core/ansi.ts'
import type { SnapshotInput } from '../src/core/snapshot.ts'
import { mulberry32 } from '../src/engine/core.ts'

const arg = (name: string, fallback = '') => {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 ? (process.argv[at + 1] ?? 'true') : fallback
}
const flag = (name: string) => process.argv.includes(`--${name}`)

const COLS = Number(arg('cols', '80')) || 80
const COUNT = Number(arg('count', '6000')) || 6000
const SEED = Number(arg('seed', '0')) || 0
const FPS = Math.max(1, Math.min(60, Number(arg('fps', '24')) || 24))
const FRAMES = Number(arg('frames', '0')) || 0
const HALF = flag('half')
const TEXT = flag('text')
const SPIN = !TEXT && !flag('still') && !FRAMES
const ID = (process.argv[2] ?? '').replace(/^--.*/, '')

if (!ID) {
  console.error('usage: gen-ascii <object|prompt> [--text] [--half] [--cols 80] [--count 6000] [--fps 24] [--frames N] [--still]')
  console.error(`objects: ${LIBRARY.map((l) => l.id).join(', ')}`)
  process.exit(1)
}

const item = LIBRARY.find((l) => l.id === ID || l.name === ID)

async function build(): Promise<{ shape: ReturnType<typeof surfaceFrom>; title: string; count: number }> {
  if (item) {
    const built = item.build(mulberry32(SEED * 7919 + 1), SEED)
    const shape = surfaceFrom(built.object)
    return { shape, title: built.title, count: Math.min(COUNT, shape.soup ? 200000 : COUNT) }
  }
  // Anything that is not a library id goes down the app's own prompt path. Those sources reach the
  // network, and a model configuration is a per-machine thing, so the CLI says what it is doing
  // rather than failing silently.
  const { fromPrompt } = await import('../src/objects/prompt.ts')
  const r = await fromPrompt(ID, mulberry32(SEED * 9973 + 1), SEED)
  return { shape: surfaceFrom(r.object), title: r.title, count: COUNT }
}

function cameraFrame(turn: number, tilt = 0.32): THREE.Matrix4 {
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 60)
  camera.position.set(0, 0, 8)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const model = new THREE.Matrix4().makeRotationX(tilt).multiply(new THREE.Matrix4().makeRotationY(turn))
  return new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, model)
}

const LIGHT = new THREE.Vector3(-0.5, 0.6, 0.62).normalize()
const RAMP = [...".,:;'`-~=+*^!/\\|<>()[]{}abcdefghijklmnopqrstuvwxyz#%&@$"]

async function main() {
  const { shape, count } = await build()
  if (!shape.soup && !shape.cloud) throw new Error('that object has nothing to draw')
  const samples = shape.soup
    ? sampleSoup(shape.soup, count, mulberry32(SEED * 31 + count))
    : { count: 0, pos: new Float32Array(0), nrm: new Float32Array(0), col: null, spacing: 0 }
  const n = samples.count

  const input = (turn: number): SnapshotInput => ({
    pos: samples.pos, nrm: samples.nrm, size: new Float32Array(n).fill(0.05),
    alpha: new Float32Array(n).fill(1), col: null,
    mv: cameraFrame(turn), projection: new THREE.PerspectiveCamera(40, 1, 0.5, 60).projectionMatrix,
    width: 640, height: 640, twoSided: false, sizeMul: 2.2, modelScale: 1.6,
    light: LIGHT.clone(), ramp: RAMP, cols: COLS,
  })

  if (TEXT) {
    const { snapshotText } = await import('../src/core/snapshot.ts')
    const frame = snapshotText(input(Number(arg('turn', '0.6')) || 0.6))
    if (arg('out')) { writeFileSync(arg('out'), frame + '\n'); console.log(`wrote ${arg('out')}`) }
    else console.log(frame)
    return
  }

  if (FRAMES) {
    // a fixed sequence of frames, one after another: what a GIF or a .cast is made of
    const lines: string[] = []
    for (let f = 0; f < FRAMES; f++) lines.push(ansiLines(input((f / FRAMES) * Math.PI * 2), { half: HALF, color: true }).join('\n'))
    if (arg('out')) {
      writeFileSync(arg('out'), lines.join('\n\n'))
      console.log(`wrote ${FRAMES} frames to ${arg('out')}`)
    } else process.stdout.write(lines.join('\n\n') + '\n')
    return
  }

  // A spin in the terminal, diffed line by line. Ctrl-C leaves the screen as it found it.
  process.stdout.write('\x1b[?25l\x1b[2J')
  let turn = 0.6
  let prev: string[] | null = null
  let stop = false
  const done = () => {
    stop = true
    process.stdout.write('\x1b[0m\x1b[?25h\x1b[2J\x1b[H')
    process.exit(0)
  }
  process.on('SIGINT', done)
  process.on('SIGTERM', done)
  while (!stop) {
    const started = Date.now()
    const frame = ansiLines(input(turn), { half: HALF, color: true })
    process.stdout.write(diffFrame(prev, frame))
    prev = frame
    turn += 0.06
    const wait = Math.max(0, 1000 / (SPIN ? FPS : 1) - (Date.now() - started))
    await new Promise((r) => setTimeout(r, wait))
    if (!SPIN) break
  }
  process.stdout.write('\x1b[0m\x1b[?25h\n')
  void ansiFrame
  void title
  void spawn
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
