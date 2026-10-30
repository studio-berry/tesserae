"""Train the denoiser on the exported shards.

    python -m cloudgen.train --data ../.cache/training/objaverse --out runs/base --steps 20000
    python -m cloudgen.train --data ../.cache/training/objaverse --data ../.cache/procedural/part-* \
        --mix 0.75,0.25 --precision bf16 --out runs/mix --steps 30000

One card, one process, no distributed anything: the baseline is meant to be the number the rest of
the plan has to beat, so it should be reproducible by one person on one machine. Every run writes a
`train.json` naming its data, its screening and its config, and that file is what a model card quotes.

Each `--data` is one group, and may name several folders (a shell glob expands into them). With
`--mix`, each batch takes that share of its clouds from each group; without it, one draw over every
row, which is how a single folder always trained. `--precision bf16` runs the forward pass under
bfloat16 autocast, with fp32 weights and optimiser state.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
import torch

from .data import CloudDataset, caption_table, load_groups, parse_mix
from .model import PointDiT, flow_loss
from .text import encoder


def cosine_lr(step: int, total: int, warmup: int, peak: float) -> float:
    if step < warmup:
        return peak * (step + 1) / max(1, warmup)
    progress = (step - warmup) / max(1, total - warmup)
    return peak * (0.05 + 0.95 * 0.5 * (1 + math.cos(math.pi * progress)))


def step_loss(model: PointDiT, x1: torch.Tensor, text: torch.Tensor, precision: str = "fp32") -> torch.Tensor:
    """The flow loss for one batch, under bfloat16 autocast when asked. The weights stay fp32, so the
    gradients and the optimiser state are full precision; only the forward pass is cast."""
    with torch.autocast(device_type=x1.device.type, dtype=torch.bfloat16, enabled=precision == "bf16"):
        loss = flow_loss(model, x1, text)
    return loss.float()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, action="append", nargs="+",
                    help="export folders holding meta.json and shards; repeat for another group")
    ap.add_argument("--mix", default=None, help="each group's share of a batch, comma separated, in --data order")
    ap.add_argument("--precision", choices=["fp32", "bf16"], default="fp32",
                    help="bf16 autocasts the forward pass; weights and optimiser stay fp32")
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

    groups = load_groups(args.data, limit_shards=args.limit_shards or None)
    weights = parse_mix(args.mix, len(groups))
    shards = [s for g in groups for s in g.shards]
    owner = [k for k, g in enumerate(groups) for _ in g.shards]
    for k, g in enumerate(groups):
        g.weight = weights[k] if weights else None
    dataset = CloudDataset(shards, seed=args.seed, turn=args.turn, groups=owner, weights=weights)
    for g in groups:
        share = f"{g.weight:.0%} of each batch" if g.weight is not None else "drawn by row count"
        notes = sorted({m.screening_note for m in g.manifests})
        print(f"{len(g.folders)} folders, {len(g.shards)} shards, {g.rows} clouds, {share}, screening: {'; '.join(notes)}", flush=True)

    encode = encoder(args.text, device="cpu")
    model = PointDiT(
        points=args.points, patch=args.patch, dim=args.dim, depth=args.depth,
        heads=args.heads, text_dim=encode.dim, cross=args.cond == "cross",
    ).to(args.device)
    print(f"{model.parameters_count() / 1e6:.1f}M parameters, cond {args.cond}, text {encode.name}", flush=True)

    # the text encoder runs once, over each distinct caption, and the loop indexes its rows: a frozen
    # encoder in the hot path would spend a third of the step budget re-encoding the same phrases
    started = time.time()
    distinct, caption_ids = caption_table(dataset.captions())
    table = encode.encode(distinct)
    print(f"encoded {len(distinct)} distinct captions of {len(caption_ids)} in {time.time() - started:.0f}s", flush=True)

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, betas=(0.9, 0.95), weight_decay=0.01)
    record = {
        "args": vars(args), "parameters": model.parameters_count(), "clouds": len(dataset),
        "shards": len(shards), "captions": len(distinct), "data": [g.record() for g in groups],
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
        text = torch.from_numpy(table[caption_ids[picked]]).to(args.device)
        loss = step_loss(model, x1, text, args.precision)
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
                "precision": args.precision,
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
