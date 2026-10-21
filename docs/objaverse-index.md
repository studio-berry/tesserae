# The Objaverse index

The index is a static file of model descriptions that the prompt path can match against, so a
prompt like "lighthouse" can find a real 3d model without asking a service that might be
withdrawn. It is built by `scripts/objaverse-index.ts` and it is the same file every rebuild
makes, because every source is read at a pinned commit.

## What is in the index

`public/objaverse/index.json.gz`, gzipped. One JSON object:

```ts
type Index = {
  version: string   // the build id, so a stale cache can be told from a fresh one
  rows: number
  revisions: Record<string, string>  // a dataset, and the commit the build read
  data: IndexRow[]
}

type IndexRow = {
  uid: string       // the objaverse uid
  title: string     // the sketchfab title, cleaned
  caption: string   // the cap3d description
  chunk: string     // the hub folder, e.g. "000-023"
  author: string
  licence: string
}
```

The GLB itself is not in the index. The app fetches it from the hub by uid and chunk, so the
index stays a megabyte rather than a gigabyte.

## The funnel

Every filter runs in the order below, and the count left after each step is the report. The
order is the order the python prototype used, and it is written down once in
`scripts/objaverse-filters.ts`, so the script and the tests cannot disagree about it.

This is the real run against the pinned data, at the default `score >= 3`:

| step | rows left |
| --- | --- |
| objaverse++ rows | 789,195 |
| in object-paths | 789,195 |
| has metadata | 789,195 |
| licence CC BY 4.0 | 695,914 |
| score >= 3 | 255,342 |
| not a scene | 217,521 |
| single object | 208,498 |
| not transparent | 207,791 |
| has a Cap3D caption | 207,578 |
| has an author | 207,578 |
| not age-restricted | 207,578 |
| not a figure | 168,707 |
| not filed as character or person | 155,611 |
| no fan art words | 147,838 |
| no explicit or blocked words | 147,623 |
| not on the reviewed denylist | 147,579 |
| not flagged as explicit | 147,574 |
| glb <= 8 MB, faces <= 200K | 92,306 |

Every objaverse++ row is in object-paths and has metadata, so the first three steps cost
nothing. The licence step is the big one: 93,281 rows are CC BY-NC, CC BY-NC-SA, CC BY-SA or
CC0, and none of them may ship.

The size filter runs last, where the python prototype had it, and it drops 55,317 rows. The
order matters: it is the last step so the other filters are not asked to read the metadata of
rows the size filter would have dropped anyway.

## Size

Measured with `npm run index:objaverse:report`, which writes the first N rows in the index
order and gzips at level 9:

| rows | raw | gzipped |
| --- | --- | --- |
| 20,000 | 3.4 MB | 1.05 MB |
| 50,000 | 9.7 MB | 3.15 MB |

The shipped file is the 20,000 row one. The app fetches it the first time a prompt runs and
holds it in memory, so an ordinary page load never pays for it.

The index is committed to the repo. It is a megabyte, it is the artefact the app serves, and a
rebuild gives the same bytes, so there is nothing to regenerate on every clone. The 840 MB of
input data is not committed; `.cache/` is ignored.

## The licences

Three licences are in play, and they are not the same licence.

**The individual objects are CC BY 4.0.** The Objaverse dataset card says the collection as a
whole is ODC-By v1.0, and that "Individual objects in Objaverse are all licensed as creative
commons distributable objects". Each object's own licence is in its metadata, and the build
keeps only the rows whose licence is `by`, which is CC BY 4.0. So the shipped index carries
per-object CC BY 4.0, and the app shows the author and the licence with every result.

**The captions are ODC-By v1.0.** Cap3D's descriptions come from the Cap3D dataset, which the
hub tags `license: odc-by`. The hub's `license: odc-by` is the Open Data Commons Attribution
License v1.0, at <https://opendatacommons.org/licenses/by/1-0/>.

**The quality scores are ODC-By v1.0.** This was the open question in issue #18, and it is
now confirmed from two places. The Objaverse++ dataset card at its pinned commit
`ac892800fd29db09c2b560bdfdd3c57253045836` carries:

```
license: other
license_name: odc-by-v1.0
license_link: https://opendatacommons.org/licenses/by/1-0/
```

The `license: other` tag is the Hub's coarse bucket, not a different licence. The TCXX
ObjaversePlusPlus README says "This dataset is licensed under the Open Data Commons
Attribution License (ODC-By) v1.0". So the terms are ODC-By v1.0, and the script says so.

What the index ships is therefore a mix: the **objects** are CC BY 4.0, and the **captions and
the quality scores** come from ODC-By v1.0 datasets. All three are credited in the README.

## The content policy

