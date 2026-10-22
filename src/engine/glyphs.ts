import * as THREE from 'three'

// Character sets. Each is ranked by how much ink its glyphs leave, so a dot's brightness picks
// its character: faint dots read as . , : ; mid ones as letters, bright ones as # % @.
export const CHARSETS = {
  // both cases, digits and brackets, so every tone has a couple of dozen glyphs to pick from and
  // a patch of one brightness never settles on the same few letters
  letters: { name: 'letters', chars: ".,:;'`-~=+*^!/\\|<>()[]{}abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$", jitter: 20 },
  classic: { name: 'classic', chars: '.:-=+*#%@', jitter: 0.9 },
  dense: { name: 'dense', chars: "`.-':_,^=;><+!rc*/z?sLTv)J7(|Fi{C}fI31tlu[neoZ5Yxjya]2ESwqkP6h9d4VpOGbUAKXHm8RD#$Bg0MNWQ%&@", jitter: 6 },
  binary: { name: 'binary', chars: '01', jitter: 1.2 },
  blocks: { name: 'blocks', chars: '·░▒▓█', jitter: 0.6 },
  hex: { name: 'hex', chars: '0123456789ABCDEF', jitter: 1.2 },
  greek: { name: 'greek', chars: 'αβγδεζηθικλμνξοπρστυφχψω', jitter: 1.7 },
  cyrillic: { name: 'cyrillic', chars: 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя', jitter: 2.2 },
  punct: { name: 'punct', chars: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~', jitter: 2.2 },
  slashes: { name: 'slashes', chars: '/\\|-_=+<>', jitter: 0.8 },
  braille: { name: 'braille', chars: '⠁⠃⠇⡇⣇⣧⣷⣿', jitter: 0.5 },
  upper: { name: 'upper', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', jitter: 6 },
  math: { name: 'math', chars: '±×÷∑∏∫√∞≈≠≤≥', jitter: 1.4 },
  arrows: { name: 'arrows', chars: '←↑→↓↖↗↘↙', jitter: 0.9 },
  katakana: { name: 'katakana', chars: 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿ', jitter: 1.9 },
} as const

export type CharsetId = keyof typeof CHARSETS | 'custom'

// The stack is ordered to cover the sets Plex lacks: Segoe UI Symbol on Windows, Apple Symbols on
// macOS and iOS, Noto on Android, and the CJK face for full-width symbols and katakana
export const FONT = '"IBM Plex Mono", "Segoe UI Symbol", "Noto Sans Symbols 2", "Noto Sans Mono CJK JP", "Apple Symbols", "Noto Sans Math", "DejaVu Sans", monospace'
// tile size and the font size drawn into it; the grid effect needs both to scale glyphs to its cells
export const TILE = 64
export const TILE_FONT = 54

// Phones enforce a 4096 px texture limit, so the tiles fold into a square grid rather than one
// row: 91 dense glyphs plus the direction tiles fit in 640 px.
export const MAX_TEXTURE = 4096
export const MAX_TILES = (MAX_TEXTURE / TILE) ** 2

export type Atlas = {
  tex: THREE.CanvasTexture
  count: number
  ranked: string[]
  jitter: number
  cols: number
  rows: number
  tiles: number
  orient: { base: number; count: number }
}

export type GlyphInk = { ch: string; ink: number }

// One square grid with a cell for every tile, never wider or taller than the texture limit
export function atlasGrid(tiles: number) {
  if (Number.isNaN(tiles)) return { cols: 1, rows: 1 }
  const need = Math.max(1, Math.ceil(tiles))
  if (need > MAX_TILES) throw new RangeError(`atlas wants ${need} tiles, the 4096 px limit allows ${MAX_TILES}`)
  const side = Math.ceil(Math.sqrt(need))
  return { cols: side, rows: side }
}

// Least ink first, one tile per character; blank glyphs would make invisible cells
export function rankGlyphs(glyphs: readonly GlyphInk[]): string[] {
  const seen = new Set<string>()
  const kept: GlyphInk[] = []
  for (const g of glyphs) {
    if (g.ink <= 0 || seen.has(g.ch)) continue
    seen.add(g.ch)
    kept.push(g)
  }
  kept.sort((a, b) => a.ink - b.ink)
  return kept.length ? kept.map((g) => g.ch) : ['#']
}

export const ORIENT_COUNT = 8
const TURN = Math.PI / ORIENT_COUNT

// Direction tiles span half a turn; angle 0 is a vertical tangent, each step an eighth of that arc
export function orientIndex(angle: number) {
  if (!Number.isFinite(angle)) return 0
  return ((Math.floor(angle / TURN) % ORIENT_COUNT) + ORIENT_COUNT) % ORIENT_COUNT
}

export function charsFor(id: CharsetId, custom: string) {
  if (id !== 'custom') return CHARSETS[id]
  const uniq = [...new Set([...custom.replace(/\s/g, '')])].slice(0, 96).join('')
  return { name: 'custom', chars: uniq || '#', jitter: Math.min(6, uniq.length * 0.15) }
}

// Grid mode draws fixed rows that cannot be scanned, so its ramp keeps no vowels: words cannot form
export const gridRamp = (chars: string) => chars.replace(/[aeiouy]/gi, '')

// Alpha only: a tile that matches the notdef drawing has no glyph behind it
export const sameTile = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
  if (a.length !== b.length) return false
  for (let i = 3; i < a.length; i += 4) if (a[i] !== b[i]) return false
  return true
}

const arrow = (g: CanvasRenderingContext2D, x: number, y: number, a: number) => {
  const cx = x + TILE / 2, cy = y + TILE / 2
  const dx = Math.cos(a), dy = Math.sin(a)
  const reach = TILE * 0.26, head = TILE * 0.15
  const tipX = cx + dx * reach, tipY = cy + dy * reach
  g.beginPath()
  g.moveTo(cx - dx * reach, cy - dy * reach)
  g.lineTo(tipX, tipY)
  for (const s of [-1, 1]) {
    const back = a + Math.PI + s * 0.5
    g.moveTo(tipX, tipY)
    g.lineTo(tipX + Math.cos(back) * head, tipY + Math.sin(back) * head)
  }
  g.stroke()
}

// Square atlas: ranked glyph tiles first, then the direction arrows in atlas.orient
export function buildAtlas(chars: string, jitter: number): Atlas {
  const T = TILE, font = `500 ${TILE_FONT}px ${FONT}`
  const scratch = document.createElement('canvas')
  scratch.width = scratch.height = T
  const sg = scratch.getContext('2d', { willReadFrequently: true })!
  const draw = (g: CanvasRenderingContext2D, ch: string, x: number, y: number) => {
    g.font = font
    g.fillStyle = '#fff'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(ch, x + T / 2, y + T / 2 + 2)
  }
  const sample = (ch: string) => {
    sg.clearRect(0, 0, T, T)
    draw(sg, ch, 0, 0)
    const d = sg.getImageData(0, 0, T, T).data
    let ink = 0
    for (let i = 3; i < d.length; i += 4) ink += d[i]
    return { ch, ink, d }
  }
  // a noncharacter no font maps draws the same notdef box a missing glyph would, ink and all
  const notdef = sample('\u{10FFFD}')
  const measured = [...new Set(chars)].slice(0, MAX_TILES - ORIENT_COUNT)
    .map(sample)
    .filter((g) => !(notdef.ink > 0 && sameTile(g.d, notdef.d)))
    .map(({ ch, ink }) => ({ ch, ink }))
  const ranked = rankGlyphs(measured)
  const { cols, rows } = atlasGrid(ranked.length + ORIENT_COUNT)
  const base = ranked.length, tiles = base + ORIENT_COUNT

  const cv = document.createElement('canvas')
  cv.width = T * cols
  cv.height = T * rows
  const g = cv.getContext('2d')!
  ranked.forEach((ch, i) => draw(g, ch, (i % cols) * T, Math.floor(i / cols) * T))
  g.strokeStyle = '#fff'
  g.lineWidth = T * 0.09
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (let k = 0; k < ORIENT_COUNT; k++) {
    const i = base + k
    // tile 0 is a vertical tangent; canvas angles start at +x, so shift a quarter turn
    arrow(g, (i % cols) * T, Math.floor(i / cols) * T, Math.PI / 2 - (k + 0.5) * TURN)
  }

  const tex = new THREE.CanvasTexture(cv)
  // glyphs draw at a fraction of their 64 px tile, so without mips a small letter shimmers and
  // loses its thin strokes; the tiles' own padding keeps a neighbour from bleeding in
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  // tileUV counts rows down from the canvas top, which is v=0 only when the upload is not flipped
  tex.flipY = false
  return { tex, count: ranked.length, ranked, jitter, cols, rows, tiles, orient: { base, count: ORIENT_COUNT } }
}
