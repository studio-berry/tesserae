"""The frozen text encoder that conditions the model.

Objaverse captions are short descriptive phrases ("a small ceramic teapot"), so a sentence encoder
trained on paraphrase pairs already puts the words the app's prompts use in the same neighbourhood.
It is frozen: nothing here is trained, and the weights are the only thing the model reads.

`hashed` is the offline stand-in: a deterministic bag of character trigrams. It carries no meaning,
so a model trained against it learns nothing useful, but it makes the data path, the tests and a
smoke run work on a machine with no network and no model download.
"""

from __future__ import annotations

import hashlib
from typing import Protocol

import numpy as np

MINILM = "sentence-transformers/all-MiniLM-L6-v2"


class Encoder(Protocol):
    dim: int
    name: str

    def encode(self, texts: list[str]) -> np.ndarray: ...


class Hashed:
    """Character trigrams hashed into a fixed width, L2 normalised. Deterministic, meaningless."""

    name = "hashed"

    def __init__(self, dim: int = 384):
        self.dim = dim

    def encode(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for i, text in enumerate(texts):
            flat = " ".join(text.lower().split())
            for at in range(max(1, len(flat) - 2)):
                gram = flat[at : at + 3]
                h = int.from_bytes(hashlib.blake2b(gram.encode("utf-8"), digest_size=4).digest(), "little")
                out[i, h % self.dim] += 1.0 if (h >> 31) & 1 else -1.0
            norm = np.linalg.norm(out[i])
            if norm:
                out[i] /= norm
        return out


class MiniLM:
    """`all-MiniLM-L6-v2`, mean pooled and L2 normalised. The encoder the trained model used."""

    name = MINILM

    def __init__(self, device: str = "cpu"):
        from transformers import AutoModel, AutoTokenizer  # imported here so a test can run without it

        self.tok = AutoTokenizer.from_pretrained(MINILM)
        self.model = AutoModel.from_pretrained(MINILM).to(device).eval()
        self.device = device
        self.dim = int(self.model.config.hidden_size)
        self._cache: dict[str, np.ndarray] = {}

    def encode(self, texts: list[str], batch: int = 64) -> np.ndarray:
        import torch

        # each distinct text once: a repeated caption would otherwise be encoded every time it appears
        todo = list(dict.fromkeys(t for t in texts if t not in self._cache))
        for start in range(0, len(todo), batch):
            chunk = todo[start : start + batch]
            with torch.no_grad():
                tok = self.tok(chunk, padding=True, truncation=True, max_length=64, return_tensors="pt").to(self.device)
                hidden = self.model(**tok).last_hidden_state
                mask = tok["attention_mask"].unsqueeze(-1)
                pooled = (hidden * mask).sum(1) / mask.sum(1).clamp(min=1e-6)
                pooled = torch.nn.functional.normalize(pooled, dim=-1)
            for text, vec in zip(chunk, pooled.cpu().numpy()):
                self._cache[text] = vec.astype(np.float32)
        return np.stack([self._cache[t] for t in texts])


def encoder(name: str, device: str = "cpu") -> Encoder:
    if name == "hashed":
        return Hashed()
    if name == MINILM or name == "minilm":
        return MiniLM(device=device)
    raise ValueError(f"unknown text encoder {name!r}: use {MINILM!r} or 'hashed'")
