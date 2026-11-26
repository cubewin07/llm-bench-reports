# data/

- `results.jsonl`: real results, written by `bench export` in the private harness. One JSON record per line.
- `demo/results.jsonl`: synthetic results from `scripts/make_demo_data.py`. The dashboard uses it only while
  `results.jsonl` is empty, and shows a demo banner when it does.

Every record must validate against `../schema/public_result.schema.json`. Only `.jsonl` files (and this README) may
live here: `scripts/check_data.py` fails on anything else, on duplicates, and on the benchmark's canary string.
