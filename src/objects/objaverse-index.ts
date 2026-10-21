// The Objaverse index: the shape the build script writes and the prompt backend reads. Both sides
// meet here, so the format is stated once and neither half invents it.
//
// The build writes one gzipped file plus the revisions it read, so a rebuild is reproducible and
// the app can say which snapshot it is looking at. The file is fetched the first time a prompt
// runs, never on an ordinary page load, and then held in memory.

export type IndexRow = {
  uid: string // the Objaverse uid
  title: string // the Sketchfab title, cleaned
  caption: string // the Cap3D description
  chunk: string // the Hub folder, e.g. "000-023"; the GLB path is glbs/<chunk>/<uid>.glb
  author: string
  licence: string
}

export type Index = {
  version: string // the id of the build that wrote it, checked when the index is loaded
  rows: number
  revisions: Record<string, string> // a dataset, and the commit the build read
  data: IndexRow[]
}

export const INDEX_DIR = 'objaverse'
export const INDEX_FILE = 'index.json.gz'
export const INDEX_URL = `${INDEX_DIR}/${INDEX_FILE}`

// The Hub holds a model's GLB under its own folder, and the folder comes from the uid.
export const glbPath = (row: IndexRow) => `glbs/${row.chunk}/${row.uid}.glb`

export const HUB_BASE = 'https://huggingface.co/datasets/allenai/objaverse/resolve'

export const glbUrl = (row: IndexRow, revision: string) => `${HUB_BASE}/${revision}/${glbPath(row)}`

// A request that fails at one address is tried at another. The second is not a second Hub
// address: hf-mirror.com is a community mirror of the Hub rather than a service of it, and it
// currently answers a model request with a redirect back to huggingface.co, so it costs a round
// trip and buys nothing until it stops doing that. The bytes are not checked against a digest
// on the way in, the way the build's downloads are.
export const HUB_MIRRORS = [
  'https://huggingface.co/datasets/allenai/objaverse/resolve',
  'https://hf-mirror.com/datasets/allenai/objaverse/resolve',
]

// The addresses a model can be fetched from, in the order they are tried.
export const glbUrls = (row: IndexRow, revision: string) =>
  HUB_MIRRORS.map((base) => `${base}/${revision}/${glbPath(row)}`)

// The Sketchfab page a model came from. The uid is the model's own identifier there.
export const sketchfabUrl = (uid: string) => `https://sketchfab.com/3d-models/${uid}`

// The length a title is capped at, so a caption never runs off the screen.
export const TITLE_MAX = 80

// The characters that are noise in a title: emoji, pictographs, the variation selectors and
// the zero width joiner that holds an emoji together.
const EMOJI =
  /[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{20E3}]/gu

// A title as the app shows it, cleaned. The rules are:
//   1. a trailing file extension goes, but only when it starts with a letter, so 'revolver 2.0'
//      keeps its number and 'knife.glb' loses its suffix
//   2. underscores become spaces, because sketchfab runs words together
//   3. emoji and pictographs go, because they are noise and never a name
//   4. whitespace collapses and the ends are trimmed
//   5. the length is capped
//
// The commons path and the objaverse index both read a title through this, so the same name
// looks the same whichever source it came from.
export const tidyName = (name: string): string => {
  const withoutExtension = name.replace(/\.[A-Za-z][A-Za-z0-9]{0,7}$/, '')
  const spaced = withoutExtension.replace(/_/g, ' ').replace(EMOJI, ' ')
  const collapsed = spaced.replace(/\s+/g, ' ').trim()
  return collapsed.slice(0, TITLE_MAX).trim()
}
// The name of the objaverse index build, cleaned the same way.
export const cleanTitle = tidyName
// The words that carry no meaning when a prompt is matched against a caption. The prompt box
// drops a smaller set of these before it asks Commons; the index needs the full set, because a
// caption is a sentence rather than a search term.
const STOP = new Set([
  'a', 'an', 'the', 'of', 'and', 'with', 'in', 'on', 'for', 'my', 'our', 'your', 'its', 'is',
  'to', 'at', 'it', 'be', 'as', 'by', 'from', 'that', 'this', 'these', 'those', 'or', 'but',
  'model', 'models', 'object', 'objects', '3d', 'mesh', 'render', 'renders', 'style', 'made',
  'featuring', 'features', 'looks', 'like', 'very', 'has', 'have', 'into', 'over', 'under',
])

// The plural and the singular are the same word for a match: "guitars" asks for a guitar.
const stem = (w: string) => {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`
  if (w.length > 3 && w.endsWith('es') && !/[aeiou]es$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

// The words of a text, folded to ascii lowercase, stemmed and stripped of the stop words. The
// build script and the app both read a row through this, so a row is never missed because the
// two halves read a word differently.
export const indexTokens = (text: string): string[] => {
  const words = text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
  const out: string[] = []
  for (const w of words) {
    if (w.length < 2 || STOP.has(w)) continue
    const s = stem(w)
    if (s.length >= 2 && !STOP.has(s)) out.push(s)
  }
  return out
}

// The tokens a row holds, split so the matcher can tell a title that agrees with the description
// from one that does not.
export const rowTokens = (row: IndexRow) => ({
  title: new Set(indexTokens(row.title)),
  caption: new Set(indexTokens(row.caption)),
})
