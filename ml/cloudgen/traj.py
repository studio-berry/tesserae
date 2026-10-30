"""The trajectory file, and the point cloud that goes with it.

`.traj` is what the app's `trajectory` source reads: every frame of a sampling run, so the stage can
replay the walk as the assembly animation. It is a 20-byte header and then float32 frames, little
endian, in the order the sampler produced them. Frame 0 is the noise the walk started from.

    magic    char[4]   "GATJ"
    version  uint32    1
    frames   uint32    steps + 1, including the noise
    points   uint32    4096
    channels uint32    6 (x, y, z, nx, ny, nz)
    data     float32[frames][points][channels]

The header is fixed rather than self-describing on purpose: a reader that guesses at a layout is a
reader that silently draws the wrong thing, so the app checks the magic and the counts and refuses
anything else.
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np

MAGIC = b"GATJ"
VERSION = 1
HEADER = struct.Struct("<4sIIII")
CHANNELS = 6


def write_traj(path: str | Path, frames: np.ndarray) -> Path:
    """Write `[frames][points][channels]` float32."""
    path = Path(path)
    frames = np.ascontiguousarray(frames, dtype="<f4")
    if frames.ndim != 3 or frames.shape[2] != CHANNELS:
        raise ValueError(f"expected [frames, points, {CHANNELS}], got {frames.shape}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as fh:
        fh.write(HEADER.pack(MAGIC, VERSION, frames.shape[0], frames.shape[1], CHANNELS))
        fh.write(frames.tobytes())
    return path


def read_traj(path: str | Path) -> np.ndarray:
    path = Path(path)
    with path.open("rb") as fh:
        magic, version, frames, points, channels = HEADER.unpack(fh.read(HEADER.size))
        if magic != MAGIC:
            raise ValueError(f"{path} is not a .traj file")
        if version != VERSION:
            raise ValueError(f"{path} is version {version}, this reader knows {VERSION}")
        if channels != CHANNELS:
            raise ValueError(f"{path} has {channels} channels, expected {CHANNELS}")
        data = np.fromfile(fh, dtype="<f4")
    if data.size != frames * points * channels:
        raise ValueError(f"{path} says {frames}x{points}x{channels} and holds {data.size} floats")
    return data.reshape(frames, points, channels)


def write_ply(path: str | Path, cloud: np.ndarray) -> Path:
    """A binary little-endian PLY of one cloud: xyz and normals, which the app's loader reads.

    No colour property: the baseline has no colour head yet, and a cloud with no colour falls back to
    the palette the way a library object does.
    """
    path = Path(path)
    cloud = np.asarray(cloud, dtype="<f4")
    if cloud.ndim != 2 or cloud.shape[1] != CHANNELS:
        raise ValueError(f"expected [points, {CHANNELS}], got {cloud.shape}")
    path.parent.mkdir(parents=True, exist_ok=True)
    header = "\n".join([
        "ply",
        "format binary_little_endian 1.0",
        "comment made by gen-ascii ml/cloudgen",
        f"element vertex {cloud.shape[0]}",
        "property float x", "property float y", "property float z",
        "property float nx", "property float ny", "property float nz",
        "end_header",
        "",
    ])
    with path.open("wb") as fh:
        fh.write(header.encode("ascii"))
        fh.write(np.ascontiguousarray(cloud).tobytes())
    return path
