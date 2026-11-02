"""Run the trainer, and run it again from its last resume point if it dies.

    python -m cloudgen.train_retry --retries 5 -- --data ../.cache/training/objaverse --out runs/base --steps 30000

Everything after `--` goes to `cloudgen.train`, with `--resume` added. A zero exit ends the loop; a
non-zero one (a driver fault, a kernel crash) starts the trainer again, which picks up from
`<out>/resume.pt` or from step 0 when no save has happened yet. The wait before a restart lets the
driver come back.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--retries", type=int, default=3, help="restarts after the first launch")
    ap.add_argument("--wait", type=float, default=30.0, help="seconds to wait before each restart")
    ap.add_argument("train_args", nargs=argparse.REMAINDER, help="after `--`: the arguments for cloudgen.train")
    args = ap.parse_args()
    train_args = args.train_args[1:] if args.train_args[:1] == ["--"] else args.train_args
    if "--resume" not in train_args:
        train_args = [*train_args, "--resume"]

    code = 0
    for attempt in range(args.retries + 1):
        code = subprocess.call([sys.executable, "-m", "cloudgen.train", *train_args])
        if code == 0:
            return 0
        if attempt < args.retries:
            print(f"trainer exited {code}; restart {attempt + 1} of {args.retries} in {args.wait:.0f}s", flush=True)
            time.sleep(args.wait)
    print(f"trainer exited {code}; out of retries", flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
