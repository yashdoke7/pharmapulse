# `pipelines/` — Data Foundation

**Owner:** Pod A (A1 builds ingest→gold, A2 builds features + the runner)
**Full brief:** `team/01_POD_A_DATA_PLATFORM.md`
**Contract produced:** C1 (`contracts/schemas/gold.sql`)

---

## Target

> Produce an analytical table that every downstream component can trust **without re-checking it.**

Every defect not caught here propagates silently into model coefficients, where it is invisible.
This folder's job is to make the rest of the system able to assume its inputs are correct.

## Inputs

| Path | What | Lane |
|---|---|---|
| `data/observed/salesdaily.csv` | 2,106 daily rows, 8 ATC-2 columns, 2014-01-02 → 2019-10-08 | `observed` |
| `data/observed/holidays.csv` | Serbian Orthodox calendar, versioned and committed by A1 | `observed` |

**`salesweekly.csv` and `salesmonthly.csv` are never read.** The monthly file is corrupt — 53
series-months disagree with a daily rollup by more than 5%, including January 2017 recorded as
near-zero against ~2,700 real units. Weekly and monthly grains are **derived** by resampling, which
makes them agree with the daily records by construction rather than by trust.

## Outputs

| Path | Shape | Consumed by |
|---|---|---|
| `data/warehouse/bronze/` | long form `(series_id, ds, y)` + `ingest_batch_id`, `snapshot_id`; append-only | this folder |
| `data/warehouse/gold/grain=<g>/year=<yyyy>/` | **contract C1** — `series_id ds grain y origin is_closed is_outlier completeness snapshot_id` | **Pod B** |
| `data/warehouse/features/` | lags, rolling stats, Fourier, calendar, event flags — one row per `(series_id, ds, grain, cutoff)` | **Pod B** |
| `data/warehouse/quarantine/` | rows that failed validation, with a reason per row | humans |

## Files

| File | Owner | Responsibility |
|---|---|---|
| `ingest.py` | A1 | wide→long, checksum, idempotent upsert into append-only bronze. **Raises on a `data/synthetic/` path.** |
| `validate.py` | A1 | seven `pandera` checks. Quarantines a failing batch; never passes it through with a warning. |
| `clean.py` | A1 | `is_closed` (26 all-zero days), `is_outlier` (flag only, never alter `y`), `completeness` |
| `holidays.py` | A1 | loads and joins the versioned holiday calendar |
| `gold.py` | A1 | writes contract C1 at all three grains. **Closure masking happens before aggregation.** |
| `features.py` | A2 | **cutoff-aware** feature construction. The highest-risk file in the repo. |
| `run_nightly.py` | A2 | orchestrates the whole batch. Idempotent end to end. |

## Rules this folder must never break

1. **One source of truth.** Daily file in, everything else derived.
2. **Closures are marked, not imputed and not deleted.** Imputation invents demand that did not
   occur; deletion leaves a gap a seasonal model reads as a missing period.
3. **Outliers are flagged, never winsorised.** They are the New Year stock-up and the January 2019
   flu peak — the behaviour the system exists to anticipate.
4. **Partial periods stay visible.** `completeness` is a column, not a filter, so the UI can render a
   hatched "partial" bar instead of a mysteriously missing one.
5. **No feature may see the future.** Every value is computed as of an explicit `cutoff`.

## Run it

```bash
make pipeline        # raw csv -> gold parquet
make nightly         # the whole batch including the forecast stage
pytest tests/unit/test_no_leakage.py -v
```

## Definition of done

- [ ] `make pipeline` on a clean clone produces all three grains
- [ ] `test_no_leakage.py` `test_ingest_idempotent.py` `test_reconciliation.py`
      `test_closures.py` `test_completeness.py` `test_lane_enforcement.py` all green
- [ ] Pod B can read gold with one DuckDB query and needs nothing else from you
