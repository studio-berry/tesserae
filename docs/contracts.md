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

## UI props

```ts
Hud({ shape, status, error, theme, ramp, onRetry })
Panel({ ..., surprise, setSurprise, edges, setEdges })
Export({ item, onClose, caption })
Post({ mode, theme, atlas, orient })
```

## Theme tokens

`applyTokens(theme)` writes the theme and tint colours onto `document.documentElement.style` as
`--ink-*` and `--theme-*` custom properties at start-up and on every theme change. Both the
shaders (through `core.ts`) and `styles.css` read from there, so a colour is changed in one place.
