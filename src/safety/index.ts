import { BLOCKED, type Kind } from './words'

export type { Kind } from './words'

// The only sentence a refusal ever shows. The matched word stays inside this module.
export const REFUSAL = 'That word is blocked. Try another.'

const MARKS = /\p{M}+/gu
const ALNUM = /[a-z0-9]/
const DIGIT = /[0-9]/

// Letters that read as another one, mostly cyrillic and greek. Case and accents fold first, so
// one lowercase entry covers every spelling of the same shape.
const LOOKALIKE: Record<string, string> = {
  '\u0430': 'a', '\u0435': 'e', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0443': 'y',
  '\u0445': 'x', '\u0456': 'i', '\u0455': 's', '\u0501': 'd', '\u04bb': 'h', '\u0458': 'j',
  '\u04cf': 'l', '\u051b': 'q', '\u051d': 'w', '\u0261': 'g', '\u028f': 'y', '\u0131': 'i',
  '\u0251': 'a', '\u0277': 'w', '\u029f': 'l', '\u03f2': 'c', '\u00df': 'ss',
  '\u03b1': 'a', '\u03b5': 'e', '\u03b9': 'i', '\u03ba': 'k', '\u03bd': 'v', '\u03bf': 'o',
  '\u03c1': 'p', '\u03c4': 't', '\u03c5': 'u', '\u03c7': 'x',
}

// Digits and symbols standing in for letters. A digit always counts; a symbol only when it sits
// inside a word, so 'sh!t' reads but a trailing 'ass!' stays a word and a sentence keeps its mark.
const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '2': 'z', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '8': 'b',
  '9': 'g', '@': 'a', $: 's', '!': 'i', '|': 'l', '+': 't', '\u20ac': 'e', '\u00a3': 'l',
}

type Unit = { ch: string; at: number; to: number }

// Folded text plus, for each letter of it, the source slice it came from. The two forms are the
// one kept for reading (separators as single spaces) and the one squeezed for matching, where a
// word broken by dots or spaces still reads as one run.
type Probe = { wide: string; narrow: string; at: number[]; to: number[] }

function probe(text: string): Probe {
  const units: Unit[] = []
  for (let i = 0; i < text.length;) {
    const glyph = String.fromCodePoint(text.codePointAt(i)!)
    const start = i
    i += glyph.length
    const plain = glyph.normalize('NFKD').replace(MARKS, '').toLowerCase()
    for (const c of plain) for (const ch of LOOKALIKE[c] ?? c) units.push({ ch, at: start, to: i })
  }
  for (let k = 0; k < units.length; k++) {
    const u = units[k], sub = LEET[u.ch]
    if (!sub) continue
    const word = (x?: Unit) => !!x && ALNUM.test(x.ch)
    if (!DIGIT.test(u.ch) && !(word(units[k - 1]) && word(units[k + 1]))) continue
    u.ch = sub
  }
  const wide: string[] = [], narrow: string[] = [], at: number[] = [], to: number[] = []
  let last = '', run = 0
  for (const u of units) {
    if (!ALNUM.test(u.ch)) {
      if (wide.length && wide[wide.length - 1] !== ' ') wide.push(' ')
      last = ''
      continue
    }
    if (u.ch === last) {
      run++
      // three of a letter is padding; two can be real spelling, as in 'ass'
      if (run === 3) { wide.pop(); narrow.pop(); at.pop(); to.pop() }
      if (run >= 3) continue
    } else {
      last = u.ch
      run = 1
    }
    wide.push(u.ch)
    narrow.push(u.ch)
    at.push(u.at)
    to.push(u.to)
  }
  return { wide: wide.join('').trim(), narrow: narrow.join(''), at, to }
}

// case, accents, leetspeak, homoglyphs, repeats, separators
export const normalise = (s: string) => probe(s).wide

// The list is folded once so a scan does no folding of its own
const LIST = BLOCKED.map((e) => ({ word: normalise(e.word), kind: e.kind }))
const KIND = new Map(LIST.map((e) => [e.word, e.kind]))

// letters only count as one word within a line: a run cut by a line break reads as two runs, and
// the whole repair path works a line at a time
const find = (text: string, p: Probe, word: string) => {
  for (let i = p.narrow.indexOf(word); i >= 0; i = p.narrow.indexOf(word, i + 1)) {
    if (!/[\n\r]/.test(text.slice(p.at[i], p.to[i + word.length - 1]))) return i
  }
  return -1
}

