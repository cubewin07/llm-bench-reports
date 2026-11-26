"""Results JSONL -> site/data.json: every number the dashboard shows, precomputed.

The browser only draws. All statistics happen here, through benchstats.py, which
is a byte-for-byte copy of the private harness's stats module (a test in the
private repo keeps them identical), so these numbers match `bench stats`.

Which records count:
  * Slices are (track, split). Tracks are never pooled: the controlled track
    gives every model the same agent; the native track uses each vendor's own CLI.
  * For the main views, each model contributes its most recent run of each task
    (re-running a model replaces its old numbers, task by task). The trend view
    uses every run.
  * Harness errors are excluded from scores and counted separately.
  * "Pass" means score >= 0.999. Rubric tasks have no pass/fail, so pass rates
    leave them out.

Usage:
    python scripts/build_site_data.py              # data/results.jsonl, or the demo data if that is empty
    python scripts/build_site_data.py --demo       # force the demo data
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from collections import defaultdict
from pathlib import Path

import benchstats as bs

ROOT = Path(__file__).resolve().parent.parent
REAL = ROOT / "data" / "results.jsonl"
DEMO = ROOT / "data" / "demo" / "results.jsonl"
OUT = ROOT / "site" / "data.json"

PASS = 0.999
K = 3                 # pass^k reliability target
MIN_TASKS = 5         # below this a per-category verdict is "too few tasks"
CATEGORY_ORDER = ["bug_localization", "bug_fix", "feature", "test_writing", "debugging_rca", "code_comprehension",
                  "security_review", "system_design", "migration_data", "ui_functional", "honesty"]


# ---------------------------------------------------------------------------- helpers

def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(ln) for ln in path.read_text().splitlines() if ln.strip()]


def clean(x):
    """NaN/inf -> None, recursively, so the output is strict JSON."""
    if isinstance(x, float):
        return None if math.isnan(x) or math.isinf(x) else round(x, 5)
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [clean(v) for v in x]
    return x


def est(e: bs.Estimate) -> dict:
    return {"mean": e.mean, "lo": e.lo, "hi": e.hi, "n_tasks": e.n_tasks, "n_runs": e.n_runs}


def diff(d: bs.PairedDiff) -> dict:
    return {"mean": d.mean, "lo": d.lo, "hi": d.hi, "n_tasks": d.n_tasks, "p_a_better": d.p_a_better}


def is_error(r: dict) -> bool:
    return "harness_error" in r["flags"]


def mean(xs: list[float]) -> float | None:
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def latest_per_task(recs: list[dict]) -> list[dict]:
    """Keep, for each (model, task), only the records of that model's most recent run of the task."""
    best: dict[tuple[str, str], tuple[str, str]] = {}
    for r in recs:
        k = (bs.model_label(r), r["task"]["hid"])
        v = (r["date"], r["run_id"])
        if k not in best or v > best[k]:
            best[k] = v
    return [r for r in recs if best[(bs.model_label(r), r["task"]["hid"])] == (r["date"], r["run_id"])]


def model_table(records: list[dict]) -> list[dict]:
    """Every model label with a fixed colour slot, in order of first appearance.
    Colour follows the model across every slice and filter, never its rank."""
    first: dict[str, tuple] = {}
    info: dict[str, dict] = {}
    for r in records:
        key = bs.model_label(r)
        if key not in first or (r["date"], r["run_id"]) < first[key]:
            first[key] = (r["date"], r["run_id"])
        m = r["model"]
        info[key] = {"key": key, "provider": m["provider"], "name": m["name"], "effort": m["effort"],
                     "agent": m["agent"], "cutoff": m.get("knowledge_cutoff")}
    out = []
    for slot, key in enumerate(sorted(first, key=lambda k: (first[k], k))):
        m = info[key]
        m["label"] = m["name"] + (f" · {m['effort']}" if m["effort"] != "default" else "")
        m["slot"] = slot if slot < 8 else None  # past eight hues, a model is drawn as "other"
        out.append(m)
    return out


