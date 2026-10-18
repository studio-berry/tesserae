import * as THREE from 'three'

// Character sets. Each is ranked by how much ink its glyphs leave, so a dot's brightness picks
// its character: faint dots read as . , : ; mid ones as letters, bright ones as # % @.
export const CHARSETS = {
  letters: { name: 'letters', chars: ".,:;'-~=+*^!/|<>abcdefghijklmnopqrstuvwxyz#%&@$", jitter: 7 },
  classic: { name: 'classic', chars: '.:-=+*#%@', jitter: 0.9 },
  dense: { name: 'dense', chars: "`.-':_,^=;><+!rc*/z?sLTv)J7(|Fi{C}fI31tlu[neoZ5Yxjya]2ESwqkP6h9d4VpOGbUAKXHm8RD#$Bg0MNWQ%&@", jitter: 6 },
  binary: { name: 'binary', chars: '01', jitter: 1.2 },
  blocks: { name: 'blocks', chars: '·░▒▓█', jitter: 0.6 },
} as const

export type CharsetId = keyof typeof CHARSETS | 'custom'

export const FONT = '"IBM Plex Mono", ui-monospace, monospace'
// tile size and the font size drawn into it; the grid effect needs both to scale glyphs to its cells
export const TILE = 64
export const TILE_FONT = 54

export type Atlas = { tex: THREE.CanvasTexture; count: number; ranked: string[]; jitter: number }

export function charsFor(id: CharsetId, custom: string) {
  if (id !== 'custom') return CHARSETS[id]
  const uniq = [...new Set([...custom.replace(/\s/g, '')])].join('').slice(0, 96)
  return { name: 'custom', chars: uniq || '#', jitter: Math.min(6, uniq.length * 0.15) }
}

// One row of glyph tiles, sorted from least to most ink
export function buildAtlas(chars: string, jitter: number): Atlas {
  const T = TILE, font = `500 ${TILE_FONT}px ${FONT}`
  const scratch = document.createElement('canvas')
  scratch.width = scratch.height = T
  const sg = scratch.getContext('2d', { willReadFrequently: true })!
  const draw = (g: CanvasRenderingContext2D, ch: string, x: number) => {
    g.font = font; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(ch, x + T / 2, T / 2 + 2)
  }
  const ranked = [...chars].map((ch) => {
    sg.clearRect(0, 0, T, T); draw(sg, ch, 0)
    const d = sg.getImageData(0, 0, T, T).data
    let ink = 0
    for (let i = 3; i < d.length; i += 4) ink += d[i]
    return { ch, ink }
  }).filter((r) => r.ink > 0).sort((a, b) => a.ink - b.ink)
  if (!ranked.length) ranked.push({ ch: '#', ink: 1 })

  const cv = document.createElement('canvas')
  cv.width = T * ranked.length; cv.height = T
  const g = cv.getContext('2d')!
  ranked.forEach((r, i) => draw(g, r.ch, i * T))
  const tex = new THREE.CanvasTexture(cv)
  tex.minFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  return { tex, count: ranked.length, ranked: ranked.map((r) => r.ch), jitter }
}
