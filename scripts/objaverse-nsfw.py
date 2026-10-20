"""Checks the thumbnails of indexed models for explicit content, offline.

The word filters catch a title that says something explicit. They cannot catch a model whose
title and tags are innocent but whose render is not, and Objaverse's own `isAgeRestricted` flag
removed nothing. So the thumbnails are looked at.

The classifier runs here, offline, while the index is built. Nothing at runtime depends on it:
the app never loads a classifier, and the index it ships has already been filtered.

The model is a ViT image classifier that says `normal` or `nsfw`, from the Falconsai detector
and its ONNX conversion on the hub. The thumbnails are the 256 px ones in the sketchfab
metadata, which are small enough to check every model cheaply.

  python scripts/objaverse-nsfw.py --data .cache/objaverse --out .cache/objaverse/nsfw.json
"""

import argparse
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

# The classifier and where it lives. The commit is pinned, so the pass reads the same model
# every time it runs.
MODEL_REPO = 'onnx-community/nsfw_image_detection-ONNX'
MODEL_REVISION = '1ceb3c7fe1e9f3f2507e6df577437f23a9149fd5'
MODEL_FILE = 'onnx/model.onnx'
MODEL_URL = f'https://huggingface.co/{MODEL_REPO}/resolve/{MODEL_REVISION}/{MODEL_FILE}'

# The size the classifier was trained at, and the mean and scale it expects.
SIZE = 224
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# The label the model gives an explicit image, and the share of the output it has to reach
# before a model is dropped. The model outputs one probability, so the threshold is the only
# choice: it is set low, because a false drop costs a model and a missed one costs the app its
# content rule.
NSFW = 1
THRESHOLD = 0.5

# The thumbnail to check. The metadata holds five sizes, and the smallest is 256 px, which is
# enough for the classifier and small enough to fetch for every model.
THUMB = 256


def fetch(url: str, dest: Path, tries: int = 5) -> bool:
    """Fetches a file, retrying, because the hub resets a connection now and then.

    The windows certificate store cannot check a revocation server that is offline, and the
    sketchfab media host sits behind a chain that ends on one, so python's own fetch fails
    where curl succeeds. Curl is tried first, and python is the fallback.
    """
    if dest.exists() and dest.stat().st_size > 0:
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    import shutil
    import ssl
    import subprocess
    import time

    curl = shutil.which('curl')
    for attempt in range(tries):
        try:
            if curl:
                done = subprocess.run(
                    [curl, '-sSL', '--ssl-no-revoke', '--max-time', '60', '-o', str(dest), url],
                    capture_output=True, timeout=90)
                if done.returncode == 0 and dest.exists() and dest.stat().st_size > 0:
                    return True
            with urllib.request.urlopen(url, timeout=60, context=ssl.create_default_context()) as res:
                dest.write_bytes(res.read())
            return True
        except Exception as err:
            print(f'  retry {attempt + 1} {dest.name}: {err}', file=sys.stderr)
            time.sleep(2 + attempt * 2)
    return False


def load_model(cache: Path) -> ort.InferenceSession:
    """The classifier, fetched once and held in the cache."""
    path = cache / 'nsfw-model.onnx'
    if not fetch(MODEL_URL, path):
        raise SystemExit(f'could not fetch the classifier from {MODEL_URL}')
    return ort.InferenceSession(str(path), providers=['CPUExecutionProvider'])


def to_input(image: Image.Image) -> np.ndarray:
    """The image as the classifier wants it: 224 px, normalised, in the order the model reads."""
    image = image.convert('RGB').resize((SIZE, SIZE), Image.BILINEAR)
    a = np.asarray(image, dtype=np.float32) / 255.0
    a = (a - MEAN) / STD
    # the model wants NCHW
    return np.transpose(a, (2, 0, 1))[np.newaxis, ...].astype(np.float32)


def score(session: ort.InferenceSession, image: Image.Image) -> float:
    """The share of the output that says the image is explicit."""
    name = session.get_inputs()[0].name
    out = session.run(None, {name: to_input(image)})
    logits = np.asarray(out[0]).reshape(-1)
    # the model gives logits, so the probability comes from the softmax over the two labels
    exp = np.exp(logits - logits.max())
    prob = exp / exp.sum()
    return float(prob[NSFW])


def thumb_url(meta: dict) -> str | None:
    """The smallest thumbnail the metadata holds, which is the one worth checking."""
    images = (meta.get('thumbnails') or {}).get('images') or []
    small = [i for i in images if i.get('width') == THUMB]
    if not small:
        small = [i for i in images if i.get('width')]
    if not small:
        return None
    return min(small, key=lambda i: i.get('width', 10 ** 9)).get('url')


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--data', type=Path, default=Path('.cache/objaverse'), help='the download directory')
    ap.add_argument('--out', type=Path, help='write the flagged uids here')
    ap.add_argument('--limit', type=int, default=0, help='check at most this many models (0 = all)')
    ap.add_argument('--threshold', type=float, default=THRESHOLD, help='the share that counts as explicit')
    ap.add_argument('--index', type=Path, help='the index to check, so only shipped models are looked at')
    ap.add_argument('--workers', type=int, default=12, help='how many thumbnails to fetch at once')
    args = ap.parse_args()

    session = load_model(args.data)
    print(f'classifier ready, threshold {args.threshold}', file=sys.stderr)

    meta_dir = args.data / 'metadata'
    flagged: dict[str, float] = {}
    checked = 0
    failures = 0

    import gzip
    from concurrent.futures import ThreadPoolExecutor

    # the models that actually ship, so the pass checks the index rather than the whole
    # collection. A model the index does not hold can never reach the app.
    wanted: set[str] = set()
    if args.index:
        with gzip.open(args.index, 'rt', encoding='utf-8') as f:
            wanted = {r['uid'] for r in json.load(f)['data']}
        print(f'checking the {len(wanted)} models the index holds', file=sys.stderr)

    def check(uid: str, meta: dict) -> tuple[str, float] | None:
        url = thumb_url(meta)
        if not url:
            return None
        thumb = args.data / 'thumbs' / f'{uid}.jpg'
        if not fetch(url, thumb, tries=2):
            return None
        try:
            with Image.open(thumb) as image:
                return (uid, score(session, image))
        except Exception as err:
            print(f'  could not read {uid}: {err}', file=sys.stderr)
            return None

    jobs: list[tuple[str, dict]] = []
    for chunk in sorted(meta_dir.glob('*.json.gz')):
        with gzip.open(chunk, 'rt', encoding='utf-8') as f:
            rows = json.load(f)
        for uid, meta in rows.items():
            if wanted and uid not in wanted:
                continue
            jobs.append((uid, meta))
        if args.limit and len(jobs) >= args.limit:
            break
    if args.limit:
        jobs = jobs[:args.limit]
    print(f'{len(jobs)} models to check', file=sys.stderr)

    with ThreadPoolExecutor(args.workers) as pool:
        for i, out in enumerate(pool.map(lambda j: check(*j), jobs), 1):
            checked += 1
            if out:
                uid, s = out
                if s >= args.threshold:
                    flagged[uid] = s
                    print(f'  flagged {uid} {s:.3f}')
            if i % 250 == 0:
                print(f'  checked {i}, flagged {len(flagged)}', file=sys.stderr)

    print(f'checked {checked}, flagged {len(flagged)}, failures {failures}')
    if args.out:
        args.out.write_text(json.dumps(flagged, indent=1))
        print(f'wrote {len(flagged)} flagged uids to {args.out}')


if __name__ == '__main__':
    main()
