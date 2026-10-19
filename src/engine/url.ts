import { Source } from '../objects'
import { LIBRARY } from '../objects/library'
import { Mode, Theme, TintId, TINTS } from './core'
import { CHARSETS, CharsetId } from './glyphs'

// Settings live in the URL so a view can be shared (dropped files excepted). Kept apart from the
// app so a share link can be checked without a browser.
export const MODES: Mode[] = ['letters', 'grid', 'dots']

export type Settings = {
  source: Source
  text: string
  prompt: string
  seed: number
  density: number
  mode: Mode
  theme: Theme
  tint: TintId
  charset: CharsetId
}

const pick = <T extends string>(v: string | null, all: readonly T[], d: T) => (all.includes(v as T) ? (v as T) : d)

export function readUrl(search: string, defaultDensity: number, system: Theme): Settings {
  const q = new URLSearchParams(search)
  const o = q.get('o'), text = q.get('text'), prompt = q.get('prompt')
  const source: Source = prompt ? { kind: 'prompt', text: prompt }
    : text ? { kind: 'text', text }
    : { kind: 'library', id: LIBRARY.some((l) => l.id === o) ? o! : LIBRARY[0].id }
  return {
    source,
    text: text ?? 'ascii',
    prompt: prompt ?? '',
    seed: Math.max(0, parseInt(q.get('seed') ?? '0') || 0),
    density: Math.max(1500, Math.min(12000, parseInt(q.get('n') ?? '') || defaultDensity)),
    mode: pick(q.get('mode'), MODES, 'letters'),
    theme: pick(q.get('theme'), ['dark', 'light'] as const, system),
    tint: pick(q.get('ink'), [...TINTS.map((t) => t.id), 'source'] as TintId[], 'ivory'),
    charset: pick(q.get('glyphs'), [...Object.keys(CHARSETS), 'custom'] as CharsetId[], 'letters'),
  }
}

export function writeUrl(s: Settings, defaultDensity: number) {
  const q = new URLSearchParams()
  if (s.source.kind === 'library') q.set('o', s.source.id)
  if (s.source.kind === 'text') q.set('text', s.source.text)
  if (s.source.kind === 'prompt') q.set('prompt', s.source.text)
  if (s.seed) q.set('seed', String(s.seed))
  if (s.density !== defaultDensity) q.set('n', String(s.density))
  if (s.mode !== 'letters') q.set('mode', s.mode)
  q.set('theme', s.theme)
  if (s.tint !== 'ivory') q.set('ink', s.tint)
  if (s.charset !== 'letters') q.set('glyphs', s.charset)
  return `?${q}`
}

// phones start with fewer, larger glyphs; recomputed on resize so a rotation is respected
export const defaultDensity = (w: number, h: number) => (Math.min(w, h) < 500 ? 4500 : 6000)
