# The training export

`scripts/objaverse-export.ts` turns the Objaverse models into training data for a model that
writes 3D shapes from a prompt. Each model is fetched from the Hub, flattened and sampled by the
same code the app draws with (`soupFrom` and `sampleSoup`), and written as points with normals
and colours, next to its caption and its credit.

```sh
npm run export:objaverse -- --limit 200                 # a first look
npm run export:objaverse                                # the whole shipped index, about 2 hours
```

## What it reads

The rows come from an index file, so they have been through every step of the build's funnel
(`docs/objaverse-index.md`): the licence, the figure and character filters, the fan art words,
the explicit word rule, the reviewed denylist and the image classifier.

The default is the shipped index, `public/objaverse/index.json.gz`, 20,000 rows. The image
classifier has looked at every one of them.

A larger pool exists. Every filter but the browser's size ceiling keeps 147,657 rows, and with
the ceiling 92,296:

```sh
node --max-old-space-size=4096 scripts/objaverse-index.ts --data .cache/objaverse --limit 0 --out .cache/objaverse/pool.json.gz
```

The image classifier has only looked at the 20,000, so the export refuses any other index unless
`--screened <file>` names the uids that were checked, and it exports only those. Running
`scripts/objaverse-nsfw.py --index` over the pool and writing out the checked uids is the step
that opens it.

## What it writes

Into `--out` (default `.cache/training/objaverse`, which git ignores), one set of files per shard
of `--shard` rows (default 1,000):

| file | holds |
|---|---|
| `shard-NNNNN.points.npy` | float16, `[n, P, 6]`: x, y, z, then the unit normal |
| `shard-NNNNN.rgb.npy` | uint8, `[n, P, 3]`: sRGB colour, 255 where the model has none |
| `shard-NNNNN.jsonl` | one line per row of the arrays, in order: uid, title, caption, author, licence, url, triangles, colored, textured |
| `shard-NNNNN.failed.jsonl` | the rows that were lost, with the reason |
| `meta.json` | the index version, the revisions it was read at, the point count and the format |

`P` is `--points`, 4,096 by default. A shard of 1,000 models is about 61 MB.

- **The space** is the unit sphere: centred on the bounding box, the farthest point at radius 1.
  The stage scales whatever it is given to its own radius of 1.9, so a generated cloud can be
  handed to it as it is.
- **The orientation** is the file's own. glTF is Y up by its spec, and the app's `standUpright`
  is not run: it reads standing as taller than wide, and on the first 24 rows it stood two buses
  and a rifle on their ends. The facing about the vertical axis is not consistent across
  Objaverse (one bus faces the camera, the other shows its side), which is usual for this data
  and is what a random turn about Y in training is for.
- **The points** are the app's blue-noise samples, Morton ordered, seeded by the uid, so a rerun
  writes the same points.
- **The colour** comes from vertex colours and material colours. Textures are dropped before the
  file is parsed, because three decodes an image through the DOM, which Node does not have, and
  an image that fails to decode fails the whole model. `textured` in the manifest says which
  models lost a texture's colour.

A shard is written whole and its manifest last, so a stopped run resumes at the first shard
without a manifest. A run into a folder that holds a different export (another index, point
count, shard size, screening list, or set of rows, such as another `--limit`) is refused rather
than mixed: `meta.json` keeps the row count and a sha256 of the uids in order.

## Reading it

```python
import json, numpy as np

points = np.load('shard-00000.points.npy', mmap_mode='r')   # (n, 4096, 6) float16
rgb = np.load('shard-00000.rgb.npy', mmap_mode='r')         # (n, 4096, 3) uint8
rows = [json.loads(line) for line in open('shard-00000.jsonl', encoding='utf-8')]

xyz, normals = points[0, :, :3].astype(np.float32), points[0, :, 3:].astype(np.float32)
caption = rows[0]['caption']
```

On Windows the manifest has to be opened as utf-8: python's default there is cp1252, and an
author's name can hold a character it cannot read.

## What was measured

On this machine, from the shipped index, eight downloads at a time:

| run | kept | failed | fetched | time |
|---|---|---|---|---|
| 24 rows | 24 | 0 | 41 MB | 22 s |
| 200 rows | 200 | 0 | 275 MB | 74 s |
| 20,000 rows | 19,980 | 20 | 26.7 GB | 1 h 55 min |

The whole shipped index is 1.2 GB of shards. Of the 20 rows lost, 19 held more triangles than
the 200,000 cap once loaded (209,536 to 324,860): the face count the index filters on is lower
than what those files hold. The last gave a point that is not finite. No row was draco
compressed or failed to parse; both are handled and named in the failure file if they turn up.
9,990 of the kept rows carry colour, and 11,457 lost a texture's colour.

The shards were read back with numpy: every point lies within radius 1 (1.0003 at most, the
rounding of a half), every normal is unit length to within 0.0004, and on the first 24 rows a
front view of each, shaded by its normals, reads as its caption (a cat, two buses, a rifle).

## The credit

Every row carries its author, its licence (CC BY 4.0) and its Sketchfab page. A model trained on
these shards is trained on CC BY works, so the credit travels with the data, and what a trained
model owes its sources is a question to settle before it ships.
