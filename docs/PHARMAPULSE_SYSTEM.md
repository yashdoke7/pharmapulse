# PHARMAPULSE — The System

> **One document that explains the whole project: what it does, how the pieces connect, why each
> decision was taken over the obvious alternative, what that decision changed in the results, and
> exactly where in the code to look.**

If you read one file, read this one. It assumes nothing.

| Companion | What it adds |
|---|---|
| `PHARMAPULSE_CONCEPT.md` | The original design proposal — component by component, no measurements |
| `PHARMAPULSE_ARCHITECTURE.md` | The engineering reference — failure modes, evaluation design, self-critique |
| **`ARCHITECTURE_DELTA.md`** | **Every place the built system differs from the design documents, and why** |
| `PHARMAPULSE_RESULTS.md` | The condensed results + demo script |
| `MODEL_CARD.md` | Intended use, evaluation, limitations |
| `DEMONSTRATION.md` | Run it, and present it |
| `../team/results/` | Per-workstream deep dives with code walkthroughs |

**Reproduce everything in this file:**

```bash
python scripts/check_data.py                  # snapshot sha256:49e4f1c5c3da
python -m pipelines.run_nightly --stage all   # ~1 min
python scripts/day1_benchmark.py              # ~45 s
pytest -q                                     # 138 tests
```

---

## Contents

| § | |
|---|---|
| **1** | The problem, in one page |
| **2** | System map — what connects to what |
| **3** | ★ Walking the pipeline: 9 stages, each with *why this and not that*, the code, and the impact |
| **4** | The request path — what happens when a buyer clicks |
| **5** | The contracts that hold it together |
| **6** | Consolidated results |
| **7** | How it is tested, and what each test protects |
| **8** | Operations: containers, CI, degradation |
| **9** | Complete file index |

---

# 1. The problem, in one page

**Every week somebody in a pharmacy decides how much of each medicine to buy.** It is done from
memory, a wall chart, or last month's spreadsheet. Getting it wrong costs money in two directions:

| Direction | What happens | What it costs |
|---|---|---|
| **Too little** | A patient asks for a medicine you do not have. They go across the road. | The lost margin, and often the customer |
| **Too much** | Cash sits on a shelf until the medicine expires. | Holding cost on capital, plus a total write-off |

**The thesis:** a forecast is not the product. The purchase order is.

```
history  →  forecast  →  uncertainty  →  order quantity  →  cost of being wrong
                                        └─ almost nothing in this market goes past here
```

**The mathematics of the last step is a hundred years old and exact.** If being one unit short costs
`Cu` and being one unit over costs `Co`, the quantity that minimises expected total cost is the
demand level you meet with probability:

```
q* = Cu / (Cu + Co)
```

If shortage costs three times as much as excess, `q* = 0.75` — order the amount you would exceed
only one week in four. **That question is unanswerable from a single point forecast and answerable
in one line from a distribution.** It is why the forecast has to be a range, and it is why the
product's central control is a slider labelled *"how often are you willing to run out?"*

## 1.1 The data

Kaggle *Pharma Sales Data* (milanzdravkovic). One pharmacy, **2 Jan 2014 → 8 Oct 2019**,
**2,106 daily rows**, **8 ATC-2 drug groups**, units dispensed. No patient, prescriber or
transaction identifiers — **no personal data at all**.

| ATC | What it is | Daily mean | Zero-sale days |
|---|---|---|---|
| M01AB | Anti-inflammatory, acetic acid (diclofenac) | 5.03 | 1.9% |
| M01AE | Anti-inflammatory, propionic acid (ibuprofen) | 3.90 | 1.7% |
| N02BA | Salicylic acid (aspirin) | 3.88 | 3.7% |
| N02BE | Anilides (paracetamol) — largest by volume | 29.92 | 1.2% |
| N05B | Anxiolytics | 8.85 | 2.0% |
| N05C | Hypnotics and sedatives | 0.59 | **67.9%** |
| R03 | Obstructive airway drugs | 5.51 | 23.0% |
| R06 | Antihistamines | 2.90 | 12.2% |

## 1.2 The rule that protects the whole project

The data has dates and units sold. It does **not** have stock levels, lead times, prices,
promotions, regions or distributors. A system that invents those and trains on them is learning from
a random number generator — and any explanation it then produces is an explanation of noise.

```
LANE 1  observed       salesdaily.csv + calendar features derived from it
        trains models  YES   explains  YES   backs an accuracy claim  YES

LANE 2  user_setting   lead time · holding cost · margin · stock on hand · pack size
        trains models  NO    explains  YES (as a named input)   backs a claim  NO

LANE 3  synthetic      demo-only generated data
        trains models  NO — raises in code    explains  NO    backs a claim  NO
```

**Enforced, not intended.** `pipelines/ingest.py::ingest()` raises on a synthetic path; every gold
and forecast row carries an `origin` column; the API returns it; the UI renders a badge from it.
`price` and `promotion` are excluded **by name** in `pipelines/features.py::feature_columns()`.

---

# 2. System map

## 2.1 The whole thing on one screen