# ---------------------------------------------------------------------------- per-slice views

def overall(recs: list[dict], by_model: dict, n_boot: int) -> dict:
    out = {}
    for key, per_task in by_model.items():
        mine = [r for r in recs if bs.model_label(r) == key and not is_error(r)]
        e = est(bs.bootstrap_ci(per_task, n_boot=n_boot))
        passable = defaultdict(list)
        for r in mine:
            if r["task"]["kind"] != "rubric":
                passable[r["task"]["hid"]].append(r["score"] >= PASS)
        k = min([K] + [len(v) for v in passable.values()]) if passable else K
        pass1 = mean([sum(v) / len(v) for v in passable.values()])
        passk = mean([bs.pass_hat_k(len(v), sum(v), k) for v in passable.values()])
        costs = [r["cost_usd"] for r in mine]
        known = [c for c in costs if c is not None]
        passes = sum(r["score"] >= PASS for r in mine if r["task"]["kind"] != "rubric")
        e.update({
            "latest_date": max(r["date"] for r in mine) if mine else None,
            "pass1": pass1, "passk": passk, "k": k, "n_pass_tasks": len(passable),
            "cost_per_run": mean(known),
            "cost_known_share": len(known) / len(costs) if costs else None,
            "cost_per_pass": (sum(known) / passes) if passes and len(known) == len(costs) else None,
            "latency_s": mean([r["latency_s"] for r in mine]),
            "tokens": mean([r["usage"]["input_tokens"] + r["usage"]["output_tokens"] for r in mine]),
            "turns": mean([r.get("turns") for r in mine]),
        })
        out[key] = e
    return out


def by_category(recs: list[dict], n_boot: int) -> dict:
    out = {}
    for cat in sorted({r["task"]["category"] for r in recs}, key=CATEGORY_ORDER.index):
        sub = bs.group_scores([r for r in recs if r["task"]["category"] == cat])
        out[cat] = {m: est(bs.bootstrap_ci(pt, n_boot=n_boot)) for m, pt in sub.items()}
    return out


def recommend(recs: list[dict], ov: dict, n_boot: int) -> list[dict]:
    """Per category: who leads, is the lead real, and is a cheaper model statistically tied with it?"""
    rows = []
    cats = ["all"] + sorted({r["task"]["category"] for r in recs}, key=CATEGORY_ORDER.index)
    for cat in cats:
        sub_recs = recs if cat == "all" else [r for r in recs if r["task"]["category"] == cat]
        sub = bs.group_scores(sub_recs)
        if not sub:
            continue
        means = {m: bs.bootstrap_ci(pt, n_boot=n_boot) for m, pt in sub.items()}
        ranking = sorted(means, key=lambda m: -means[m].mean)
        n_tasks = len({t for pt in sub.values() for t in pt})
        row = {"category": cat, "n_tasks": n_tasks, "ranking": ranking, "leader": ranking[0],
               "leader_est": est(means[ranking[0]]), "runner_up": None, "diff": None, "cheaper": None}
        if len(ranking) == 1:
            row["verdict"] = "single_model"
        else:
            leader = ranking[0]
            d = bs.paired_difference(sub[leader], sub[ranking[1]], n_boot=n_boot)
            row["runner_up"], row["diff"] = ranking[1], diff(d)
            if d.n_tasks < MIN_TASKS:
                row["verdict"] = "too_few"
            elif d.lo > 0:
                row["verdict"] = "clear"
            else:
                row["verdict"] = "tied"
            # Cheapest model the data cannot tell apart from the leader on these tasks.
            lead_cost = ov.get(leader, {}).get("cost_per_run")
            best = None
            for m in ranking[1:]:
                dm = bs.paired_difference(sub[leader], sub[m], n_boot=n_boot)
                cost = ov.get(m, {}).get("cost_per_run")
                if dm.n_tasks >= MIN_TASKS and dm.lo <= 0 and cost is not None and lead_cost and cost < lead_cost:
                    if best is None or cost < best["cost_per_run"]:
                        best = {"model": m, "diff": diff(dm), "cost_per_run": cost, "cost_ratio": cost / lead_cost}
            row["cheaper"] = best
        rows.append(row)
    return rows


