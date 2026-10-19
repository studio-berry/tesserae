# /// script
# requires-python = ">=3.11"
# dependencies = ["pyarrow"]
# ///
"""Builds a static prompt index of Objaverse models: caption -> GLB on the Hub, with its credit.

Joins three keyless Hugging Face datasets:
  allenai/objaverse          object-paths.json.gz and metadata/*.json.gz (licence, author, page)
  tiange/Cap3D               Cap3D_automated_Objaverse_full.csv (uid -> caption, ODC-By)
  cindyxl/ObjaversePlusPlus  default/train parquet (uid -> quality score and traits, ODC-By)

Offline only: nothing in the app reads this yet. Downloads (~900 MB) land in --data, which must
stay out of src/ and out of git.

  uv run scripts/objaverse-index.py --data .cache/objaverse --out .cache/objaverse/index.json
  uv run scripts/objaverse-index.py --data .cache/objaverse --report
"""
import argparse
import csv
import functools
import gzip
import json
import random
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HUB = 'https://huggingface.co/datasets'
SOURCES = {
    'object-paths.json.gz': f'{HUB}/allenai/objaverse/resolve/main/object-paths.json.gz',
    'cap3d.csv': f'{HUB}/tiange/Cap3D/resolve/main/Cap3D_automated_Objaverse_full.csv',
    'plusplus.parquet': f'{HUB}/cindyxl/ObjaversePlusPlus/resolve/refs%2Fconvert%2Fparquet/default/train/0000.parquet',
}
CHUNKS = [f'000-{i:03d}' for i in range(160)]
LICENCES = {'by': 'CC BY 4.0'}
# the same ceilings the Commons model path holds a download to (src/objects/search.ts)
MAX_BYTES = 8_000_000
MAX_FACES = 200_000

PROMPTS = ['lighthouse', 'teapot', 'bicycle', 'skull', 'guitar', 'chair', 'car', 'dog', 'tree', 'castle']


def fetch(url: str, dest: Path):
    if dest.exists() and dest.stat().st_size > 0:
        return
    part = dest.with_suffix(dest.suffix + '.part')
    for attempt in range(8):
        try:
            with urllib.request.urlopen(url, timeout=60) as res, open(part, 'wb') as out:
                while block := res.read(1 << 20):
                    out.write(block)
            part.replace(dest)
            return
        except OSError as err:
            print(f'  retry {attempt + 1} {dest.name}: {err}', file=sys.stderr)
            time.sleep(2 + attempt * 2)
    raise SystemExit(f'could not fetch {url}')


def download(data: Path):
    (data / 'metadata').mkdir(parents=True, exist_ok=True)
    jobs = [(url, data / name) for name, url in SOURCES.items()]
    jobs += [(f'{HUB}/allenai/objaverse/resolve/main/metadata/{c}.json.gz', data / 'metadata' / f'{c}.json.gz') for c in CHUNKS]
    with ThreadPoolExecutor(8) as pool:
        list(pool.map(lambda j: fetch(*j), jobs))


def load_quality(data: Path):
    import pyarrow.parquet as pq
    rows = pq.read_table(data / 'plusplus.parquet').to_pylist()
    return {r['UID']: r for r in rows}


def load_captions(data: Path):
    with open(data / 'cap3d.csv', encoding='utf-8', newline='') as f:
        return {uid: cap.strip() for uid, cap in csv.reader(f)}


def load_meta(data: Path, wanted: set[str]):
    meta = {}
    for c in CHUNKS:
        with gzip.open(data / 'metadata' / f'{c}.json.gz') as f:
            for uid, m in json.load(f).items():
                if uid not in wanted:
                    continue
                user = m.get('user') or {}
                glb = (m.get('archives') or {}).get('glb') or {}
                meta[uid] = {
                    'licence': m.get('license'),
                    'author': (user.get('displayName') or user.get('username') or '').strip(),
                    'url': m.get('viewerUrl') or f'https://sketchfab.com/3d-models/{uid}',
                    'name': (m.get('name') or '').strip(),
                    'adult': bool(m.get('isAgeRestricted')),
                    'faces': m.get('faceCount') or 0,
                    'bytes': glb.get('size') or 0,
                }
    return meta


@functools.cache
def load(data: Path):
    quality = load_quality(data)
    with gzip.open(data / 'object-paths.json.gz') as f:
        paths = json.load(f)
    return quality, paths, load_captions(data), load_meta(data, set(quality) & set(paths))


