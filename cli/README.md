# gen-ascii, in a terminal

```sh
npm run cli -- teapot                      # spin a library object in the terminal
npm run cli -- knot --text --cols 60       # one frame as plain text
npm run cli -- "a lighthouse" --text       # the app's own prompt path
npm run cli -- crystal --frames 24 --out crystal.txt
```

`npm run cli` builds the bundle with esbuild and runs it. After an `npm publish` of this folder,
`npx gen-ascii teapot` is the same thing.

## What it draws with

The app's renderer, not a second one: the same sampler (`src/core/sample.ts`), the same lighting
(`src/core/lighting.ts`), the same raster (`src/core/snapshot.ts`), and the ANSI writer the browser
text export uses. A change to any of them shows up in the terminal with no extra work.

## Flags

| flag | default | what it does |
|---|---|---|
| `--text` | off | one frame as plain text, no colour |
| `--half` | off | two pixels a cell: the upper half block with a background colour |
| `--cols` | 80 | columns across the object |
| `--count` | 6000 | glyphs sampled from the surface |
| `--seed` | 0 | a different form of the same object |
| `--fps` | 24 | frames a second while spinning |
| `--frames N` | 0 | print N frames of a full turn and exit |
| `--out <path>` | stdout | write there instead |
| `--still` | off | draw once and exit, without animating |

## Limits, stated

- **No model yet.** `gen-ascii "a lighthouse"` goes through the app's prompt sources, which reach the
  network. Drawing from the trained point-cloud model needs the ONNX export the plan's D5 names, and
  `onnxruntime-node` behind it; that is not in this build.
- **A terminal, not a browser.** There is no occluder pass, so a hidden back face is only hidden by
  the raster's depth buffer, which is the same rule the text export uses.
- **`--half` needs a truecolor terminal** that draws U+2580; with `NO_COLOR` set the glyph mode is the
  safer choice.
