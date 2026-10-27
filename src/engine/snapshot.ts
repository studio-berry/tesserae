import * as THREE from 'three'
import { clamp01, smooth } from './core'

// Renders the current view as plain text: project the visible dots, crop to the object, splat
// them into a fine depth buffer, then give each character cell the glyph its average ink calls
// for. Pure maths over the dot attributes, so it runs headless in a test.
export type SnapshotInput = {
  pos: Float32Array // N * 3, the positions the dots are settling on
  nrm: Float32Array // N * 3, zero-length for dust
  size: Float32Array
  alpha: Float32Array
  mv: THREE.Matrix4
  projection: THREE.Matrix4
  width: number
  height: number
  twoSided: boolean
  sizeMul: number
  modelScale: number // the stage's zoom * fit, which the shader multiplies into the glyph size
  light: THREE.Vector3
  ramp: readonly string[]
  cols: number
}

export function snapshotText(p: SnapshotInput) {
  const cols = Math.max(8, p.cols)
  const pos = p.pos, nrm = p.nrm
  const v = new THREE.Vector3(), n = new THREE.Vector3(), h = new THREE.Vector3(), view = new THREE.Vector3()
  const dots: { x: number; y: number; z: number; ink: number; r: number }[] = []
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  // the same focal length the shader uses, so a dot covers the cell it covers on screen
  const focal = (p.height * p.projection.elements[5]) / 2
  for (let i = 0; i < p.size.length; i++) {
    const i3 = i * 3
    if (nrm[i3] === 0 && nrm[i3 + 1] === 0 && nrm[i3 + 2] === 0) continue
    v.fromArray(pos, i3).applyMatrix4(p.mv)
    const z = -v.z
    if (z <= 0.1) continue
    n.fromArray(nrm, i3)
    view.copy(v).negate().normalize()
    let facing = n.dot(view)
    if (p.twoSided && facing < 0) { n.negate(); facing = -facing }
    if (!p.twoSided && facing < -0.05) continue
    const lam = Math.max(0, n.dot(p.light)), spec = Math.max(0, n.dot(h.copy(p.light).add(view).normalize())) ** 24
    const graze = 0.5 + 0.5 * smooth(facing / 0.45)
    const ink = clamp01(p.alpha[i] * (0.16 + 0.84 * lam + 0.55 * spec + 0.06 * (1 - clamp01(facing)) ** 3) * graze * 0.72)
    v.applyMatrix4(p.projection)
    const x = (v.x * 0.5 + 0.5) * p.width, y = (0.5 - v.y * 0.5) * p.height
    const r = (p.size[i] * p.sizeMul * p.modelScale * focal) / z / 2
    dots.push({ x, y, z, ink, r })
    x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r)
  }
  if (!dots.length) return ''
  // character cells are twice as tall as wide; the columns span the object, not the screen
  const cw = (x1 - x0) / cols, ch = cw * 2, rows = Math.max(1, Math.ceil((y1 - y0) / ch))
  const SX = 3, SY = 6, gw = cols * SX, gh = rows * SY, sub = cw / SX
  const zb = new Float32Array(gw * gh).fill(Infinity), ib = new Float32Array(gw * gh)
  for (const d of dots) {
    const sx = (d.x - x0) / sub, sy = (d.y - y0) / sub, rad = Math.max(0.6, d.r / sub)
    for (let gy = Math.max(0, Math.floor(sy - rad)); gy <= Math.min(gh - 1, Math.ceil(sy + rad)); gy++)
      for (let gx = Math.max(0, Math.floor(sx - rad)); gx <= Math.min(gw - 1, Math.ceil(sx + rad)); gx++) {
        if ((gx + 0.5 - sx) ** 2 + (gy + 0.5 - sy) ** 2 > rad * rad) continue
        const k = gy * gw + gx
        if (d.z < zb[k]) { zb[k] = d.z; ib[k] = d.ink }
      }
  }
  const ramp = p.ramp.length ? p.ramp : ['#']
  const lines: string[] = []
  for (let r = 0; r < rows; r++) {
    let line = ''
    for (let c = 0; c < cols; c++) {
      let sum = 0
      for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) sum += ib[(r * SY + y) * gw + c * SX + x]
      const ink = sum / (SX * SY)
      line += ink < 0.05 ? ' ' : ramp[Math.min(ramp.length - 1, Math.floor(ink ** 0.8 * ramp.length))]
    }
    lines.push(line.replace(/\s+$/, ''))
  }
  while (lines.length && !lines[0]) lines.shift()
  while (lines.length && !lines[lines.length - 1]) lines.pop()
  const indent = Math.min(...lines.filter(Boolean).map((l) => l.match(/^ */)![0].length), Infinity)
  return lines.map((l) => l.slice(indent === Infinity ? 0 : indent)).join('\n')
}