```
                        ┌──────────────────────────────────────┐
   data/observed/       │  salesdaily.csv    holidays.csv      │   LANE 1
                        └──────────────┬───────────────────────┘
                                       │
  ═══════════════ NIGHTLY BATCH ═══════▼═══════════════════════════════════
                                       │
   pipelines/ingest.py      ① INGEST   │  wide→long · sha256 snapshot ·
                                       │  idempotent upsert · raises on lane 3
                                       ▼
   pipelines/validate.py    ② VALIDATE │  9 gates · quarantine, never warn
                                       ▼
   pipelines/clean.py       ③ CLEAN    │  26 closures · outliers flagged not
                                       │  removed · holiday join
                                       ▼
   pipelines/gold.py        ④ GOLD     │  day / week / month, DERIVED from
                                       │  daily · completeness per bucket
                                       │  ┌─────────── CONTRACT C1 ──────────┐
                                       │  │ series_id ds grain y origin      │
                                       │  │ is_closed is_outlier completeness│
                                       │  │ snapshot_id                      │
                                       │  └──────────────────────────────────┘
                                       ▼
   pipelines/features.py    ⑤ FEATURES │  lags · rolling · Fourier · calendar
                                       │  ALL computed as of an explicit cutoff
                                       ▼
   core/classify.py         ⑥ ROUTE    │  ADI / CV² per series PER GRAIN
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
                 SMOOTH           INTERMITTENT        ERRATIC
             Prophet MSTL          Croston/TSB      quantile LGBM
             ARIMA SNaive          SNaive LGBM      MSTL SNaive ARIMA
             LightGBM
                    └──────────────────┼──────────────────┘
                                       ▼
   core/portfolio/*.py      ⑦ FIT      │  5 members, per series, train fold only
                                       ▼
   core/combine.py          ⑧ COMBINE  │  MEDIAN across members, then enforce
                                       │  quantile monotonicity
                                       ▼
   core/calibrate.py        ⑨ CALIBRATE│  conformal scale so the stated
                                       │  interval is the real one
                                       ▼
   core/forecast_store.py   FORECAST STORE
                                       │  21 quantiles × 8 series × 3 grains
                                       │  versioned dir + CURRENT pointer,
                                       │  written LAST → never a partial read
                                       │  ┌─────────── CONTRACT C2 ──────────┐
                                       │  │ series_id grain cutoff ds horizon│
                                       │  │ quantile value model_version     │
                                       │  └──────────────────────────────────┘
                                       ▼
  ══════════ the line: NOTHING BELOW RUNS A MODEL ═════════════════════════
                                       │
   api/deps.py              CACHE      │  LRU keyed on model_version →
                                       │  a deploy self-invalidates
                                       ▼
   core/forecast_store.py   lead_time_demand(series, days)
                                       │           ↓
   decision/newsvendor.py   DECIDE     │  q* = Cu/(Cu+Co)  ×  LANE 2 settings
                                       │  → integer order · cost at ±1 pack
                                       │  → 16-point cost curve
                                       ▼
   decision/risk.py         RANK       │  4 rules, sorted by RUPEES not
                                       │  probability
                                       ▼
   decision/ledger.py       SHELF      │  opening stock + every movement
                                       │  (SQLite, hash-chained order log)
                                       ▼
   api/routers/*.py         SERVE      │  16 endpoints, one envelope, every
                                       │  value carrying its provenance lane
                                       ▼
   web/src/screens/*.tsx    7 SCREENS  │  ┌────────── CONTRACT C3 ─────────┐
                                       │  │ {data, meta{origin, stale, …}} │
                                       │  └────────────────────────────────┘

  ══════════ EVIDENCE, produced independently of the app ══════════════════

   scripts/day1_benchmark.py  →  artifacts/benchmarks.json   (CONTRACT C4)
   decision/replay.py         →  /api/replay/business-case
```

## 2.2 The three properties that map makes visible

**The line in the middle.** Nothing below it fits a model. The nightly batch pays `O(n)` once so
every request is `O(1)`. That is why the response is fast, why two users opening the same product on
the same day see the same number, and why the service-level slider can recompute live.

**Lane 2 enters at exactly one point** — the decision engine. Settings never reach the trainer. The
provenance rule is enforced by the *shape* of the pipeline, not by discipline.

**Evidence is produced outside the app.** `benchmarks.json` is written by a script the API only
reads. "No number on the Ops Console is typed by a human" is therefore literally true.

## 2.3 Directory → responsibility

| Directory | Owns | Lines |
|---|---|---|
| `pipelines/` | raw file → trustworthy gold table + features | ~800 |
| `core/` | gold → calibrated demand distribution + explanation | ~1,500 |
| `decision/` | distribution + costs → order, risk, shelf, replay | ~1,150 |
| `api/` | HTTP surface, envelope, cache, settings | ~800 |
| `web/src/` | seven screens, two bespoke charts | ~3,150 |
| `tests/` | 138 tests: unit, property, contract | ~1,400 |
| `scripts/` | data check, benchmark, fixtures, openapi, demo reset | ~650 |

---

# 3. ★ Walking the pipeline

Each stage below answers four questions: **what it does**, **why this and not the obvious
alternative**, **where the code is**, and **what it changed in the result.**

---

## Stage ① — Ingest

**What.** Read `salesdaily.csv`, parse dates, unpivot wide → long `(series_id, ds, y)`, hash the
source file, upsert into append-only bronze.

**Why not use the supplied weekly and monthly files?** They ship with the dataset and would save a
`resample()` call. **`salesmonthly.csv` is corrupt** — January 2017 reads ~zero for seven of eight
groups while the daily file totals ~2,700 units for the same month. **53 series-months disagree with
a daily rollup by more than 5%.**

