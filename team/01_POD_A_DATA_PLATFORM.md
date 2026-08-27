# POD A — Data & Platform

> Paste `team/00_PROJECT_BRIEF.md` first, then this file. Then read `CONTRACTS.md` section C1.

**Two people. A1 and A2.**

| | Owns files | One-line job |
|---|---|---|
| **A1** | `pipelines/ingest.py` `validate.py` `clean.py` `gold.py` `holidays.py` | Raw CSV becomes a gold table nobody downstream has to re-check |
| **A2** | `pipelines/features.py` `run_nightly.py` `infra/` `.github/workflows/` | Features with no leakage, and one command that brings the whole system up |

**Your mission:** *produce an analytical table that every other pod can trust without re-checking
it, and a container/CI setup that makes "works on my machine" impossible.*

Every defect you do not catch propagates silently into model coefficients, where it is invisible.

**You own:** `pipelines/` `infra/` `data/` `scripts/check_data.py` `tests/unit/test_pipeline*.py`
`tests/unit/test_no_leakage.py`
**You never edit:** `core/` `decision/` `api/` `web/` `docs/`

---

## Day plan

| Day | A1 | A2 | Evening gate |
|---|---|---|---|
| **0** | dataset in place, `check_data.py` green, snapshot_id posted in the team channel | repo scaffold, `docker compose up` works, CI skeleton green, everyone has merged one PR | 8/8 people merged a PR; placeholder page live on a public URL |
| **1** | ingest → validate → clean → **gold parquet at all three grains** | cutoff-aware `features.py` + **`test_no_leakage.py` green** | `make pipeline` produces gold from a clean clone; Pod B can read it |
| **2** | closure calendar, all seven quality gates, quarantine path | `run_nightly.py` end to end, deploy pipeline to the host | `make nightly` runs the whole batch unattended |
| **3** | replay data feed for Pod C, partial-bucket flags verified in the UI | CI runs tests + benchmark on every push; deploy is one click; warm-up ping | CI green, deployed URL stable |
| **4** | support integration; do not start anything new | freeze, rehearse the fallback (local compose on the presenter's laptop) | — |

---

## 1 · `scripts/check_data.py` — already written, run it first

```bash
python scripts/check_data.py
```

It asserts 2,106 rows, the 8 expected columns, **26 all-zero days**, and prints the `snapshot_id`.
**Post that snapshot_id in the team channel and pin it.** Every reported number is tied to it.

If the all-zero count is not 26, stop and tell the lead before anyone builds on it — the closure
calendar in the design documents assumes 26.

---

## 2 · `pipelines/ingest.py` (A1)

```python
def ingest(raw_path: str | Path, out_root: str = "data/warehouse/bronze") -> IngestResult:
    """Parse salesdaily.csv into long form and upsert into append-only bronze."""
```

| | |
|---|---|
| **Input** | `data/observed/salesdaily.csv` — wide: `datum` + one column per ATC group |
| **Processing** | parse dates to store-local calendar · unpivot wide→long `(series_id, ds, y)` · SHA-256 the source file as `snapshot_id` · upsert keyed on `(series_id, ds)` |
| **Output** | Parquet at `data/warehouse/bronze/`, append-only, every row carrying `ingest_batch_id` and `snapshot_id` |
| **Returns** | `IngestResult(snapshot_id, rows_in, rows_written, batch_id)` |

**Rules:**
- **`salesdaily.csv` only.** Never read `salesweekly.csv` or `salesmonthly.csv`. The monthly file is
  corrupt (53 series-months disagree with a daily rollup by >5%). Deriving costs one `resample()`
  and removes an entire class of silent inconsistency forever.
- **The upsert is keyed on the natural key**, so re-ingesting the same file is a no-op. The nightly
  job must be safely re-runnable after a failure, and a real POS feed resends after a network
  interruption.
- **Bronze is append-only**, so any load can be reverted or replayed without hand-reconstructing
  history.
- **Raise on a synthetic path.** `if "synthetic" in str(raw_path): raise ValueError(...)`. One test
  asserts this. This is lane enforcement in code, not by convention.

---

## 3 · `pipelines/validate.py` (A1)

Seven declarative checks as a `pandera` schema contract, run inside the pipeline **and again as a
unit test in CI**.

| Check | Detects |
|---|---|
| Column set and dtypes | a renamed, added, or removed drug group |
| Row count per period | incomplete ingestion |
| Period completeness ratio | partial weeks and months |
| Derived-vs-daily reconciliation | the corrupt-monthly-file class of defect |
| Duplicate key detection | double-posted batches |
| Range and sign checks | negative or implausible unit counts |
| Date ordering and gaps | out-of-sequence or missing days |

```python
def validate(df: pd.DataFrame) -> ValidationResult:
    """Returns passing rows plus a quarantine frame with a failure reason per row."""
```

**A failing batch is quarantined, never passed through with a warning.** A 5% drift in a training
input is indistinguishable from a genuine change in the business once it reaches a model, so it must
be stopped at the boundary where it is still attributable to a file.

---

## 4 · `pipelines/clean.py` + `holidays.py` (A1)

```python
def clean(df: pd.DataFrame, holidays: pd.DataFrame) -> pd.DataFrame:
    """Adds is_closed, is_outlier, completeness. Never alters y."""
```

| Step | Rule |
|---|---|
| **Closures** | a day where **all eight** series read exactly 0 → `is_closed = True`. Expect 26. |
| **Holidays** | join `data/observed/holidays.csv` — a **versioned CSV you commit**, Serbian Orthodox calendar: 7 January, Orthodox Easter (20 Apr 2014, 12 Apr 2015, 1 May 2016, 16 Apr 2017, 8 Apr 2018, 28 Apr 2019), 1 January, 19 December, 1 May |
| **Completeness** | for week/month grains, `observed_days / expected_days`. The final bucket is partial — this is how it stays visible. |
| **Outliers** | `is_outlier = True` beyond mean + 4σ per series. **`y` is not touched.** |

**Why closures are masked rather than imputed or deleted:** imputation invents demand that did not
occur; deletion leaves a gap a seasonal model reads as a missing period. Marking the state and
masking the loss represents the fact accurately — demand is *unobserved*, not zero.

**Why outliers are flagged rather than winsorised:** the extremes here are real events (New Year
stock-up, the January 2019 flu peak). Removing them removes the behaviour the system exists to
anticipate. The flag plus a calendar feature lets a model attribute the spike to a cause instead of
raising its baseline.

---

## 5 · `pipelines/gold.py` (A1) — **CONTRACT C1**

Write exactly the schema in `contracts/schemas/gold.sql`. Partition `grain=<g>/year=<yyyy>/`,
Parquet + ZSTD via pyarrow.

```python
def build_gold(silver: pd.DataFrame, snapshot_id: str,
               out_root: str = "data/warehouse/gold") -> None:
```

**Derive week and month by resampling the daily rows — never ingest them.** Closure masking happens
**before** aggregation, or a closed day quietly drags a weekly total down.

**A reconciliation test asserts derived weekly and monthly totals match a rollup of daily, and it
fails loudly rather than warning quietly.**

---

## 6 · `pipelines/features.py` (A2) — the highest-risk file in the repo

```python
def build_features(gold: pd.DataFrame, cutoff: str | pd.Timestamp,
                   grain: str = "week") -> pd.DataFrame:
    """Every value computed using ONLY rows with ds <= cutoff."""
```

Columns are listed in `CONTRACTS.md` C1. Use `mlforecast` lag/rolling transforms; `numpy` for the
Fourier terms.

**The test that makes this file trustworthy — `tests/unit/test_no_leakage.py`:**

```python
def test_features_are_cutoff_only():
    full = build_features(gold, cutoff="2018-06-30")
    truncated = build_features(gold[gold.ds <= "2018-06-30"], cutoff="2018-06-30")
    pd.testing.assert_frame_equal(full, truncated)   # must be identical
```

> Look-ahead leakage is the most common defect in forecasting pipelines and the hardest to notice
> afterwards, **because it produces results that look excellent.** It needs a structural guarantee,
> not a review convention. **If this test is red, every number the team reports is meaningless — say
> so loudly rather than working around it.**

Calendar and holiday features are permitted at inference because they are known in advance. Any
externally-sourced covariate (weather, pollen) is unknown-future and must come from its own forecast
or a climatological normal — and it is **below the cut line** for this build anyway.

---

## 7 · `pipelines/run_nightly.py` (A2)

```bash
python -m pipelines.run_nightly --stage all      # gold | features | forecast | all
```

Orchestrates ingest → validate → clean → gold → features, then calls Pod B's entrypoint for the
forecast stage. **Idempotent end to end** — a failed run re-executes with no manual cleanup.

Use APScheduler embedded in the API process if a schedule is wanted. Do **not** introduce Prefect,
Airflow, or a broker; that is below the cut line and buys nothing in four days.

---

## 8 · `infra/` (A2)

See `team/05_INTEGRATION_DOCKER_OPS.md` for the full spec — it is your document as much as anyone's.
Minimum for Day 0:

- `infra/Dockerfile.api` — python:3.11-slim, non-root user, `pip install -r requirements.txt`
- `infra/Dockerfile.web` — node build stage → nginx or `vite preview`
- `docker-compose.yml` at the repo root — `api` on 8000, `web` on 5173, one shared volume for
  `data/warehouse`
- `.github/workflows/ci.yml` — ruff, pytest, and (from Day 1) `make benchmark`

**Prophet is the install risk.** It pulls `cmdstanpy` and can take 10+ minutes or fail outright on
Windows. **Verify a Prophet import on all 8 machines during Day 0**, and make the container the
fallback for anyone it fails on. Tell Pod B immediately if it fails anywhere, because their
portfolio has a documented degradation path without it.

---

## Tests you own

| File | Asserts |
|---|---|
| `tests/unit/test_no_leakage.py` | features at *t* are identical with or without future rows |
| `tests/unit/test_ingest_idempotent.py` | ingesting the same file twice changes zero rows |
| `tests/unit/test_reconciliation.py` | weekly and monthly rollups equal the daily sum |
| `tests/unit/test_closures.py` | exactly 26 days flagged `is_closed`; none deleted |
| `tests/unit/test_completeness.py` | the final week and month are flagged partial |
| `tests/unit/test_lane_enforcement.py` | ingest raises on a `data/synthetic/` path |

---

## Definition of done

- [ ] `make pipeline` on a clean clone produces `data/warehouse/gold/` with all three grains
- [ ] All six tests above pass in CI
- [ ] `docker compose up` brings API and web up on a fresh machine with no manual steps
- [ ] CI runs lint + tests + benchmark on every push and blocks merge on red
- [ ] The deployed URL is live and warm, and someone other than A2 has deployed once
- [ ] `data/observed/holidays.csv` is committed and versioned

## Your handoffs

| To | What | When |
|---|---|---|
| **Pod B** | gold parquet at `data/warehouse/gold/` matching C1, plus the feature table | **end of Day 1** — they are blocked without it |
| **Pod C** | a replay feed: daily rows for a chosen window, in date order | Day 3 |
| **Everyone** | one command that runs the system; a green CI; a live URL | Day 0, maintained daily |

## Traps

1. **Reading the weekly or monthly CSV "just to compare."** Somebody will. Delete those files from
   `data/observed/` — `check_data.py` fails if they are there.
2. **Dropping closure days instead of flagging them.** A gap is not the same as a marked zero.
3. **Building features without a cutoff argument "for now."** It will never get fixed and it
   invalidates every result.
4. **Winsorising outliers because they look like errors.** They are the January 2019 flu peak.
5. **A Docker image that only builds on your laptop.** Pin the base image digest and test on
   someone else's machine on Day 0, not Day 3.
