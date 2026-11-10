// Measure the ink every glyph leaves, once, and write `src/core/glyph-ink.json`.
//
//   npm run glyphs:ink
//
// The atlas needs a ranking from least ink to most, and measuring it in the page meant the ranking
// depended on whichever font the machine happened to fall back to and could not be checked in a
// Node test. This renders each character in `CHARSETS` in one headless browser, at the same tile
// size and font the atlas draws with, and writes the table the app reads.
//
// A character a font cannot draw is stored as 0: the notdef box is not a glyph, and the atlas drops
// anything with no ink.

import { writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { Tab, alive } from '../bench/lib/cdp.ts'
import { CHARSETS, FONT, TILE, TILE_FONT } from '../src/engine/glyphs.ts'

const OUT = 'src/core/glyph-ink.json'
const PORT = Number(process.env.INK_CDP ?? 9334)
const PROFILE = `${process.env.TEMPDIR ?? process.env.LOCALAPPDATA ?? '.'}/Temp/gen-ascii-ink-profile`

const chars = [...new Set(Object.values(CHARSETS).flatMap((c) => [...c.chars]))].sort()

const chrome = spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' })

try {
  if (!(await alive(`http://127.0.0.1:${PORT}/json/version`, 60))) throw new Error('headless Chrome never came up')
  const tab = await Tab.open(PORT)
  await tab.navigate('data:text/html,<html><body></body></html>')

  const ink = await tab.evaluate<Record<string, number>>(`(() => {
    const T = ${TILE}, font = '500 ${TILE_FONT}px ' + ${JSON.stringify(FONT)}
    const cv = document.createElement('canvas')
    cv.width = cv.height = T
    const g = cv.getContext('2d', { willReadFrequently: true })
    const sample = (ch) => {
      g.clearRect(0, 0, T, T)
      g.font = font
      g.fillStyle = '#fff'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(ch, T / 2, T / 2 + 2)
      return g.getImageData(0, 0, T, T).data
    }
    const notdef = sample('\\u{10FFFD}')
    const sameTile = (a) => { for (let i = 3; i < a.length; i += 4) if (a[i] !== notdef[i]) return false; return true }
    const out = {}
    for (const ch of ${JSON.stringify(chars)}) {
      const d = sample(ch)
      // a character this font cannot draw becomes the notdef box: no ink, so the atlas drops it
      if (sameTile(d)) { out[ch] = 0; continue }
      let sum = 0
      for (let i = 3; i < d.length; i += 4) sum += d[i]
      out[ch] = Math.round((sum / (T * T * 255)) * 10000) / 10000
    }
    return out
  })()`)

  const sorted = Object.fromEntries(Object.entries(ink).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  writeFileSync(OUT, JSON.stringify(sorted, null, 0) + '\n')
  const blank = Object.values(sorted).filter((v) => v === 0).length
  console.log(`${Object.keys(sorted).length} glyphs measured, ${blank} had no ink; wrote ${OUT}`)
} finally {
  try { chrome.kill() } catch { /* already gone */ }
  await sleep(200)
}
