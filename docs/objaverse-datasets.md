# Three hub datasets as sources for the prompt path

This is the measurement behind issue 21. Three smaller hub datasets fit the app and had not been
looked at past their dataset pages: Smithsonian Open Access 3D, Google Scanned Objects, and NASA 3D
Resources. Each was opened, sampled, downloaded and parsed, and the numbers below are what the files
actually held rather than what the cards claimed.

The app's rules that bear on the choice are in the readme under "Nothing here needs a key": no part
of this app may depend on a service that can be billed or withdrawn, and no hosted service was
chosen. The prompt path therefore has to fetch from a source that answers today and keeps answering,
with no key and with CORS that lets a browser read it.

## What the app needs from a model

The loader caps what it will take, in `src/objects/url-loader.ts`:

| ceiling | value | where |
| --- | --- | --- |
| bytes | 8,000,000 | `MAX_BYTES` |
| triangles | 200,000 | `MAX_TRIS` |

A model over either ceiling is refused rather than drawn, so a row that is usable here is one whose
file is under 8 MB and under 200k triangles. A row is also usable only if it has a downloadable model
file, a name that can be shown, and a licence that permits redistribution and use.

## Summary

| | Smithsonian | Google Scanned Objects | NASA |
| --- | --- | --- | --- |
| rows in the set | 3,451 | 1,029 glb objects | 931 rows in 4 configs |
| rows a model is drawn from | 3,451 | 1,029 | 235 (`models`) |
| usable rows (licence permits use) | 3,451 | 1,029 | 235 |
| sampled rows | 30 | 30 | 30 |
| sampled rows that render well | 30 | 30 | 25 |
| typical size, median bytes | 3,794,298 | 7,306,956 | 844,696 |
| sampled rows inside both ceilings | 20 of 30 | 22 of 30 | 28 of 30 |
| titles work as search text | no | partly | partly |
| recommendation | fetch from the source | skip | skip |

## Smithsonian Open Access 3D

`suvadityamuk/smithsonian-open-access-3d`, at revision `f2ce6fc4323095e1984994e86fb0ec0e4cdffb8e`.

### What is in it

The card says 3,451 rows. That is right, and it was counted by reading the row count out of every
one of the twelve parquet shards rather than trusting the card: 300 rows in each of shards 0 to 10,
299 in shard 5, and 152 in shard 11, which is 3,451 in total. The set's own
`meta/build_summary.json` agrees.

Each row is one 3D package from the Smithsonian Open Access record. Every row carries a licence
field, and all 3,451 read `CC0-1.0` with `media_usage_access` of `CC0`. Every row carries a
`mesh_url` pointing at the original Smithsonian file, either on
`smithsonian-open-access.s3-us-west-2.amazonaws.com` (2,136 rows) or on `3d-api.si.edu` (1,315
rows), plus a `size_bytes`, a triangle count and a vertex count. One package was excluded at build
time for having no downloadable glb, and it is listed in `meta/excluded.jsonl`.

The mesh source matters for the app:

| mesh_source | rows | draco | host |
| --- | --- | --- | --- |
| `web_high_nondraco` | 2,136 | no | s3 |
| `download_low_resolution` | 1,242 | no | 3d-api |
| `web_high` | 73 | yes (72 of them) | 3d-api |

So 72 rows, 2.1% of the set, are draco compressed. Every other row is a plain glb.

### How many render well

30 rows were sampled at random, with the draco rows deliberately included so the decoder would be
exercised. Every one was downloaded from its own `mesh_url` and parsed.

All 30 parsed. All 30 are a single mesh with a single primitive, which the gltf json confirms
directly. The median triangle count is 149,998, and the maximum is 150,000: the Smithsonian high
glb is capped at 150k faces, so the mesh side of the app's ceiling is never the problem here.

The harder question is whether a row reads as one object rather than a scene. Each file was split
into its connected parts and the parts were measured against the model's own bounding box. The
worst separation in the sample was 0.9592, that is the furthest two mass-carrying parts sit from
each other, as a share of the model's own longest side. Nothing in the sample had a part outside the
model's bounding box (`centroid_outside` was 0.0 for all 30). These are single specimens on a
plinth, not rooms.