def pairs(by_model: dict, order: list[str], n_boot: int) -> list[dict]:
    out = []
    for i, a in enumerate(order):
        for b in order[i + 1:]:
            d = bs.paired_difference(by_model[a], by_model[b], n_boot=n_boot)
            if d.n_tasks:
                out.append({"a": a, "b": b, **diff(d)})
    return out


def failures(recs: list[dict]) -> dict:
    by_model: dict[str, dict] = {}
    totals: dict[str, int] = defaultdict(int)
    for r in recs:
        key = bs.model_label(r)
        row = by_model.setdefault(key, {"runs": 0, "failed": 0, "errors": 0, "counts": defaultdict(int)})
        if is_error(r):
            row["errors"] += 1
            continue
        row["runs"] += 1
        row["failed"] += r["score"] < PASS
        for f in r["flags"]:
            row["counts"][f] += 1
            totals[f] += 1
    flags = sorted(totals, key=lambda f: (-totals[f], f))
    for row in by_model.values():
        row["counts"] = dict(row["counts"])
    return {"flags": flags, "by_model": by_model}


def calibration(recs: list[dict]) -> dict:
    out = {}
    for key in sorted({bs.model_label(r) for r in recs}):
        pts = [(r["confidence"], r["score"] >= PASS) for r in recs
               if bs.model_label(r) == key and r.get("confidence") is not None and not is_error(r)]
        if not pts:
            continue
        conf, ok = [c for c, _ in pts], [o for _, o in pts]
        out[key] = {"n": len(pts), "brier": bs.brier_score(conf, ok), "mean_conf": mean(conf),
                    "accuracy": sum(ok) / len(ok), "bins": bs.calibration_bins(conf, ok, n_bins=5)}
    return out


def contamination(recs: list[dict], n_boot: int) -> dict:
    out = {}
    groups = {"public": True, "not_public": False, "unknown": None}
    for key in sorted({bs.model_label(r) for r in recs}):
        mine = [r for r in recs if bs.model_label(r) == key]
        row = {}
        for name, flag in groups.items():
            sub = bs.group_scores([r for r in mine if r["task"].get("solution_public_before_cutoff") is flag])
            row[name] = est(bs.bootstrap_ci(sub[key], n_boot=n_boot)) if key in sub else None
        out[key] = row
    return out


def trends(all_recs: list[dict], n_boot: int) -> dict:
    runs: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in all_recs:
        runs[(bs.model_label(r), r["run_id"])].append(r)
    out: dict[str, list] = defaultdict(list)
    for (key, run_id), rs in runs.items():
        sub = bs.group_scores(rs)
        if key not in sub:
            continue
        e = est(bs.bootstrap_ci(sub[key], n_boot=n_boot))
        e.update({"date": rs[0]["date"], "run_id": run_id, "harness_version": rs[0]["harness_version"],
                  "prompt_version": rs[0]["prompt_version"]})
        out[key].append(e)
    return {k: sorted(v, key=lambda e: (e["date"], e["run_id"])) for k, v in out.items()}


def task_grid(recs: list[dict], by_model: dict) -> list[dict]:
    info = {r["task"]["hid"]: r["task"] for r in recs}
    health = {s.task: s for s in bs.item_stats(by_model)} if by_model else {}
    rows = []
    for hid, t in info.items():
        cells = {}
        for key, per_task in by_model.items():
            if hid in per_task:
                v = per_task[hid]
                cells[key] = {"mean": sum(v) / len(v), "n": len(v), "passes": sum(x >= PASS for x in v),
                              "min": min(v), "max": max(v)}
        h = health.get(hid)
        rows.append({"hid": hid, "category": t["category"], "kind": t["kind"], "difficulty": t.get("difficulty"),
                     "source": t.get("source"), "human_minutes": t.get("human_minutes"),
                     "mean": h.mean if h else None, "disc": h.discrimination if h else None,
                     "status": h.status if h else None, "cells": cells})
    rows.sort(key=lambda r: (CATEGORY_ORDER.index(r["category"]), -(r["mean"] or 0), r["hid"]))
    return rows


