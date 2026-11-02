import re
import subprocess
import sys

import torch

from test_data import write_shards

SMALL = ["--dim", "32", "--depth", "1", "--heads", "4", "--points", "64", "--patch", "8", "--text", "hashed",
         "--batch", "2", "--warmup", "2", "--device", "cpu", "--log-every", "5", "--save-every", "10"]


def train(data, out, steps, *extra):
    cmd = [sys.executable, "-m", "cloudgen.train", "--data", str(data), "--out", str(out), "--steps", str(steps), *SMALL, *extra]
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")


def lines(out):
    return {int(m[1]): m[2] for m in re.finditer(r"step\s+(\d+) loss \S+ ema \S+ lr (\S+)", (out / "train.log").read_text(encoding="utf-8"))}


def test_a_save_also_writes_the_state_a_resume_needs(tmp_path):
    write_shards(tmp_path / "d", n=4, points=64)
    assert train(tmp_path / "d", tmp_path / "o", 10).returncode == 0
    saved = torch.load(tmp_path / "o" / "resume.pt")
    assert set(saved) == {"model", "opt", "step", "running", "best"}
    assert saved["step"] == 10
    assert not (tmp_path / "o" / "resume.tmp").exists()
    assert "opt" not in torch.load(tmp_path / "o" / "last.pt"), "last.pt keeps the shape the sampling scripts load"


def test_resume_continues_from_the_saved_step_on_the_same_schedule(tmp_path):
    write_shards(tmp_path / "d", n=4, points=64)
    whole = train(tmp_path / "d", tmp_path / "whole", 20)
    assert whole.returncode == 0
    # the first half of a 20 step run stands in for the crashed process: save-every 10 leaves resume.pt at step 10
    half = train(tmp_path / "d", tmp_path / "cut", 20)
    assert half.returncode == 0
    saved = torch.load(tmp_path / "cut" / "resume.pt")
    saved["step"], saved["running"] = 10, 1.0
    torch.save(saved, tmp_path / "cut" / "resume.pt")
    again = train(tmp_path / "d", tmp_path / "cut", 20, "--resume")
    assert again.returncode == 0
    assert "resumed from step 10" in again.stdout
    assert "step     10 " in again.stdout and "step      5 " not in again.stdout
    resumed = [int(m) for m in re.findall(r"^step\s+(\d+) ", again.stdout, re.M)]
    assert resumed == [10, 15]
    # the learning rate follows the absolute step, so it matches the uninterrupted run
    assert lines(tmp_path / "cut")[15] == lines(tmp_path / "whole")[15]


def test_resume_without_a_saved_state_starts_from_zero(tmp_path):
    write_shards(tmp_path / "d", n=4, points=64)
    run = train(tmp_path / "d", tmp_path / "o", 10, "--resume")
    assert run.returncode == 0
    assert "resumed from" not in run.stdout


def test_the_retry_wrapper_restarts_a_failing_trainer_then_gives_up(tmp_path):
    cmd = [sys.executable, "-m", "cloudgen.train_retry", "--retries", "2", "--wait", "0", "--",
           "--data", str(tmp_path / "missing"), "--out", str(tmp_path / "o")]
    run = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    assert run.returncode != 0
    assert run.stdout.count("restart ") == 2
    assert "out of retries" in run.stdout
