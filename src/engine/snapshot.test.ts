import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { snapshotText, SnapshotInput } from './snapshot'

const RAMP = ['.', ':', '#']
const IDENT = new THREE.Matrix4()

// a flat sheet of dots five units in front of the camera, all facing it
function sheet(n = 30, facing = 1) {
  const count = n * n
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), size = new Float32Array(count), alpha = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    pos[i * 3] = ((i % n) / (n - 1)) * 3 - 1.5
    pos[i * 3 + 1] = (Math.floor(i / n) / (n - 1)) * 3 - 1.5
    pos[i * 3 + 2] = -5
    nrm[i * 3 + 2] = facing
    size[i] = 0.1
    alpha[i] = 1
  }
  return { pos, nrm, size, alpha }
}

const base = (over: Partial<SnapshotInput> = {}): SnapshotInput => ({
  ...sheet(),
  mv: IDENT,
  projection: new THREE.PerspectiveCamera(40, 1, 0.5, 60).projectionMatrix,
  width: 400,
  height: 400,
  twoSided: false,
  sizeMul: 1,
  light: new THREE.Vector3(0, 0, 1),
  ramp: RAMP,
  cols: 20,
  ...over,
})

describe('snapshotText', () => {
  it('draws only characters from the ramp, in a block the width of the object', () => {
    const lines = snapshotText(base()).split('\n')
    expect(lines.length).toBeGreaterThan(2)
    expect(lines.every((l) => [...l].every((ch) => ch === ' ' || RAMP.includes(ch)))).toBe(true)
    const filled = lines.join('').replace(/ /g, '').length
    expect(filled).toBeGreaterThan(lines.length * 20 * 0.55)
  })

  it('is the same picture for the same dots', () => {
    const a = base(), b = base()
    expect(snapshotText(a)).toBe(snapshotText(b))
  })

  it('leaves a lit surface darker when the light moves behind it', () => {
    const front = snapshotText(base())
    const back = snapshotText(base({ light: new THREE.Vector3(0, 0, -1) }))
    expect(front).toContain('#')
    expect(back).not.toContain('#')
    expect(back).toContain('.')
  })

  it('drops dots that face away unless the surface is open', () => {
    const away = sheet(20, -1)
    expect(snapshotText(base(away))).toBe('')
    expect(snapshotText(base({ ...away, twoSided: true }))).toContain('.')
  })

  it('gives a wider crop more columns, and taller rows with it', () => {
    const wide = snapshotText(base({ cols: 40 })).split('\n')
    const narrow = snapshotText(base({ cols: 10 })).split('\n')
    expect(wide[0].length).toBeGreaterThan(narrow[0].length)
    expect(wide.length).toBeGreaterThan(narrow.length)
  })

  it('returns nothing rather than a blank block when there are no dots', () => {
    expect(snapshotText(base({ ...sheet(0) }))).toBe('')
  })
})
