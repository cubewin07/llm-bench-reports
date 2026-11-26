"""Statistics for small, noisy, repeated-run benchmarks.

Two sources of noise, and they need different fixes:
  * between-task: which tasks you happened to write. Only more tasks shrink it.
  * within-task: the same model on the same task gives different results.
    Repeated epochs shrink it and also let you measure reliability (pass^k).

So confidence intervals here use a two-stage (clustered) bootstrap: resample
tasks, then resample epochs within each task. Comparisons between models are
*paired* on the tasks both attempted, which is much tighter than comparing
two independent intervals. See Evan Miller, "Adding Error Bars to Evals" (2024).
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from statistics import NormalDist

import numpy as np


def model_label(rec: dict) -> str:
    m = rec["model"]
    label = f"{m['provider']}/{m['name']}"
    if m.get("effort") not in (None, "default"):
        label += f"[{m['effort']}]"
    if m.get("agent") not in (None, "react"):
        label += f"+{m['agent']}"
    return label


def task_label(rec: dict) -> str:
    t = rec["task"]
    return t.get("hid") or f"{t['id']}@v{t['version']}"


def group_scores(records: list[dict], metric: str = "score") -> dict[str, dict[str, list[float]]]:
    """model -> task -> [score per epoch], skipping harness errors."""
    out: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for r in records:
        if "harness_error" in r.get("flags", []):
            continue
        v = r[metric] if metric in r else r.get("metrics", {}).get(metric)
        if v is None:
            continue
        out[model_label(r)][task_label(r)].append(float(v))
    return out


@dataclass
class Estimate:
    mean: float
    lo: float
    hi: float
    n_tasks: int
    n_runs: int


def _pad(arrays: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """Ragged per-task epoch lists -> (tasks x max_epochs matrix, lengths)."""
    lens = np.array([len(a) for a in arrays])
    mat = np.zeros((len(arrays), int(lens.max())))
    for i, a in enumerate(arrays):
        mat[i, : len(a)] = a
    return mat, lens


def _resampled_task_means(mat: np.ndarray, lens: np.ndarray, task_idx: np.ndarray,
                          rng: np.random.Generator) -> np.ndarray:
    """Second bootstrap stage, vectorised: for every (resample, slot) in ``task_idx``,
    redraw that task's epochs with replacement and return their mean. Shape of task_idx."""
    n_len = lens[task_idx]
    picks = (rng.random(task_idx.shape + (mat.shape[1],)) * n_len[..., None]).astype(int)
    vals = mat[task_idx[..., None], picks]
    keep = np.arange(mat.shape[1]) < n_len[..., None]
    return (vals * keep).sum(-1) / n_len


def bootstrap_ci(
    per_task: dict[str, list[float]], n_boot: int = 2000, alpha: float = 0.05, seed: int = 0
) -> Estimate:
    tasks = list(per_task)
    if not tasks:
        return Estimate(float("nan"), float("nan"), float("nan"), 0, 0)
    rng = np.random.default_rng(seed)
    arrays = [np.asarray(per_task[t], dtype=float) for t in tasks]
    point = float(np.mean([a.mean() for a in arrays]))
    mat, lens = _pad(arrays)
    idx = rng.integers(0, len(arrays), (n_boot, len(arrays)))
    boots = _resampled_task_means(mat, lens, idx, rng).mean(-1)
    lo, hi = np.quantile(boots, [alpha / 2, 1 - alpha / 2])
    return Estimate(point, float(lo), float(hi), len(tasks), int(lens.sum()))


@dataclass
class PairedDiff:
    mean: float
    lo: float
    hi: float
    n_tasks: int
    p_a_better: float  # share of bootstrap resamples where A > B


def paired_difference(
    a: dict[str, list[float]], b: dict[str, list[float]], n_boot: int = 2000, alpha: float = 0.05, seed: int = 0
) -> PairedDiff:
    common = sorted(set(a) & set(b))
    if not common:
        return PairedDiff(float("nan"), float("nan"), float("nan"), 0, float("nan"))
    rng = np.random.default_rng(seed)
    da = [np.asarray(a[t], dtype=float) for t in common]
    db = [np.asarray(b[t], dtype=float) for t in common]
    point = float(np.mean([x.mean() - y.mean() for x, y in zip(da, db)]))
    (ma, la), (mb, lb) = _pad(da), _pad(db)
    idx = rng.integers(0, len(common), (n_boot, len(common)))  # same tasks for both: that is the pairing
    boots = (_resampled_task_means(ma, la, idx, rng) - _resampled_task_means(mb, lb, idx, rng)).mean(-1)
    lo, hi = np.quantile(boots, [alpha / 2, 1 - alpha / 2])
    return PairedDiff(point, float(lo), float(hi), len(common), float((boots > 0).mean()))