**So: one source of truth.** The daily file is the only input; weekly and monthly are derived, and a
test asserts they reconcile.

**Code** — `pipelines/ingest.py`

```python
def ingest(raw_path, out_root="data/warehouse/bronze") -> IngestResult:
    # Lane enforcement, in code rather than by convention.
    if "synthetic" in str(raw_path).replace("\\", "/").lower():
        raise ValueError(f"refusing to ingest from a synthetic path: {raw_path}")
    ...
    # Idempotent upsert on the natural key: re-ingesting the same file is a no-op.
    combined = combined.drop_duplicates(subset=["series_id", "ds"], keep="last")
```

**Impact.** Without this, a model trains on a month that never happened and every monthly chart is
wrong. Cost: one line. Guarded by `tests/unit/test_pipeline.py::test_ingest_is_idempotent` and
`::test_ingest_refuses_a_synthetic_path`.

---

## Stage ② — Validate

**What.** Nine declarative gates. A failing batch is **quarantined**, never passed through with a
warning.

**Why not pandera, as the design document proposed?** Same assertions, one fewer dependency, and the
failure messages are readable on stage. The gates are the point, not the framework.

**Why quarantine rather than warn?** A five-percent drift in a training input is indistinguishable
from a genuine change in the business once it reaches a model. It must be stopped at the boundary
where it is still attributable to a file.

**Code** — `pipelines/validate.py::validate()` and `::assert_reconciles()`

| Gate | Catches |
|---|---|
| schema + series set | a renamed, added or removed drug group |
| unique `(series_id, ds)` | a double-posted batch |
| non-negative, no nulls | impossible unit counts |
| contiguous dates | missing days |
| rows per day | incomplete ingestion |
| single snapshot | provenance traceable to one file |
| observed lane only | lane-3 data reaching the trainer |
| **daily-rollup reconciliation** | **the corrupt-monthly class of defect** |

**Impact.** All nine pass on the real file. `assert_reconciles` is the one that would have caught the
supplied monthly file, and it fails loudly rather than warning quietly.

---

## Stage ③ — Clean

**What.** Mark closures, flag outliers, join the holiday calendar. **`y` is never altered.**

**Why mask closures rather than impute or delete them?** 26 days read exactly zero across all eight
groups — the shop was shut, not slow.

- *Imputation* invents demand that did not occur.
- *Deletion* leaves a gap that a seasonal model reads as a **missing period**, shifting every
  subsequent lag.
- *Marking* records the fact accurately: demand was **unobserved**, not zero. The flag then becomes a
  feature the model can use, because closures are known in advance.

**Why flag outliers rather than winsorise them?** They are not errors. The five extreme N02BE days
are 30–31 December 2016 (New Year stock-up) and three days in January 2019 (a flu peak). **Removing
them removes the behaviour the system exists to anticipate.**

**Code** — `pipelines/clean.py`

```python
def detect_closures(long: pd.DataFrame) -> pd.DatetimeIndex:
    """Days where every series reads exactly zero: the shop was shut."""
    per_day = long.groupby("ds")["y"].agg(["sum", "count"])
    n_series = long["series_id"].nunique()
    closed = per_day[(per_day["sum"] == 0) & (per_day["count"] == n_series)]
    return pd.DatetimeIndex(closed.index)
```

**What we found, and a correction to our own architecture document.** 21 of the 26 closures map to
the Serbian Orthodox calendar. But the document claimed *"7 January, 2014–2019, every year"*. **It is
wrong: on 7 January 2017 the pharmacy was open and sold 59.9 units.** Corrected in the doc, and now
asserted by `tests/unit/test_pipeline.py::test_orthodox_christmas_is_a_closure_in_five_of_six_years`.

---

## Stage ④ — Gold

**What.** Write day, week and month grains as partitioned Parquet. Contract C1.

**Why is `completeness` a column and not a filter?** The series ends on 8 October 2019, so October
reads 295 units of N02BE against 984 in September — an apparent **70% collapse that is purely an
artefact of a partial month**. Dropping partial buckets makes them vanish, and a missing bar looks
like the data ends for an unknown reason. **A hatched bar labelled "partial" is honest.**

**Why Parquet + DuckDB rather than Postgres?** The workload is full-column scans grouped by series —
what a columnar format is for. DuckDB runs SQL directly over Parquet with **no server, no port and no
credentials**, so the identical code path runs on a laptop, in CI, and in a container.

**Code** — `pipelines/gold.py::aggregate()` and `::fitting_frame()`

```python
def fitting_frame(grain="week", root="data/warehouse/gold") -> pd.DataFrame:
    """Gold, filtered to what a model may fit on.

    Excludes partial periods. Closure rows are KEPT and carry their flag -
    masking them from the loss is the model layer's job, and deleting them
    here would leave a gap a seasonal model reads as missing data.
    """
    df = read_gold(grain, root)
    return df[df["completeness"] >= 1.0].reset_index(drop=True)
```

**Impact.** 2,106 daily → **302 weekly and 70 monthly buckets**, 16 partial periods flagged and
visible. Weekly and monthly reconcile exactly with the daily rollup.

---

## Stage ⑤ — Features

**What.** Lags 1–52, rolling mean/std over 4/13/52, expanding mean, calendar parts, a Fourier
seasonal basis, event flags, `series_id` as a categorical.

