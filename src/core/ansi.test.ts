import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ansiFrame, ansiLines, diffFrame, HOME } from './ansi'
import type { SnapshotInput } from './snapshot'

const RAMP = ['.', ':', '#']
const IDENT = new THREE.Matrix4()

// a flat sheet of dots five units in front of the camera, all facing it
function sheet(n = 24): SnapshotInput {
  const count = n * n
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), size = new Float32Array(count), alpha = new Float32Array(count)
  const col = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    pos[i * 3] = ((i % n) / (n - 1)) * 3 - 1.5
    pos[i * 3 + 1] = (Math.floor(i / n) / (n - 1)) * 3 - 1.5
    pos[i * 3 + 2] = -5
    nrm[i * 3 + 2] = 1
    size[i] = 0.2
    alpha[i] = 1
    col[i * 3] = 0.2; col[i * 3 + 1] = 0.6; col[i * 3 + 2] = 0.9
  }
  return {
    pos, nrm, size, alpha, col, mv: IDENT,
    projection: new THREE.PerspectiveCamera(40, 1, 0.5, 60).projectionMatrix,
    width: 300, height: 300, twoSided: false, sizeMul: 1, modelScale: 1,
    light: new THREE.Vector3(-0.5, 0.6, 0.62).normalize(), ramp: RAMP, cols: 24,
  }
}

describe('ansiLines', () => {
  it('draws one line a row with truecolor for every ink it finds', () => {
    const lines = ansiLines(sheet())
    expect(lines.length).toBeGreaterThan(3)
    expect(lines.some((l) => l.includes('\x1b[38;2;'))).toBe(true)
    expect(lines.join('')).toMatch(/[.:#]/)
  })

  it('uses the upper half block and a background in half mode', () => {
    const lines = ansiLines(sheet(), { half: true })
    expect(lines.join('')).toContain('▀')
    expect(lines.join('')).toContain('\x1b[48;2;')
  })

  it('gives a grey ramp rather than colour when colour is off', () => {
    const lines = ansiLines(sheet(), { color: false, half: false })
    expect(lines.join('')).not.toContain('38;2;')
    expect(lines.join('')).toMatch(/[.:#]/)
  })

  it('ends every line with a reset, so a terminal does not keep the last colour', () => {
    for (const line of ansiLines(sheet())) expect(line.endsWith('\x1b[0m')).toBe(true)
  })

  it('draws nothing when there is nothing on screen', () => {
    const empty = sheet()
    empty.pos = new Float32Array(empty.pos.length)
    empty.nrm = new Float32Array(empty.nrm.length)
    expect(ansiLines(empty)).toEqual([])
  })
})

describe('diffFrame', () => {
  const lines = ansiLines(sheet())

  it('writes nothing at all for the same frame', () => {
    expect(diffFrame(lines, lines)).toBe('')
  })

  it('rewrites only the lines that changed', () => {
    const next = [...lines]
    next[2] = '\x1b[38;2;1;2;3m::::\x1b[0m'
    const out = diffFrame(lines, next)
    expect(out).toContain('3;1H')
    expect(out.split(';1H')).toHaveLength(2)
  })

  it('writes the whole frame when there is no previous one', () => {
    const out = diffFrame(null, lines.slice(0, 3))
    expect(out.split(';1H')).toHaveLength(4)
  })
})

describe('ansiFrame', () => {
  it('homes the cursor before the first row', () => {
    expect(ansiFrame(sheet()).startsWith(HOME)).toBe(true)
  })
})
