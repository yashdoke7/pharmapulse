# `scripts/` — the four things anyone runs by hand

Shared folder, but **each script has one owner.** Do not edit someone else's.

| Script | Owner | What it does | When it runs |
|---|---|---|---|
| `check_data.py` | A1 | Verifies the dataset: 2,106 rows, 8 ATC columns, **26 closure days**. Prints the `snapshot_id`. Fails if the corrupt monthly file is present. | **Day 0, everyone, before writing code** |
| `day1_benchmark.py` | **B1** | Reproduces every accuracy figure from a clean clone → `artifacts/benchmarks.json`. **Not yet written — Day 1 morning, top priority.** | Day 1, then in CI on every push |
| `make_fixtures.py` | C2 (A2 on Day 0) | Regenerates `contracts/fixtures/*.json`. Day 0 it emits shape-correct mocks; from Day 2 it reads the real store. **Shapes never change without a `CONTRACTS.md` change-log line.** | Day 0, then after any shape change |
| `dump_openapi.py` | C2 | Writes `contracts/openapi.json` from the FastAPI app so Pod D can generate TypeScript types. **Not yet written.** | after every API shape change |

## Run them

```bash
python scripts/check_data.py       # -> snapshot_id, pin it in the team channel
make benchmark                     # -> artifacts/benchmarks.json + the leaderboard
make fixtures                      # -> contracts/fixtures/*.json
python scripts/dump_openapi.py     # -> contracts/openapi.json
```

## Why `day1_benchmark.py` is the most important file in the repository

Every headline claim the team will make — the ensemble beating the seasonal-naive benchmark, the
measured case against model selection, the interval-coverage correction — is only as good as the
ability to reproduce it **from a clean clone, on stage, in front of someone who doubts it.**

> `git clone && pip install -r requirements.txt && make benchmark`

That is the answer to "how do we know your numbers are real", and it is worth more than any slide.
Write it before you write a model.
