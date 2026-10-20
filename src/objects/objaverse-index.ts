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
  version: string // the build's id, so a stale cache can be told from a fresh one
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

// The Sketchfab page a model came from. The uid is the model's own identifier there.
export const sketchfabUrl = (uid: string) => `https://sketchfab.com/3d-models/${uid}`

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
