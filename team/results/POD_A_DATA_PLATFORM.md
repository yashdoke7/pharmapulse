# POD A — Data & Platform · RESULTS

> What was built, what it measured, what broke, and where the code is.
> Original brief: `../01_POD_A_DATA_PLATFORM.md`

**Owns:** `pipelines/` · `infra/` · `data/` · `scripts/check_data.py` · `.github/workflows/`
**Delivers:** contract **C1** (gold + features) to Pod B, and a system that comes up in one command.

---

## 1. Scorecard

| Deliverable | Status | Evidence |
|---|---|---|
| Ingest → validate → clean → gold at 3 grains | **done** | `make pipeline`, 2.6 s |
| Cutoff-aware features | **done** | `tests/unit/test_no_leakage.py`, 7 tests |
| 9 validation gates, quarantine on failure | **done** | all pass on the real file |
| Closure calendar | **done** | 26 detected, 21 mapped |
| Completeness tracking | **done** | 16 partial buckets flagged, not dropped |
| Weekly/monthly derived + reconciled | **done** | `assert_reconciles()` in the nightly run |
| Docker Compose | **done, verified** | `docker compose up --build` |
| CI running the real pipeline | **done, green** | 2 m 50 s end to end |

**Measured output of `python -m pipelines.run_nightly --stage gold`:**

```
holiday calendar   data\observed\holidays.csv
ingest             16848 rows  2014-01-02 -> 2019-10-08
snapshot_id        sha256:49e4f1c5c3da
validate
  [PASS] schema: all required columns present
  [PASS] series set: 8 expected series
  [PASS] unique key: 0 duplicate (series_id, ds) rows
  [PASS] non-negative: 0 negative values
  [PASS] no nulls: 0 null y values
  [PASS] no date gaps: 2106 contiguous days
  [PASS] rows per day: 0 days with != 8 series
  [PASS] single snapshot: 1 distinct snapshot_id values
  [PASS] observed lane only: origins present: ['observed']
clean              26 closure days, 59 outlier rows, 72 holiday days
gold[day  ]       16848 rows, 0 partial periods
gold[week ]        2416 rows, 16 partial periods
gold[month]         560 rows, 16 partial periods
reconcile          week and month totals match the daily rollup
features[week ]   2400 rows, cutoff 2019-09-30
features[month]   544 rows, cutoff 2019-09-01

gold stage complete in 2.6s
```

**302 weekly and 70 monthly buckets** — exactly what the architecture document predicted.

---

## 2. Decisions, and what each one changed

### 2.1 One source of truth

**Chose:** ingest `salesdaily.csv` only; derive weekly and monthly.
**Instead of:** using the supplied `salesweekly.csv` / `salesmonthly.csv`.

**Why:** the monthly file is corrupt — January 2017 reads ~zero for seven of eight groups against
~2,700 real units in the daily file; **53 series-months disagree by >5%**.

**Code** — `pipelines/gold.py`

```python
def _period_start(ds: pd.Series, grain: str) -> pd.Series:
    if grain == "week":
        return ds.dt.to_period("W").dt.start_time      # Monday
    if grain == "month":
        return ds.dt.to_period("M").dt.start_time
```

**Guard** — `pipelines/validate.py::assert_reconciles()`, called in `run_nightly.py` for both derived
grains. It raises rather than warns:

```python
    bad = joined[diff > tolerance]
    if not bad.empty:
        raise AssertionError(
            f"{grain} grain does not reconcile with the daily rollup: "
            f"{len(bad)} mismatched buckets, worst delta {diff.max():.6f}")
```

**Impact:** an entire class of silent inconsistency is now impossible. Cost: one `resample()`.

---

### 2.2 Closures marked, not imputed or deleted

**Chose:** flag `is_closed`, keep `y = 0`, let the consumer mask it.
**Instead of:** filling with an average, or dropping the rows.

