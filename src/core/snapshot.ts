import * as THREE from 'three'
import { shade } from './lighting'

// Renders the current view as plain text: project the visible dots, crop to the object, splat
// them into a fine depth buffer, then give each character cell the glyph its average ink calls
// for. Pure maths over the dot attributes, so it runs headless in a test.
export type SnapshotInput = {
  pos: Float32Array // N * 3, the positions the dots are settling on
  nrm: Float32Array // N * 3, zero-length for dust
  size: Float32Array
  alpha: Float32Array
  col?: Float32Array | null // N * 3, the dots' own colour, when the palette keeps it
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

// The cells, before they are turned into anything: a fine grid of ink and colour, three sub-cells
// across and six down per character cell. The text renderer averages them to one glyph a cell, the
// ANSI renderer to one glyph or one half block, and both start here so the two cannot disagree.
export type Raster = {
  cols: number
  rows: number
  sx: number // sub-cells across a cell
  sy: number // sub-cells down a cell
  gw: number // sub-cells across the grid
  gh: number
  ink: Float32Array // gw * gh, 0..1
  rgb: Float32Array | null // gw * gh * 3, 0..1
}

export function rasterize(p: SnapshotInput): Raster | null {
  const cols = Math.max(8, p.cols)
  const pos = p.pos, nrm = p.nrm
  const v = new THREE.Vector3(), n = new THREE.Vector3(), view = new THREE.Vector3()
  const dots: { x: number; y: number; z: number; ink: number; r: number; cr: number; cg: number; cb: number }[] = []
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
    const shaded = shade(n, p.light, view, p.alpha[i], p.twoSided)
    if (!shaded) continue
    const ink = shaded.ink
    v.applyMatrix4(p.projection)
    const x = (v.x * 0.5 + 0.5) * p.width, y = (0.5 - v.y * 0.5) * p.height
    const r = (p.size[i] * p.sizeMul * p.modelScale * focal) / z / 2
    const c = p.col
    dots.push({ x, y, z, ink, r, cr: c ? c[i3] : 1, cg: c ? c[i3 + 1] : 1, cb: c ? c[i3 + 2] : 1 })
    x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r)
  }
  if (!dots.length) return null
  // character cells are twice as tall as wide; the columns span the object, not the screen
  const cw = (x1 - x0) / cols, ch = cw * 2, rows = Math.max(1, Math.ceil((y1 - y0) / ch))
  const sx = 3, sy = 6, gw = cols * sx, gh = rows * sy, sub = cw / sx
  const zb = new Float32Array(gw * gh).fill(Infinity), ink = new Float32Array(gw * gh)
  const rgb = p.col ? new Float32Array(gw * gh * 3) : null
  for (const d of dots) {
    const px = (d.x - x0) / sub, py = (d.y - y0) / sub, rad = Math.max(0.6, d.r / sub)
    for (let gy = Math.max(0, Math.floor(py - rad)); gy <= Math.min(gh - 1, Math.ceil(py + rad)); gy++)
      for (let gx = Math.max(0, Math.floor(px - rad)); gx <= Math.min(gw - 1, Math.ceil(px + rad)); gx++) {
        if ((gx + 0.5 - px) ** 2 + (gy + 0.5 - py) ** 2 > rad * rad) continue
        const k = gy * gw + gx
        if (d.z < zb[k]) {
          zb[k] = d.z; ink[k] = d.ink
          if (rgb) { rgb[k * 3] = d.cr; rgb[k * 3 + 1] = d.cg; rgb[k * 3 + 2] = d.cb }
        }
      }
  }
  return { cols, rows, sx, sy, gw, gh, ink, rgb }
}

// A cell's ink: the mean of its sub-cells
export const cellInk = (r: Raster, c: number, row: number) => {
  let sum = 0
  for (let y = 0; y < r.sy; y++) for (let x = 0; x < r.sx; x++) sum += r.ink[(row * r.sy + y) * r.gw + c * r.sx + x]
  return sum / (r.sx * r.sy)
}

export const glyphFor = (ink: number, ramp: readonly string[]) => {
  const r = ramp.length ? ramp : ['#']
  return ink < 0.05 ? ' ' : r[Math.min(r.length - 1, Math.floor(ink ** 0.8 * r.length))]
}

export function snapshotText(p: SnapshotInput) {
  const raster = rasterize(p)
  if (!raster) return ''
  const lines: string[] = []
  for (let row = 0; row < raster.rows; row++) {
    let line = ''
    for (let c = 0; c < raster.cols; c++) line += glyphFor(cellInk(raster, c, row), p.ramp)
    lines.push(line.replace(/\s+$/, ''))
  }
  while (lines.length && !lines[0]) lines.shift()
  while (lines.length && !lines[lines.length - 1]) lines.pop()
  const indent = Math.min(...lines.filter(Boolean).map((l) => l.match(/^ */)![0].length), Infinity)
  return lines.map((l) => l.slice(indent === Infinity ? 0 : indent)).join('\n')
}
