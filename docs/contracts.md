# Contracts

Shared interfaces that more than one module depends on. Change these deliberately: the atlas
addressing is duplicated in three shaders, and the shape contract is the seam between the
sampling code and the stage.

## Glyph atlas

The atlas is one canvas holding every tile in a square grid, so the texture stays under the
4096 px limit that older phones enforce. Tile `i` sits at column `i % cols`, row
`floor(i / cols)`, counted from the top-left of the canvas.

```ts
type Atlas = {
  tex: THREE.CanvasTexture
  count: number   // ranked glyphs, index 0..count-1, sorted from least ink to most
  ranked: string[] // the glyphs themselves, least ink first
  jitter: number
  cols: number    // tiles per row
  rows: number    // tile rows; cols * rows is the whole grid
  tiles: number   // count + orient.count, how many grid cells are in use
  orient: { base: number; count: number } // direction tiles, index base..base+count-1, ordered by screen angle
}
```

Shader addressing. `local` runs from the top-left of the tile, matching `gl_PointCoord`:

```glsl
vec2 tileUV(float i, vec2 local) {
  return vec2((mod(i, uCols) + local.x) / uCols, (floor(i / uCols) + local.y) / uRows);
}
```

Three uploads canvas textures with `flipY` off, so texture row 0 is the top of the canvas,
which is what makes the formula above address the atlas as written. A single-row atlas with this
formula reduces to the old `(idx + x) / count, 1.0 - y`.

## Safety

```ts
// src/safety
normalise(s: string): string                  // case, accents, leetspeak, homoglyphs, repeats, separators
blockedToken(text: string): string | null     // whole-token match, for typed input
blockedRun(text: string): string | null       // substring match both directions, for exports
checkTyped(text: string): { ok: true } | { ok: false; reason: string }
scanLine(line: string, ramp: string): string  // swaps one letter of a hit for a neighbouring ramp glyph
maskName(name: string): string                // m•••l.glb
```

Nothing above ever returns the matched word to the caller for display. `REFUSAL` is the only
string the user sees.

The content rule is separate, because it applies to every source and not only to what the user
typed. `src/safety/content.ts` holds the fan art and explicit guards, and `src/safety/result.ts`
holds the rule for a row that came back from a search.

```ts
// src/safety
isFanArt(text: string): boolean       // a character or a piece of somebody else's world
isExplicit(text: string): boolean      // material that shows a body
checkContent(text: string): { ok: true } | { ok: false; reason: string }
checkResult(text: string): { ok: true } | { ok: false; reason: string }  // the blocklist too
resultPasses(text: string): boolean
```

A searched hit whose title or description fails `checkResult` is skipped, and the search moves on
to the next one. The reason is never shown, because naming the word would defeat the rule.

The rule for a result is a whole token and nothing else. The run scan, which counts a word
wherever its letters start, is for typed input, where a word written with its letters held
apart is typed on purpose, and for exported ASCII, where the letters of a word sit side by side
in a grid. A title is neither: "book shelf" is a bookshelf, and "Tropical 4" is a palm. A rule
that counted the letters inside a word refused a fish called Seabass, a Low Poly Assault Rifle
and a Bookshelf, so the result rule matches whole tokens only.

## The credit

A searched model or drawing carries its credit, and CC BY and CC BY-SA both ask for the author,
the licence, a link to the source and a note that the work was changed.

```ts
// src/objects/credit.ts
CREDIT_NOTE: string                          // 'rendered as ASCII'
creditLine(c: Credit): string                // one line of text
creditParts(c: Credit): { author, licence, note, url }
passesContent(...parts: (string | undefined)[]): boolean
```

The exports live in `src/ui/Export.tsx`, and they scan what they print.

```ts
scanCredit(credit: Credit | null, ramp: string): { words: string; url: string }
creditText(credit: Credit | null, ramp: string): string
exportText(body: string, caption: string, credit: Credit | null, ramp: string): string
```

The words are scanned, because the author and the licence come from a third party. The link is
not, because a scan replaces a letter in place and a scanned link points at nothing. The export
header is scanned like the art, because it carries the title, and for a prompt the title came
from a third party too.

## Shape

`prepare(source, count, seed)` is the only entry point, and it returns the contract every source
must meet: bounding radius `R`, Y up, front facing +Z, a pose, and a glyph size fixed for the
density rather than derived from the object's own area.

