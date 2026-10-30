"""Move sampled clouds where the benchmark can open them.

The benchmark scores the baseline the way a person would: by dropping a model file on the app. In a
headless run that is a `?ply=` link, so this copies each sampled `.ply` to `bench/samples/<id>.ply`
and writes the index the runner reads.

    python -m cloudgen.to_bench --samples runs/base/samples --out ../bench/samples
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", required=True, help="a folder written by cloudgen.sample")
    ap.add_argument("--out", required=True, help="where the app's dev server can serve the files")
    ap.add_argument("--only", default="", help="a comma-separated list of ids")
    args = ap.parse_args()

    samples = Path(args.samples)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    index = json.loads((samples / "index.json").read_text(encoding="utf-8"))
    only = {s.strip() for s in args.only.split(",") if s.strip()}

    rows = []
    for row in index["rows"]:
        if only and row["id"] not in only:
            continue
        source = samples / row["ply"]
        if not source.exists():
            continue
        shutil.copyfile(source, out / f"{row['id']}.ply")
        rows.append({"id": row["id"], "prompt": row["prompt"], "ply": f"/bench/samples/{row['id']}.ply"})

    (out / "index.json").write_text(json.dumps({"from": str(samples), "step": index.get("step"), "rows": rows}, indent=2), encoding="utf-8")
    print(f"copied {len(rows)} clouds into {out}")


if __name__ == "__main__":
    main()