The build drops a row when the app would refuse to show it, and it uses the app's own guards
rather than a second copy of the lists. `scripts/objaverse-filters.ts` imports `isFanArt` and
`isExplicit` from `src/safety/content.ts`, and the four word lists in the python prototype
were checked against the app's and match exactly, entry for entry.

The rules, and why each one is there:

- **No fan art.** A fan-art stem matches inside a run of up to three words, so `pokemon3d` and
  `sonic_the_hedgehog` are caught; a fan-art word matches only when it stands alone, so
  `cosplay` is caught but `panasonic` and `sextant` are not. A ceiling fan is not fan art:
  `fan` alone never counts.
- **Nothing explicit.** An explicit stem matches inside one word, because across words it
  finds `happen is`. A word matches only when it stands alone.
- **The app's own blocklist joins in**, so no row says a word the prompt box would refuse.
- **No figures at all.** Most fan art is a character, and a character from someone else's world
  cannot be told apart by its words alone.
- **Not filed as a character or a person.** The sketchfab categories catch characters that
  Objaverse++ missed.
- **Not age-restricted.** The `isAgeRestricted` flag in the metadata.
- **A row must have an author**, so every result can be credited.

The content is read over the title, the tags and the caption together, because a name can be
clean while a tag is not.

The word lists cannot catch every franchise, and the build does not claim they do. The rows
that survive were read by eye during the prototype's report, which is why the lists are as
long as they are.

## Whether figures come back

The index drops every model that is a figure, and the categories a model is filed under drop
every model that is a character or a person. The reason is that most fan art is a character,
and a character from somebody else's world cannot be told apart from a sculpture by its words
alone. The cost is that a prompt for "knight", "robot", "statue" or "astronaut" finds nothing
and falls back to Commons.

The filters are the largest content filter by a factor of six. Of the 207,578 rows that were
clean on every other count, the figure filter dropped 38,871, 18.7 per cent, and the category
filter dropped a further 13,096, 6.3 per cent. The franchise words dropped 7,773, 3.7 per
cent. So a quarter of the clean rows are gone because they hold a person.

The decision is to keep the filter, for three reasons that the numbers support.

The alternative in the issue is to allow figures whose words name a generic thing, once the
denylist exists. The denylist exists, and it is the wrong tool here, because it holds models
rather than words: it cannot say "a statue is fine, a statue of a named character is not",
which is the distinction the allowance turns on. Allowing figures on their words would let
back every model the filter now drops, since the filter drops them for being figures rather
than for naming anything.

The rows that survive already show the cost is small. Of the 20,000 rows the index ships,
272, 1.4 per cent, have a title that names a figure or a person, and most of those are false
positives of the measure rather than figures at all: "hand gun", "Longsword (Hand and A Half)",
"Hand Grenade", "pirate ship". A prompt for a statue or a robot finds a build or a form rather
than a figure, which is the same thing a prompt for an abstract word has always found.

And the third reason is the rule the whole index runs under. A model of a person is the one
kind of thing a content rule cannot check well: the words may be innocent, and a render of a
named character is the clearest case of fan art there is. The filter is the conservative
answer, and the app has no way to show a figure safely.

The way back, if it is wanted, is a reviewed list of figure subjects rather than a word rule:
the nouns a figure may be, checked by eye, the way the denylist was. That is a separate piece
of work with its own review, and it is not blocked by anything here.

## The offline classifier

The word filters catch a title that says something explicit. They cannot catch a model whose
title and tags are innocent but whose render is not, and Objaverse's own `isAgeRestricted` flag
removed nothing. So the thumbnails are looked at, by an image classifier, offline, while the
index is built. Nothing at runtime depends on it.

The pass ran over the 20,000 models the index holds. It flagged 36 of them.

Every one of the 36 was then looked at, as a contact sheet, and not one was explicit. They
were a knife, a wine glass, a banana, an anatomical heart, a candle, a bone, a light bulb and
a bench. The classifier fires on flesh-toned shapes and on silhouettes that are phallic
without meaning to be, which is exactly what a 3D model of a heart or a candle looks like.

So the threshold is 0.9, where the classifier is confident, rather than 0.5, where it is
eager. Five models are above 0.9 and those are the ones the build drops.

The number is recorded rather than hidden, because the useful finding is the shape of it: on a
collection of 20,000 public 3D models, a general-purpose explicit-image classifier found
nothing it was sure of, and every model it was unsure about was innocent. The check is worth
running because it is cheap and it is offline, not because it found anything.

The script is `scripts/objaverse-nsfw.py` and the uids it flagged are in
`scripts/objaverse-flagged.ts`. It reads the model from the hub at a pinned commit, so the
pass reads the same classifier every time it runs.

## The title rules