def build_slice(all_recs: list[dict], n_boot: int) -> dict:
    recs = latest_per_task(all_recs)
    by_model = bs.group_scores(recs)
    ov = overall(recs, by_model, n_boot)
    order = sorted(ov, key=lambda m: -ov[m]["mean"])
    n_tasks = len({r["task"]["hid"] for r in recs})
    costs = [r["cost_usd"] for r in recs if not is_error(r)]
    return {
        "n_records": len(recs),
        "n_records_all_runs": len(all_recs),
        "n_tasks": n_tasks,
        "n_harness_errors": sum(is_error(r) for r in recs),
        "n_pending_runs": sum(((r.get("metrics") or {}).get("pending") or 0) > 0 for r in recs),
        "total_cost_all_runs": sum(r["cost_usd"] or 0 for r in all_recs),
        "cost_known_share": (sum(c is not None for c in costs) / len(costs)) if costs else None,
        "power": {
            "n_tasks": n_tasks,
            "detectable_gap": bs.detectable_gap(n_tasks),
            "table": [{"gap": g, "tasks": bs.min_tasks_for_difference(g)} for g in (0.20, 0.10, 0.05)],
        },
        "order": order,
        "overall": ov,
        "by_category": by_category(recs, n_boot),
        "recommendations": recommend(recs, ov, n_boot),
        "pairs": pairs(by_model, order, n_boot),
        "failures": failures(recs),
        "calibration": calibration(recs),
        "contamination": contamination(recs, n_boot),
        "trends": trends(all_recs, n_boot),
        "tasks": task_grid(recs, by_model),
    }


def build(records: list[dict], demo: bool, sources: list[str], n_boot: int = 2000) -> dict:
    slices = {}
    for track in ("controlled", "native"):
        for split in ("dev", "heldout"):
            sub = [r for r in records if r["track"] == track and r["task"]["split"] == split]
            if sub:
                slices[f"{track}/{split}"] = build_slice(sub, n_boot)
    dates = sorted({r["date"] for r in records})
    return clean({
        "meta": {
            "demo": demo,
            "generated": dt.date.today().isoformat(),
            "sources": sources,
            "n_records": len(records),
            "first_date": dates[0] if dates else None,
            "last_date": dates[-1] if dates else None,
            "harness_versions": sorted({r["harness_version"] for r in records}),
            "prompt_versions": sorted({r["prompt_version"] for r in records}),
            "pass_threshold": PASS,
            "k": K,
            "min_tasks": MIN_TASKS,
            "n_boot": n_boot,
            "category_order": CATEGORY_ORDER,
        },
        "models": model_table(records),
        "slices": slices,
    })


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="build site/data.json from results")
    ap.add_argument("--data", nargs="*", help=f"result files (default: {REAL.relative_to(ROOT)})")
    ap.add_argument("--demo", action="store_true", help="use the synthetic demo data")
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--boot", type=int, default=2000, help="bootstrap resamples")
    args = ap.parse_args(argv)

    paths = [Path(p) for p in args.data] if args.data else [REAL]
    records = [] if args.demo else [r for p in paths for r in read_jsonl(p)]
    demo = args.demo or not records
    if demo:
        paths = [DEMO]
        records = read_jsonl(DEMO)
        if not records:
            raise SystemExit("no results and no demo data: run scripts/make_demo_data.py first")
    sources = [str(p.resolve().relative_to(ROOT)) if p.resolve().is_relative_to(ROOT) else p.name for p in paths]
    data = build(records, demo, sources, args.boot)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, allow_nan=False, separators=(",", ":")))
    kind = "DEMO" if demo else "real"
    print(f"{kind}: {len(records)} records, slices {', '.join(data['slices'])} -> {out} "
          f"({out.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