**Why:** imputation invents demand; deletion leaves a gap a seasonal model reads as a **missing
period**, shifting every lag after it.

**Code** — `pipelines/clean.py::detect_closures()` (whole function, 6 lines):

```python
def detect_closures(long: pd.DataFrame) -> pd.DatetimeIndex:
    per_day = long.groupby("ds")["y"].agg(["sum", "count"])
    n_series = long["series_id"].nunique()
    closed = per_day[(per_day["sum"] == 0) & (per_day["count"] == n_series)]
    return pd.DatetimeIndex(closed.index)
```

**Measured: exactly 26 closure days.**

| Pattern | Count | What it is |
|---|---|---|
| 7 January | **5** (2014, 15, 16, 18, 19) | Orthodox Christmas |
| Orthodox Easter Sunday | 6 | all six years, exact |
| 1 January | 4 | New Year |
| 19 December | 5 | St. Nicholas (Nikoljdan) |
| 1 May | 1 | Labour Day |
| unexplained one-offs | 5 | 2017-02-13, 2017-10-09, 2018-12-06, 2018-12-08, 2019-04-18 |

**21 mapped + 5 unexplained = 26.** ✓

### ★ A correction to the architecture document

The doc claimed *"7 January | 2014–2019, every year"*. **It is wrong.**

```
--- every 7 January ---
2014 total= 0.0     2015 total= 0.0     2016 total= 0.0
2017 total= 59.9  ← THE SHOP WAS OPEN
2018 total= 0.0     2019 total= 0.0
```

Corrected in `docs/PHARMAPULSE_ARCHITECTURE.md` in two places. The "21 of 26" total is unaffected and
is now asserted:

```python
# tests/unit/test_pipeline.py
def test_orthodox_christmas_is_a_closure_in_five_of_six_years(cleaned):
    closed_years = {y for y in range(2014, 2020)
                    if pd.Timestamp(f"{y}-01-07") in detect_closures(cleaned)}
    assert closed_years == {2014, 2015, 2016, 2018, 2019}
    assert pd.Timestamp("2017-01-07") not in detect_closures(cleaned)
```

**Why it matters:** the holiday regressor must be fitted from the *observed* closure calendar, not an
assumed one — otherwise the model expects a shutdown that did not happen and under-forecasts that
week.

---

### 2.3 Outliers flagged, never winsorised

**Chose:** `is_outlier` beyond mean + 4σ, computed on non-closure days, **`y` untouched**.
**Instead of:** clipping them, which is what they look like they need.

**Why:** they are real events. **59 outlier rows**, including 30–31 December 2016 (New Year stock-up)
and January 2019 (flu peak).

**Test that keeps it honest** — the cleaned frame's `y` must equal the raw frame's `y`, row for row:

```python
def test_outliers_are_flagged_but_y_is_untouched(cleaned, raw_long):
    assert cleaned["is_outlier"].sum() > 0
    merged = cleaned.merge(raw_long, on=["series_id", "ds"], suffixes=("", "_raw"))
    pd.testing.assert_series_equal(merged["y"], merged["y_raw"], check_names=False)
```

---

### 2.4 `completeness` is a column, not a filter

**Chose:** carry the ratio and let consumers decide.
**Instead of:** dropping partial buckets so charts look clean.

**Why:** October 2019 reads 295 units of N02BE against 984 in September — an apparent **70% collapse
that is purely a truncation artefact**. A missing bar looks like the data ends for an unknown reason;
a hatched bar labelled "partial" is honest.

**Two consumers, two behaviours:**

```python
# pipelines/gold.py — models never see a partial bucket
def fitting_frame(grain="week"):
    return read_gold(grain)[lambda d: d["completeness"] >= 1.0]

# web/src/components/FanChart.tsx — the UI always shows it
{history.map((h) => h.completeness < 1 ? <rect fill="url(#partial)" ... /> : null)}
```

---

### 2.5 Validation without pandera

**Chose:** nine explicit checks in plain pandas.
**Instead of:** the `pandera` schema the design document specified.