The sketchfab titles are raw user text: "knife", "damm this is a knife", random capitals,
underscores, emoji, and files that kept their extension. The index carries a cleaned title,
because the title is what the app shows and what the matcher reads.

The rules, all in `tidyName` in `src/objects/objaverse-index.ts`:

1. a trailing file extension goes, but only when it starts with a letter, so `knife.glb`
   becomes `knife` while `Scifi revolver 2.0` keeps its number and `P.018.03.2021` keeps all
   of it
2. underscores become spaces, because sketchfab runs words together
3. emoji and pictographs go, because they are noise and never a name
4. whitespace collapses and the ends are trimmed
5. the length is capped at 80 characters

A title that is empty after cleaning, or that holds no word worth showing, falls back to the
first words of the caption, and to `model` when even the caption is empty. The fallback skips
stop words, so a caption of "A weathered stone lighthouse" gives "weathered stone lighthouse"
rather than starting on "A".

The commons path used to have its own cleaner in `src/objects/search.ts`. It now calls the
same `tidyName`, so the two sources clean a name the same way. This is the one change to
`search.ts`, and it does not change what the commons path shows: its titles are file names
like `Tiny_pyramid.stl`, and they clean to the same string as before.

## Rebuilding

The inputs are 840 MB and are not in the repo. They are downloaded once, from the pinned
commits, and the digests are checked:

```sh
npm run index:objaverse:fetch    # downloads into .cache/objaverse
npm run index:objaverse          # writes public/objaverse/index.json.gz
npm run index:objaverse:report   # prints the funnel and the sizes, writes nothing
```

The build reads the pinned commits and checks the sha256 of each download, so the same inputs
give the same file. The index this branch ships is sha256
`716b17687da9a8f435f5378257b906b8bbbf697afb5064bfd8b5ad8f30277ad1`, and a rebuild from the same
data gives that file byte for byte.

The hash belongs to the filters as well as the data, because the filters decide which rows
survive. A later change to the content rule or to the denylist changes the file, and the hash
with it, so the hash is checked against the filters and not only against the pinned commits.

The build is a stream rather than a join. The cap3d csv holds 1.6 million captions, which does
not fit in memory as a map, so the metadata is filtered first and the csv is then walked once,
keeping only the captions of the rows that are still alive. The whole build fits in a 1 GB
heap, which is why the npm scripts pass `--max-old-space-size=2048`: a build that joined the
csv in memory ran out of heap at 3.4 GB.

## The pinned revisions

| dataset | commit | what is read |
| --- | --- | --- |
| [allenai/objaverse](https://huggingface.co/datasets/allenai/objaverse) | `556637099bf4fa79ea7b239d0d9c328b8a2e9ac8` | `object-paths.json.gz`, `metadata/*.json.gz` |
| [tiange/Cap3D](https://huggingface.co/datasets/tiange/Cap3D) | `0f05a726ff7eb3db93444a4efc65f0552bce84a4` | `Cap3D_automated_Objaverse_full.csv` |
| [cindyxl/ObjaversePlusPlus](https://huggingface.co/datasets/cindyxl/ObjaversePlusPlus) | `ac892800fd29db09c2b560bdfdd3c57253045836` | the annotation card and licence |
| cindyxl/ObjaversePlusPlus (parquet) | `d564ab4d65106127ef4fc6e960be82d7e202564f` | `default/train/0000.parquet` |

The last one is the conversion ref, which has its own commit. The build reads the parquet, so
that commit is pinned too. All four travel inside the index file, in its `revisions` field, so
a copy of the index says which snapshot it is.

The sha256 of each downloaded file is checked against the digest the hub serves for the
pinned commit:

| file | bytes | sha256 |
| --- | --- | --- |
| `object-paths.json.gz` | 19,803,736 | `db88ff78942613f10566ec4723fb8b8f558c37ffe8e78a8fc5428a20b93886a0` |
| `cap3d.csv` | 255,150,954 | `2a02dbf636bf4c9a60a8b39f7ac25dc546f02caa654cd402bef69f130d8f1638` |
| `plusplus.parquet` | 28,074,735 | `d7b2965728414eb6c4c8d06403483761fc0ea82f30e3bdc3880f0277d2db3f0c` |

## The credits

- [Objaverse](https://huggingface.co/datasets/allenai/objaverse), by Allen Institute for AI.
  The collection is ODC-By v1.0; the individual objects are CC BY 4.0 and carry their own
  author and licence.
- [Cap3D](https://huggingface.co/datasets/tiange/Cap3D), by the Tiange group. The captions are
  ODC-By v1.0.
- [Objaverse++](https://huggingface.co/datasets/cindyxl/ObjaversePlusPlus), by cindyxl and
  collaborators. The quality scores and traits are ODC-By v1.0.

The README carries the same credits, because a person who sees a result in the app should be
able to find them there.
