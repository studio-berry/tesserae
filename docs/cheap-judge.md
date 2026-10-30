# A judge cheap enough to run in a loop

The benchmark's judge is a vision model asked three times and majority-voted. It is the right
instrument for a released number and the wrong one for a training loop, because one image costs about
fifteen seconds: scoring two hundred samples takes an hour, and a step of nine hundred checkpoints is
not affordable that way.

`ml/cloudgen/cheap_judge.py` is the stand-in. It is a frozen image encoder plus a logistic head fitted
to the full judge's own verdicts, and it is a distillation of the judge rather than a second opinion.
That distinction is the whole reason it works and the whole reason it has a ceiling.

    cd ml
    env -u PYTHONPATH -u PYTHONHOME .venv/Scripts/python.exe -m cloudgen.cheap_judge \
      --results ../bench/results/2026-10-29 \
      --extra ../bench/results/2026-10-29-ply \
      --out artifacts/judge-head.npz \
      --report ../bench/results/judge-head.json

It reads the verdicts and thumbnails already in a benchmark run directory, so it needs no new judging
and no network. The head it writes is a few kilobytes and is committed at `ml/artifacts/judge-head.npz`
so a training run can score a checkpoint without fitting anything first.

## What it measures, and what it does not

Six hundred judged images from the two committed runs: 400 from the search and chat sources, 200 from
the server baseline, split 480 train and 120 test, stratified by source and verdict, because that
population is lopsided in both.

| | agreement | read rate, judge | read rate, head | false accepts | false rejects |
|---|---|---|---|---|---|
| train, 480 | 99.6 per cent | 29.4 | 29.8 | 2 | 0 |
| held out, 120 | 77.5 per cent | 30.0 | 30.8 | 14 | 13 |

The held-out row is the only one worth quoting. Two things follow from it, and neither is negotiable.

- **The aggregate tracks even where the verdicts do not.** On held out images it reports a 30.8 per
  cent read rate where the judge says 30.0, and its individual calls are wrong on one image in four,
  in both directions. So it is a gauge for a training loop watching a trend, and it is not evidence
  for a gate. Anything that lands in `docs/moonshot.md` as a score still comes from the real judge.
- **One in four calls is wrong, and the errors are not one-sided.** Fourteen renders the judge refused
  were accepted, thirteen it accepted were refused. A monitor that only ever erred one way would at
  least be correctable by a threshold; this one is not, which is why the threshold is fitted for
  balanced accuracy rather than picked for the rate.

The encoder here is `pixels`, the default, because it needs no download. It is a 32 by 20 grey layout
of the image plus local contrast and edge energy per cell in a 4 by 4 grid, 688 numbers, and it
separates "a dense object" from "a scatter of noise", which is most of what a read rate asks. A frozen
resnet18 is the stronger option and is one flag away (`--encoder resnet18`); it is **unverified on this
machine**, because neither `download.pytorch.org` nor `huggingface.co` would complete a fetch while
this was written, and a feature path nobody has run is not a feature path. Measure it before trusting
it.

The ridge term is 0.1 on purpose. At 1e-2 the head memorised the training half at 99.6 per cent while
agreeing on 76 per cent of the held-out half, which is what 688 features against a few hundred images
does.

## Using it in a loop

    from cloudgen.cheap_judge import Head, features

    head = Head.load("ml/artifacts/judge-head.npz")
    x = features([str(p) for p in thumbs], encoder="pixels")
    reads = head.predict(x).mean()

Compare checkpoints against each other with the same head on the same prompts. Do not compare one
checkpoint's head score with another run's judge score; they are different instruments with a known
seventeen-point disagreement on individual images.
