# gen-ascii

Render any 3D object as living ASCII. Pick a built-in object, type a word, or drop a model file,
and it assembles out of drifting dust as thousands of characters lit like a real surface: the side
facing the light takes heavy glyphs (`# % @`), the shadow side light ones (`. , :`), and the far
side is hidden as if the object were solid.

The look and the engine started from the dot-scene examples in
[ivory-ui](https://github.com/mberrys/ivory-ui/tree/ascii-dots-ui): the same glyph atlas ranked by
ink, spring-driven dots that travel between formations, a dust shell for depth, bloom in dark
mode, and the Fraunces + IBM Plex Mono type on paper or ink.

```sh
npm install
npm run dev        # http://localhost:5181
npm test           # sampling and geometry tests
npm run build      # typecheck + production build into dist/
```

## Using it

- **Objects**: teapot, supershape, donut, knot, crystal, shell, klein, helix, asteroid.
  **reroll** (or `r`) grows a variation: a new superformula, knot, solid, shell, helix or rock.
- **text**: type up to 40 characters; it is extruded, bevelled and sways to stay readable.
- **open… / drop**: `.glb .gltf .obj .stl .ply .fbx`. Drop a `.gltf` or `.obj` together with its
  `.bin`, `.mtl` and textures. Vertex colours, material colours and textures are sampled, so
  the **ink** swatch with the rainbow ring shows the model in its own colours. Point clouds work
  too; normals are estimated when the file has none.
- **Render modes** (`g`): `letters` (glyphs floating in 3D), `grid` (a fixed character grid,
  like a terminal) and `dots` (a halftone).
- **tune**: glyph set (letters, classic ramp, dense ramp, binary, blocks, or your own
  characters), ink colour, density (1.5k–12k glyphs), spin, scatter, and export.
- **Export**: *copy text* renders the current view as plain ASCII (96 columns); *save png*
  saves the canvas.
- **Pointer**: drag to turn, flick to coast, pinch or scroll to zoom, tap the object to send a
  ripple across it. Keys: `←` `→` step through objects, `space` scatters, `t` toggles theme.
- Settings live in the URL (`?o=knot&mode=grid&theme=light&glyphs=classic&seed=3`) so a view
  can be shared.

## How it works

```
source ──► triangle soup ──► even samples ──► stage ──► (grid pass) ──► screen
library      flatten meshes    blue noise,      springs,     ASCII cells
text         normalise to      normals,         lighting,    from a splat
file         radius 1.9        colours          occluder     image
```

- `src/objects/` turns anything into samples. `soup.ts` flattens every mesh into one triangle
  soup with normals, uvs, vertex colours and materials (textures are read once, by uv).
  `sample.ts` scatters area-weighted candidates, thins them with dart throwing on a hash grid so
  glyphs tile the surface evenly, and sorts the result along a Z-order curve so two objects
  morph coherently (dot *i* of one lands near dot *i* of the next). `library.ts` holds the
  built-in objects, `text.ts` the extruded type, `load.ts` the file loaders.
- `src/engine/Stage.tsx` drives a fixed pool of 12,000 dots with the ivory spring
  (dots visibly travel and settle), releases them in a sweep when the object changes, and adds
  the scan band, tap ripples and scatter. Each dot carries its surface normal; the shader lights
  it from the upper left and picks the glyph by brightness. The object's own mesh is drawn into
  the depth buffer only, nudged back a hair, so the far side of the object is hidden; it grows
  with the object as it assembles.
- `src/engine/Post.tsx` runs the composer: bloom in dark mode, and for the grid mode a pass
  that reads an opaque splat image (ink in alpha) one character cell at a time.
- Text export splats the visible dots into a fine depth buffer on the CPU and gives each
  character cell the glyph its average ink calls for.
