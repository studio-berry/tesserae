# ml

Training code for the model that draws an object from a prompt. Python and PyTorch, kept out of the
app's bundle: the app ships sampled clouds and (later) an ONNX export, never this.

```sh
uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe torch --index-url https://download.pytorch.org/whl/cu124
uv pip install --python .venv/Scripts/python.exe numpy transformers pytest
```

## The pipeline

```sh
# 1. the data, from the app's own export (docs/training-data.md)
npm run export:objaverse                      # 20,000 rows into .cache/training/objaverse

# 2. train
python -m cloudgen.train --data ../.cache/training/objaverse --out runs/base --steps 30000

# 3. sample, one trajectory and one cloud per prompt
python -m cloudgen.sample --ckpt runs/base/last.pt --prompts ../bench/prompts.jsonl \
  --steps 32 --out runs/base/samples

# 4. the clouds the benchmark can open
python -m cloudgen.to_bench --samples runs/base/samples --out ../bench/samples
npm run bench -- --sources ply
```

## What is here

| module | holds |
|---|---|
| `cloudgen/data.py` | the shard reader, the manifest rules, a batch with a random turn about Y |
| `cloudgen/text.py` | the frozen text encoder, and the hashed stand-in for an offline test |
| `cloudgen/model.py` | the patch transformer, the rectified-flow loss and the Euler walk |
| `cloudgen/train.py` | the loop, the record a model card quotes |
| `cloudgen/sample.py` | a prompt to a `.traj` and a `.ply` |
| `cloudgen/traj.py` | the `.traj` format the app reads, and the `.ply` writer |
| `cloudgen/to_bench.py` | sampled clouds into `bench/samples/` |

## Traps

- **`PYTHONPATH` pointing at another virtualenv wins over the one you activated.** On this machine
  it points at a Hermes environment, so `python -c "import numpy"` in a fresh venv fails with a
  missing `_multiarray_umath` that is really a `cp314` numpy being imported by a `cp312` interpreter.
  Run the venv's `python.exe` with `env -u PYTHONPATH -u PYTHONHOME`.
- **`pytest`'s `tmp_path` base is unscannable on this Windows box**, so pass
  `--basetemp "$LOCALAPPDATA/Temp/pytest-cloudgen"`.
- **`ml/.venv` is gitignored**, and a worktree needs its own install.