def build(data: Path, min_score: int, log=print):
    """Every filter in order, logging the rows left after each, so the funnel is the report."""
    quality, paths, captions, meta = load(data)

    steps = [
        ('objaverse++ rows', lambda u, q, m: True),
        ('in object-paths', lambda u, q, m: u in paths),
        ('has metadata', lambda u, q, m: m is not None),
        ('licence CC BY 4.0', lambda u, q, m: m['licence'] in LICENCES),
        (f'score >= {min_score}', lambda u, q, m: q['score'] >= min_score),
        ('not a scene', lambda u, q, m: q['is_scene'] == 'false'),
        ('single object', lambda u, q, m: q['is_multi_object'] == 'false'),
        ('not transparent', lambda u, q, m: q['is_transparent'] == 'false'),
        ('has a Cap3D caption', lambda u, q, m: u in captions),
        ('has an author', lambda u, q, m: bool(m['author'])),
        ('not age-restricted', lambda u, q, m: not m['adult']),
        (f'glb <= {MAX_BYTES // 1_000_000} MB, faces <= {MAX_FACES // 1000}K', lambda u, q, m: 0 < m['bytes'] <= MAX_BYTES and m['faces'] <= MAX_FACES),
    ]
    alive = list(quality)
    funnel = []
    for label, keep in steps:
        alive = [u for u in alive if keep(u, quality[u], meta.get(u))]
        funnel.append((label, len(alive)))
        log(f'  {label:<34} {len(alive):>8,}')

    rows = [{
        'uid': u,
        'caption': captions[u],
        'glbPath': paths[u],
        'author': meta[u]['author'],
        'sourceUrl': meta[u]['url'],
        'licence': LICENCES[meta[u]['licence']],
        # kept beside the row for the report; dropped from the written index unless --name
        '_name': meta[u]['name'],
        '_score': quality[u]['score'],
    } for u in alive]
    rows.sort(key=lambda r: (-r['_score'], len(r['caption']), r['uid']))
    return rows, funnel


def public(rows, with_name=False):
    out = []
    for r in rows:
        row = {k: v for k, v in r.items() if not k.startswith('_')}
        if with_name:
            row['name'] = r['_name']
        out.append(row)
    return out


def encode(rows):
    return json.dumps(rows, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


STOP = {'a', 'an', 'the', 'of', 'and', 'with', 'in', 'on', 'for', 'its', 'is', 'to', 'at', 'it', 'model', '3d'}
WORD = re.compile(r'[a-z0-9]+')


def tokens(s: str):
    return {w for w in WORD.findall(s.lower()) if w not in STOP}


def match(rows, prompt: str, field: str, n=3):
    """Simple token overlap: the share of prompt words a row's caption holds, fewer words first.
    'agree' counts a word only when the Sketchfab title holds it too, which drops most rows whose
    caption names the wrong thing (a water tower captioned as a lighthouse)."""
    want = tokens(prompt)
    scored = []
    for r in rows:
        have = tokens(r['caption'])
        found = want & have
        if field == 'agree':
            found &= tokens(r['_name'])
        if found:
            scored.append((-len(found) / len(want), len(have), r))
    scored.sort(key=lambda s: (s[0], s[1]))
    return [s[2] for s in scored[:n]], len(scored)


def show(rows, field):
    for p in PROMPTS:
        top, total = match(rows, p, field)
        print(f'  {p} ({total} hits)')
        for r in top:
            print(f'    {r["uid"]}  [{r["_name"][:30]}]  {r["caption"][:90]}')


def report(data: Path):
    print('# funnel, score = 3')
    strict, _ = build(data, 3)
    print('\n# funnel, score >= 2')
    loose, _ = build(data, 2)

    print('\n# gzip size (rows sorted by score, then caption length; first N kept)')
    for label, rows in (('score = 3', strict), ('score >= 2', loose)):
        for n in (20_000, 50_000):
            if len(rows) < n:
                print(f'  {label:<11} {n:>6,} rows: only {len(rows):,} available')
                continue
            plain, named = encode(public(rows[:n])), encode(public(rows[:n], True))
            print(f'  {label:<11} {n:>6,} rows: {len(plain) / 1e6:5.1f} MB raw, {len(gzip.compress(plain, 9)) / 1e6:4.2f} MB gzip'
                  f'  (+name: {len(gzip.compress(named, 9)) / 1e6:4.2f} MB gzip)')

    print('\n# 20 random captions, score = 3')
    rng = random.Random(7)
    for r in rng.sample(strict, 20):
        print(f'  [{r["_name"][:28]:<28}] {r["caption"]}')

    head = strict[:20_000]
    print('\n# prompt matches, caption only, first 20K of score = 3')
    show(head, 'caption')
    print('\n# prompt matches, caption and title agree, first 20K of score = 3')
    show(head, 'agree')
    print(f'\n# prompt matches, caption and title agree, all {len(strict):,} of score = 3')
    show(strict, 'agree')


def main():
    sys.stdout.reconfigure(encoding='utf-8')  # names and captions are not all ascii
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--data', type=Path, default=Path('.cache/objaverse'), help='download directory, outside src/ and git')
    ap.add_argument('--out', type=Path, help='write the index JSON here')
    ap.add_argument('--min-score', type=int, default=3, choices=(0, 1, 2, 3))
    ap.add_argument('--limit', type=int, default=20_000, help='rows to keep, best first (0 = all)')
    ap.add_argument('--name', action='store_true', help="also keep the Sketchfab title in each row")
    ap.add_argument('--report', action='store_true', help='print the funnel, sizes, samples and prompt matches')
    args = ap.parse_args()

    download(args.data)
    if args.report:
        report(args.data)
    if args.out:
        rows, _ = build(args.data, args.min_score)
        rows = public(rows[:args.limit] if args.limit else rows, args.name)
        args.out.write_bytes(encode(rows))
        print(f'wrote {len(rows):,} rows to {args.out}')


if __name__ == '__main__':
    main()