**The one non-negotiable rule.** Every feature is computed as of an explicit `cutoff`, and the frame
is **truncated as the first operation** — which makes the guarantee structural rather than a review
convention.

**Why it matters more than it sounds.** Look-ahead leakage is the most common defect in forecasting
pipelines and the hardest to notice afterwards, **because it produces results that look excellent.**

**Code** — `pipelines/features.py::build_features()`

```python
    # THE guarantee. Truncate first, compute second. Everything below this line
    # is arithmetic on a frame that cannot contain the future.
    df = df[df["ds"] <= cutoff].sort_values(["series_id", "ds"]).reset_index(drop=True)
```

and the rolling windows shift before they roll, so today never enters its own feature:

```python
    for window in ROLLING_WINDOWS:
        shifted = grouped.shift(1)                      # never include today
        roll = shifted.groupby(df["series_id"]).rolling(window, min_periods=2)
```

**Test** — `tests/unit/test_no_leakage.py` (7 tests). The central one:

```python
def test_features_depend_only_on_the_past(gold_week, cutoff):
    full = build_features(gold_week, cutoff=cutoff, grain="week")
    truncated = build_features(gold_week[gold_week["ds"] <= cutoff], cutoff=cutoff, grain="week")
    pd.testing.assert_frame_equal(full, truncated)
```

**If that test is red, every number the project reports is meaningless.**

---

## Stage ⑥ — Route

**What.** Compute ADI (average demand interval) and CV² (squared coefficient of variation of the
non-zero sizes) per series, place it in a Syntetos–Boylan quadrant, and route it to a model family.

**Why a computed rule rather than configuration?** When a product's behaviour changes, the route
changes on its own. Nothing is hardcoded to a series name.

**Code** — `core/classify.py`

```python
ADI_CUTOFF = 1.32
CV2_CUTOFF = 0.49

ROUTES = {
    SMOOTH:       ["Prophet", "AutoARIMA", "MSTL", "SeasonalNaive", "LightGBM"],
    INTERMITTENT: ["CrostonOptimized", "SeasonalNaive", "LightGBM"],
    ERRATIC:      ["LightGBM", "MSTL", "SeasonalNaive", "AutoARIMA"],
    LUMPY:        ["CrostonOptimized", "LightGBM", "SeasonalNaive"],
}
```

**Measured routing at daily grain — it lands exactly on the architecture document's table:**

| Quadrant | Series | ADI | CV² |
|---|---|---|---|
| smooth | M01AB M01AE N02BA N02BE N05B R06 | ~1.0–1.14 | 0.26–0.49 |
| **intermittent** | **N05C** | **3.115** | 0.41 |
| **erratic** | **R03** | 1.298 | **0.818** |

**★ A bug a test caught: demand class depends on the GRAIN.** Aggregation removes sparsity. N05C is
intermittent daily and **smooth** weekly. Classifying once on weekly data would have routed the daily
forecast to the wrong model family. Routing is now recomputed per grain —
`core/pipeline.py::forecast_grain()` calls `classify(gold)` on its own grain, asserted by
`tests/unit/test_core.py::test_demand_class_depends_on_the_grain`.

---

## Stage ⑦ — Fit the portfolio

**Why five members and not one?** Because they encode **different structural assumptions about how
demand is generated**, and the eight products here do not share one.

| Member | The one thing only it contributes | File |
|---|---|---|
| **Prophet** | Holidays as **named, individually fitted regressors**, plus a trend/season/holiday decomposition **in the units of the series** — which *is* the explainability screen | `core/portfolio/prophet_model.py` |
| **AutoARIMA** | Short-run autocorrelation. A decomposition model has no mechanism for momentum or mean reversion | `core/portfolio/statistical.py` |
| **MSTL** | Two overlapping seasonal cycles, non-parametrically, with Loess down-weighting the outliers we deliberately kept | same |
| **SeasonalNaive** | The control — "the calendar alone". It cannot extrapolate, diverge, or go negative | same |
| **LightGBM** (global, quantile) | The only member learning structure **shared across products**, and the only one whose cost does not grow with product count | `core/portfolio/lgbm_global.py` |

### ★ Two decisions inside this stage that changed the numbers

**1. AutoARIMA is fitted NON-seasonally at weekly grain.**

The obvious choice is `season_length=52`, since the data has annual seasonality. **It never
finished** — seasonal ARIMA searches seasonal lags 52 apart on 300 observations and ran **over 20
minutes without completing**, which would have made a CI-affordable backtest impossible.

```python
# core/portfolio/statistical.py
# Seasonal ARIMA at m=52 is pathological: the order search explores seasonal
# lags 52 apart on ~300 observations and takes minutes per series without
# improving accuracy. Weekly annual seasonality is better handled by MSTL and
# Prophet, which are in the portfolio for exactly that. So ARIMA is fitted
# NON-seasonally and contributes what only it can - short-run autocorrelation.
"AutoARIMA": AutoARIMA(season_length=1 if m > 24 else m),
```

**Impact:** fit time went from *never* to **1.2 s**. Honest cost: MASE 1.115 rather than the 1.039
the design document projected. Stated in the model card.

**2. Prophet's holidays are dropped at MONTHLY grain.**

Every holiday falls in the same month every year, so its coefficient is collinear with the annual
seasonal term. Fitting ~14 holiday coefficients on 70 monthly observations attributed **+34 units on
a 104-unit baseline** to "holidays" — visible on the explainability screen.

