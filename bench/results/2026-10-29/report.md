# Prompt benchmark, 2026-10-30

200 prompts, prompt (search backends) and chat (scene writer), 12000 glyphs, theme dark.
Judge: `claude-haiku-5-5`, three calls per image at temperature 0.7, majority vote.

## Read rate and time to first glyph

| source | tested | drawn | reads | thumbnail reads | first glyph p50 | p95 |
|---|---|---|---|---|---|---|
| prompt (search backends) | 200 | 200 | 39% (78/200) | 35% | 269 ms | 377 ms |
| chat (scene writer) | 200 | 200 | 50% (99/200) | 60% | 269 ms | 305 ms |

## By category

| category | prompts |  prompt reads | prompt thumb |  chat reads | chat thumb | 
|---| ---|---| ---|---| ---|
| household | 20 | 25% | 30% | 40% | 55% |
| tool | 20 | 50% | 40% | 75% | 85% |
| vehicle | 20 | 45% | 35% | 50% | 45% |
| building | 20 | 30% | 25% | 25% | 45% |
| animal | 20 | 60% | 60% | 65% | 75% |
| plant | 20 | 45% | 35% | 50% | 60% |
| food | 20 | 40% | 40% | 35% | 45% |
| abstract | 20 | 50% | 55% | 45% | 65% |
| scene | 20 | 30% | 15% | 55% | 65% |
| motion | 20 | 15% | 15% | 55% | 60% |

## What the judge said about the misses

| id | prompt | source | reason |
|---|---|---|---|
| p003 | a cast iron frying pan | prompt | shows a double helix, not a frying pan. |
| p004 | a wooden chair | prompt | it reads as a blocky box with handles; no legs or clear chair structure show. |
| p005 | a table lamp | prompt | it's a rounded, shapeless mass with no visible lamp base, stem, or shade. |
| p006 | a bookshelf | prompt | a plain tilted slab with no visible shelves or bookshelf structure. |
| p007 | a washing machine | prompt | it's a flat toroidal washer ring, not a washing machine's drum, door, or body. |
| p010 | a kitchen knife on a cutting board | prompt | the render is a shapeless blob-like sphere with no visible knife blade, handle, or board. |
| p011 | a floor lamp | prompt | a shapeless blob with no pole, base, or lamp shade. |
| p012 | a sofa | prompt | it's a cylinder-like block, resembling a digital sundial, with no sofa parts. |
| p013 | a bedside table | prompt | reads as a lamp or floating blocks, not a table with legs. |
| p014 | a kettle | prompt | a rounded blob with no clear kettle spout or handle. |
| p015 | a mixing bowl | prompt | reads as a dense sphere, with no clear bowl opening or base. |
| p016 | a broom | prompt | Shows a blobby bust-like mass, not a broom's handle and bristles. |