The 30 splits do show that the Smithsonian exports are not welded. Part counts ran from 5 to 23,094,
and the largest connected part holds as little as 0.0028 of the faces on one cranium. That is a
property of the scan, not a defect: a cranium made of separate bone plates is still one skull, and
the app's sampler draws points on the surface regardless of how the vertices are connected. It does
mean a naive "is it one connected blob" test would wrongly fail this set, so the scene test was
done on where the parts sit, not on how many there are.

**30 of 30 sampled rows render well.** No failures: no parse failures, no broken files, no scenes.

### Size

Over the whole set the median file is 6,154,276 bytes, with a 25th percentile of 2,509,248 and a 75th
of 9,419,000. The smallest is 341,804 and the largest 40,220,792. 2,247 of the 3,451 rows, 65.1%,
are inside the 8 MB ceiling. On triangles, 3,442 of 3,451 are inside the 200k ceiling.

In the 30 sampled files the median was 3,794,298 bytes, the range ran from 693,148 to 16,869,472, and
20 of the 30, 67%, sat inside both ceilings. The 10 that did not were over on bytes alone; none was
over on triangles.

### Do the titles work as search text

No. 3,187 of the 3,451 titles, 92.4%, are a latin binomial, and only 11 start with a lower case
word. A sample of 50 drew a binomial every time:

```
Eulemur rufus                          Gorilla beringei beringei
Pan troglodytes verus                  Xestospongia rosariensis
Pongo pygmaeus                         Perodicticus potto
Simocetus rayi Fordyce, 2002           Isthminia panamensis Pyenson et al., 2015
Pycnopodia helianthoides               Quadrula stapes
```

The `package_title` field is better, because it names the bone: `Pongo pygmaeus: Cranium`,
`Alouatta pigra: Mandible`, `Dinictis cyclops (Cope): presentation`. It is still a taxon name plus
an anatomical part. The set does hold some ordinary objects, and they are the minority: `apron`,
`Kylix`, `Mechanic Engine Company Fire Hat`, `Alto saxophone owned and played by Charlie Parker`,
`Step stool used by the Pullman Palace Car Company`. Counting common query words against the
titles gives 3 rows for "chair", 1 for "knife", 1 for "helmet", 0 for "guitar", 0 for "book", 0 for
"clock" and 0 for "banana".

The set is also not evenly spread. 2,138 of the 3,451 rows come from the mammal division
(`NMNHMAMMALS`), 944 from invertebrate zoology and 219 from paleontology, so 3,301 of 3,451, 95.7%,
are bones, shells and fossils rather than furniture or tools.

### Licence

CC0 1.0. The card sets `license: cc0-1.0`, and every row's own `license` field reads `CC0-1.0` with
`media_usage_access` of `CC0`. The set's readme quotes the Smithsonian terms of use: "This Content is
not protected by copyright and may be used for commercial and noncommercial purposes without fee or
copyright restriction". Source: <https://www.si.edu/termsofuse>.

Two obligations the readme records, neither of which is a licence term: the Smithsonian asks for a
credit line of title, source, licence and source URL even though CC0 does not require one, and it
notes that CC0 covers copyright only, so trademark, privacy and publicity rights in some objects
remain with third parties. The readme also notes that collection language may be culturally
sensitive.

### Recommendation

**Fetch from the source.** It is the only one of the three that is both clean and free to use, and
it can be fetched from the source because the files are served with `access-control-allow-origin: *`
and no key.

The catch is the titles, and it is a catch that decides the shape of the work rather than whether
the work happens. A prompt of "chair" will not find a chair here. The titles work if the app
searches on the package title and the taxon, and if a fallback maps a plain word onto a taxon, which
is a different and larger piece of work than the one this issue asked for. On the evidence here the
honest first step is to use the set as a fetched backend with its own search, and to leave the plain
word mapping out of scope until it is designed.

## Google Scanned Objects

`suvadityamuk/google-scanned-objects`, at revision `b944bf0e56d93c82652b8b7243187be237434ed4`.

### What is in it

The card says 1,030 objects. The real number of model files is 1,029. The set's own
`stats/processing_log.jsonl` has 1,046 rows, of which 1,030 are `status: ok` and 16 are `status:
failed` with the reason `BadZipFile: File is not a zip file`. The 16 failures are the objects the
readme says were deliberately left out because they are not Google scans and carry different
licences: 13 from `OpenRobotics` (Bed, Cardboard box, Door handle, Fridge, Hinged door,
KitchenCountertop, LampAndStand, Plastic Cup, Shower, SquareShelf, Standard Toilet, Vanity,
WhiteCabinet) and 3 from `LeDSantos` (ada_lovelace_poster, garage_door, toilet_paper).