**Impact:** with them removed, R06's attribution reads seasonality −23.7, trend +4.0. Credible.
Weekly grain is unaffected, so the benchmark numbers do not move.

**3. Prophet's install is self-healing.** The 1.1.6 wheel ships a precompiled binary but no cmdstan
`makefile`, which cmdstanpy validates — so fits died with a confusing
`'Prophet' object has no attribute 'stan_backend'`. `_repair_cmdstan()` creates the placeholder at
import, verified by deleting the file and re-importing.

---

## Stage ⑧ — Combine

**What.** Take the **median across members at each quantile level**, then enforce monotonicity.

### ★ The result worth leading with

The obvious response to "five different models win across eight series" is to pick each series' best
model. **We implemented that and measured it losing.**

| Strategy | MASE |
|---|---|
| Pick each series' best model from previous folds | **0.968** |
| Median combination | **0.907** |
| Perfect hindsight (a bound, not a model) | 0.843 |

**Why selection loses.** With ~300 weekly observations you get a handful of folds. "Best on the last
fold" is mostly noise, so selection chases noise and locks in whichever model got lucky. Combination
does the opposite: **independent models make independent mistakes, and the median cancels them.**

Selection is scored honestly — `core/backtest.py::selection_score()` chooses for fold *k* using only
folds 1…*k*−1, so it never sees the answer it is graded on.

**Why median and not mean?** The failure we protect against is one member blowing up on one period.
A mean carries that error in proportion to its size; a median does not. Driven by a test:

```python
def test_median_ignores_one_member_blowing_up():
    preds = _preds(Prophet=[100.0], AutoARIMA=[102.0], MSTL=[98.0],
                   SeasonalNaive=[101.0], LightGBM=[9000.0])
    assert combine_point(preds)["value"].iloc[0] == pytest.approx(101.0)
    assert preds["value"].mean() > 1000    # sanity: the mean really is wrecked
```

**Why sort afterwards?** Taking medians independently at each level does **not** preserve ordering,
and an unordered quantile set is not a distribution. `core/combine.py::enforce_monotonic()` makes the
output valid; the sort is not cosmetic.

---

## Stage ⑨ — Calibrate

**What.** Measure whether our own prediction intervals are true, and correct them.

**Why this is not optional.** The decision layer reads a *specific quantile* to pick an order
quantity. A mis-sized interval moves that quantity, and **the error is invisible in any
point-forecast metric.**

### ★ The measurement — and it runs opposite to what we predicted

| | |
|---|---|
| Nominal interval | 80% |
| Achieved, raw model | **92.2%** |
| Achieved, after conformal correction | **82.0%** |
| Scale applied | 0.718 |
| Points behind it | 256 (8 series × 8 steps × 4 folds) |

The architecture document predicted over-confidence (75%, too narrow, causing silent
under-ordering). **Measured, the intervals are too WIDE.** The methodology is unchanged; the business
story flips: too-wide intervals cause **over-ordering and capital tied up on the shelf**.

**Why conformal?** It assumes nothing about the shape of the error distribution and gives a
finite-sample guarantee — appropriate for a non-negative count with an asymmetric tail, where a
Gaussian assumption is not.

**Why pooled across series?** Per-series calibration on ~32 points would overfit.

**Code** — `core/calibrate.py::conformal_scale()`

```python
    resid = (calibration["y"] - calibration["point"]).abs()
    standardised = (resid / calibration["spread"].replace(0, np.nan)).dropna()
    empirical = float(np.quantile(standardised, level))
    assumed = float(norm.ppf(0.5 + level / 2.0))
    return float(np.clip(empirical / assumed, 0.25, 5.0))
```

**And it is shown, not asserted.** The reliability diagram on the *Why* screen draws both curves and
prints `n = 256` on the chart, because **a confidence claim the user cannot verify is not a
confidence claim.**

---

## Stage ⑩ — The forecast store

**What.** 21 quantiles × 8 series × 3 grains = **7,056 rows**, written to a versioned directory.

**Why a pointer swap?** The `CURRENT` file is rewritten as the **last** operation, so a
partially-written run is never readable.

```python
# core/forecast_store.py::write_version
    # Last operation. Until this line runs, the new version is invisible.
    POINTER.write_text(slug, encoding="utf-8")
```

**The one function the decision engine needs:**

```python
def lead_time_demand(series_id: str, lead_time_days: int) -> dict[str, float]:
    """Distribution of TOTAL demand over the next `lead_time_days` days.

    Daily quantiles are aggregated by scaling the central estimate linearly and
    the spread by sqrt(n) - independent-ish daily errors partially cancel, so
    lead-time uncertainty grows slower than the mean. Summing the quantiles
    directly would overstate the tail badly.
    """
```

**Why not just sum the daily quantiles?** Because the 95th percentile of a sum is **not** the sum of
95th percentiles unless the days are perfectly correlated. Summing would inflate the tail and make
the system over-order at every service level.

---

# 4. The request path

**Nothing below the store fits a model.** Here is a `/api/recommend` call end to end.

