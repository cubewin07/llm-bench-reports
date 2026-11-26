import json

import build_site_data as b
import make_demo_data


def _data(n_boot=200):
    recs = make_demo_data.generate(seed=3)
    return recs, b.build(recs, demo=True, sources=["demo"], n_boot=n_boot)


def test_output_is_strict_json_and_has_every_slice():
    _, data = _data()
    json.dumps(data, allow_nan=False)
    assert set(data["slices"]) == {"controlled/dev", "controlled/heldout", "native/dev"}
    assert data["meta"]["demo"] is True


def test_colour_slots_follow_the_model_not_its_rank():
    _, data = _data()
    slots = {m["key"]: m["slot"] for m in data["models"]}
    assert sorted(slots.values()) == list(range(len(slots)))
    # the September models come first, whatever their score
    assert slots["demo/model-a"] == 0 and slots["demo/model-b"] == 1


def test_latest_run_replaces_older_runs_task_by_task():
    recs, data = _data()
    s = data["slices"]["controlled/dev"]
    assert s["overall"]["demo/model-a"]["latest_date"] == "2026-11-16"
    assert s["n_records"] < s["n_records_all_runs"]
    # trends keep every run
    assert len(s["trends"]["demo/model-a"]) == 3


def test_recommendation_verdicts_respect_minimum_tasks():
    _, data = _data()
    for row in data["slices"]["controlled/dev"]["recommendations"]:
        if row["verdict"] == "clear":
            assert row["diff"]["lo"] > 0 and row["diff"]["n_tasks"] >= b.MIN_TASKS
        if row["diff"] and row["diff"]["n_tasks"] < b.MIN_TASKS:
            assert row["verdict"] == "too_few"


def test_harness_errors_are_excluded_from_scores():
    recs = make_demo_data.generate(seed=3)
    for r in recs:
        if r["model"]["name"] == "model-b" and r["track"] == "controlled":
            r["flags"], r["score"] = ["harness_error"], 0.0
    data = b.build(recs, demo=True, sources=["demo"], n_boot=100)
    s = data["slices"]["controlled/dev"]
    assert "demo/model-b" not in s["overall"]
    assert s["failures"]["by_model"]["demo/model-b"]["errors"] > 0