Counting the files rather than the log gives 1,029 glb members across all 43 tar shards, and the
difference is one object. Three of the ok log rows are not in the tar under their logged name: one
because its name is longer than the 100 bytes a tar header holds, so it lives under a pax header,
and two because their names contain a non-ascii character that the tar spells `Pok_mon` while the
log spells `Pokémon`. All three are present as files. So the set holds 1,029 model files, not 1,030.

Reading the tar shards was a job in itself: the 43 shards hold 21,914,422,983 bytes in total and the
model files are members inside them, so each shard was walked over http range requests to build an
index of 10,336 members.

Every object carries the same licence fields. All 1,028 objects whose json was read have
`license_id` of `cc-by-4.0`, `license_url` of `https://creativecommons.org/licenses/by/4.0/`,
`author` of `{"name": "Google", ...}` and `copyright` of `Copyright 2020 Google LLC.`.

### How many render well

30 rows were sampled at random across the whole set and their glb members pulled out of the tar
shards. Every one parsed, and every one is a single mesh with a single primitive. No draco: none of
the 30 uses `KHR_draco_mesh_compression`, and none of the set's processing records mention it.

The scene test is the clearest result of the three sets. Across the 30 files the connected parts
number from 1 to 445, but the largest part always holds the mass: the smallest largest-part share
was 0.2488, and 21 of the 30 are above 0.86. No file had a part sitting outside its own bounding
box. These are products on a table, and they read as one solid form.

**30 of 30 sampled rows render well.** No failures: no parse failures, no broken files, no scenes.

### Size

The size here is the problem. Every object's glb carries a 4096 by 4096 diffuse texture, which is
what pushes the files up. Over the 1,030 ok rows the median glb is 7,692,276 bytes, with a 25th
percentile of 6,158,418 and a 75th of 9,361,653. The smallest is 1,728,736 and the largest
19,399,760. Only 569 of 1,030, 55.2%, are inside the 8 MB ceiling.

In the 30 sampled files the median was 7,306,956 bytes, the range ran from 3,011,636 to 16,596,568,
and 22 of the 30, 73%, sat inside both ceilings. The 8 that did not were over on bytes alone; none
was over on triangles. Every sampled file was inside the 200k triangle ceiling, with a median of
16,455 and a maximum of 53,672, and the whole set is inside it: the 1,030 ok rows have a maximum of
101,142 triangles.

### Do the titles work as search text

Partly, and better than the other two. The names are the retail product names, so an object word
does appear, but it arrives wrapped in a brand and a colourway. A sample of 50:

```
3D_Dollhouse_Sink                       Threshold_Porcelain_Pitcher_White
Baby_Elements_Stacking_Cups             Ecoforms_Plant_Container_S24Turquoise
Cole_Hardware_Deep_Bowl_Good_Earth_1075 Ecoforms_Plate_S20Avocado
Black_Decker_CM2035B_12Cup_Thermal_Coffeemaker
Mens_Mako_Canoe_Moc_2Eye_Boat_Shoe_in_Coffee_9d05GG33QQQ
Tiek_Blue_Patent_Tieks_Italian_Leather_Ballet_Flats
Remington_1_12_inch_Hair_Straightener
```

So "sink", "bowl", "pitcher", "plate", "plant container" and "cups" are all findable by substring,
while "coffee maker" is not, because the file says `Coffeemaker`. The names are underscore joined
and mostly upper case, so a search has to fold case and treat `_` as a space. Of 1,030 objects,
812 carry a category and the categories are coarse: `Shoe` 254, `Consumer Goods` 246, `Toys` 147,
`Bottles and Cans and Cups` 53, `Bag` 28, `Media Cases` 21, `Action Figures` 17, `Board Games` 17,
`Legos` 10. A quarter of the set is footwear, which is not what a person types when they want a
"chair".

### Licence

CC BY 4.0. The set's `LICENSE` file states it, and every object's json carries
`license_id` of `cc-by-4.0`. Source:
<https://creativecommons.org/licenses/by/4.0/legalcode.txt>, and the set's own `LICENSE` file.