```
POST /api/recommend {"series_id": "N02BE", "service_level": 0.95}
  │
  ├─ api/routers/decisions.py::_params_for()
  │     merges LANE 2 settings (ops.db) with any request override
  │     stock_on_hand = opening stock + every ledger movement
  │
  ├─ decision/newsvendor.py::protection_interval_days(4, 7) → 11
  │     ★ not 4. See below.
  │
  ├─ core/forecast_store.py::lead_time_demand("N02BE", 11)
  │     → {"0.05": 88.0, "0.50": 121.0, "0.95": 168.0, …}   [cached, LRU]
  │
  ├─ decision/newsvendor.py::recommend_order()
  │     Cu     = unit_margin                             = 4.00
  │     Co     = cost·holding·(L/365) + cost·expiry      = 0.2176
  │     q*     = Cu/(Cu+Co)                              = 0.948
  │     target = quantile(lead_time_demand, level)
  │     order  = round_to_pack(target − stock_on_hand)   ← asymmetric
  │     + build_cost_curve() at 16 service levels
  │
  └─ envelope with origin, model_version, snapshot_id, stale, correlation_id
```

## 4.1 ★ Three decisions inside the decision engine

### The protection interval — a real bug replay caught

**The obvious choice** is to size the order against demand over the **lead time**. It is what
"lead-time demand" suggests.

**It is wrong.** In a periodic-review system you cannot reorder until the next review. With a 7-day
review and a 4-day lead time, **today's order must survive 11 days** — until the order *after* next
arrives.

```python
def protection_interval_days(lead_time_days: int, review_period_days: int) -> int:
    """The window the order has to survive.

    Sizing against the lead time alone systematically under-orders, which the
    replay simulation surfaced as persistent stockouts under both policies.
    """
    return max(int(lead_time_days), 1) + max(int(review_period_days), 0)
```

**Impact — the largest single correctness fix in the project:**

| | Units unsupplied, Jan–Mar 2019 |
|---|---|
| Sizing against the lead time (4 days) | **2,207** |
| Sizing against the protection interval (11 days) | **121** |

### Rounding is asymmetric

Rounding to the *nearest* pack is wrong: the two rounding errors do not cost the same. With
`Cu > Co` the correct direction is **up**.

```python
def round_to_pack(units, pack_size, cu, co) -> int:
    packs = units / pack_size
    return int(math.ceil(packs) if cu >= co else math.floor(packs))
```

### The quantile grid is anchored at (0, 0)

**The bug:** clamping at the lowest stored quantile meant a product whose shortage is nearly free
still got ordered up to the 5th percentile — an order floor with no economic justification. Demand is
non-negative, so the quantile function genuinely approaches zero.

```python
    if level >= levels[-1]:
        return values[-1]                                   # upper tail: CLAMP
    return float(np.interp(level, [0.0] + levels, [0.0] + values))   # lower: to zero
```

The **upper** tail is still clamped, because extrapolating a tail we did not estimate would invent
confidence we do not have. Found by
`tests/property/test_newsvendor.py::test_free_shortage_means_order_nothing`.

## 4.2 The cost curve — why the slider feels instant

`/api/recommend` returns the order quantity, expected cost and stockout probability at **16 service
levels** in the same response. The browser interpolates that array locally and makes **zero network
calls while dragging**.

```
web/src/components/ServiceLevelSlider.tsx
    ON DRAG: interpolate(curve, level)  ← pure function, no fetch
```

This is only possible because the newsvendor calculation is **closed form** and the demand
distribution was already resolved by the batch. Fetching on drag would stutter *and* throw away the
reason the maths is closed form.

## 4.3 The shelf is event-sourced

```
live position  =  opening stock (settings, lane 2)  +  Σ ledger movements
```

Accepting an order posts a goods **receipt**, so the decision moves the shelf:

| | |
|---|---|
| Before accepting | 310 units · `order_now` · suggests 220 |
| After accepting 220 | **530 units** · `ok` · suggests 0 |

`decision/ledger.py` keeps this in SQLite — a running balance under concurrent writes needs
transactions, not scan throughput — with a **hash-chained order log**: each entry stores the previous
entry's hash, so an edit or deletion is detectable, and an override without a reason is refused.

---

# 5. The contracts

Five frozen interfaces, each with one producer. Full detail in `../CONTRACTS.md`.

| # | Contract | Producer → consumer | Enforced by |
|---|---|---|---|
| **C1** | Gold schema | `pipelines/` → `core/` | `contracts/schemas/gold.sql` + reconciliation test |
| **C2** | Forecast store | `core/` → `decision/`, `api/` | `contracts/schemas/forecast.sql` + roundtrip test |
| **C3** | HTTP API | `api/` → `web/` | `contracts/openapi.json` + 33 contract tests |
| **C4** | `benchmarks.json` | benchmark script → API, UI | shape asserted in CI |
| **C5** | Fixtures | API → web | captured from the live API, so shapes cannot drift |

**The envelope every 200 response carries:**

```json
{ "data": {...},
  "meta": { "origin": "observed", "model_version": "…/ens-v1",
            "snapshot_id": "sha256:49e4f1c5c3da", "stale": false,
            "degraded": null, "correlation_id": "c-9f2c1a4b" } }
```

Built once in `api/deps.py::meta()`, so every route carries provenance **whether or not its author
remembered**.

---

# 6. Consolidated results

## 6.1 Forecast accuracy

Weekly grain · horizon 8 · 4 non-overlapping rolling origins · MASE (in-sample naive denominator) ·
8 series · seed 42 · **43 s**, 292 series-model-folds, one CPU.

