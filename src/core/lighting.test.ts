import { describe, expect, it } from 'vitest'
import { KEY, GRAZE, shade, type Vec3 } from './lighting'

const unit = (x: number, y: number, z: number): Vec3 => {
  const l = Math.hypot(x, y, z) || 1
  return { x: x / l, y: y / l, z: z / l }
}
const LIGHT = unit(-0.5, 0.6, 0.62)
const VIEW = unit(0, 0, 1)

describe('shade', () => {
  it('lights a face turned toward the key more than one turned away', () => {
    const toward = shade(unit(-0.3, 0.5, 0.8), LIGHT, VIEW, 1, false)!
    const away = shade(unit(0.6, -0.5, 0.6), LIGHT, VIEW, 1, false)!
    expect(toward.ink).toBeGreaterThan(away.ink)
  })

  it('keeps a silhouette edge rather than fading it to nothing', () => {
    // the graze term halves the ink at the rim instead of zeroing it, so an outline still reads
    const edge = shade(unit(1, 0, 0.05), LIGHT, VIEW, 1, false)!
    const front = shade(unit(-0.3, 0.5, 0.8), LIGHT, VIEW, 1, false)!
    expect(edge.ink).toBeGreaterThan(0.05)
    expect(edge.ink).toBeLessThan(front.ink * 0.5)
  })

  it('draws nothing of a face turned away from a one-sided surface', () => {
    expect(shade(unit(0, 0, -1), LIGHT, VIEW, 1, false)).toBeNull()
  })

  it('turns a face on a two-sided surface so both sides are lit', () => {
    const back = shade(unit(0, 0, -1), LIGHT, VIEW, 1, true)!
    expect(back.facing).toBeCloseTo(1, 6)
    expect(back.ink).toBeGreaterThan(0.1)
  })

  it('scales with alpha and never leaves 0..1', () => {
    const half = shade(unit(-0.3, 0.5, 0.8), LIGHT, VIEW, 0.5, false)!
    const full = shade(unit(-0.3, 0.5, 0.8), LIGHT, VIEW, 1, false)!
    expect(half.ink).toBeCloseTo(full.ink / 2, 6)
    for (const n of [unit(1, 0, 0), unit(0, 1, 0), unit(-1, -1, -1)]) {
      const s = shade(n, LIGHT, VIEW, 1, false)
      if (s) expect(s.ink).toBeGreaterThanOrEqual(0), expect(s.ink).toBeLessThanOrEqual(1)
    }
  })

  it('pins the model the vertex shader carries', () => {
    // the same numbers as SHADER_TWIN: if one moves without the other, the two renders disagree
    expect([KEY, GRAZE]).toEqual([0.84, 0.5])
  })
})