The conditions that bind the app are in section 3(a)(1) of that licence:

> If You Share the Licensed Material (including in modified form), You must: (a) retain the
> following if it is supplied by the Licensor with the Licensed Material: ... identification of the
> creator(s) ... a copyright notice ... a notice that refers to this Public License ... a URI or
> hyperlink to the Licensed Material to the extent reasonably practicable; (b) indicate if You
> modified the Licensed Material and retain an indication of any previous modifications; and (c)
> indicate the Licensed Material is licensed under this Public License, and include the text of, or
> the URI or hyperlink to, this Public License.

The app already has the shape for this. `src/objects/credit.ts` builds a credit of author, licence,
link and a note, and `CREDIT_NOTE` is `rendered as ASCII`, which is the modification notice the
licence asks for. What it would need from this set is a per-object link to the material and the
`Copyright 2020 Google LLC.` notice.

### Recommendation

**Skip.** The files are the best of the three: 30 of 30 rendered well, every one a single product
object with a low triangle count. Two things stop it.

The first is the licence obligation. CC BY 4.0 obliges the app to carry a credit on every model it
shows, with a link to the material and a modification note. That is a shipped behaviour, not a
disclaimer in a readme, and it has to be right for every object the app will ever show from the set.

The second is the size. The 4096 square texture on every file puts the median just under the 8 MB
ceiling and leaves 55.2% of the set under it, so most objects would be refused by the loader as it
stands. The texture is also the part that matters least for an ASCII render, so a re-encode could
fix it, but that is new work on 1,029 files.

Neither is a reason the set is bad. It is a reason it is not the first thing to build, and there is
a better use of the same effort.

## NASA 3D Resources

`suvadityamuk/nasa-3d-resources`, at revision `b509836ac86d058edfc13d21a6eadf995aa76300`.

### What is in it

The card says 931. That is the row count, and it was counted out of the eight parquet shards: 235
in `models`, 432 in `printables`, 99 in `textures` and 165 in `source_files`. The first three are
meshes or images, and `source_files` is a holding place for the original blender, 3ds and archive
files, which are of no use to the app. So the set offers 235 rows of models, and the `models` config
covers 206 distinct subjects, since some subjects ship several glb variants and each variant is its
own row.

Every model row carries a `source_url` that points at the original file, either on
`raw.githubusercontent.com` or on `science.nasa.gov`, and a `sha256`. 204 of the 235 model rows are
draco compressed. 11 of the 235 were contributed by organisations outside NASA and are flagged
`third_party_contributor`, which matters for the licence.

The set excludes anything carrying NASA insignia, and it says so: 23 glb files covering 14 models
were left out, along with the `NASA Insignia` and `CubeSat` printables and 41 original source files.

### How many render well

30 rows were sampled at random from the `models` config, with the draco rows included so the
decoder would be exercised, and each was downloaded from its own `source_url` and parsed.

All 30 parsed. This set is where the failures are, and they are of two kinds.

Five of the 30 are scenes rather than objects. In each the parts sit further apart than the model is
wide, or outside its own bounding box:

| row | part separation | outside its own bounds |
| --- | --- | --- |
| Tracking and Data Relay Satellites (TDRS) (A) | 6.9911 | 3.9507 |
| SeaStar | 2.2288 | 1.8408 |
| Landsat 4 and 5 | 3.0325 | 2.8354 |
| Active Cavity Irradiance Monitor Satellite (AcrimSAT) (B) | 27.3761 | 26.9052 |
| Tether | 98.6017 | 49.2512 |

The `Tether` row is the clearest case: a cable whose parts are 98 times the model's longest side
apart, which is a long thin line rather than an object. These are the rows that would draw as an
unreadable smear of glyphs.

The second kind is a part that holds almost none of the geometry. In 11 of the 30 the largest
connected part holds under 5% of the faces: `Space Shuttle Parts` at 0.0002, `Tall Dish` at 0.0001,
`70 meter dish` at 0.0001, `Magnetospheric Multiscale (MMS) (B)` at 0.004, `Wide Field Planetary
Camera` at 0.0045. These are assembled models built from many separate panels, each panel its own
part. They still draw as one form, because the panels sit together inside the model's bounds, so
they are counted as well.