**Why:** identical assertions, one fewer dependency, and the failure output is readable on stage:

```
  [PASS] no date gaps: 2106 contiguous days
  [FAIL] non-negative: 3 negative values
```

**Documented as a deviation** rather than silently swapped.

---

### 2.6 The no-leakage guarantee is structural

**Chose:** truncate the frame at the cutoff as the **first operation**.
**Instead of:** computing features and trusting reviewers to spot leakage.

**Why:** look-ahead leakage is the most common defect in forecasting pipelines and the hardest to
notice afterwards, **because it produces results that look excellent.**

**Code** — `pipelines/features.py::build_features()`

```python
    # THE guarantee. Truncate first, compute second. Everything below this line
    # is arithmetic on a frame that cannot contain the future.
    df = df[df["ds"] <= cutoff].sort_values(["series_id", "ds"]).reset_index(drop=True)
```

Rolling windows shift before they roll, so today never enters its own feature:

```python
    for window in ROLLING_WINDOWS:
        shifted = grouped.shift(1)                      # never include today
        roll = shifted.groupby(df["series_id"]).rolling(window, min_periods=2)
```

**And price/promotion are excluded by name**, because no such column exists:

```python
def feature_columns(df) -> list[str]:
    banned = {"price", "promotion"}
    return [c for c in df.columns if c not in exclude and c not in banned]
```

---

## 3. Docker — two real bugs found by actually running it

Docker was believed unavailable and the compose file was shipped **marked unverified**. It turned out
to be installed but off the bash `PATH`. Running it surfaced two genuine bugs:

**Bug 1 — the container ran in fixture mode.** A Day-0 default survived into the compose file:

```yaml
# before
PHARMAPULSE_FIXTURES: "${PHARMAPULSE_FIXTURES:-1}"     # forced fixtures forever

# after — unset, so the API auto-detects
PHARMAPULSE_FIXTURES: "${PHARMAPULSE_FIXTURES:-}"
```

**Bug 2 — the Vite proxy pointed at the wrong container.** `localhost:8000` inside the web container
*is* the web container.

```ts
// web/vite.config.ts
// In Docker the API is another service, so the proxy target has to be the
// service name - "localhost" inside the web container is the web container.
const target = process.env.VITE_PROXY_TARGET ?? "http://localhost:8000";
```

**Verified after the fix:**

```
health: {'status':'ok','ladder_rung':1,'forecast_store':'present'}
meta  : {'origin':'observed','model_version':'2026-08-28T1718Z/ens-v1','degraded':None}
```

---

## 4. CI — and the bug `ruff` caught

CI runs the **real** pipeline on every push: `ruff` → `check_data` → full batch → 138 tests →
`day1_benchmark --fast`. **2 m 50 s, green.**

The first run failed at **Lint**, not at Prophet. Twenty-one errors, mostly import ordering — but
**one was a real bug**:

```python
# api/routers/forecasting.py  — F841, "assigned but never used"
cutoff = fs.read_forecast(series_id, grain, horizon)   # ← removed
```

That read the **entire forecast store from Parquet and discarded it, on every `/forecast` request**.
No test would have found it, because the endpoint returned correct results either way.

Two more worth fixing rather than silencing:

```python
# zip() without strict= silently truncates on a length mismatch, which in
# forecast_store and lgbm_global would mean quietly dropping forecast rows.
for q, v in zip(grp["quantile"], grp["value"], strict=True):
```

**Also fixed:** CI only built *gold*, but the replay tests need the forecast **store**. They would
have failed with a confusing "no orders were placed". CI now runs the full batch, and the replay
fixture skips with a clear reason if the store is genuinely absent.

---

## 5. Tests owned