| Model | MASE | |
|---|---|---|
| Naive | 1.332 | |
| WindowAverage(8) | 1.165 | |
| DynamicOptimizedTheta | 1.149 | |
| AutoETS | 1.124 | |
| **SeasonalNaive** | **1.117** | ← the benchmark to beat |
| AutoARIMA | 1.115 | non-seasonal, see stage ⑦ |
| CrostonOptimized | 1.085 | |
| MSTL | 1.014 | |
| LightGBM | 0.961 | |
| Prophet | 0.935 | best single model |
| **Ensemble (median of 5)** | **0.907** | ← **shipped · 18.8% better than benchmark** |
| *Oracle* | *0.843* | a bound, not a model |

## 6.2 Per series — including the weak ones

| Series | SeasonalNaive | Ensemble | Best single | |
|---|---|---|---|---|
| M01AB | 0.971 | **0.651** | AutoARIMA | |
| M01AE | 1.019 | **1.000** | Naive | ⚠ effectively a tie |
| N02BA | 0.671 | **0.618** | SeasonalNaive | |
| N02BE | 0.993 | **0.799** | Prophet | |
| N05B | 0.939 | **0.621** | WindowAverage | |
| N05C | 1.174 | **0.785** | CrostonOptimized | routing pays off |
| R03 | 1.294 | **1.137** | CrostonOptimized | above 1.0 |
| **R06** | 1.880 | **1.646** | Prophet | ⚠ **worst series** |

## 6.3 Decision quality — the business case

Both policies replayed over the **same real days**, identical costs, lead time, review cadence and
**protection interval**. The only difference: min/max sizes against the **mean**, we size against the
quantile the cost ratio implies.

| Window | Min/max | PharmaPulse | Lower by | Units unsupplied |
|---|---|---|---|---|
| Jan–Mar 2019 | ₹4,608 | **₹1,479** | **67.9%** | 349 → **121** |
| Apr–Jun 2019 | ₹3,362 | **₹1,200** | **64.3%** | 325 → **76** |
| Oct–Dec 2018 | ₹4,942 | **₹1,211** | **75.5%** | 343 → **48** |

**The saving comes from lost sales, not from holding less.** We deliberately hold *more* stock and
pay *more* holding cost — `tests/unit/test_replay.py::test_the_saving_comes_from_fewer_lost_sales`
asserts both.

**★ An earlier version of this comparison was rigged.** After fixing our own protection interval I
left min/max on the old one, which handed us an 88% saving. Giving the baseline the same interval
brings it to a defensible ~70%. **A flattering number deserves the same scrutiny as a bad one.**

---

# 7. How it is tested

**138 tests.** Not coverage for its own sake — each one protects a claim that appears on a slide.

| Suite | Count | Protects |
|---|---|---|
| `tests/unit/test_no_leakage.py` | 7 | **every reported number** |
| `tests/unit/test_pipeline.py` | 18 | one source of truth, closures, completeness, lanes |
| `tests/unit/test_core.py` | 20 | routing, combination validity, calibration direction |
| `tests/unit/test_decision.py` | 21 | ledger balance, audit chain, risk ranking |
| `tests/unit/test_replay.py` | 17 | the simulation and the business case |
| `tests/property/test_newsvendor.py` | 22 | the order arithmetic, via `hypothesis` |
| `tests/contract/test_api.py` | 33 | the shapes the frontend codes against |

## 7.1 The six that matter most

| Test | If it breaks |
|---|---|
| `test_features_depend_only_on_the_past` | Every accuracy number is meaningless |
| `test_derived_grains_reconcile_with_the_daily_rollup` | "One source of truth" is a claim, not a fact |
| `test_order_is_monotone_in_service_level` | The slider is incoherent |
| `test_explain_components_sum_to_the_total` | The explanation contradicts the number it explains |
| `test_matches_fixtures` / contract suite | The frontend breaks silently |
| `test_concurrent_ticks_do_not_corrupt_the_run` | Replay produces different answers under load |

## 7.2 Property testing, and why it earned its place

The order arithmetic is where a **plausible-looking wrong answer is indistinguishable from a right
one**. So it is tested by properties rather than examples:

- order quantity is monotone non-decreasing in `service_level`
- order quantity is monotone non-increasing in `stock_on_hand`
- the order is always a non-negative whole multiple of `pack_size`
- `Cu → 0` implies `q* → 0` implies order 0
- expected cost at the optimum is never worse than at ±1 pack

## 7.3 The bugs the tests found

| Found by | Bug |
|---|---|
| A test asserting N05C is intermittent | Demand class was computed once on weekly data |
| A property test on free shortage | Quantile grid clamped instead of anchoring at zero |
| Writing replay | The decision engine sized against the lead time, not the protection interval |
| A test assuming every day trades | (Not a bug — replay correctly reproduces the 26 closure days) |
| Driving the UI | Concurrent replay ticks corrupted a run |
| `ruff` in CI | A full forecast-store read per request whose result was discarded |

---

# 8. Operations

## 8.1 Run it

```bash
# local
pip install -r requirements.txt
python -m pipelines.run_nightly --stage all
uvicorn api.main:app --port 8000
cd web && npm run dev

# containers - verified
docker compose up --build
python scripts/reset_demo.py     # reset the board between rehearsals
```

**No database service and no Redis, deliberately.** Analytical storage is Parquet read by DuckDB;
operational storage is SQLite in the same volume; the cache is an in-process LRU keyed on
`model_version`, so a deploy self-invalidates with no flush step anyone could forget.

