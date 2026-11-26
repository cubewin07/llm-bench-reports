import hashlib
import json
import uuid

import check_data as cd
import make_demo_data


def test_scan_finds_a_canary_uuid_only_by_its_hash():
    token = str(uuid.UUID(int=12345))
    hashes = {hashlib.sha256(token.encode()).hexdigest()}
    assert cd.scan_text(f"some text {token} more", hashes) == ["contains the canary UUID"]
    assert cd.scan_text(f"upper case {token.upper()}", hashes) == ["contains the canary UUID"]
    assert cd.scan_text(f"another {uuid.UUID(int=999)}", hashes) == []


def test_scan_flags_the_marker():
    assert cd.scan_text(cd.MARKER + " anything", set()) == ["contains the canary marker"]


def test_repo_is_clean_and_demo_data_is_valid():
    problems, n = cd.check_data()
    assert problems == [] and n > 0
    assert cd.check_canary(cd.repo_files(), cd.load_hashes()) == []


def _write(tmp_path, recs):
    d = tmp_path / "data"
    d.mkdir()
    (d / "results.jsonl").write_text("".join(json.dumps(r) + "\n" for r in recs))
    return d


def test_free_text_and_unknown_fields_are_rejected(tmp_path):
    rec = make_demo_data.generate(seed=1)[0]
    leaky = json.loads(json.dumps(rec))
    leaky["task"]["prompt"] = "The carousel shows a blank slide"
    problems, n = cd.check_data(_write(tmp_path, [leaky]))
    assert n == 0 and "Additional properties" in problems[0]


def test_duplicates_and_stray_files_are_rejected(tmp_path):
    rec = make_demo_data.generate(seed=1)[0]
    d = _write(tmp_path, [rec, rec])
    (d / "notes.txt").write_text("hi")
    problems, _ = cd.check_data(d)
    assert any("duplicate" in p for p in problems)
    assert any("only .jsonl" in p for p in problems)