export function blockedToken(text: string): Kind | null {
  for (const token of normalise(text).split(' ')) {
    const kind = KIND.get(token)
    if (kind) return kind
  }
  return null
}

// exports are read as a grid of letters, so a hit counts wherever it starts and even when the
// letters are held apart by the drawing itself
export function blockedRun(text: string): Kind | null {
  const p = probe(text)
  for (const e of LIST) if (find(text, p, e.word) >= 0) return e.kind
  return null
}

export type Verdict = { ok: true } | { ok: false; reason: string }

// A word typed out with its letters held apart is still typed on purpose, while a word that merely
// contains a shorter one (Scunthorpe) is not. So a run-scan hit counts as typed input only when the
// matched letters straddle a separator in what was actually written.
const straddles = (text: string, p: Probe, i: number, len: number) =>
  /[^\p{L}\p{N}]/u.test(text.slice(p.at[i], p.to[i + len - 1]))

// A word typed twice in a row is a stutter, not a longer word
const doubled = (token: string) => {
  const half = token.slice(0, token.length >> 1)
  return token.length % 2 === 0 && half === token.slice(token.length >> 1) && KIND.has(half)
}

export function blockedTyped(text: string): Kind | null {
  const kind = blockedToken(text)
  if (kind) return kind
  for (const token of normalise(text).split(' ')) if (doubled(token)) return KIND.get(token.slice(0, token.length >> 1))!
  const p = probe(text)
  for (const e of LIST) {
    const i = find(text, p, e.word)
    if (i >= 0 && straddles(text, p, i, e.word.length)) return e.kind
  }
  return null
}

export const checkTyped = (text: string): Verdict =>
  blockedTyped(text) ? { ok: false, reason: REFUSAL } : { ok: true }

type Hit = { i: number; len: number; at: number[]; to: number[] }

const firstHit = (text: string): Hit | null => {
  const p = probe(text)
  let best: Hit | null = null
  for (const e of LIST) {
    const i = find(text, p, e.word)
    if (i < 0) continue
    // earliest wins, so a swap lands where a reader's eye is
    if (!best || i < best.i || (i === best.i && e.word.length > best.len)) best = { i, len: e.word.length, at: p.at, to: p.to }
  }
  return best
}

// the glyph next door in the ink order: the row keeps its weight, the word stops reading
const nudge = (glyph: string, ramp: string) => {
  const glyphs = [...ramp].filter((g) => g.trim())
  const n = glyphs.length
  if (!n) return ' ' // an empty ramp cannot offer a neighbour, and a gap still breaks the word
  const same = (g: string) => g.toLowerCase() === glyph.toLowerCase()
  const at = glyphs.findIndex(same)
  // a ramp of blocks has no letter to step from; the middle weight is the nearest guess
  if (at < 0) return glyphs[n >> 1]
  // walk outwards until a different glyph turns up: a ramp that repeats a glyph cannot dead-end
  for (let step = 1; step < n; step++) {
    const up = glyphs[at + step], down = glyphs[at - step]
    if (up !== undefined && !same(up)) return up
    if (down !== undefined && !same(down)) return down
  }
  // a ramp of one glyph has no neighbour to step to; a stray space beats leaving the word readable
  return glyphs.find((g) => !same(g)) ?? ' '
}

export const scanLine = (line: string, ramp: string) => {
  let out = line
  // one swap per hit; a row of random glyphs rarely carries more than a couple
  for (let pass = 0; pass < 4; pass++) {
    const hit = firstHit(out)
    if (!hit) break
    const k = hit.i + (hit.len >> 1)
    const next = nudge(out.slice(hit.at[k], hit.to[k]), ramp)
    if (!next) break
    out = out.slice(0, hit.at[k]) + next + out.slice(hit.to[k])
  }
  return out
}

// enough of the name to recognise the file, not enough to read it in a caption
export const maskName = (name: string) => {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  if (stem.length < 2) return '•'.repeat(stem.length) + ext
  if (stem.length === 2) return stem[0] + '•' + ext
  return stem[0] + '•'.repeat(stem.length - 2) + stem[stem.length - 1] + ext
}
