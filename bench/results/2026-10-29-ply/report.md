# Prompt benchmark, 2026-10-30

200 prompts, baseline (server model), 12000 glyphs, theme dark.
Judge: `claude-haiku-5-5`, three calls per image at temperature 0.7, majority vote.

## Read rate and time to first glyph

| source | tested | drawn | reads | thumbnail reads | page clock p50 | p95 | wall p50 | p95 |
|---|---|---|---|---|---|---|---|---|
| baseline (server model) | 200 | 200 | 0% (0/200) | 1% | 292 ms | 330 ms | 6224 ms | 6988 ms |

## By category

| category | prompts |  ply reads | ply thumb | 
|---| ---|---| ---|
| household | 20 | 0% | 0% |
| tool | 20 | 0% | 0% |
| vehicle | 20 | 0% | 0% |
| building | 20 | 0% | 0% |
| animal | 20 | 0% | 0% |
| plant | 20 | 0% | 0% |
| food | 20 | 0% | 0% |
| abstract | 20 | 0% | 5% |
| scene | 20 | 0% | 0% |
| motion | 20 | 0% | 0% |

## What the judge said about the misses

| id | prompt | source | reason |
|---|---|---|---|
| p001 | a teapot | ply | a shapeless oval cloud, with no visible spout, handle, or lid. |
| p002 | a coffee cup with a saucer | ply | a shapeless glyph cloud with no discernible cup, handle, or saucer. |
| p003 | a cast iron frying pan | ply | a shapeless, scattered point cloud with no discernible handle, pan body, or cooking-surface outline. |
| p004 | a wooden chair | ply | the glyph cloud is a triangular mass with no chair legs, seat, or back. |
| p005 | a table lamp | ply | a shapeless, blobby cloud of glyphs with no lamp base, shade, or stem visible. |
| p006 | a bookshelf | ply | an irregular glyph cloud with no shelves, frame, or book-like parts. |
| p007 | a washing machine | ply | a shapeless glyph cloud with no washing machine parts visible. |
| p008 | a toaster | ply | a shapeless glyph cloud with no toaster parts visible. |
| p009 | a wine glass | ply | no clear bowl, stem, and base; it reads as a shapeless cloud. |
| p010 | a kitchen knife on a cutting board | ply | a vague, elongated glyph cloud with no discernible knife blade, handle, or board. |
| p011 | a floor lamp | ply | a vertical, blobby glyph cloud with no discernible lamp base, pole, or shade. |
| p012 | a sofa | ply | a shapeless glyph cloud with no discernible sofa body, arms, or legs. |