| Test | Asserts |
|---|---|
| `test_features_depend_only_on_the_past` | **the load-bearing one** — feature at *t* identical with or without future rows |
| `test_lag_1_equals_the_previous_observation` | the lag is a real lag, not an off-by-one |
| `test_rolling_mean_excludes_the_current_period` | roll_mean_4 at *t* does not contain y(t) |
| `test_price_and_promotion_are_never_offered_as_features` | lane discipline in the feature matrix |
| `test_ingest_is_idempotent` | re-ingesting the same file changes zero rows |
| `test_ingest_refuses_a_synthetic_path` | lane 3 blocked in code |
| `test_exactly_26_closure_days` | the closure calendar |
| `test_orthodox_christmas_is_a_closure_in_five_of_six_years` | the doc correction |
| `test_closure_calendar_matches_the_documented_breakdown` | 21 mapped + 5 one-offs = 26 |
| `test_outliers_are_flagged_but_y_is_untouched` | no winsorising |
| `test_derived_grains_reconcile_with_the_daily_rollup` | one source of truth |
| `test_reconciliation_fails_loudly_when_a_bucket_is_wrong` | the guard actually guards |
| `test_the_truncated_final_bucket_is_visible_not_missing` | completeness is visible |
| `test_expected_row_counts` | 302 weekly, 70 monthly |

**25 tests across `test_no_leakage.py` and `test_pipeline.py`.**

---

## 6. What Pod A hands over

| To | What | Where |
|---|---|---|
| **Pod B** | gold at 3 grains, contract C1 | `data/warehouse/gold/grain=*/year=*/part.parquet` |
| **Pod B** | cutoff-aware features | `data/warehouse/features/grain=*/part.parquet` |
| **Pod C** | daily actuals for replay | `pipelines.gold.read_gold("day")` |
| **Everyone** | one command up, green CI, reproducible snapshot | `docker compose up`, `scripts/check_data.py` |

---

## 7. Honest gaps

- **`holidays.csv` is generated, not curated.** `pipelines/holidays.py` builds it from a fixed table
  plus computed Orthodox Easter dates. Verified against the closure pattern, but it is our table.
- **The 5 unexplained closures stay unexplained.** 2017-02-13 is near Statehood Day; the rest we do
  not account for. Named rather than rationalised.
- **No incremental ingest.** The nightly job re-reads the whole file. Correct and idempotent, but it
  is O(all history) rather than O(new rows). Fine at this size, and stated.

---

## 8. Second pass — the platform learned to hold more than one dataset

The data layer was correct and immovable. Four separate guards each said "no"
in a way that made a second dataset impossible, and the warehouse itself was a
hardcoded string. This section is that work, and the two provenance bugs it
surfaced.

### 8.1 The dead environment variable that explained everything

`docker-compose.yml` set `PHARMAPULSE_DATA_ROOT`. **No Python code read it.**

That was not a loose end, it was the reason a second dataset could not exist:
every layer hardcoded `data/warehouse/...` in a *default argument*, which
Python evaluates once at import. Running the batch on another file overwrote
the demo warehouse in place, because there was only ever one path.

`pipelines/paths.py` resolves the root per call:

```python
def data_root() -> Path:
    """The warehouse root. Read fresh every call - never captured in a default."""
    return Path(os.getenv("PHARMAPULSE_DATA_ROOT") or DEFAULT_ROOT)
```

Which turns "which dataset" into an environment variable:

```bash
PHARMAPULSE_DATA_ROOT=data/warehouse-synthetic \
  python -m pipelines.run_nightly --stage all \
    --raw data/synthetic/salesdaily_synthetic_2019_2026.csv --origin synthetic
```

The ledger keeps its own variable (`PHARMAPULSE_DB`) because it is
*operational* state, not analytical: you may want a fresh shelf against the
same forecasts, or the same shelf while you rebuild them.

### 8.2 Four guards that had to be switched off to do any work

Each was the right instinct implemented as a dead end. **A rule you switch off
to get work done is not a rule** — so each became narrower and kept its teeth.

