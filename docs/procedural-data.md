# The procedural export

`scripts/procedural-export.ts` turns the app's own library of forms into training data. Every item
in `src/objects/library.ts` is built at a seed with the same code the app draws with, sampled into
points with normals and colours, and written in the shard format `scripts/objaverse-export.ts`
writes, so `ml/cloudgen/data.py` reads both without a change.

```sh
npm run export:procedural -- --out .cache/procedural-smoke --count 200   # a first look
npm run export:procedural -- --out .cache/procedural --count 1000        # one shard
```

## What it generates

A cloud is one library item at one seed: the teapot, the supershape, the donut, the torus knot, the
crystal, the seashell, the Klein bottle, the double helix and the asteroid. Seeds are taken item by
item, seed 0 through every item, then seed 1, so raising `--count` only appends rows and a small run
starts with the nine canonical forms the app shows before anything is rerolled. Seed 0 is each
item's canonical build; any other seed is a variation of it, which for the knot means another
(p, q), for the crystal another platonic solid, for the supershape another pair of superformula
numbers, and for the asteroid another set of craters.

The flags:

| flag | default | means |
|---|---|---|
| `--out` | required | the folder the shards are written into |
| `--count` | 1000 | how many clouds |
| `--shard` | 1000 | clouds per shard |
| `--points` | 4096 | samples per cloud |
| `--seed` | 0 | the first seed; the sweep runs upward from it |
| `--limit-items` | every item | only the first N library items, for a smoke run |

Nine items means 1,000 clouds is 112 seeds (9 × 111 + 1) and a million clouds 111,112.

## The shard format

Identical to the Objaverse export, format 1:

| file | holds |
|---|---|
| `shard-NNNNN.points.npy` | float16, `[n, P, 6]`: x, y, z, then the unit normal |
| `shard-NNNNN.rgb.npy` | uint8, `[n, P, 3]`: sRGB colour, 255 where the form has none |
| `shard-NNNNN.jsonl` | one line per cloud, in order: uid, title, caption, author, licence, url, triangles, colored, textured |
| `shard-NNNNN.failed.jsonl` | the rows that were lost and why; empty on every run so far |
| `meta.json` | the format, the index, the counts and the screening note |

- **The space** is the unit sphere: `surfaceFrom` leaves a form at the stage's radius of 1.9, and the
  export scales that to 1, which is what the Objaverse shards hold. A model trained on both sees one
  scale, and the app scales whatever it is given to its own radius anyway.
- **The points** are `sampleSoup`, the app's blue-noise sampler, Morton ordered and seeded per
  cloud, so the same seed writes the same points.
- **The colour** is the vertex and material colour the build gives the form: the crystal's edges
  and the helix's strands and base pairs carry their palette, everything else is the plain white
  material the library uses, so 156 of a 200-cloud run's rows are 255 across. `colored` in the
  jsonl says which is which, and `textured` is always false: no form here has a texture.
- **Provenance** is in the row: `author` is the raw generator name (`knot`, `asteroid`, …), `uid` is
  `<generator>-s<seed>`, and `url` is `procedural://<generator>/<seed>`.

A 1,000-cloud shard at 4,096 points is 49.2 MB of points, 12.3 MB of colour and 213 KB of rows,
about 61 MB, the same as a shard of Objaverse models. A million clouds is 1,000 such shards: about
49 GB of float16 points, and about 61 GB with the colour arrays. On this machine 200 clouds took
12 seconds, so a shard is about a minute and a million clouds about 17 hours in one process.

The run resumes: a shard is written file by file and renamed into place, and a shard counts as done
when its `.jsonl` is there, so a stopped run skips what it already wrote. `meta.json` keeps the row
count, a sha256 of the uids in order and the item list, so a second run into the same folder with
another `--count`, `--seed` or set of items is refused rather than mixed into the first.

## The captions

Each caption is one sentence, built from the same build that is sampled: the generator's own
`detail` string carries the numbers (the knot's `(p, q)`, the crystal's solid, the helix's base
pairs, the asteroid's craters, the supershape's rim), and the caption reads them back, so the words
cannot name a shape other than the points. An adjective drawn from a short list by the seed keeps a
run of one generator reading as a run of sentences rather than one sentence with a new number.

| item | caption |
|---|---|
| teapot | `a glazed teapot with its lid off` |
| supershape | `a ribbed supershape with an eight-lobed rim` |
| donut | `an even torus with a thick tube` |
| knot | `a tight trefoil knot`, `a dense torus knot wound three times around the ring and five times through its hole` |
| crystal | `a faceted twenty-sided crystal`, `a pale six-sided crystal` |
| shell | `a pale seashell spiralling three turns` |
| klein | `a smooth Klein bottle passing through its own wall` |
| helix | `a narrow double helix with twenty-three base pairs` |
| asteroid | `a craggy asteroid with nine craters` |

Numbers are words, never digits, up to ninety-nine: a text encoder reading `twenty-three` and `23`
learns two tokens for one idea for no gain. Counts are rounded where the form is continuous (the
shell's 2.6 to 3.2 turns all read as `three turns`), and every count the library can produce stays
inside what the words cover. Across 200 clouds a run gave 116 distinct captions; the teapot, with
ten combinations of lid and adjective, is the least varied, and the knot the most.

## The licence

There is no third-party source and no credit to carry: every cloud is generated here, from the
repo's own procedural code, and belongs with the repo. `licence` in each row says `CC0-1.0`, which
is the position these forms are contributed under. Two of them are classical shapes rather than this
repo's inventions — the Utah teapot's control points come from Martin Newell's 1975 model by way of
three.js's `TeapotGeometry`, and the Klein bottle is the standard immersion three.js ships in
`ParametricFunctions` — and three.js is MIT licensed, so nothing here is asked to credit anyone. A
model trained on these shards owes its sources nothing beyond that.

## Screening

`meta.json` carries `screened: ["procedural: generated by scripts/procedural-export.ts"]`. The Python
loader refuses a manifest that cannot say what screened its rows (J3 in the plan), and
`Manifest.screening_note` reads a list holding a `procedural:` entry as *generated by this repo's
generators*, rather than as a list of uids an image classifier checked. Nothing was classified
because there was no third-party image to classify.

## Reading it

```python
import json, numpy as np
from cloudgen.data import load_shards

manifest, shards = load_shards('.cache/procedural-smoke')
print(manifest.rows, manifest.points, manifest.screening_note)
cloud = shards[0].clouds(np.arange(4))          # (4, 4096, 6) float32
rows = shards[0].rows                           # uid, title, caption, author, licence, url, …
```

Measured on the 200-cloud smoke run: every point lies within radius 1 (1.0002 at most, the rounding
of a half), every normal is unit length to within 0.0005, and two runs with the same `--count` wrote
byte-identical `.npy` files. The crystal and the helix are the only rows with colour: two distinct
colours for a crystal, five for a helix.

The library logs `THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed` while
building the crystal. It is three.js noting a no-op on a polyhedron that is already flat, it costs
nothing, and it is not this script's warning to silence.
