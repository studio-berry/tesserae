"""Train the denoiser on the exported shards.

    python -m cloudgen.train --data ../.cache/training/objaverse --out runs/base --steps 20000

One card, one process, no distributed anything: the baseline is meant to be the number the rest of
the plan has to beat, so it should be reproducible by one person on one machine. Every run writes a
`train.json` naming its data, its screening and its config, and that file is what a model card quotes.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
import torch

from .data import CloudDataset, load_shards
from .model import PointDiT, flow_loss
from .text import encoder


def cosine_lr(step: int, total: int, warmup: int, peak: float) -> float:
    if step < warmup:
        return peak * (step + 1) / max(1, warmup)
    progress = (step - warmup) / max(1, total - warmup)
    return peak * (0.05 + 0.95 * 0.5 * (1 + math.cos(math.pi * progress)))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="the export folder holding meta.json and shards")
    ap.add_argument("--out", required=True, help="where checkpoints and the run's record go")
    ap.add_argument("--steps", type=int, default=20_000)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--warmup", type=int, default=500)
    ap.add_argument("--dim", type=int, default=384)
    ap.add_argument("--depth", type=int, default=10)
    ap.add_argument("--heads", type=int, default=6)
    ap.add_argument("--patch", type=int, default=16)
    ap.add_argument("--points", type=int, default=4096)
    ap.add_argument("--cond", choices=["cross", "ada"], default="cross")
    ap.add_argument("--text", default="minilm", help="the frozen text encoder: minilm or hashed")
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--log-every", type=int, default=50)
    ap.add_argument("--save-every", type=int, default=2_000)
    ap.add_argument("--limit-shards", type=int, default=0)
    ap.add_argument("--turn", action="store_true", default=True)
    ap.add_argument("--no-turn", dest="turn", action="store_false")
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    manifest, shards = load_shards(args.data, limit_shards=args.limit_shards or None)
    dataset = CloudDataset(shards, seed=args.seed, turn=args.turn)
    print(f"{len(shards)} shards, {len(dataset)} clouds, screening: {manifest.screening_note}", flush=True)

    encode = encoder(args.text, device="cpu")
    model = PointDiT(
        points=args.points, patch=args.patch, dim=args.dim, depth=args.depth,
        heads=args.heads, text_dim=encode.dim, cross=args.cond == "cross",
    ).to(args.device)
    print(f"{model.parameters_count() / 1e6:.1f}M parameters, cond {args.cond}, text {encode.name}", flush=True)

    # the text encoder runs once, over every caption, and the loop indexes its rows: a frozen encoder
    # in the hot path would spend a third of the step budget re-encoding the same phrases
    started = time.time()
    embeddings = encode.encode(dataset.captions())
    print(f"encoded {len(embeddings)} captions in {time.time() - started:.0f}s", flush=True)

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, betas=(0.9, 0.95), weight_decay=0.01)
    record = {
        "args": vars(args), "parameters": model.parameters_count(), "clouds": len(dataset),
        "shards": len(shards), "index": manifest.index, "screened": manifest.screened,
        "screening": manifest.screening_note, "revisions": manifest.revisions,
        "text_encoder": encode.name, "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (out / "train.json").write_text(json.dumps(record, indent=2), encoding="utf-8")

    running = None
    best = float("inf")
    started = time.time()
    log = (out / "train.log").open("a", encoding="utf-8")
    for step in range(args.steps):
        lr = cosine_lr(step, args.steps, args.warmup, args.lr)
        for group in opt.param_groups:
            group["lr"] = lr
        cloud, picked, _ = dataset.batch(args.batch)
        x1 = torch.from_numpy(cloud).to(args.device)
        text = torch.from_numpy(embeddings[picked]).to(args.device)
        loss = flow_loss(model, x1, text)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()

        value = float(loss.detach())
        running = value if running is None else running * 0.98 + value * 0.02
        if step % args.log_every == 0:
            line = f"step {step:6d} loss {value:.4f} ema {running:.4f} lr {lr:.2e} {time.time() - started:.0f}s"
            print(line, flush=True)
            log.write(line + "\n")
            log.flush()
        if (step + 1) % args.save_every == 0 or step + 1 == args.steps:
            ckpt = {
                "model": model.state_dict(),
                "config": {
                    "points": args.points, "patch": args.patch, "dim": args.dim, "depth": args.depth,
                    "heads": args.heads, "text_dim": encode.dim, "cross": args.cond == "cross",
                },
                "text_encoder": encode.name,
                "step": step + 1,
                "loss": value,
                "train": "train.json",
            }
            torch.save(ckpt, out / "last.pt")
            if running < best:
                best = running
                torch.save(ckpt, out / "best.pt")
            print(f"saved at step {step + 1}", flush=True)

    record["finished"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    record["minutes"] = round((time.time() - started) / 60, 1)
    record["best_ema"] = best
    (out / "train.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    log.close()


if __name__ == "__main__":
    main()
