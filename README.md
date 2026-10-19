# gen-ascii

Render any 3D object as living ASCII. Pick a built-in object, type a word, describe something, or
drop a model file, and it assembles out of drifting dust as thousands of characters lit like a real
surface: the side facing the light takes heavy glyphs (`# % @`), the shadow side light ones (`. , :`),
and the far side is hidden as if the object were solid.

The look and the engine started from the dot-scene examples in
[ivory-ui](https://github.com/mberrys/ivory-ui/tree/ascii-dots-ui): the same glyph atlas ranked by
ink, spring-driven dots that travel between formations, a dust shell for depth, bloom in dark
mode, and the Fraunces + IBM Plex Mono type on paper or ink. Both fonts are served from this repo,
so a first frame no longer waits on a font network. `docs/contracts.md` holds the interfaces the
modules share, and `docs/run-log.tsv` the decisions behind them.

```sh
npm install
npm run dev        # http://localhost:5181
npm test           # sampling, atlas, guard, export, prompt and URL tests
npm run build      # typecheck + production build into dist/
```

## Using it

- **Objects**: teapot, supershape, donut, knot, crystal, shell, klein, helix, asteroid.
  **reroll** (or `r`) grows a variation: a new superformula, knot, solid, shell, helix or rock.
- **text**: type up to 40 characters; it is extruded, bevelled and sways to stay readable.
- **prompt**: describe what you want in the header, or share a `?prompt=` link. A common noun is
  looked up in the [Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:STL_files) 3D
  catalogue and loaded through the model path, with the author and licence in the caption. An
  abstract term is looked up as a drawing and parsed into a flat figure that faces the viewer. When
  neither turns up, a built-in form is grown from the words themselves, so a prompt always draws
  something.
- **open… / drop**: `.glb .gltf .obj .stl .ply .fbx`. Drop a `.gltf` or `.obj` together with its
  `.bin`, `.mtl` and textures. Vertex colours, material colours and textures are sampled, so
  the **ink** swatch with the rainbow ring shows the model in its own colours. Point clouds work
  too; normals are estimated when the file has none.
- **Render modes** (`g`): `letters` (glyphs floating in 3D), `grid` (a fixed character grid,
  like a terminal) and `dots` (a halftone). The switch dims the canvas for a beat rather than
  cutting.
- **tune**: glyph set (the original five, plus braille, upper, math, arrows, katakana, greek, hex,
  cyrillic, punct and slashes, or your own characters), ink colour, density (1.5k–12k glyphs), spin,
  scatter, and export. **surprise** makes reroll change the glyph set too; **look → edges** lets the
  silhouette take direction glyphs instead of the brightness ramp, the way hand-drawn ASCII art
  reads.
- **Export**: *as text* renders the current view as plain ASCII (96 columns) with a header line
  naming the object and settings; *as png* saves the canvas with a caption strip. Every exported
  line is scanned for accidental words before it can leave the app.
- **Pointer**: drag to turn it like an object in your hand, flick to coast, pinch or scroll to zoom.
  Tap the object for a ripple and a nudge, tap twice for a burst around the point, hold to pull the
  glyphs toward your finger, tap the dust for a ripple and a wobble. Keys: `←` `→` step through
  objects, `w` `a` `s` `d` or `shift` + arrows turn it, `space` scatters, `t` toggles theme,
  `r` rerolls, `g` changes mode.
- Settings live in the URL (`?o=knot&mode=grid&theme=light&glyphs=classic&seed=3`, or
  `?prompt=a+lighthouse`) so a view can be shared. A typed word, a prompt and a dropped file's name
  are checked against a blocklist before anything is drawn, and a refusal keeps the previous object
  on screen.

## How it works

```
source ──► triangle soup ──► even samples ──► stage ──► (grid pass) ──► screen
library      flatten meshes    blue noise,      springs,     ASCII cells
text         normalise to      normals,         lighting,    from a splat
prompt       radius 1.9        colours          occluder     image
file
```

- `src/objects/` turns anything into samples. `soup.ts` flattens every mesh into one triangle
  soup with normals, uvs, vertex colours and materials (textures are read once, by uv).
  `sample.ts` scatters area-weighted candidates, thins them with dart throwing on a hash grid so
  glyphs tile the surface evenly, and sorts the result along a Z-order curve so two objects
  morph coherently (dot *i* of one lands near dot *i* of the next). `library.ts` holds the
  built-in objects, `text.ts` the extruded type, `load.ts` the file loaders, `prompt.ts` the
  backends a prompt walks, `svg.ts` the SVG reader behind flat figures. Every source meets one
  style contract in `prepare`: radius 1.9, Y up, front facing +Z, a declared pose, and a glyph
  size fixed for the density rather than derived from the object's own area, so the family reads
  as one family.
- `src/objects/worker.ts` builds and samples library and text sources on a background thread, so a
  switch between objects never blocks the page. A dropped file is parsed on the main thread, since
  its textures arrive through the DOM.
- `src/engine/Stage.tsx` drives a fixed pool of 12,000 dots. The dots move on the GPU: each one
  holds where it came from, where it is going and when it was released, and `shaders.ts` evaluates
  the spring, the normals and the scan band from the clock, so a frame at rest uploads nothing and
  costs nothing. The object's own mesh is drawn into the depth buffer only, nudged back a hair, so
  the far side is hidden; it grows with the object as it assembles. The caption stays honest either
  way: the engine reports what it is doing about ten times a second.
- `src/engine/Post.tsx` runs the composer: bloom in dark mode, and for the grid mode a pass that
  reads an opaque splat image (ink in alpha) one character cell at a time, with scanlines and a
  vignette in dark mode, and a glyph chosen from the ink gradient wherever an edge crosses a cell.
- `src/engine/glyphs.ts` draws one square atlas of 64 px tiles, ranked from least ink to most, plus
  eight direction tiles. A glyph the installed fonts cannot draw is dropped rather than drawn as an
  empty box, which is why the symbol sets survive on machines that lack them.
- `src/safety/` holds a blocklist and the folding that sees through case, accents, leetspeak,
  lookalike letters, doubled letters and letters held apart, with a whole-token guard for typed
  input so a place name is never refused for the word inside it.
- Text export splats the visible dots into a fine depth buffer and gives each character cell the
  glyph its average ink calls for.

## Nothing here needs a key

The prompt path has three backends, and one of them always answers: a Wikimedia Commons model, a
Wikimedia Commons drawing parsed into a flat figure, then a form grown from the words themselves.
A hosted text-to-3D or LLM-scene backend was considered for the prompts those three miss, and it is
deliberately out of scope, so no part of this app depends on a service that can be billed or
withdrawn. A prompt that has neither a model nor a drawing on Commons gets a built form rather than
an invented 2D figure.
