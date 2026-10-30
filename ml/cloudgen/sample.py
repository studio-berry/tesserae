"""A prompt in, a trajectory and its final cloud out.

    python -m cloudgen.sample --ckpt runs/base/last.pt --prompt "a teapot" --steps 32 --out out/

Two files per prompt: `<id>.traj` (every frame of the walk, for the app's trajectory source) and
`<id>.ply` (the final cloud, which the app's own file loader already reads). `--prompts` takes a
jsonl with `id` and `prompt` fields, which is exactly what `bench/prompts.jsonl` holds.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch

from .model import PointDiT, sample as walk
from .text import encoder
from .traj import write_ply, write_traj


def load(ckpt_path: str | Path, device: str) -> tuple[PointDiT, dict, str]:
    ckpt = torch.load(ckpt_path, map_location=device, weights_only=False)
    config = dict(ckpt["config"])
    model = PointDiT(**config).to(device).eval()
    model.load_state_dict(ckpt["model"])
    return model, ckpt, str(ckpt.get("text_encoder", "minilm"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--prompt", default="")
    ap.add_argument("--prompts", default="", help="a jsonl of {id, prompt} rows, run in order")
    ap.add_argument("--steps", type=int, default=32)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", required=True)
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--save-trajectory", action="store_true", default=True)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    torch.manual_seed(args.seed)
    model, ckpt, encoder_name = load(args.ckpt, args.device)
    encode = encoder(encoder_name, device="cpu")

    if args.prompts:
        rows = [json.loads(line) for line in Path(args.prompts).read_text(encoding="utf-8").splitlines() if line.strip()]
    elif args.prompt:
        rows = [{"id": "sample", "prompt": args.prompt, "seed": args.seed}]
    else:
        raise SystemExit("give --prompt or --prompts")

    index = []
    for row in rows:
        prompt = str(row["prompt"])
        ident = str(row.get("id", "sample"))
        seed = int(row.get("seed", args.seed))
        started = time.time()
        text = torch.from_numpy(encode.encode([prompt])).to(args.device)
        frames = walk(model, text, steps=args.steps, seed=seed)[:, 0].cpu().numpy()  # [frames, P, 6]
        traj = write_traj(out / f"{ident}.traj", frames) if args.save_trajectory else None
        ply = write_ply(out / f"{ident}.ply", frames[-1])
        index.append({
            "id": ident, "prompt": prompt, "seed": seed, "steps": args.steps,
            "frames": int(frames.shape[0]), "points": int(frames.shape[1]),
            "traj": traj.name if traj else None, "ply": ply.name,
            "ms": round((time.time() - started) * 1000),
        })
        print(f"{ident} {prompt} → {ply.name} in {index[-1]['ms']} ms", flush=True)

    record = {
        "ckpt": str(args.ckpt), "step": ckpt.get("step"), "text_encoder": encoder_name,
        "steps": args.steps, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "rows": index,
    }
    (out / "index.json").write_text(json.dumps(record, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
