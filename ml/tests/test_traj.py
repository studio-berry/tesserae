import numpy as np
import pytest

from cloudgen.traj import HEADER, read_traj, write_ply, write_traj


def test_traj_round_trips_every_frame(tmp_path):
    frames = np.arange(3 * 4096 * 6, dtype=np.float32).reshape(3, 4096, 6)
    path = write_traj(tmp_path / "a.traj", frames)
    back = read_traj(path)
    assert back.shape == (3, 4096, 6)
    assert np.array_equal(back, frames)
    assert path.stat().st_size == HEADER.size + frames.nbytes


def test_traj_refuses_a_file_that_is_not_one(tmp_path):
    path = tmp_path / "b.traj"
    path.write_bytes(b"NOPE" + b"\0" * 32)
    with pytest.raises(ValueError, match="not a .traj"):
        read_traj(path)


def test_traj_refuses_a_truncated_file(tmp_path):
    frames = np.zeros((2, 16, 6), dtype=np.float32)
    path = write_traj(tmp_path / "c.traj", frames)
    path.write_bytes(path.read_bytes()[:-8])
    with pytest.raises(ValueError, match="holds"):
        read_traj(path)


def test_traj_refuses_the_wrong_width(tmp_path):
    with pytest.raises(ValueError, match="expected"):
        write_traj(tmp_path / "d.traj", np.zeros((2, 16, 3), dtype=np.float32))


def test_ply_is_a_binary_little_endian_cloud_with_normals(tmp_path):
    cloud = np.arange(16 * 6, dtype=np.float32).reshape(16, 6)
    path = write_ply(tmp_path / "e.ply", cloud)
    raw = path.read_bytes()
    head, body = raw.split(b"end_header\n")
    text = head.decode("ascii")
    assert "format binary_little_endian 1.0" in text
    assert "element vertex 16" in text
    for prop in ("x", "y", "z", "nx", "ny", "nz"):
        assert f"property float {prop}" in text
    assert len(body) == cloud.nbytes
    assert np.array_equal(np.frombuffer(body, dtype="<f4").reshape(16, 6), cloud)