| Guard | Was | Is | Why the new one is the real rule |
|---|---|---|---|
| `ingest` | refused any path containing `synthetic` | takes an explicit `origin=`; refuses a synthetic *path* loaded under any *other* lane | Loading lane 3 is allowed. Loading it **silently** is not. |
| `validate` | required `origins == {"observed"}` | requires a single **coherent** lane | The failure worth preventing is a MIXTURE: a frame that is mostly real with some invented rows produces a number nobody can characterise. |
| `read_gold` | filtered to `origin == "observed"`, so a lane-3 warehouse read back **empty** and models fitted on nothing | drops synthetic rows only when lanes are mixed | Same argument. A frame that is entirely one lane is coherent; what may be *claimed* about it is decided downstream from its origin. |
| the warehouse | one hardcoded path | `PHARMAPULSE_DATA_ROOT` | §8.1 |

```python
# pipelines/ingest.py
looks_synthetic = "synthetic" in str(raw_path).replace("\\", "/").lower()
if looks_synthetic and origin != "synthetic":
    raise ValueError(
        f"refusing to ingest {raw_path} as origin={origin!r}: the path says "
        "synthetic. Pass origin='synthetic' to load it knowingly ...")
```

Two tests hold the line: the original one (a synthetic path under the default
lane still raises) plus a new one asserting that when it *is* loaded knowingly,
every row reaches bronze carrying `origin == "synthetic"`.

### 8.3 Running the system as of any past date

`--as-of` truncates gold **before** anything is fitted, so the demand class, the
routing, the models and the calibration are all recomputed on what was knowable
that day:

```python
# core/pipeline.py::forecast_grain
if as_of is not None:
    gold = gold[gold["ds"] <= pd.Timestamp(as_of)]
```

Truncate-then-compute — the same guarantee `pipelines/features.py` makes, for
the same reason: a cutoff applied *after* a calculation is a cutoff that has
already leaked.

The date goes **into the version slug**
(`version=2026-09-02T1632Z_ens-v1_asof-2017-06-15`). Two stores built minutes
apart from the same file at different cutoffs are different models, and a
version string that cannot tell them apart is a provenance hole. Cost: about
22 seconds for all three grains.

### 8.4 Two provenance bugs, both found by running it rather than reasoning about it

**The version pointer repointed the wrong warehouse.** `POINTER` was a module
constant built from the old hardcoded root. After the root became configurable,
`write_version` wrote the new version into the *new* warehouse and then
repointed the *old* one at it — so the demo store ended up pointing at a
version that did not exist inside it. That is exactly the failure the atomic
pointer swap exists to prevent, reintroduced by leaving one path behind during
the migration.

Caught because the run printed `pointer -> None`. It is a function now, and
`write_version` writes `root / "CURRENT"` where `root` is the one it just used.

**The store stamped itself with the wrong file's hash.** It called
`snapshot_id(RAW)` — re-hashing the hardcoded real file. Building from any
other input produced a store claiming the *first* file's lineage, which is
worse than carrying no hash at all. It now reads the snapshot back off the gold
it actually fitted, and reports `mixed:N` rather than picking one if a
warehouse ever contains more than one.

```python
def _snapshot_of_gold() -> str:
    snaps = sorted(fitting_frame("day")["snapshot_id"].dropna().unique())
    if len(snaps) == 1:
        return str(snaps[0])
    return f"mixed:{len(snaps)}" if snaps else "unknown"
```

### 8.5 The synthetic extension, and why the obvious version is useless

We were handed a 2020–2026 extension. It broke four of the seven properties the
architecture is built on:

```
N05C zero-days   67.9%  ->   0.0%     the intermittent series vanished
N05C lag-1 acf    0.011 ->   0.930    a smooth AR process, not a pharmacy
closures         26 days ->  0        nothing for the cleaner to find
N05C spread      sd 1.09 ->  sd 0.12  9x compressed
```

