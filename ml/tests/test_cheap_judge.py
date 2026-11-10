"""The cheap judge's arithmetic, without torch or a picture.

The encoder is verified by fitting the head to real benchmark images (see docs/cheap-judge.md). What
is tested here is everything that would silently lie if it were wrong: the split, the threshold, the
counts, and whether a fit can separate two clusters at all.
"""

from __future__ import annotations

import numpy as np

from cloudgen.cheap_judge import Head, Row, best_threshold, fit, report, split


def clusters(n: int = 60, dim: int = 8, seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    top = rng.normal(1.0, 0.3, size=(n // 2, dim))
    bottom = rng.normal(-1.0, 0.3, size=(n // 2, dim))
    x = np.vstack([top, bottom])
    y = np.array([1] * (n // 2) + [0] * (n // 2))
    order = rng.permutation(len(y))
    return x[order], y[order]


def test_fit_separates_two_clusters():
    x, y = clusters()
    head = fit(x, y)
    pred = head.predict(x)
    assert (pred == y).mean() > 0.95


def test_head_round_trips_through_a_file(tmp_path):
    x, y = clusters()
    head = fit(x, y)
    path = tmp_path / "head.npz"
    head.save(path)
    back = Head.load(path)
    assert np.allclose(back.score(x), head.score(x))
    assert back.threshold == head.threshold


def test_threshold_prefers_the_cut_that_keeps_both_classes():
    # a rare positive: plain 0.5 would score it as a total miss, balanced accuracy finds the gap
    p = np.array([0.9, 0.8, 0.7, 0.2, 0.1, 0.05])
    y = np.array([1, 1, 1, 0, 0, 0])
    assert 0.2 < best_threshold(p, y) <= 0.7


def test_threshold_is_the_middle_when_a_class_is_absent():
    assert best_threshold(np.array([0.1, 0.9]), np.array([1, 1])) == 0.5


def test_report_counts_every_cell():
    head = Head(np.zeros(2), np.ones(2), np.array([1.0, 0.0]), 0.0, 0.5)
    x = np.array([[1.0, 0.0], [1.0, 0.0], [-1.0, 0.0], [-1.0, 0.0]])
    y = np.array([1, 0, 1, 0])
    got = report(head, x, y)
    assert (got["tp"], got["fp"], got["fn"], got["tn"]) == (1, 1, 1, 1)
    assert got["agree"] == 0.5
    assert got["read_rate_true"] == 0.5 and got["read_rate_pred"] == 0.5


def test_split_holds_every_source_and_label_in_the_test_half():
    rows = [Row(f"s{i}", source, f"/p{i}", label)
            for i, (source, label) in enumerate([("prompt", 1), ("prompt", 0), ("chat", 1), ("chat", 0)] * 25)]
    train, test = split(rows, frac=0.2)
    assert len(train) + len(test) == len(rows)
    assert len({r.uid for r in test}) == len(test)  # nothing scored twice
    assert {(r.source, r.label) for r in test} == {("prompt", 1), ("prompt", 0), ("chat", 1), ("chat", 0)}


def test_split_is_a_partition():
    rows = [Row(f"s{i}", "prompt", f"/p{i}", i % 2) for i in range(40)]
    train, test = split(rows)
    assert {r.uid for r in train}.isdisjoint({r.uid for r in test})
    assert len(train) + len(test) == 40