```ts
type Source =
  | { kind: 'library'; id: string }
  | { kind: 'text'; text: string }
  | { kind: 'prompt'; text: string }
  | { kind: 'file'; name: string; object: THREE.Object3D; bytes: number }

type Shape = Samples & {
  key: string
  kind: Source['kind']
  title: string
  detail: string
  twoSided: boolean
  occluder: THREE.BufferGeometry | null
  triangles: number
  across: number
  up: number
  glyphSize: number          // world units, identical for every source at one density
  pose: 'spin' | 'face'      // spin: turntable. face: rock toward the viewer
  flat: boolean              // 2D sources face the viewer and get no depth
  source: Provenance | null  // where a searched model came from
}

type Provenance = { author: string; licence: string; url: string }
```

## Prompt backends

`fromPrompt(text, rng)` walks the backends in order and returns the first that produces an
object. It never throws for a normal word: the procedural backend always returns something.

```ts
type PromptResult = {
  object: THREE.Object3D
  title: string
  detail: string
  twoSided?: boolean
  flat: boolean
  source: Provenance | null
}
```

## The Objaverse index

`scripts/objaverse-index.ts` writes it and the prompt backend reads it. Both meet here, so the
format is stated once and neither half invents it. The file is
`public/objaverse/index.json.gz`, and the path constants live in
`src/objects/objaverse-index.ts`.

```ts
type Index = {
  version: string   // the id of the build that wrote it, checked when the index is loaded
  rows: number
  revisions: Record<string, string>  // a dataset, and the commit the build read
  data: IndexRow[]
}

type IndexRow = {
  uid: string
  title: string   // the sketchfab title, cleaned
  caption: string // the cap3d description
  chunk: string   // the hub folder, e.g. "000-023"
  author: string
  licence: string
}
```

The GLB is not in the index. The app fetches it from the hub by uid and chunk, so the index
stays a megabyte rather than a gigabyte.

`tidyName` cleans a title, and both the commons path and the index use it, so the same name
reads the same from either source. `indexTokens` reads a text into the words a match is made
of, and `rowTokens` reads a row's title and caption apart.

The build's filters live in `scripts/objaverse-filters.ts`, and they import `isFanArt` and
`isExplicit` from `src/safety/content.ts`. The build and the app cannot disagree about what
is fan art or what is explicit.

## The Objaverse backend

The index is fetched the first time a prompt runs and then held in memory, so an ordinary page
load never pays for it. A prompt that reaches the backend is matched against the index, and the
winning model's GLB is fetched from the hub.

```ts
// src/objects/objaverse-fetch.ts
objaverseIndex(): Promise<Index | null>   // fetched once and held

// src/objects/objaverse-match.ts
CUTOFF: number                            // the share of a prompt a row must hold
matchRows(rows: IndexRow[], prompt: string, limit?: number): Match[]
pickRow(matches: Match[], step: number): IndexRow | null

// src/objects/objaverse.ts
findObjaverse(query: string, options?: { step?: number }): Promise<PromptResult | null>
```

A match is the share of the prompt's words a row holds, and a row below `CUTOFF` is not a
match. A row whose title agrees with its description outranks one that only matches the
description, because the title is the name the author gave the model.

The step is the reroll: the index holds many models for one prompt, and the step says which to
take, so pressing reroll gives a different model rather than the same one again. The step is
the seed, and a prompt result is cached by prompt and seed.

Every step can fail and every failure falls through: no index, no match, a row the content
rules refuse, a download that does not arrive, a model that cannot be parsed. The backend
never throws.

## Orientation

A model has to meet the style contract before it is sampled: Y up, and its front facing +Z.
glTF says Y is up, but a model uploaded to a sharing site can be authored any way up.

```ts
// src/objects/orient.ts
orient(positions: ArrayLike<number>): Orientation   // { quaternion, confidence }
applyOrientation(root: THREE.Object3D, o: Orientation): THREE.Object3D
```

The correction is a search over the ways a model can be stood up, scored by how tall it stands
and how flat its bottom is. A model that already stands is not turned. A model with no readable
axis is left alone, because a wrong turn reads worse than the original.

The correction goes on the model's meshes, not on its root, because the triangle soup is built
in the root's own space: the root's transform is multiplied out, so a rotation on the root
would be cancelled before it reached the samples.

A check over sixty models taken from the collection the app would ship turned forty-six of
them, and every one of the forty-six stood upright afterwards. The fourteen that were left
alone were already standing.


## UI props

```ts
Hud({ shape, status, error, theme, ramp, onRetry })
Panel({ ..., surprise, setSurprise, edges, setEdges })
Export({ item, onClose, caption, credit })
Post({ mode, theme, atlas, orient })
```

## Theme tokens

`applyTokens(theme)` writes the theme and tint colours onto `document.documentElement.style` as
`--ink-*` and `--theme-*` custom properties at start-up and on every theme change. The shaders
take their colours from the same `core.ts` values, so `styles.css` reads what the shaders were
given rather than the two reading each other, and a colour is changed in one place.