With N05C smooth, the classifier routes it away from Croston and half the
model-portfolio argument evaporates on screen. Its *seasonality* was excellent —
all eight peak months preserved — which is the hard part, so
`scripts/make_extension.py` keeps that approach and fixes the rest.

It also does the thing that makes an extension worth anything: **five labelled
regime changes**, each chosen because the system should visibly respond without
being reconfigured. The headline one is N05C ceasing to be intermittent in 2022,
which moves it `intermittent -> smooth`, ADI 3.23 -> 1.12, and changes its route
from Croston/TSB to the smooth portfolio with nothing edited. M01AE runs the
same transition in reverse so the first cannot be dismissed as a one-way trick.

Four generator bugs, all found by measuring rather than assuming:

| Bug | Effect |
|---|---|
| the closure calendar applied every date ever closed to every year | 98 closures/yr against a real 4.3 |
| `exp()` of a zero-mean normal has mean `exp(sigma^2/2)` | levels and spread inflated ~2x |
| drawing a magnitude at the *with-zeros* mean, then zeroing it 68% of the time | counted the zeros twice; N05C at a quarter of its real volume |
| taking sigma from `std(log residual)` | double-counted seasonal misfit; **M01AE started life classified "erratic"**, so the smooth->intermittent transition had nowhere to start from |

`scripts/verify_extension.py` checks all of it and exits non-zero on drift. It
treats a series within 10% of a classifier cutoff as a **boundary case** rather
than a failure — R03 sits at ADI 1.30 against a 1.32 cutoff and will flip either
way run to run. Tuning the generator until it agreed would be fitting to the
checker.

### 8.6 The test suite was writing to the demo database

`ledger.post(..., db_path=DB_PATH)` — a default argument, evaluated once at
import, so nothing could redirect it afterwards. The contract tests POST
`/api/orders` through the real application. **Every `pytest` run wrote a real
receipt (+130 paracetamol, +25 sedatives) and a real hash-chained `order_log`
row into `data/warehouse/ops.db`.** Forty rows had accumulated.

That is why the Order screen kept drifting towards "recommended 0 units" between
runs and looked broken for no visible reason — and it would have done it during
a rehearsal.

The path resolves per call from `PHARMAPULSE_DB`, a session fixture points the
suite at a temp file, and a regression test asserts the real database is
byte-identical after a redirected write. The test was checked to actually fail
when the isolation is removed, rather than passing vacuously.

### 8.7 Scripts could not import the project

`python scripts/day1_benchmark.py` puts `scripts/` on `sys.path[0]`, **not** the
repository root. So `from core import calibrate` searched site-packages and
found an unrelated installed `core` distribution:

```
ImportError: cannot import name 'calibrate' from 'core'
(...\site-packages\core\__init__.py)
```

It only surfaced on a machine that happened to have that package. `scripts/`
*is* on `sys.path` when a script in it runs directly, so `scripts/_bootstrap.py`
prepends the repo root before any repo import resolves.

### 8.8 Deployment

A root `Dockerfile` builds the interface with Node and serves both from one
Python image — one URL, no CORS, no second free-tier service to keep awake. It
lives at the repository root because Hugging Face Spaces and most one-click
hosts build `./Dockerfile` and none of them let you point elsewhere.

The nightly batch runs *during the build*, so a cold container serves real
forecasts on its first request. If that fails — no network, a build timeout —
the build still succeeds and the API serves fixtures with `meta.degraded` set.
**A deployment that boots degraded and says so beats one that will not boot.**

### 8.9 Honest gaps, updated

- **The container filesystem is ephemeral and there is no reset endpoint.**
  A cold start reseeds the board, which is what you want, but while the
  instance is awake state accumulates and the only fix is a full redeploy.
- **`data/warehouse-*` is gitignored and unversioned.** Two people can build
  different stores from the same commit and neither can tell.
- **No scheduler.** `run_nightly` is triggered by hand or by the new
  `/api/datasets/rebuild` endpoint. The batch is triggered, not scheduled.