def pass_at_k(n: int, c: int, k: int) -> float:
    """P(at least one of k samples passes), unbiased estimator from n runs with c passes."""
    if n - c < k:
        return 1.0
    return 1.0 - math.comb(n - c, k) / math.comb(n, k)


def pass_hat_k(n: int, c: int, k: int) -> float:
    """P(all k samples pass): the reliability metric from tau-bench (pass^k)."""
    if c < k:
        return 0.0
    return math.comb(c, k) / math.comb(n, k)


def min_tasks_for_difference(delta: float, discordant: float = 0.3, alpha: float = 0.05, power: float = 0.8) -> int:
    """Rough number of tasks needed to detect a pass-rate gap ``delta`` between two models.

    McNemar-style approximation for paired binary outcomes, where ``discordant``
    is the share of tasks on which the two models disagree. Treat it as an
    order-of-magnitude planning tool, not an exact power analysis.
    """
    z = NormalDist().inv_cdf(1 - alpha / 2) + NormalDist().inv_cdf(power)
    return math.ceil(z * z * discordant / (delta * delta))


def detectable_gap(n_tasks: int, discordant: float = 0.3, alpha: float = 0.05, power: float = 0.8) -> float:
    """Inverse of ``min_tasks_for_difference``: the smallest pass-rate gap that ``n_tasks``
    paired tasks can reliably detect. Same rough McNemar approximation."""
    if n_tasks <= 0:
        return float("nan")
    z = NormalDist().inv_cdf(1 - alpha / 2) + NormalDist().inv_cdf(power)
    return z * math.sqrt(discordant / n_tasks)


@dataclass
class ItemStats:
    task: str
    mean: float
    discrimination: float | None
    status: str  # ok | saturated | dead | flat


def item_stats(scores: dict[str, dict[str, list[float]]], min_models: int = 5) -> list[ItemStats]:
    """Per-task difficulty and discrimination across models.

    ``dead`` (nobody ever scores) tasks are more often broken than hard: audit
    the key/tests first. ``saturated`` tasks no longer tell models apart.
    Discrimination is the corrected item-total correlation: a model's score on
    this task vs its mean on the OTHER tasks (including the task itself inflates
    it badly when there are only a few dozen tasks). Near zero or negative means
    the task ranks models differently from everything else: noise, or a broken key.
    It needs at least ``min_models`` models: a correlation over three or four
    points swings between -1 and 1 by chance, and would flag good tasks as flat.
    Even at five to ten models, treat ``flat`` as "look at this task", not a verdict.
    """
    models = list(scores)
    tasks = sorted({t for m in models for t in scores[m]})
    task_means = {m: {t: float(np.mean(v)) for t, v in scores[m].items()} for m in models}
    out = []
    for t in tasks:
        ms = [m for m in models if t in scores[m] and len(task_means[m]) > 1]
        vals = np.array([task_means[m][t] for m in ms]) if ms else np.array([np.mean(scores[m][t]) for m in models
                                                                              if t in scores[m]])
        mean = float(vals.mean())
        disc = None
        if len(ms) >= min_models:
            rest = np.array([np.mean([v for u, v in task_means[m].items() if u != t]) for m in ms])
            if vals.std() > 0 and rest.std() > 0:
                disc = float(np.corrcoef(vals, rest)[0, 1])
        if mean >= 0.95:
            status = "saturated"
        elif mean <= 0.02:
            status = "dead"
        elif disc is not None and disc <= 0.0:
            status = "flat"
        else:
            status = "ok"
        out.append(ItemStats(t, mean, disc, status))
    return out


def brier_score(confidences: list[float], outcomes: list[bool]) -> float:
    pairs = [(c, o) for c, o in zip(confidences, outcomes) if c is not None]
    if not pairs:
        return float("nan")
    return float(np.mean([(c - float(o)) ** 2 for c, o in pairs]))


def calibration_bins(confidences: list[float], outcomes: list[bool], n_bins: int = 5) -> list[dict]:
    bins: list[list[tuple[float, bool]]] = [[] for _ in range(n_bins)]
    for c, o in zip(confidences, outcomes):
        if c is None:
            continue
        bins[min(int(c * n_bins), n_bins - 1)].append((c, o))
    return [
        {
            "lo": i / n_bins,
            "hi": (i + 1) / n_bins,
            "n": len(b),
            "mean_conf": float(np.mean([c for c, _ in b])) if b else None,
            "accuracy": float(np.mean([o for _, o in b])) if b else None,
        }
        for i, b in enumerate(bins)
    ]
