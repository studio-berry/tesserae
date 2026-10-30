# The prompt benchmark

The instrument every quality claim in the moonshot plan is measured with. Two hundred prompts in ten
categories go through a source, each render is screenshotted and judged by a vision model, and the
run writes a report that says how often the picture read as its prompt and how long the first glyph
took to arrive.

```sh
npm run bench -- --sources prompt,chat
```

It starts the dev server and headless Chrome itself. Nothing else needs to be running, and the run
is one command so a number in the docs can be reproduced by rerunning it.

## What it measures

| column | what it is |
|---|---|
| `reads` | the render reads as its prompt, three judgements, majority |
| `thumbnail reads` | the same frame at 256x160, so a picture that needs the full screen does not count |
| `first glyph` | milliseconds from navigation to the first frame the stage draws |

`first glyph` is read from the page's own clock. A script installed before the app runs watches
`.hud .eyebrow` and records the first moment it says `assembling`, `rendering` or `scanning`;
nothing waits on a fixed sleep for a render. A screenshot is only taken after the phase has held
`rendering` for three seconds, because dev-mode StrictMode runs the prepare effect twice and a
picture taken on the first pass is a half-built object.

## The judge

`bench/judge.ts` sends each image to a vision model with one question:

> The image is a 3D object drawn as small glyphs, dots or lettering. Would an ordinary person
> recognise this as "&lt;prompt&gt;"? Judge the shape and its distinctive parts, not the detail: a
> coarse render that still has the body, limbs, spout or other parts that name the thing is a READ. A
> different object, or a shapeless mass, is a NOT.

Three calls per image at temperature 0.7, majority vote. The reply is parsed strictly: only a reply
whose first word is `READ` counts as a read, and anything hedged counts as a miss. A judge that is
allowed to be vague is not an instrument.

The first wording asked "does it read as the prompt" and was harsher than a person: it called a
recognisable Utah teapot "a sphere with two side tubes". The wording above names the bar, which is
what a hand check is for.

The model is pinned by a probe over the same gateway the app's scene writer uses:

| model | one image, one question |
|---|---|
| `claude-haiku-5-5` | 1.5 s |
| `gpt-6-luna` | 3.1 s |
| `gemini-4-argon` | 4.9 s |
| `qwen3.8-max` | 12.5 s |

`claude-haiku-5-5` is the default in `bench/judge.ts` and `BENCH_JUDGE_MODEL` moves it. A judge that
changes underneath the benchmark breaks every comparison, so a run records the model it used in its
report.

## Checking the judge against an eye

The judge is the risk. Before any number it produces is trusted, forty of its judgements are checked
against a person:

```sh
npm run bench:agree -- --run bench/results/2026-10-29 --sample 40
# look at the forty pictures, write { id, source, human: true|false } lines to human.jsonl
npm run bench:agree -- --run bench/results/2026-10-29 --human bench/results/2026-10-29/human.jsonl
```

Below 85 per cent agreement the judge prompt is wrong and no other measurement is worth taking.

## What a run writes

`bench/results/<date>/`:

| file | holds |
|---|---|
| `report.md` | the tables: per source and per category, read rate, thumbnail rate, p50/p95 |
| `results-<stamp>.jsonl` | one row per prompt and source, appended as it lands |
| `meta-<stamp>.json` | the judge, the density, the theme, the sources |
| `shots/<stamp>/` | the 1280x800 screenshot and its 256x160 thumbnail for every render |

The pictures are gitignored: two hundred of them is 80 MB. The report and the rows are committed,
because they are the record.

## Options

| flag | default | what it does |
|---|---|---|
| `--sources` | `prompt` | `prompt`, `chat`, `ply` |
| `--limit` | all 200 | the first N prompts, for a smoke run |
| `--concurrency` | 3 | browsers to run at once |
| `--density` | 12000 | glyphs, the app's `n=` |
| `--theme` | dark | light or dark |
| `--out` | `bench/results/<date>` | where the run writes |
| `--reuse` | off | do not start a dev server; expect one at `--port` |
| `--no-judge` | off | take the screenshots, judge nothing |

## Traps

- **A shared browser is a background tab.** Only the focused tab asks for frames, and this app only
  advances while it renders, so a second tab in one Chrome measured a frozen stage and reported
  every prompt as a failure. Each worker gets its own browser, port and profile.
- **`Page.navigate` answers when the navigation starts, not when it lands.** Every DOM query in
  between reaches the page the browser is leaving, so the phase, the title and the clock all come
  from the previous prompt and read as a suspiciously fast render. The driver waits for
  `location.search` to match the URL it asked for before it measures anything.
- **A reasoning judge can spend its whole completion budget and return an empty string**, which the
  parser scores as a NOT. The cap is 400 tokens, and a retry after two failures gives it 1,200.
- **The dev server binds `::1` by default.** The runner passes `--host 127.0.0.1`, because headless
  Chrome pointed at `127.0.0.1` against a `::1` bind gets `ERR_CONNECTION_REFUSED`, which reads like
  a crashed app.
- **A worktree has no `.env`.** The judge key lives in the ignored file at the primary checkout.
  Copy it, or pass `--env <path>`; without a key the run still takes its screenshots and says so.
- **The thumbnail is made by the same browser.** The screenshot is drawn into a 256x160 canvas in
  the page that took it, so the small picture is the same frame and not a second render.
- **One prompt that will not load is a failed row, not the end of the run.** The runner records the
  error and carries on; an hour of work must not be lost to one dead tab.

## What was measured

200 prompts, 12,000 glyphs, dark theme, one machine, 30 October 2026.

| source | read | thumbnail | page clock p50 | wall p50 |
|---|---|---|---|---|
| search sources (`--sources prompt`) | 39% (78/200) | 35% | 269 ms | not recorded |
| scene writer (`--sources chat`) | 50% (99/200) | 60% | 269 ms | not recorded |
| the baseline model (`--sources ply`) | 0% (0/200) | 1% | 292 ms | 6.2 s |

The search sources read best on animals (60 per cent) and worst on things in motion (15 per cent),
which is what a phrase like "a wheel rolling" asks of a search index. The scene writer reads best on
tools (75 per cent) and worst on buildings (25 per cent).

**The page clock reads the app booting, not the source answering.** For the search sources that is
close enough (the first glyph arrives with the object), but the baseline's own run shows the gap:
292 ms on the page clock against 6.2 s of wall clock, and the scene writer's line in the app reads
8.4 to 16.1 s. The runner records both numbers now; the wall column is what a fresh visit costs.

**The judge agrees with an eye on 36 of 40 images (90 per cent).** `hand-check.jsonl` and
`human.jsonl` are committed beside the report, so the check can be re-scored. All four disagreements
were the judge accepting a render the eye refused, which makes the read rates a little generous
rather than harsh. The plan's gate is 85 per cent.

## The baseline


`--sources ply` scores a sampled cloud through the same path a dropped file takes: the runner opens
`?ply=/bench/samples/<id>.ply`, the app fetches and parses the file with its own loader, and the stage
draws it. `ml/cloudgen/to_bench.py` writes those files.
