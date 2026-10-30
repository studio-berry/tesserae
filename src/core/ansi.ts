// The same picture, for a terminal: 24-bit colour, either a glyph a cell or two pixels a cell.
//
// The cells come from the same raster the text renderer uses, so the terminal, the text export and
// the browser are three views of one render rather than three renders. A frame is lines of text with
// escape codes; `diffFrame` writes only the lines that changed, which is what makes 25 frames a
// second cheap enough to stream over a pipe.

import { cellInk, glyphFor, rasterize, type Raster, type SnapshotInput } from './snapshot'

export const HOME = '\x1b[H'
export const RESET = '\x1b[0m'
export const CLEAR = '\x1b[2J'

export type AnsiOptions = {
  cols?: number
  half?: boolean // two pixels a cell: the upper half block with a background
  color?: boolean // 24-bit colour; off gives a grey ramp that survives a 16-colour terminal
}

const byte = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)))
const fg = (r: number, g: number, b: number) => `\x1b[38;2;${byte(r)};${byte(g)};${byte(b)}m`
const bg = (r: number, g: number, b: number) => `\x1b[48;2;${byte(r)};${byte(g)};${byte(b)}m`

// The colour of one sub-cell, falling back to a grey of its ink when the object has no colours
function sub(raster: Raster, gx: number, gy: number, color: boolean): [number, number, number] {
  const k = gy * raster.gw + gx
  const ink = raster.ink[k]
  if (!color) return [ink, ink, ink]
  const rgb = raster.rgb
  if (!rgb) return [ink, ink, ink]
  // the colour is the object's own; the ink still decides how bright the cell reads
  const lift = 0.35 + 0.65 * ink
  return [rgb[k * 3] * lift, rgb[k * 3 + 1] * lift, rgb[k * 3 + 2] * lift]
}

// Half-block rows: the top three sub-rows and the bottom three become one cell's fg and bg
function halfCell(raster: Raster, c: number, row: number, color: boolean): [number[], number[]] {
  const top: number[] = [0, 0, 0], bottom: number[] = [0, 0, 0]
  const half = raster.sy / 2
  for (let y = 0; y < raster.sy; y++) {
    const into = y < half ? top : bottom
    for (let x = 0; x < raster.sx; x++) {
      const rgb = sub(raster, c * raster.sx + x, row * raster.sy + y, color)
      into[0] += rgb[0]; into[1] += rgb[1]; into[2] += rgb[2]
    }
  }
  const n = raster.sx * half
  return [top.map((v) => v / n), bottom.map((v) => v / n)]
}

export function ansiLines(p: SnapshotInput, opts: AnsiOptions = {}): string[] {
  const cols = opts.cols ?? p.cols
  const raster = rasterize({ ...p, cols })
  if (!raster) return []
  const color = opts.color !== false
  const ramp = p.ramp
  const lines: string[] = []
  for (let row = 0; row < raster.rows; row++) {
    let line = ''
    for (let c = 0; c < raster.cols; c++) {
      if (opts.half) {
        const [top, bottom] = halfCell(raster, c, row, color)
        const dark = top[0] + top[1] + top[2] + bottom[0] + bottom[1] + bottom[2] < 0.06
        if (dark) { line += reset(); line += ' '; continue }
        line += color ? fg(top[0], top[1], top[2]) + bg(bottom[0], bottom[1], bottom[2]) + '▀' : glyphFor(cellInk(raster, c, row), ramp)
      } else {
        const ink = cellInk(raster, c, row)
        const glyph = glyphFor(ink, ramp)
        if (glyph === ' ') { line += reset(); line += ' '; continue }
        const rgb = sub(raster, c * raster.sx + Math.floor(raster.sx / 2), row * raster.sy + Math.floor(raster.sy / 2), color)
        line += color ? fg(rgb[0], rgb[1], rgb[2]) + glyph : glyph
      }
    }
    lines.push(line + reset())
  }
  return lines
}

const reset = () => RESET

// One frame, from the top of the screen, without clearing: a caller printing this in place redraws
// the picture rather than appending to the scrollback.
export function ansiFrame(p: SnapshotInput, opts: AnsiOptions = {}): string {
  return HOME + ansiLines(p, opts).map((l, i) => `\x1b[${i + 1};1H${l}`).join('')
}

// Only the lines that differ, each positioned absolutely. A still frame is four bytes: a terminal
// that gets the same picture twice should do no work for it.
export function diffFrame(prev: string[] | null, next: string[]): string {
  if (!prev) return ansiLinesToFrame(next)
  const out: string[] = []
  const rows = Math.max(prev.length, next.length)
  for (let i = 0; i < rows; i++) {
    const line = next[i] ?? ''
    if (prev[i] === line) continue
    out.push(`\x1b[${i + 1};1H${line}\x1b[K`)
  }
  return out.length ? out.join('') : ''
}

const ansiLinesToFrame = (lines: string[]) => lines.map((l, i) => `\x1b[${i + 1};1H${l}\x1b[K`).join('')
