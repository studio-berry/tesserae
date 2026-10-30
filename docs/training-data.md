# The training data

What the model is trained on, where every row came from, what each row passed, and the command that
rebuilds it. A trained model's card points here, and so does the app's credit line when a generated
object is on screen.

## Sources

| source | what it gives | rows | licence |
|---|---|---|---|
| `allenai/objaverse` at `556637099bf4fa79ea7b239d0d9c328b8a2e9ac8` | the models | 20,000 shipped | CC BY 4.0 per object, ODC-By for the dataset |
| `tiange/Cap3D` at `0f05a726ff7eb3db93444a4efc65f0552bce84a4` | the captions | 20,000 | MIT for the code, the captions describe CC BY objects |
| `cindyxl/ObjaversePlusPlus` at `ac892800fd29db09c2b560bdfdd3c57253045836` | the licence and author fields | 20,000 | the dataset's own terms |
| `cindyxl/ObjaversePlusPlus (parquet)` at `d564ab4d65106127ef4fc6e960be82d7e202564f` | the paths and thumbnails | 20,000 | the dataset's own terms |

Every source is read at a fixed commit and the commits travel inside `public/objaverse/index.json.gz`
and in the export's `meta.json`, so a rebuild is reproducible and a reviewed denylist points at the
same models.

## What every row passed

The shards come from the shipped index, so every row went through the build's funnel
(`docs/objaverse-index.md`):

1. a licence that allows redistribution;
2. the figure filter and the character filter, which drop human scans and franchise characters;
3. the fan-art word rule (`src/safety/content.ts`, imported by the build so the two cannot disagree);
4. the explicit word rule;
5. the 44 reviewed uids in `scripts/objaverse-denylist.ts`;
6. the image classifier over every kept row (`scripts/objaverse-nsfw.py`), which is what makes the
   shipped 20,000 the only pool the export will read without a list of checked uids.

A larger pool exists: every filter but the browser's 8 MB ceiling keeps 147,657 rows, and with it
92,296. The classifier has only looked at the 20,000, so the export refuses any other index unless
`--screened <file>` names the uids that were checked. The training loader applies the same rule from
the other side: `cloudgen/data.py` refuses a shard whose `meta.json` cannot say what screened it, so
a shard set that slipped past the export cannot be trained on by accident.

## Counts

| | rows |
|---|---|
| index rows | 20,000 |
| written | 19,980 |
| lost | 20 |
| carrying colour | 9,990 |
| lost a texture's colour | 11,457 |

Of the 20 lost rows, 19 held more triangles than the 200,000 cap once loaded (209,536 to 324,860) and
one gave a point that is not finite. No row was Draco compressed or failed to parse.

## What is in a row

`[4096, 6]` float16 per cloud: x, y, z on the unit sphere, then the unit normal. Colour is a separate
`[4096, 3]` uint8 array, 255 where the model had none. The orientation is the file's own: glTF is Y up,
and a random turn about Y in training covers the fact that the facing varies across Objaverse. The
app's `standUpright` is deliberately not run, because it reads standing as taller than wide and stood
two buses and a rifle on their ends.

## Rebuilding it

```sh
npm run export:objaverse                         # 20,000 rows, about 1.2 GB of shards, two hours
python -m cloudgen.train --data ../.cache/training/objaverse --out runs/base
```

The export resumes at the first shard without a manifest, and refuses a folder holding a different
export rather than mixing two. `docs/training-export.md` is the format's own description.

## Known gaps

- **The captions are Cap3D's**, which are noisy: some describe the back of an object, some name a part
  rather than the whole. Prompt quality is bounded by this until the rows are re-captioned (C4).
- **11,457 rows lost a texture's colour** and fall back to the palette, so a trained model has no
  colour signal from most of its data. A colour head is a later step for that reason.
- **The export samples the surface of a mesh**, so a sparse scan or a model with a hole trains on a
  cloud with a hole.
- **Screening is a word list plus an image classifier.** It cannot reach zero: a model called "Nuka
  Cola" says nothing a word list refuses, which is why the classifier runs over every shipped row.
