// How much ink each glyph leaves, measured once at build time instead of once per page load.
//
// The atlas ranks its glyphs by ink so a dot's brightness picks its character. That ranking used to
// be measured on a canvas every time the page started, which meant the order could differ between
// machines with different font fallbacks and could not be read in a Node test. `npm run glyphs:ink`
// renders every character in `CHARSETS` once, in one browser, and writes the table;
// `glyph-ink.json` is that table, committed.
//
// A character the table does not know (a user's custom ramp) is still measured on the canvas, so a
// custom set works exactly as it did before. Everything built in takes the table.

import table from './glyph-ink.json'

export type InkTable = Record<string, number>

export const inkTable = table as InkTable

export const knownInk = (ch: string): number | undefined => inkTable[ch]
