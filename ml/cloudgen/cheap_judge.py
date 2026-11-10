"""A judge cheap enough to score a training run.

The full judge is a vision model asked three times and majority-voted. That is the right instrument
for a release number and the wrong one for a loop that wants to know whether checkpoint 9,000 is
better than checkpoint 8,500, because it costs about fifteen seconds an image.

This is the cheap stand-in. A frozen image encoder (resnet18's pooled features) plus a logistic head
fitted to the full judge's own verdicts. It is a distillation of the judge, not a second opinion, and
its agreement with the judge on images it never trained on is the only number that says how far to
trust it. Against a human label it is weaker still, and the report says so.

    python -m cloudgen.cheap_judge --results bench/results/2026-10-29 --out ml/artifacts/judge-head.npz

Point it at any directory of benchmark results; the verdicts and the thumbnails are already in them.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from dataclasses import dataclass

import numpy as np

THUMB = "thumb"


@dataclass
class Row:
    """One scored image: what the app drew, what the full judge said, and where the picture lives."""

    uid: str
    source: str
    path: str
    label: int


def load_rows(results: pathlib.Path) -> list[Row]:
    """Every judged image in a benchmark run, as (uid, source, thumbnail path, label)."""
    rows: list[Row] = []
    for jsonl in sorted(results.glob("results-*.jsonl")):
        for line in jsonl.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            if r.get("reads") is None:
                continue
            # the thumbnail is what the judge sees as well, so the head sees the same pixels
            shot = r.get("thumb") or r.get("shot")
            if not shot:
                continue
            path = results / shot
            if not path.exists():
                continue
            rows.append(Row(f"{r['source']}-{r['id']}", r["source"], str(path), int(bool(r["reads"]))))
    return rows


def pixels(paths: list[str], grid: tuple[int, int] = (32, 20), cells: int = 4) -> np.ndarray:
    """Offline encoder: a coarse grey layout, its local contrast, and edge energy per cell.

    Weaker than a frozen CNN, and it needs no download, which matters because this machine cannot
    reach either weight host. It is honest about what it is: a layout and edge histogram that can tell
    a dense object from a scatter of noise, which is most of what the read rate asks.
    """
    from PIL import Image

    out = np.zeros((len(paths), grid[0] * grid[1] + cells * cells * 3), dtype=np.float32)
    for i, p in enumerate(paths):
        with Image.open(p) as im:
            g = np.asarray(im.convert("L").resize((grid[1] * 8, grid[0] * 8), Image.BILINEAR), dtype=np.float32) / 255.0
        h, w = g.shape
        cell_h, cell_w = h // cells, w // cells
        feats = [g.reshape(grid[0], 8, grid[1], 8).mean(axis=(1, 3)).ravel()]
        for cy in range(cells):
            for cx in range(cells):
                block = g[cy * cell_h : (cy + 1) * cell_h, cx * cell_w : (cx + 1) * cell_w]
                gy, gx = np.gradient(block)
                feats.append(np.array([block.mean(), block.std(), np.hypot(gx, gy).mean()], dtype=np.float32))
        out[i] = np.concatenate(feats)
    return out


def resnet(paths: list[str], batch: int = 32) -> np.ndarray:
    """Frozen resnet18 features. Needs torchvision and a weights download, so it is opt-in."""
    import torch
    from PIL import Image
    from torchvision.models import ResNet18_Weights, resnet18

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = resnet18(weights=ResNet18_Weights.DEFAULT)
    model.fc = torch.nn.Identity()
    model.eval().to(device)
    mean = torch.tensor([0.485, 0.456, 0.406], device=device).view(1, 3, 1, 1)
    std = torch.tensor([0.229, 0.224, 0.225], device=device).view(1, 3, 1, 1)

    out: list[np.ndarray] = []
    with torch.no_grad():
        for start in range(0, len(paths), batch):
            chunk = paths[start : start + batch]
            pixels_ = []
            for p in chunk:
                with Image.open(p) as im:
                    im = im.convert("RGB").resize((224, 224), Image.BILINEAR)
                    pixels_.append(torch.tensor(np.asarray(im), dtype=torch.float32).permute(2, 0, 1) / 255.0)
            x = torch.stack(pixels_).to(device)
            out.append(model((x - mean) / std).cpu().numpy())
    return np.concatenate(out, axis=0)


ENCODERS = {"pixels": pixels, "resnet18": resnet}


def features(paths: list[str], encoder: str = "pixels") -> np.ndarray:
    return ENCODERS[encoder](paths)


@dataclass
class Head:
    """Standardise, then a logistic fit. Small enough to commit and to argue about."""

    mean: np.ndarray
    scale: np.ndarray
    w: np.ndarray
    b: float
    threshold: float

    def score(self, x: np.ndarray) -> np.ndarray:
        return 1.0 / (1.0 + np.exp(-(((x - self.mean) / self.scale) @ self.w + self.b)))

    def predict(self, x: np.ndarray) -> np.ndarray:
        return (self.score(x) >= self.threshold).astype(int)

    def save(self, path: pathlib.Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez(path, mean=self.mean, scale=self.scale, w=self.w, b=self.b, threshold=self.threshold)

    @classmethod
    def load(cls, path: pathlib.Path) -> "Head":
        z = np.load(path)
        return cls(z["mean"], z["scale"], z["w"], float(z["b"]), float(z["threshold"]))


def fit(x: np.ndarray, y: np.ndarray, steps: int = 600, rate: float = 0.1, l2: float = 0.1) -> Head:
    """Logistic regression by full-batch gradient descent: deterministic, and no dependency to pin.

    The ridge term is loose-handed on purpose. The offline encoder gives 688 features for a few
    hundred images, and at 1e-2 the head memorised the training half (99.6 per cent) while agreeing
    with the judge on 76 per cent of the held-out half.
    """
    mean = x.mean(axis=0)
    scale = x.std(axis=0) + 1e-6
    z = (x - mean) / scale
    w = np.zeros(z.shape[1])
    b = 0.0
    for _ in range(steps):
        p = 1.0 / (1.0 + np.exp(-(z @ w + b)))
        err = p - y
        w -= rate * (z.T @ err / len(y) + l2 * w)
        b -= rate * float(err.mean())
    head = Head(mean, scale, w, b, 0.5)
    head.threshold = best_threshold(head.score(x), y)
    return head


def best_threshold(p: np.ndarray, y: np.ndarray) -> float:
    """The cut that maximises balanced accuracy, so a rare positive cannot be won by guessing 0."""
    if y.min() == y.max():
        return 0.5
    best, at = -1.0, 0.5
    for t in np.unique(np.round(p, 3)):
        pred = p >= t
        tpr = pred[y == 1].mean()
        tnr = (~pred)[y == 0].mean() if (y == 0).any() else 1.0
        if 0.5 * (tpr + tnr) > best:
            best, at = 0.5 * (tpr + tnr), float(t)
    return at


def report(head: Head, x: np.ndarray, y: np.ndarray) -> dict:
    pred = head.predict(x)
    tp = int(((pred == 1) & (y == 1)).sum())
    fp = int(((pred == 1) & (y == 0)).sum())
    fn = int(((pred == 0) & (y == 1)).sum())
    tn = int(((pred == 0) & (y == 0)).sum())
    n = len(y)
    return {
        "n": n,
        "agree": round((tp + tn) / n, 3) if n else 0.0,
        "read_rate_true": round(float(y.mean()), 3) if n else 0.0,
        "read_rate_pred": round(float(pred.mean()), 3) if n else 0.0,
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
    }


def split(rows: list[Row], frac: float = 0.2, seed: int = 7) -> tuple[list[Row], list[Row]]:
    """Stratified by source and label, because both are lopsided and an unstratified split lies."""
    rng = np.random.default_rng(seed)
    buckets: dict[tuple[str, int], list[Row]] = {}
    for r in rows:
        buckets.setdefault((r.source, r.label), []).append(r)
    train: list[Row] = []
    test: list[Row] = []
    for key in sorted(buckets):
        group = [buckets[key][i] for i in rng.permutation(len(buckets[key]))]
        cut = max(1, int(round(len(group) * frac)))
        test.extend(group[:cut])
        train.extend(group[cut:])
    return train, test


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="fit a cheap stand-in for the benchmark's vision judge")
    ap.add_argument("--results", required=True, type=pathlib.Path, help="a benchmark run directory")
    ap.add_argument("--extra", action="append", default=[], type=pathlib.Path,
                    help="another run directory, scored the same way (e.g. the baseline run)")
    ap.add_argument("--out", type=pathlib.Path, default=pathlib.Path("ml/artifacts/judge-head.npz"))
    ap.add_argument("--encoder", choices=sorted(ENCODERS), default="pixels",
                    help="pixels needs nothing; resnet18 fetches weights and is stronger")
    ap.add_argument("--report", type=pathlib.Path, help="write the numbers here as JSON")
    args = ap.parse_args(argv)

    rows = load_rows(args.results)
    for more in args.extra:
        rows.extend(load_rows(more))
    if len(rows) < 40:
        print(f"only {len(rows)} judged images; that is not enough to fit anything", file=sys.stderr)
        return 1
    labels = np.array([r.label for r in rows])
    if labels.min() == labels.max():
        print("every image carries the same verdict: nothing to separate", file=sys.stderr)
        return 1

    train, test = split(rows)
    print(f"{len(train)} train, {len(test)} test, {int(labels.sum())} of {len(rows)} read")
    xtr = features([r.path for r in train], args.encoder)
    xte = features([r.path for r in test], args.encoder)
    head = fit(xtr, np.array([r.label for r in train]))
    head.save(args.out)

    numbers = {
        "train": report(head, xtr, np.array([r.label for r in train])),
        "test": report(head, xte, np.array([r.label for r in test])),
        "threshold": head.threshold,
        "encoder": args.encoder,
        "features": int(xtr.shape[1]),
    }
    print(json.dumps(numbers, indent=2))
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(numbers, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