**25 of 30 sampled rows render well.** The 5 that fail are scenes, all of them named above. No
parse failures and no broken files.

### Size

Over the 235 model rows the median file is 716,840 bytes, with a 25th percentile of 214,264 and a
75th of 1,921,268. The smallest is 2,916 and the largest 22,431,576. 223 of the 235, 94.9%, are
inside the 8 MB ceiling, the best of the three sets by some way.

On triangles the set is the other way round. The median is 25,064 but the maximum is 2,029,759, and
only 210 of the 235, 89.4%, are inside the 200k ceiling. The 25 that are not are the heavy
assemblies.

In the 30 sampled files the median was 844,696 bytes, the range ran from 21,752 to 11,696,720, and
28 of the 30, 93%, sat inside both ceilings. The 2 that did not were over on bytes alone; none was
over on triangles in the sample.

### Do the titles work as search text

Partly. The titles are catalogue names for spacecraft and instruments, and a plain object word does
appear in some of them. A sample of 50:

```
Wrench                                Tall Dish
Radome                                Satellite Kit
Crew Lock Bag                         Advanced Crew Escape Suit
JSC Mission Control Room              Space Shuttle Parts
Viking Lander                         Mars Global Surveyor
Cassini Assembly                      Hubble Space Telescope (A)
```

So "wrench", "dish", "suit", "lander", "camera" and "telescope" are findable by substring. But the
titles are mostly proper nouns of missions: `Mars Reconnaissance Orbiter (MMR) (C)`,
`Active Cavity Irradiance Monitor Satellite (AcrimSAT) (B)`, `Mars Atmosphere and Volatile
EvolutioN (MAVEN) (B)`, `Atmosphere-Space Transition Region Explorer (ASTRE)`, `1999 RQ36 asteroid`.
Counting across the 235 model titles, 32 contain "satellite", 9 "telescope", 9 "shuttle", 6 "probe",
4 "dish", 3 "suit", 2 "camera", 2 "module", 1 "rover", 1 "helmet" and 1 "lander".

The suffixes are also noisy: a single subject ships as `(A)`, `(B)`, `(C)`, so "Aqua" finds four
rows and "Cassini-Huygens" finds four. And 15 rows are listed under more than one title through
`also_listed_under`.

### Licence

Not an open licence. The card sets `license: other`, `license_name: nasa-media-usage-guidelines`
and points at <https://www.nasa.gov/nasa-brand-center/images-and-media/>.

The NASA Images and Media Usage Guidelines say:

> NASA content - images, audio, video, and media files used in the rendition of 3-dimensional
> models, such as texture maps and polygon data in any format - generally are not subject to
> copyright in the United States. You may use this material for educational or informational
> purposes, including photo collections, textbooks, public exhibits, computer graphical simulations
> and Internet Web pages.

And:

> NASA content used in a factual manner that does not imply endorsement may be used without needing
> explicit permission. NASA should be acknowledged as the source of the material.

The guidelines go on to say that "The NASA Insignia, Logotype, identifiers, and imagery are not in
the public domain", and for AI work specifically: "NASA cannot verify the accuracy of information
once it's incorporated into a large language model. Therefore, attribution of the information
directly to NASA is not permitted", "NASA does not permit our Insignia (i.e., NASA Meatball, Worm
logotype, or Seal) to appear with AI generated imagery or in the training of AI tools", and "All
outputs from the AI model should be attributed to the AI product itself, not NASA. References like
'according to NASA' or similar are prohibited in AI products."

So the obligations on the app are these. NASA content is generally free of copyright in the United
States, but the terms are a permission rather than a licence, and they are written for educational
and informational use, with commercial use handled separately and conditional on not implying
endorsement. NASA should be acknowledged as the source. The use must not imply endorsement. NASA
asks that AI outputs be marked as AI generated and not attributed to NASA. And the copyright status
outside the United States is not stated by NASA at all.

### Recommendation

**Skip.** It is the one set that cannot be redistributed cleanly. The NASA terms are a permission
that is written around educational and informational use and that says nothing about the copyright
status outside the United States, so bundling any of it in a public app is a judgement the app
cannot make for itself. Fetching from the source puts the same question on every load, and the
insignia and AI wording make it a live question rather than a formality.

