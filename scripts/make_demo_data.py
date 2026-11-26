"""Synthetic results so the dashboard has something to draw before real runs exist.

Everything here is made up: the models are fictional ("demo/model-a" and so on),
the task ids are random, and the scores come from a toy model below. The output
goes to data/demo/, and the dashboard shows a "demo data" banner whenever it
reads from there. Real results only ever come from the private harness
(`bench export`) into data/results.jsonl.

The toy model is shaped to exercise every view: models differ by category,
epochs disagree (flaky tasks), one task is dead and one saturated, one model is
overconfident, and one model does suspiciously well on tasks whose fix was
public before its training cutoff.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "demo" / "results.jsonl"

KIND = {
    "bug_localization": "findings", "security_review": "findings",
    "bug_fix": "patch", "feature": "patch", "ui_functional": "patch", "migration_data": "patch",
    "debugging_rca": "answer", "code_comprehension": "answer", "honesty": "answer",
    "system_design": "rubric",
}
DEV_MIX = {"bug_localization": 5, "bug_fix": 7, "feature": 3, "debugging_rca": 4, "code_comprehension": 4,
           "security_review": 3, "system_design": 3, "ui_functional": 2, "honesty": 4, "migration_data": 1}
HELDOUT_MIX = {"bug_fix": 3, "bug_localization": 2, "debugging_rca": 2, "honesty": 2, "system_design": 1}

# name, effort, cutoff, $/M input, $/M output, overconfidence, skill by category (logit scale)
MODELS = {
    "model-a": dict(effort="default", cutoff="2025-09-30", price=(3.0, 15.0), overconf=0.02,
                    skill={"bug_localization": 0.6, "bug_fix": 0.9, "feature": 0.8, "debugging_rca": 0.5,
                           "code_comprehension": 1.0, "security_review": 0.3, "system_design": 0.6,
                           "ui_functional": 0.7, "honesty": 0.9, "migration_data": 0.4}),
    "model-a@high": dict(effort="high", cutoff="2025-09-30", price=(3.0, 15.0), overconf=0.0, token_mult=2.6,
                         skill={"bug_localization": 1.1, "bug_fix": 1.2, "feature": 1.0, "debugging_rca": 1.3,
                                "code_comprehension": 1.3, "security_review": 0.9, "system_design": 1.2,
                                "ui_functional": 0.8, "honesty": 1.1, "migration_data": 0.9}),
    "model-b": dict(effort="default", cutoff="2026-01-31", price=(1.25, 10.0), overconf=0.18,
                    skill={"bug_localization": 0.9, "bug_fix": 1.5, "feature": 1.2, "debugging_rca": 0.4,
                           "code_comprehension": 0.9, "security_review": 0.5, "system_design": 0.2,
                           "ui_functional": 1.1, "honesty": -0.4, "migration_data": 0.7}),
    "model-c": dict(effort="default", cutoff="2026-04-30", price=(5.0, 25.0), overconf=0.06, history_boost=1.6,
                    skill={"bug_localization": 1.0, "bug_fix": 1.1, "feature": 1.3, "debugging_rca": 1.0,
                           "code_comprehension": 1.2, "security_review": 1.2, "system_design": 1.0,
                           "ui_functional": 0.9, "honesty": 0.6, "migration_data": 1.0}),
}

# date, track, [(model key, agent)], splits
RUNS = [
    ("2026-09-14", "controlled", [("model-a", "react"), ("model-b", "react")], ("dev",)),
    ("2026-10-12", "controlled", [("model-a", "react"), ("model-a@high", "react"), ("model-b", "react")],
     ("dev", "heldout")),
    ("2026-11-16", "controlled", [("model-a", "react"), ("model-a@high", "react"), ("model-b", "react"),
                                  ("model-c", "react")], ("dev", "heldout")),
    ("2026-11-16", "native", [("model-a", "demo-cli-a"), ("model-b", "demo-cli-b")], ("dev",)),
]
FIRST_RUN_TASKS = 30  # the September run predates the last six dev tasks

FAIL_FLAGS = {
    "patch": ["partial_fix", "regression", "symptom_patch", "wrong_localization", "no_verification",
              "budget_exhausted", "out_of_scope_edit", "test_tampering", "gave_up"],
    "findings": ["fabricated_reference", "wrong_localization", "overclaim", "shallow_reasoning"],
    "answer": ["shallow_reasoning", "misread_task", "overclaim", "wrong_abstention"],
    "rubric": ["shallow_reasoning", "overengineered", "misread_task"],
}


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def make_tasks(rng: np.random.Generator) -> list[dict]:
    tasks = []
    for split, mix in (("dev", DEV_MIX), ("heldout", HELDOUT_MIX)):
        for cat, n in mix.items():
            for _ in range(n):
                kind = KIND[cat]
                source = rng.choice(["planted", "planted", "planted", "history", "real"]) if kind != "rubric" \
                    else "synthetic"
                public_since = None
                if source == "history":
                    public_since = str(rng.choice(["2025-08-02", "2025-11-20", "2026-02-14", "2026-03-30",
                                                   "2026-06-11"]))
                difficulty = int(rng.integers(1, 6))
                tasks.append({
                    "hid": "".join(rng.choice(list("0123456789abcdef"), 12)),
                    "category": cat, "kind": kind, "split": split, "source": str(source),
                    "difficulty": difficulty,
                    "human_minutes": float(rng.choice([10, 20, 30, 45, 60, 90])) * (0.5 + difficulty / 4),
                    "public_since": public_since,
                    "ease": float(rng.normal(0, 0.8)),
                })
    rng.shuffle(tasks)
    dev = [t for t in tasks if t["split"] == "dev"]
    dev[0].update(ease=-9.0, kind="patch", category="bug_fix", source="planted")  # dead: probably a broken key
    dev[1]["ease"] = 9.0                                                              # saturated: too easy
    return tasks


def flags_for(rng, kind: str, ok: bool, budget: bool) -> list[str]:
    flags: list[str] = []
    if budget:
        flags.append("budget_exhausted")
    if not ok:
        pool = FAIL_FLAGS[kind]
        weights = np.linspace(1.0, 0.25, len(pool))
        for f in rng.choice(pool, size=int(rng.integers(1, 3)), replace=False, p=weights / weights.sum()):
            if f not in flags:
                flags.append(str(f))
    elif kind == "patch" and rng.random() < 0.15:
        flags.append("no_verification")
    return flags


def record(rng, date, track, mkey, agent, task, epoch) -> dict:
    spec = MODELS[mkey]
    name = mkey.split("@")[0]
    kind, cat = task["kind"], task["category"]
    public_before = None
    if task["public_since"]:
        public_before = task["public_since"] < spec["cutoff"]
    logit = spec["skill"][cat] - 0.75 * (task["difficulty"] - 3) + task["ease"]
    if public_before:
        logit += spec.get("history_boost", 0.0)
    if track == "native":
        logit += 0.35
    p = sigmoid(logit)

    budget = rng.random() < 0.04
    harness_error = rng.random() < 0.008
    confidence, metrics, resolved = None, {}, None
    if kind == "rubric":
        score = float(np.clip(p + rng.normal(0, 0.08), 0, 1))
        ok = score >= 0.75
    elif kind == "findings":
        ok = rng.random() < p
        recall = 1.0 if ok else float(rng.choice([0.0, 0.0, 0.5]))
        fp = 0 if ok and rng.random() < 0.7 else int(rng.integers(1, 4))
        tp = 1 if recall > 0 else 0
        precision = tp / (tp + fp) if tp + fp else None
        score = 0.0 if not precision or not recall else 2 * recall * precision / (recall + precision)
        ok = score >= 0.999
        pending = int(rng.random() < 0.06)
        metrics = {"recall": recall, "precision": precision, "findings": float(tp + fp + pending), "tp": float(tp),
                   "fp": float(fp), "pending": float(pending), "fabricated": float(fp > 1)}
    else:
        ok = rng.random() < p
        score = 1.0 if ok else 0.0
        if kind == "patch":
            resolved = ok
        else:
            confidence = float(np.clip(p + spec["overconf"] + rng.normal(0, 0.12), 0.05, 0.99))
    flags = flags_for(rng, kind, ok, budget)
    if kind == "answer" and cat == "honesty" and not ok:
        flags = ["hallucinated_answer"] + [f for f in flags if f != "wrong_abstention"]
    if harness_error:
        flags, score, resolved = ["harness_error"], 0.0, None

    mult = spec.get("token_mult", 1.0) * (1.4 if track == "native" else 1.0)
    base_in = {"patch": 380_000, "findings": 260_000, "answer": 150_000, "rubric": 60_000}[kind]
    tin = int(base_in * mult * rng.lognormal(0, 0.35))
    tout = int(base_in / 40 * mult * rng.lognormal(0, 0.4))
    reasoning = int(tout * 0.6) if spec["effort"] == "high" else None
    cache_read = int(tin * 0.7)
    pin, pout = spec["price"]
    cost = round(((tin - cache_read) * pin + cache_read * pin * 0.1 + tout * pout) / 1e6, 4)
    turns = int(max(3, rng.normal(24 if kind == "patch" else 12, 6) * (1.3 if spec["effort"] == "high" else 1)))
    slug = "-".join(x for x in (name, spec["effort"] if spec["effort"] != "default" else "", agent
                                if agent != "react" else "") if x)
    return {
        "schema_version": 1,
        "run_id": f"demo-{date.replace('-', '')}-{track[:4]}-{slug}",
        "date": date,
        "harness_version": "0.1.0",
        "prompt_version": "p1",
        "track": track,
        "model": {"provider": "demo", "name": name, "effort": spec["effort"], "agent": agent,
                  "knowledge_cutoff": spec["cutoff"]},
        "task": {"hid": task["hid"], "category": cat, "kind": kind, "split": task["split"],
                 "source": task["source"], "difficulty": task["difficulty"],
                 "human_minutes": round(task["human_minutes"], 1), "solution_public_before_cutoff": public_before},
        "epoch": epoch,
        "score": round(score, 4),
        "resolved": resolved,
        "confidence": None if confidence is None else round(confidence, 3),
        "metrics": metrics,
        "flags": flags,
        "usage": {"input_tokens": tin, "output_tokens": tout, "reasoning_tokens": reasoning,
                  "cache_read_tokens": cache_read, "cache_write_tokens": int(tin * 0.05)},
        "cost_usd": cost,
        "latency_s": round(tout / 55 + turns * 4.5 * rng.lognormal(0, 0.25), 1),
        "turns": turns,
        "tool_calls": int(turns * 0.9),
    }


def generate(seed: int = 7, epochs: int = 3) -> list[dict]:
    rng = np.random.default_rng(seed)
    tasks = make_tasks(rng)
    dev = [t for t in tasks if t["split"] == "dev"]
    out = []
    for i, (date, track, models, splits) in enumerate(RUNS):
        pool = [t for t in tasks if t["split"] in splits]
        if i == 0:
            pool = dev[:FIRST_RUN_TASKS]
        for mkey, agent in models:
            for task in pool:
                for epoch in range(1, epochs + 1):
                    out.append(record(rng, date, track, mkey, agent, task, epoch))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="write synthetic demo results to data/demo/")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args(argv)
    recs = generate(args.seed)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("".join(json.dumps(r, sort_keys=True) + "\n" for r in recs))
    print(f"wrote {len(recs)} demo records -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