## 8.2 CI

Runs the **real** pipeline on every push: `ruff` → `check_data` → full batch → 138 tests →
`day1_benchmark --fast`. A model regression fails the build rather than surprising us later. The
dataset is committed (117 kB, public, no personal data), so CI scores the same bytes a developer
machine does.

## 8.3 Degradation ladder

The system descends a rung and **says which rung it is on** via `meta.degraded`; the UI renders a
badge.

| Rung | State | Serves | User sees |
|---|---|---|---|
| 1 | Healthy | calibrated ensemble | nothing unusual |
| 3 | Nightly job failed | yesterday's forecasts | amber staleness badge with the vintage |
| 5 | Model layer down | `contracts/fixtures/*.json` | "demo data · model layer offline" |

Rung 5 is one environment variable — `PHARMAPULSE_FIXTURES=1` — and it is the switch to flip if the
model layer dies on stage. It is kept working and tested all the way through.

---

# 9. Complete file index

## `pipelines/` — Data foundation

| File | Responsibility | Key function |
|---|---|---|
| `ingest.py` | wide→long, checksum, idempotent upsert, lane-3 refusal | `ingest()` |
| `validate.py` | 9 gates, quarantine, rollup reconciliation | `validate()`, `assert_reconciles()` |
| `clean.py` | closures, outlier flags, holiday join | `detect_closures()`, `clean()` |
| `holidays.py` | Serbian Orthodox calendar, versioned CSV | `build_calendar()` |
| `gold.py` | contract C1 at 3 grains, completeness | `aggregate()`, `fitting_frame()` |
| `features.py` | **cutoff-aware** features | `build_features()` |
| `run_nightly.py` | orchestration, idempotent | `run_gold()`, `main()` |

## `core/` — Forecast engine

| File | Responsibility | Key function |
|---|---|---|
| `classify.py` | ADI/CV² routing | `classify()`, `eligible_models()` |
| `backtest.py` | rolling-origin CV, MASE, ablations | `make_folds()`, `selection_score()` |
| `portfolio/statistical.py` | ARIMA, MSTL, SNaive, Croston, ETS, Theta | `fit_predict()` |
| `portfolio/prophet_model.py` | Prophet + self-healing install | `fit_predict()`, `_repair_cmdstan()` |
| `portfolio/lgbm_global.py` | global quantile LightGBM | `fit_predict()` |
| `combine.py` | median + monotonicity | `combine_point()`, `enforce_monotonic()` |
| `calibrate.py` | conformal scale, coverage curves | `conformal_scale()` |
| `forecast_store.py` | contract C2, pointer swap | `write_version()`, `lead_time_demand()` |
| `explain.py` | attribution in units | `attribute()` |
| `pipeline.py` | the forecast stage, per-grain routing | `build_forecast_store()` |

## `decision/` — Decision engine

| File | Responsibility | Key function |
|---|---|---|
| `newsvendor.py` | **pure** order arithmetic | `recommend_order()`, `protection_interval_days()` |
| `ledger.py` | event-sourced shelf + hash-chained audit | `balance()`, `log_order()`, `verify_chain()` |
| `risk.py` | 4 rules, ranked by rupees | `detect()`, `rank()` |
| `replay.py` | day-by-day simulation + business case | `ReplaySession`, `compare_policies()` |

## `api/` — Service

| File | Responsibility |
|---|---|
| `main.py` | app, CORS, routers, error envelope |
| `deps.py` | envelope, settings, LRU cache, live stock |
| `routers/forecasting.py` | `/series` `/history` `/forecast` `/explain` |
| `routers/decisions.py` | `/recommend` `/risk` `/positions` `/settings` `/orders` `/ledger` |
| `routers/replay.py` | `/replay/start` `/tick` `/stop` `/business-case` |
| `routers/ops.py` | `/health` `/metrics` |

## `web/src/` — Product

| Path | Screen / component |
|---|---|
| `screens/Dashboard.tsx` | exceptions ranked by money — opens on a statement, never a chart |
| `screens/Orders.tsx` | the order, the slider, the ledger trail |
| `screens/Forecast.tsx` | fan chart, grain switch, member comparison |
| `screens/Explain.tsx` | attribution in units + reliability diagram |
| `screens/LiveOps.tsx` | replay + the measured business case |
| `screens/Ops.tsx` | leaderboard, ablation, per-series including losses |
| `screens/Settings.tsx` | lane-2 parameters, live q\* |
| `components/FanChart.tsx` | raw SVG — bands, cutoff rule, hatched partial buckets |
| `components/ReliabilityDiagram.tsx` | raw SVG — before/after coverage |
| `components/ServiceLevelSlider.tsx` | local interpolation, zero fetches on drag |
| `components/ui.tsx` | the design system |

## `scripts/`

| File | What it does |
|---|---|
| `check_data.py` | Day-0 gate: rows, columns, 26 closures, prints the snapshot_id |
| `day1_benchmark.py` | **writes every accuracy number** → `artifacts/benchmarks.json` |
| `make_fixtures.py` | captures fixtures from the live API |
| `dump_openapi.py` | regenerates `contracts/openapi.json` |
| `reset_demo.py` | resets the board between rehearsals |

---

> ### The system's output is not a forecast. It is a purchase quantity, a probability, and the reason behind both.