The content is also the least suited. 5 of the 30 sampled rows were scenes that would draw as a
smear, and the objects themselves are spacecraft: a person typing "chair" will never find one here,
and the titles that do read plainly are things like `Wrench`, `Radome` and `Tall Dish`.

## Why this shape

The Smithsonian set is the one worth building on, for three reasons that the measurements support
rather than assume.

It is the only set where every sampled row rendered well, at 30 of 30, and where nothing in the
sample was a scene. Every file is a single mesh with a single primitive. That is a cleaner starting
point than the other two, where one in six NASA rows was a scene and where a scene needs to be
detected and skipped.

It is the only set with a licence that asks nothing of the app. CC0 obliges no credit and no
disclosure, so the shipped behaviour does not change.

And it is fetchable on the app's terms. The files come off two hosts with
`access-control-allow-origin: *`, need no key, and are not a service that can be billed or
withdrawn: the Smithsonian Open Access program publishes these as a public bucket and a public api.
Nothing about it is a hosted inference service.

What it costs is the title mapping, and that cost is real. 92.4% of the titles are latin binomials
and the prompt path matches a typed word against a title, so the set as it stands does not answer
"chair". The work is a search over the package title and the taxon, with a curated map from plain
words onto the subjects the set holds, and that map is the thing to design before any of it is
written. The measurement here says the set is worth that work. It does not say what the map should
say.

## How to reproduce

Everything was measured from the hub at the revisions named above. Scratch files went to
`$LOCALAPPDATA/Temp/hf-eval`, never into the repo.

The hub api and the file tree, which give the row counts and the licences:

```sh
curl --ssl-no-revoke "https://huggingface.co/api/datasets/suvadityamuk/smithsonian-open-access-3d"
curl --ssl-no-revoke "https://huggingface.co/api/datasets/suvadityamuk/google-scanned-objects"
curl --ssl-no-revoke "https://huggingface.co/api/datasets/suvadityamuk/nasa-3d-resources"
curl --ssl-no-revoke "https://huggingface.co/api/datasets/suvadityamuk/smithsonian-open-access-3d/tree/main?recursive=true"
```

The parquet row counts were read out of each shard's footer over http range requests, so no shard
was downloaded whole. The datasets-server rows endpoint fails on all three, the Smithsonian one with
"The server is busier than usual and the response is not ready yet" and the NASA one with
"could not determine the type of the data cell", so the shards were read directly. The google set
is a webdataset and its rows endpoint fails with "The dataset generation failed", so its tar shards
were walked instead, the same way, reading the tar headers over range requests.

The model files were sampled at random with a fixed seed, downloaded, and parsed twice: once by
reading the gltf json out of the glb directly, for the mesh count, primitive count, triangle count,
image count and extension list, and once by loading the file with the app's own
`GLTFLoader` and `DRACOLoader` from `src/objects/url-loader.ts`, for the parse and the triangle
count the loader would see. The draco rows were sampled on purpose, so the decoder was exercised
rather than assumed.

The scene test was done by splitting each mesh into its connected parts with a union-find over the
vertex graph, then measuring where the parts that carry the mass sit relative to the model's own
bounding box. A row counts as a scene when a mass-carrying part sits more than one model's
longest side from another, or outside the model's own bounds. The count of parts on its own was not
used, because the Smithsonian exports are not welded and a bone made of separate plates is still one
object.

The browser checks were run in a real chromium, since a node parse cannot answer what a browser
sees. The draco decode, the CORS behaviour of every host and the app's own `prepare` were all
checked in the browser. The one thing a browser check found that a command line check did not is
that `3d-api.si.edu` answers a `HeadlessChrome` user agent with a 245 byte "Request Rejected" page
and no CORS header, while a normal browser user agent gets the real file with
`access-control-allow-origin: *`. The 30 Smithsonian files that were parsed under node all parsed
in the browser too, the 6 that failed under node being the draco ones, which failed only because
node has no `Worker`.

The licence texts were read from the source, not from a summary: the Smithsonian terms of use at
<https://www.si.edu/termsofuse>, the CC BY 4.0 legal code at
<https://creativecommons.org/licenses/by/4.0/legalcode.txt> and the NASA guidelines at
<https://www.nasa.gov/nasa-brand-center/images-and-media/>.
