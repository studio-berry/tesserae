// The build's filter funnel, in one place, so the script and the tests read the same rules.
//
// The order is the report: every step drops rows, and the rows left after each step are the
// number the docs quote. A step that moved would change every number after it, so the order
// here is the order the python prototype used and the order the docs record.
//
// The content guards come from src/safety/content.ts, so a row the build drops is a row the
// app would also refuse to show. The app and the build cannot disagree about fan art.

import { isFanArt } from '../src/safety/content.ts'
import { resultPasses } from '../src/safety/result.ts'
import { indexTokens, tidyName } from '../src/objects/objaverse-index.ts'
import { denied } from './objaverse-denylist.ts'
import { flagged } from './objaverse-flagged.ts'

// The categories a model is filed under when it is a character or a person.
export const CHARACTER_CATEGORIES = new Set(['characters-creatures', 'people'])

// The per-object licences kept. The dataset as a whole is ODC-By v1.0, but each object carries
// its own licence, and only CC BY 4.0 may be shipped and attributed.
export const LICENCES: Record<string, string> = { by: 'CC BY 4.0' }

// The ceilings the Commons model path holds a download to (src/objects/search.ts).
export const MAX_BYTES = 8_000_000
export const MAX_FACES = 200_000

// The words a row is read over: its title, its tags and its caption together.
export const rowText = (row: { title: string; tags: string; caption: string }) =>
  `${row.title} ${row.tags} ${row.caption}`

// One row of the build, before it becomes an index row.
export type Candidate = {
  uid: string
  chunk: string // the hub folder the glb sits in, e.g. "000-023"
  title: string // the raw sketchfab title
  caption: string
  tags: string
  categories: string
  author: string
  licence: string
  adult: boolean
  faces: number
  bytes: number
  score: number
  multiObject: boolean
  scene: boolean
  figure: boolean
  transparent: boolean
  inPaths: boolean
  hasMeta: boolean
  hasCaption: boolean
}

// What a step needs to decide. A meta step reads the sketchfab record alone, and a caption
// step reads the cap3d text as well.
export type StepKind = 'meta' | 'caption'

// One step of the funnel. A step keeps a row or drops it.
export type Step = {
  label: string
  kind: StepKind
  keep: (row: Candidate) => boolean
}

// The steps of the funnel, in order. The order is the report, so it is written down once.
export const funnelSteps = (minScore: number): Step[] => [
  { label: 'objaverse++ rows', kind: 'meta', keep: () => true },
  { label: 'in object-paths', kind: 'meta', keep: (r) => r.inPaths },
  { label: 'has metadata', kind: 'meta', keep: (r) => r.hasMeta },
  { label: 'licence CC BY 4.0', kind: 'meta', keep: (r) => r.licence in LICENCES },
  { label: `score >= ${minScore}`, kind: 'meta', keep: (r) => r.score >= minScore },
  { label: 'not a scene', kind: 'meta', keep: (r) => !r.scene },
  { label: 'single object', kind: 'meta', keep: (r) => !r.multiObject },
  { label: 'not transparent', kind: 'meta', keep: (r) => !r.transparent },
  { label: 'has a Cap3D caption', kind: 'caption', keep: (r) => r.hasCaption },
  { label: 'has an author', kind: 'meta', keep: (r) => !!r.author },
  { label: 'not age-restricted', kind: 'meta', keep: (r) => !r.adult },
  // most fan art is a character, and a character from someone else's world cannot be told apart
  // by its words alone, so no figures at all
  { label: 'not a figure', kind: 'meta', keep: (r) => !r.figure },
  // the author's own word that it is a character or a person, which objaverse++ missed
  {
    label: 'not filed as character or person',
    kind: 'meta',
    keep: (r) => !r.categories.split(' ').some((c) => CHARACTER_CATEGORIES.has(c)),
  },
  { label: 'no fan art words', kind: 'caption', keep: (r) => !isFanArt(rowText(r)) },
  // the app's own rule, over the title and the caption together. It is the rule the app
  // applies to a result it shows, so a row the build keeps is a row the app would show, and a
  // row the app would refuse never reaches the index.
  //
  // The earlier version of this step read the title, the tags and the caption with the build's
  // own guards, which matched whole words while the app matches anywhere in the text. The two
  // disagreed, and 491 rows the build kept were rows the app would refuse.
  {
    label: 'no explicit or blocked words',
    kind: 'caption',
    keep: (r) => resultPasses(`${r.title} ${r.caption}`),
  },
  // the models the word filters could not catch, found by looking at the top match of a list of
  // everyday nouns. The list is reviewed rather than generated, so it is worth reading.
  { label: 'not on the reviewed denylist', kind: 'meta', keep: (r) => !denied(r.uid) },
  // the models an image classifier flagged as explicit. The pass runs offline while the index
  // is built, and nothing at runtime depends on it.
  { label: 'not flagged as explicit', kind: 'meta', keep: (r) => !flagged(r.uid) },
  {
    label: `glb <= ${MAX_BYTES / 1e6} MB, faces <= ${MAX_FACES / 1e3}K`,
    kind: 'meta',
    keep: (r) => r.bytes > 0 && r.bytes <= MAX_BYTES && r.faces <= MAX_FACES,
  },
]

// The first step that needs the cap3d text. The caption steps come after it, so the csv is
// streamed once, when the build reaches that point.
export const captionStep = (minScore: number) =>
  funnelSteps(minScore).findIndex((s) => s.kind === 'caption')

// Apply one step of the funnel to the rows, dropping the ones it does not keep. The number
// left is the report. The build and the tests both go through here, so a step cannot behave
// one way in the script and another way in a test.
export const applyStep = (rows: Map<string, Candidate>, step: Step): number => {
  for (const [uid, row] of rows) if (!step.keep(row)) rows.delete(uid)
  return rows.size
}

// The funnel, run over the rows. The number left after each step is the report.
export const runFunnel = (rows: Candidate[], minScore: number) => {
  const steps = funnelSteps(minScore)
  const map = new Map(rows.map((r) => [r.uid, r]))
  const counts: { label: string; count: number }[] = []
  for (const step of steps) counts.push({ label: step.label, count: applyStep(map, step) })
  return { alive: [...map.values()], counts }
}

// The title a row shows when its own title says nothing: the first words of the caption, or
// 'model' when even the caption is empty. A caption is a description, so its first words name
// the thing far better than a bare 'model' would.
export const fallbackTitle = (caption: string): string => {
  const kept: string[] = []
  for (const word of caption.split(/\s+/)) {
    const clean = word.replace(/[^\p{L}\p{N}]/gu, '')
    if (!clean) continue
    // a stop word carries no meaning, so it cannot open a title
    if (!indexTokens(word).length) continue
    kept.push(clean)
    if (kept.length >= 6) break
  }
  return kept.join(' ').slice(0, 80).trim() || 'model'
}

// The title a row shows, cleaned, and never empty.
export const rowTitle = (raw: string, caption: string) => {
  const clean = tidyName(raw)
  if (clean && indexTokens(clean).length) return clean
  return fallbackTitle(caption)
}
