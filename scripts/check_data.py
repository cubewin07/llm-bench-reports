"""The gate for everything in this public repo. CI runs it on every push and pull request.

1. data/ holds only ``*.jsonl`` files (plus README.md), and every line validates
   against the closed schema. The schema has no free-text field, so prompts,
   code, answer keys and transcripts have nowhere to go.
2. No (run, model, task, epoch) appears twice.
3. Canary scan: every UUID-shaped token in every file is hashed and compared
   with canary.sha256. The canary itself is never stored here, only its hashes,
   so this check cannot leak what it guards.

Exit status 1 on any problem.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import jsonschema

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "schema" / "public_result.schema.json"
CANARY_PATH = ROOT / "canary.sha256"
DATA_DIR = ROOT / "data"

UUID_RX = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
MARKER = "LLM-BENCH-" + "CANARY"  # built from parts so this file does not trip its own scan
SKIP_DIRS = {".git", ".venv", "node_modules", "__pycache__", ".pytest_cache"}


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def load_hashes(path: Path = CANARY_PATH) -> set[str]:
    return {ln.strip() for ln in path.read_text().splitlines() if ln.strip() and not ln.startswith("#")}


def scan_text(text: str, hashes: set[str]) -> list[str]:
    """Reasons this text looks like it carries the canary (empty list if clean)."""
    problems = []
    if MARKER in text:
        problems.append("contains the canary marker")
    for token in set(UUID_RX.findall(text)):
        for candidate in (token, token.lower(), f"{MARKER} {token}", f"{MARKER} {token.lower()}"):
            if sha256(candidate) in hashes:
                problems.append("contains the canary UUID")
                break
    return problems


def repo_files(root: Path = ROOT) -> list[Path]:
    """Tracked and not-yet-ignored files; falls back to a directory walk outside git."""
    try:
        out = subprocess.run(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
            cwd=root, capture_output=True, check=True,
        ).stdout.decode()
        return [root / p for p in out.split("\0") if p and (root / p).is_file()]
    except (OSError, subprocess.CalledProcessError):
        return [p for p in root.rglob("*") if p.is_file() and not SKIP_DIRS & set(p.relative_to(root).parts)]


def check_canary(files: list[Path], hashes: set[str], root: Path = ROOT) -> list[str]:
    problems = []
    for f in files:
        try:
            text = f.read_text()
        except (UnicodeDecodeError, OSError):
            continue  # binary files cannot carry a text canary we would recognise anyway
        problems += [f"{f.relative_to(root)}: {p}" for p in scan_text(text, hashes)]
    return problems


def record_key(rec: dict) -> tuple:
    m = rec["model"]
    return (rec["run_id"], m["provider"], m["name"], m["effort"], m["agent"], rec["task"]["hid"], rec["epoch"])


def check_data(data_dir: Path = DATA_DIR, schema_path: Path = SCHEMA_PATH) -> tuple[list[str], int]:
    """Returns (problems, number of valid records)."""
    validator = jsonschema.Draft202012Validator(json.loads(schema_path.read_text()))
    problems: list[str] = []
    n = 0
    for path in sorted(p for p in data_dir.rglob("*") if p.is_file()):
        rel = path.relative_to(data_dir.parent)
        if path.name == "README.md" or path.name == ".gitkeep":
            continue
        if path.suffix != ".jsonl":
            problems.append(f"{rel}: only .jsonl files may live under data/")
            continue
        seen: set[tuple] = set()
        for i, line in enumerate(path.read_text().splitlines(), 1):
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError as e:
                problems.append(f"{rel}:{i}: not JSON ({e.msg})")
                continue
            errors = sorted(validator.iter_errors(rec), key=lambda e: list(e.path))
            if errors:
                e = errors[0]
                where = "/".join(str(x) for x in e.path) or "(record)"
                problems.append(f"{rel}:{i}: {where}: {e.message[:160]}")
                continue
            key = record_key(rec)
            if key in seen:
                problems.append(f"{rel}:{i}: duplicate record for run/model/task/epoch")
            seen.add(key)
            n += 1
    return problems, n


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.parse_args(argv)
    hashes = load_hashes()
    problems, n = check_data()
    problems += check_canary(repo_files(), hashes)
    for p in problems:
        print(f"FAIL {p}")
    print(f"{n} valid records; {len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
