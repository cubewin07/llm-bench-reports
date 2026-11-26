# llm-bench results

Public results from a personal benchmark of frontier models on real software work, built to answer one question:
**which model should I use for which kind of work?**

Every task comes from one real full-stack codebase of mine (Spring Boot, React, Redis, WebSockets, workers, RBAC,
migrations). The tasks, the codebase snapshot, the answer keys and the transcripts live in a private repo. This repo
holds only scores, in a closed format that cannot carry task content, and a dashboard that draws them.

> **Right now the dashboard shows demo data.** The models (`demo/model-a` and so on) are fictional and the scores are
> synthetic, so the layout can be built and checked before real runs exist. A banner says so on every page. Real
> results replace the demo automatically once `data/results.jsonl` has records.

## Reading the dashboard

| View | What it answers |
|---|---|
| Which model for which work | Per category: the best model so far, whether its lead is real, and whether a cheaper model is statistically tied with it |
| Overall score | Mean score with a 95% interval |
| Paired differences | Model A minus model B on the tasks both ran. Pairing removes task difficulty, so these intervals are much narrower than comparing two overall scores |
| Score by category | Model × category, with the interval drawn inside each cell |
| Score against cost / time | Which models are on the frontier: nothing cheaper (or faster) scores higher |
| Reliability | pass@1 against pass^3, the chance that all three runs pass |
| Calibration | When a model says it is 80% sure, is it right 80% of the time? |
| Contamination check | Do models score higher on tasks whose fix was public before their training cutoff? |
| How models fail | Share of runs with each failure flag: regressions, test tampering, made-up references, giving up and so on |
| Over time | Score per run, to catch silent model updates and harness changes |
| Tasks | Every task by every model, with item health: saturated, dead or flat tasks get flagged |

Every chart has a table view. Track and split filters sit above everything:

- **Controlled** gives every model the same agent loop, tools, prompts and limits. Use it to compare models.
- **Native agents** runs each model in its vendor's own coding CLI. Use it to compare products.
- **Dev** is the working set. **Held-out** is run rarely, to check the dev results were not overfitted.

## Method in brief

- Every task scores 0 to 1:
  - code changes: hidden tests, fail-to-pass and pass-to-pass
  - bug finding and security review: findings matched against an answer key
  - debugging and comprehension questions: a matched answer plus a stated confidence
  - design: a judge panel with a rubric
- A run passes at a score of 1.
- Each model runs each task three times.
- Intervals are 95% two-stage bootstrap intervals: resample tasks, then runs within each task.
- A lead is "clear" only when the paired interval excludes zero and the two models share at least five tasks.
  Otherwise the dashboard says the models can't be told apart, or that there are too few tasks.
- The main views use each model's latest run of each task. The trend view keeps every run.
- Harness errors are counted and shown, but left out of scores.
- The KPI row shows the smallest gap the current task count can detect. A few dozen tasks can only separate models
  that are far apart, and the dashboard says so rather than ranking noise.
- `scripts/benchstats.py` is a byte-for-byte copy of the private harness's statistics module, so the numbers here
  match the private reports exactly.

## What is not published, and why

Anything that could leak a task into future training data stays private:

- task prompts
- the codebase snapshot
- answer keys and hidden tests
- agent transcripts
- the private task names

Two tripwires guard this repo:

1. **Closed schema.** Every record must validate against [schema/public_result.schema.json](schema/public_result.schema.json).
   - It has no free-text field.
   - Task ids are keyed hashes: stable between runs, but they reveal nothing.
   - A record that adds any field fails.
2. **Canary scan.** The private tasks carry a canary string. [canary.sha256](canary.sha256) holds only its hashes.
   `scripts/check_data.py` hashes every UUID-shaped token in the repo and fails if one matches.

CI runs both on every push.

## How data gets here

On the private side:

```bash
bench export --to ../llm-bench-reports/data/results.jsonl
```

Then here:

```bash
uv sync
uv run python scripts/check_data.py         # schema + canary gate; must print 0 problems
uv run python scripts/build_site_data.py    # data/results.jsonl -> site/data.json
uv run pytest -q
git add data/results.jsonl && git commit -m "results: <what ran>"
```

## Preview locally

```bash
uv run python scripts/build_site_data.py
```

```bash
python3 -m http.server 8765 --directory site
```

Then open http://localhost:8765. The page is plain HTML, CSS and JavaScript, with no build step and no dependencies.

To regenerate the demo data:

```bash
uv run python scripts/make_demo_data.py
```

## Layout

```
data/results.jsonl         real results (from `bench export`); empty until the first real run
data/demo/results.jsonl    synthetic demo results, used only while the above is empty
schema/                    the closed public record schema (identical to the private copy)
canary.sha256              hashes of the private canary string
scripts/check_data.py      data gate: schema, duplicates, stray files, canary scan
scripts/build_site_data.py all statistics, precomputed into site/data.json
scripts/benchstats.py      statistics module, copied from the private harness
scripts/make_demo_data.py  demo data generator
site/                      the dashboard (index.html, style.css, app.js)
```

## Publishing

`.github/workflows/pages.yml` builds the site and deploys it to GitHub Pages. It only runs once Pages is turned on for
the repo and the repository variable `PAGES_ENABLED` is set to `true`.
