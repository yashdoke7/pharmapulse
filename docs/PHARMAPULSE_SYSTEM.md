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
| **10** | ★ **Second pass** — what changed, and the four claims it corrected |
| **11** | ★ **Every choice explained** — the tools and what they beat, the five models with their formulas, the newsvendor worked through, the ERP comparison, and 30 panel questions |

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

> **⚠ SUPERSEDED — the table above is the old measurement.** The replay served
> ONE forecast, anchored months *after* the window it was replaying, to every
> policy. On R03 that predicted 41 units per protection interval against 119
> actually sold in December: every policy under-ordered all winter, and the
> headline saving really meant "safety stock on a stale forecast beats no
> safety stock on the same stale forecast".
>
> Every policy now sizes off the same trailing window of real sales, and two
> harder baselines were added. Current figures (positive = we are cheaper):
>
> | Baseline | Jan–Mar 19 | Apr–Jun 19 | Oct–Dec 18 |
> |---|---|---|---|
> | Min/max on the mean | +6.0% | +48.8% | +61.1% |
> | (s, S) safety stock — what an ERP does | −2.9% | +23.1% | −1.8% |
> | **Our forecast, sized with a normal approximation** | **+17.9%** | **+8.1%** | **+0.4%** |
>
> The third row is the one that carries the claim: same forecast, same service
> level, differing only in normal-approximation versus the empirical quantile.
> We win all three. Against a real ERP policy we are level. See README.md.


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
---

# 10. Second pass — what changed, and the four things it corrected

Sections 1–9 describe the system as first built. A review pass changed enough
that this section exists rather than editing history: **three of the four
changes below are corrections to claims the system was making**, and the
correction is more instructive than the claim.

| | Change | Why it is here |
|---|---|---|
| **10.1** | The system can hold more than one dataset, and run as of any past date | A frozen system could not answer "does it work on my data?" |
| **10.2** | The business case was measuring forecast vintage, not decision rule | **The headline number was inflated.** It moved from 69.5% to a set of smaller, defensible figures |
| **10.3** | Three claims the code could not defend | A hardcoded season label, a mislabelled tie, a panel that did not vary |
| **10.4** | Two bugs that were silently corrupting state | The test suite wrote to the demo database; a pointer swap repointed the wrong warehouse |

---

## 10.1 One system, many datasets, any date

### The dead environment variable

`docker-compose.yml` set `PHARMAPULSE_DATA_ROOT`. **No Python code read it.**

That was not a loose end — it was the reason a second dataset could not exist.
Every layer hardcoded `data/warehouse/...` in a *default argument*, which Python
evaluates once at import, so nothing could redirect it afterwards. Running the
batch on a second file overwrote the demo warehouse in place.

`pipelines/paths.py` resolves per call, and "which dataset" becomes an
environment variable:

```bash
PHARMAPULSE_DATA_ROOT=data/warehouse-synthetic \
  python -m pipelines.run_nightly --stage all \
    --raw data/synthetic/salesdaily_synthetic_2019_2026.csv --origin synthetic
```

### Four guards that had to be switched off to do any work

Each was the right instinct built as a dead end. **A rule you switch off to get
work done is not a rule.**

| Guard | Was | Is now |
|---|---|---|
| `ingest` | refused any path containing `synthetic` | takes an explicit `origin=`; refuses a synthetic *path* under any *other* lane |
| `validate` | required `origins == {"observed"}` | requires a single **coherent** lane |
| `read_gold` | filtered to `observed`, so a lane-3 warehouse read back **empty** | drops synthetic rows only when lanes are **mixed** |
| the warehouse | one hardcoded path | `PHARMAPULSE_DATA_ROOT` |

The rule worth enforcing was never "lane 3 may not be loaded". It is **"lane 3
may not be loaded silently, and may never be mixed with lane 1"**. A frame that
is mostly real with some invented rows produces a number nobody can
characterise; a frame that is entirely one lane is coherent, and what may be
*claimed* about it is decided downstream from its `origin` — which now travels
to the browser and switches the accuracy figures off.

### Running as of a past date

```python
# core/pipeline.py::forecast_grain
gold = fitting_frame(grain)
if as_of is not None:
    gold = gold[gold["ds"] <= pd.Timestamp(as_of)]
```

Placement is the entire point, and it is the same guarantee stage ⑤ makes:
**truncate first, compute second.** Everything below that line — `classify`, the
route, the fits, the conformal scale — sees a frame that cannot contain the
future. Filtering a finished forecast instead would leak through the demand
class alone, because ADI is computed from the zero rate and a zero rate that
includes future days is future information.

The as-of date goes **into the version slug**
(`version=2026-09-02T1632Z_ens-v1_asof-2017-06-15`), because two stores built
minutes apart from the same file at different cutoffs are different models.
Cost: ~22 s for all three grains.

### The synthetic extension, and why the obvious version proves nothing

An extension that continues the same series with the same statistics shows
nothing. Worse, the one we were handed broke four of the seven properties from
§1:

```
N05C zero-days   67.9%  ->   0.0%     the intermittent series vanished
N05C lag-1 acf    0.011 ->   0.930    a smooth AR process, not a pharmacy
closures         26 days ->  0        nothing for the cleaner to find
N05C spread      sd 1.09 ->  sd 0.12  9x compressed
```

`scripts/make_extension.py` preserves those and injects **five labelled regime
changes**, each chosen because the system should visibly respond *without being
reconfigured*:

```
N05C  2019-2022  intermittent  ADI 3.23  -> Croston, SeasonalNaive, LightGBM
      2025-2026  smooth        ADI 1.12  -> Prophet, ARIMA, MSTL, SNaive, LGBM
M01AE 2019-2022  smooth                  -> the same transition, in reverse
```

That is the demonstration: a computed rule re-routed a product because the
product changed. `scripts/verify_extension.py` checks every preserved property
and exits non-zero on drift, treating a series within 10% of a cutoff as a
**boundary case** rather than a failure — R03 sits at ADI 1.30 against a 1.32
cutoff and flips either way run to run. Tuning the generator until it agreed
would be fitting to the checker.

---

## 10.2 ★ The business case was measuring the wrong thing

**This is the most important correction in the project.**

### The flaw

Every policy in the replay read the **published forecast store**, anchored at one
cutoff — the day after the last observation. The replay windows are months
*earlier*, so one static forecast was applied to every simulated day regardless
of season:

```
R03  Oct-Dec 2018   forecast(11d) = 41.0   actual = 118.6   ratio 0.35
```

Min/max shared the same handicap. So "69.5% cheaper" really meant *safety stock
on a stale forecast beats no safety stock on the same stale forecast.*

### Where the old advantage came from, exactly

```
              STALE STORE (old)            TRAILING ACTUALS (new)
         p50/11d p95/11d minmax-S     p50/11d p95/11d minmax-S
R03           41     118       67          92     153      151
N02BE        399     546      654         371     443      607
M01AB         57      91       94          54      69       88
```

R03 is the whole story. The stale forecast said 41; December sold 119. Min/max
sized off that same wrong number and targeted 67 — it starved. We targeted the
p95 of that distribution, 118, which landed near the real 119 **by accident**:
our interval was wide enough to compensate for a point forecast that was badly
wrong. Ratio **1.76×**.

With real trailing data R03 goes to p95 = 153 against min/max S = 151 — ratio
**1.02×**. The gap collapses because the artefact disappears.

### The fix, and the harder baselines

Every policy now sizes off rolling sums of the trailing 180 days, strictly
before the simulated day. And min/max alone is too soft to lead with — every ERP
carries safety stock — so two harder rungs were added:

| Policy | Sizes at | Gets our forecast? | Tests |
|---|---|---|---|
| `minmax` | `mean · (L + R)` | no | the "no system" floor |
| `safety_stock` | `μ·L + z·σ·√L` from trailing stats | no | what an ERP does |
| `normal_approx` | `median + z·σ` from **our** distribution | **yes** | **normal vs empirical, forecast quality held constant** |

`normal_approx` is the rung that carries the claim. `σ` is recovered from the
interval rather than assumed — for a normal, `p90 − p50 = 1.2816σ`, which is
what a practitioner does with a published interval and does not require the
distribution to actually *be* normal.

### The honest result

```
                   Jan-Mar 19   Apr-Jun 19   Oct-Dec 18
minmax                  +6.0%       +48.8%       +61.1%
safety_stock            -2.9%       +23.1%        -1.8%
normal_approx          +17.9%        +8.1%        +0.4%
```

**We beat the normal approximation on every window** — the empirical quantile
earns its place. **We are level with a real ERP policy**, winning one and losing
two by a couple of percent, and those cells ship in amber rather than being
cropped out. What separates us there is not cost: `z` comes from the pharmacy's
own margins instead of a consultant, the interval behind it is calibrated, and
the number explains itself.

### The limit, stated

Because every policy sizes off a trailing window, **none can anticipate a
seasonal turn** — on 1 January the last 180 days are autumn. Anticipating it is
exactly what the forecast layer is *for*, and the replay does not exercise it:
that needs a forecast produced at each **review point** rather than one vintage.
`--as-of` makes it buildable. It is the single most valuable next experiment.

---

## 10.3 Three claims the code could not defend

### A season label that was typed, not measured

```python
SEASON_HINTS = {"R06": "pollen season", "N02BE": "flu wave", ...}   # deleted
```

The **magnitude** was always real — Prophet's fitted `yearly` component. The
**noun** was a lookup table, and it was the only thing on any screen the code had
not derived. It would have been silently wrong on anyone else's data.

Derived from the measured peak month now, with the shape drawn beside it:

```
R06    peak May       1.74x its own average
N02BE  peak January   1.49x
R03    peak December  1.46x
```

The old labels were roughly right, which is exactly what made them dangerous.

### A tie counted as a loss

The per-series chips treated `MASE >= 1` as a failure, so **M01AE at exactly
1.000 was flagged "above naive"** — the Evidence screen said *3 of 8* while the
deck said two. A tie is not a loss. Both surfaces now say **2 losses, 1 tie**.

### A panel that did not vary with its subject

The right-hand panel on *Why* was the reliability diagram — a **global** result,
byte-identical on all eight products. It moved to *Evidence*, where a global
result belongs, and *Why* now shows that medicine's own seasonal profile.

---

## 10.4 Two bugs that were silently corrupting state

### `pytest` was writing to the demo database

`ledger.post(..., db_path=DB_PATH)` — a default argument, evaluated once at
import. The contract tests POST `/api/orders` through the real application, so
**every test run wrote a real receipt (+130 paracetamol, +25 sedatives) and a
real hash-chained `order_log` row into `data/warehouse/ops.db`.** Forty rows had
accumulated.

That is why the Order screen kept drifting towards "recommended 0 units" between
runs, for no visible reason — and it would have done it during a rehearsal. The
path resolves per call from `PHARMAPULSE_DB` now, a session fixture points the
suite at a temp file, and a regression test asserts the real database is
byte-identical afterwards. The test was checked to actually *fail* when the
isolation is removed.

### The atomic pointer swap repointed the wrong warehouse

`POINTER` was a module constant built from the old hardcoded root. Once the root
became configurable, `write_version` wrote the new version into the *new*
warehouse and then repointed the *old* one at it — so the demo store pointed at
a version that did not exist inside it.

That is precisely the failure the pointer swap exists to prevent (§stage ⑩),
reintroduced by leaving one path behind during a migration. Caught because the
run printed `pointer -> None`.

### And one more, in the same family

The store stamped itself with `snapshot_id(RAW)` — re-hashing the hardcoded
input file. Building from any other file produced a store **claiming the first
file's lineage**, which is worse than carrying no hash at all. It now reads the
snapshot back off the gold it actually fitted.

---

## 10.5 Serving, deployment, and what does not cache

**One container, one origin.** `api/main.py` mounts `web/dist` when it exists,
with a catch-all returning `index.html` so a refresh on `/orders` does not 404.
`docker-compose` still runs two services because that is right for development —
Vite gives hot reload, a static bundle cannot.

That catch-all had a bug worth recording: it **swallowed unmatched `/api` paths
and returned HTML with a 200**, so a caller got a page where it expected JSON.
It 404s properly now.

**The batch runs during the image build**, so a cold container serves real
forecasts on its first request. If it fails, the build still succeeds and the
API serves fixtures with `meta.degraded` set — a deployment that boots degraded
and says so beats one that will not boot.

**What caches and what does not**, now stated on the Evidence screen:

| | Cached? |
|---|---|
| Serving a screen | **yes** — in-process LRU keyed on `model_version`; no model runs inside a request |
| The nightly batch | **no** — refits from scratch every run. No warm start, no incremental update |

Affordable at 8 products; the first thing that breaks at 8,000. The original
design had update modes and they were never built.

One cache bug found on the way: the LRU key is `model_version`, so publishing a
*new* version self-invalidates — but **activating an OLD one brings a stale key
back into scope with stale data behind it.** `deps.clear_caches()` now runs on
every pointer swap.

---

## 10.6 The eighth screen

`web/src/screens/Data.tsx` — the live dataset with its lane badge, an as-of
date control, a CSV upload, and every version built with an *Activate* button.

A rebuild costs ~20 s: too long to hold a request open, far too short to justify
a queue. `POST /api/datasets/rebuild` runs it on a thread and the screen polls.
Only one runs at a time — they write to the same warehouse — and a second
request gets a 409 rather than a corrupted store.

Full screen-by-screen reference: [WEB_REFERENCE.md](WEB_REFERENCE.md).

---

## 10.7 Honest gaps, as of this pass

- **`api/routers/datasets.py` has zero tests** — ~250 lines, the newest surface
  in the project, entirely uncovered.
- **No reset endpoint.** `scripts/reset_demo.py` needs a shell, which a free
  hosting tier does not provide. A live instance that has been clicked around
  cannot be reset without a redeploy.
- **The replay cannot yet show the forecast layer's value** (§10.2).
- **No warm start in the batch** (§10.5).
- **Nothing below `lg:` in the interface has been looked at**, and no
  accessibility pass has been done.
- **Jobs die with the process.** In-memory, no persistence.

---

# 11. ★ Every choice explained — the tools, the models, the maths, the competition

§3 walked the pipeline and said *what* each stage does. This section answers the
next question in every case: **why that, and not the obvious alternative** — and
it explains the models themselves in plain language, with the formula, so a
reader can defend any part of the system without having built it.

Read §11 as five blocks:

| | |
|---|---|
| **11.1 – 11.4** | The stack. Every library, why it beat the alternative, and the eleven things we refused to install |
| **11.5 – 11.6** | The models. What each one actually computes, what job it does, where it is weak |
| **11.7** | The decision. How a distribution becomes a number of boxes, worked through with real figures |
| **11.8** | The competition. What an ERP does, why it beats us where it does, and the honest verdict |
| **11.9** | Thirty questions a panel can ask, with short answers |

---

## 11.1 The one constraint that shaped the whole stack

> **The system must run on one laptop, with no server process to administer, and
> install from `pip install -r requirements.txt`.**

That is not modesty — it is a design constraint with teeth. A judge, a teammate,
a CI runner and a free hosting tier all have to run this thing. So nearly every
component is a **library**, not a **service**: nothing has a port, a password, or
a daemon that can be down while you are presenting.

Read the rest of §11.2–11.4 through that lens. Most "why not X" answers end in
the same place: X is a server.

---

## 11.2 Storage — three different jobs, three different answers

### Parquet for the history

**What it is.** A columnar, compressed, binary table format. *Columnar* is the
important word: a CSV stores row after row, so reading one column means reading
the whole file; Parquet stores each column together, so reading one column
touches only that column's bytes.

**Four things it gives us that a CSV cannot:**

1. **Types survive.** A CSV has no types — `ds` comes back a string, `is_closed`
   comes back the text `"True"`, and `y` becomes `object` the moment one cell is
   blank. Every one of those is a silent bug that surfaces three layers later.
   Parquet keeps the schema in the file, so `read_parquet` returns dates, bools
   and floats with no conversion code to forget.
2. **Compression that matters.** Demand columns are long runs of similar small
   numbers, so zstd gets 5–10×. **The whole warehouse is 1.1 MB** — which is why
   it fits a free hosting tier and does not bloat the repository.
3. **Partition pruning.** `grain=week/year=2018/` is not decoration; it is a
   Hive-style partition scheme. A reader that wants weekly rows never opens the
   daily files. At our size that saves milliseconds. At 8,000 products it is a
   200 ms read instead of a 40-second one — **and the layout does not change**.
4. **Publication becomes atomic for free.** A version directory is written in
   full, then the `CURRENT` pointer is rewritten last. A reader sees the old
   complete version or the new complete version, never a half-written one. That
   is a property of *files*; a database would need a transaction for it.

**Why not Postgres here.** A relational database is built for *transactions* —
many small concurrent reads and writes, with locking and constraints. Our
analytical layer is the opposite: **written once a night by one process, read
whole by everything else.** Paying for a server, a port, a password and a
migration tool to get a *worse* fit is a bad trade — and `docker compose up`
would then need a database to be healthy before anything worked at all.

**What it costs us.** You cannot open a Parquet file in Excel. Which is exactly
the gap the next tool fills.

### DuckDB as the way to look inside

**What it is.** An in-process analytical SQL engine — "SQLite for analytics". You
`import` it; you do not connect to it. No daemon, no port, no user account.

Two properties make it the right companion to Parquet:

* **Vectorised and columnar** — it processes ~2,048 values of one column at a
  time instead of one row at a time, which for aggregation is typically 10–100×
  a row-oriented engine.
* **It queries Parquet in place.** No import step. The file *is* the table:

  ```sql
  SELECT series_id, sum(y) FROM 'data/warehouse/gold/**/*.parquet'
  WHERE grain = 'week' GROUP BY 1;
  ```

  It reads the footer, skips the partitions the `WHERE` cannot match, and reads
  only the named columns — which is the entire payoff of the layout above.

**Say this precisely, because it is a fair question to be caught on.** DuckDB is
a pinned dependency and the **documented query interface** to the warehouse
(`CONTRACTS.md` C1). It is how you inspect gold by hand. But the **runtime read
path is `pandas.read_parquet`** — `pipelines/gold.py::read_gold` concatenates the
parts with pandas, and no application module imports duckdb.

That is deliberate, and the honest version is the stronger answer:

> Everything above the data layer wants a **pandas DataFrame**, because
> statsforecast, LightGBM, Prophet and scipy all take one. Going through DuckDB
> only to call `.df()` adds a conversion for no gain at 1.1 MB. DuckDB is in the
> stack because it is the right tool the moment the warehouse stops fitting in
> memory — and at that point `read_gold` becomes a `duckdb.sql(...).df()`
> one-liner and **nothing above it moves**, because gold is a contract, not an
> implementation.

**Why not Spark.** Spark wins when data does not fit on one machine, and costs a
JVM, a cluster and 30–60 s of startup before the first row. We have 1.1 MB.
DuckDB saturates a laptop on data 10,000× larger than ours. Spark here would be
**slower** — the classic big-data-tool-on-small-data mistake.

### SQLite for the shelf

The stock ledger is SQLite, not Parquet, and the split is the clearest example
in the project of picking storage for the workload:

| | History (gold, features, forecasts) | The shelf (`ops.db`) |
|---|---|---|
| Pattern | write once nightly, read whole | many small appends, running balance |
| Question | "aggregate three years of a column" | "what is the balance right now" |
| Writers | one, offline | interleaved HTTP requests |
| **Storage** | **Parquet** | **SQLite** |

The ledger is **event-sourced** — it stores events, not a level:

```
opening + received − sold − wastage ± adjustment = stock_on_hand
```

so the current stock is always derivable and auditable, and every order is
written to a hash-chained `order_log` that cannot be edited after the fact
without breaking the chain. Appending to Parquet would mean rewriting the whole
file; SQLite gives a real transactional `INSERT` in one file, with no server.

---

## 11.3 The libraries, and what each one beat

| Choice | What it does here | Why it, and not the alternative |
|---|---|---|
| **pandas / numpy** | the table and array layer | not really a choice — every modelling library speaks DataFrame. Pinned hard (`numpy 1.26.4`) because numpy 2.0 changed the ABI and breaks compiled packages built against 1.x |
| **pyarrow** | the Parquet reader/writer | the reference implementation; `read_parquet` uses it underneath |
| **statsforecast** | ARIMA, MSTL, ETS, Theta, Croston, the naive family, behind **one** API | it is **Numba-compiled** — JIT to machine code. That is why 292 model-fold fits take **29.7 s** (~102 ms each) and the full backtest can run on every commit. A backtest you cannot run is a backtest nobody runs. One library also means one input format, one interval convention, one output shape — per-library integrations are where subtle mismatches live |
| **LightGBM** | the one global machine-learning member | leaf-wise tree growth and histogram binning make it fast; it handles `series_id` as a **native categorical** instead of one-hot; and it has a **built-in quantile objective**, which is the decisive one (§11.5) |
| **Prophet** | trend + season + holidays, decomposed | the only member that returns **each component in the units of the series** — that decomposition *is* the explainability screen. Choosing Prophet means the explanation comes from the model that made the forecast, not from an approximation bolted on afterwards |
| **scipy** | `norm.ppf`, quantile helpers | already required by the forecasting stack |
| **FastAPI + Pydantic v2** | the service | **the schema is the code** — one Pydantic model is validator, serialiser and OpenAPI schema at once, so `contracts/openapi.json` is generated from the running app and frontend and backend types cannot drift silently. Pydantic v2's core is compiled Rust, 5–20× v1. Django would be the wrong shape entirely: an ORM, an admin and migrations for a service with no relational model |
| **React + TypeScript** | eight stateful screens | TS earns its place *because* the contract is generated — a renamed field becomes a compile error instead of `undefined` on stage |
| **Vite** | dev server and bundler | native-ESM dev startup in under a second (it does not bundle in dev); builds to `web/dist`, which FastAPI serves — **one process serves the whole product**, which is what makes a free-tier deploy a single service |
| **Tailwind** | styling | made one consistent visual language cheap across eight screens under time pressure, and deleted the "which stylesheet owns this" question |
| **TanStack Query** | server state | caching, request de-duplication and background refetch. Without it the replay poller and the dashboard fetch independently and **disagree with each other on screen** — the classic two-panels-different-numbers demo failure |
| **Docker** | reproducible environment | three things here are genuinely painful to install by hand: Prophet/cmdstanpy, LightGBM's compiled wheel, and a matched numpy/pandas pair. Multi-stage: the Node stage builds the frontend, and **only `web/dist`** is copied into the Python stage, so the image carries no `node_modules` |

**Two library-level scars worth knowing.**

*Prophet does not install cleanly.* prophet 1.1.6 ships a **precompiled** model
binary, so nothing needs building — but cmdstanpy 1.3 refuses a cmdstan
directory that has no `makefile`, and the wheel does not include one. The symptom
is vicious: **the import succeeds** and the fit dies later with `'Prophet' object
has no attribute 'stan_backend'`. `_repair_cmdstan()` writes the placeholder at
import so a clean install just works. And the import is **guarded**: if Prophet
is missing, the ensemble runs on four members and `benchmarks.json` records which
members were actually present. We never silently ship a different ensemble than
the one on the slide.

*Charts are hand-written SVG, not a chart library.* `FanChart`,
`ReliabilityDiagram` and `SeasonalProfile` are raw `<path>` and `<rect>` with the
scales computed in the component — because our charts need a fan of seven nested
quantile bands with correct opacity stacking, hatched partial bars, and an anchor
that sits on the last *complete* bucket. Bending a library into that shape is
more code than drawing it.

> **Honest note, say it before someone finds it:** `recharts` is listed in
> `web/package.json` and **never imported**. Leftover from an early spike; it
> should be removed.

---

## 11.4 Everything we deliberately did NOT install

This list is as much a part of the design as `requirements.txt`. Each entry is
something a reviewer might expect to see.

| Not used | What it would have given | Why not |
|---|---|---|
| **Postgres / MySQL** | a relational store | wrong workload for analytics (§11.2), and a server to administer |
| **Redis** | a cache | the cache is an in-process LRU keyed on `model_version`. A network hop to cache an already-fast read is negative value at this size |
| **Airflow / Prefect / Dagster** | scheduling, retries, a DAG UI | the DAG is `run_nightly.py` — four stages, idempotent, re-runnable. A scheduler is a service, a database and a UI to make one command run daily. **And we are honest that there is no scheduler at all**: the nightly job is run by hand |
| **Spark / Dask** | distributed compute | 1.1 MB of data; framework overhead would exceed the work |
| **MLflow** | experiment tracking, a model registry | below the cut line in `requirements-optional.txt`. The registry we needed is ~40 lines: immutable version directories plus a `CURRENT` pointer — which gives atomic publication *and* instant rollback, the two things a registry is for |
| **SHAP** | model-agnostic attribution | also optional, also uninstalled. Prophet gives an **exact additive decomposition in units**; SHAP would *approximate* the same thing, more slowly. **There is no SHAP in this project — do not claim there is** |
| **Kafka** | streaming ingestion | there is no stream. The feed is a daily file |
| **Kubernetes** | orchestration at scale | one container |
| **A feature store** | online/offline parity | the feature table *is* a Parquet file built by one function with an explicit cutoff. Parity holds because there is only one path |
| **pandera** | declarative dataframe schemas | pinned, and it *was* the plan. The seven gates are explicit checks instead: same assertions, one fewer dependency, and the failure messages are readable on stage |
| **scipy inside `decision/`** | the inverse normal CDF | stdlib `statistics.NormalDist().inv_cdf` is exact and already there |

---

## 11.5 The models, one at a time

Every model below is scored in `artifacts/benchmarks.json`. **Five ship** in the
ensemble; the rest are a **bench** — they exist so the leaderboard is a real
field and the oracle bound means something.

### First: what we are scoring, and why MASE

```
              mean( |actual − forecast| )     over the test window
MASE  =  ──────────────────────────────────
              mean( |y_t − y_{t−1}| )         over the TRAINING window
```

The denominator is the error a **naive "next week equals this week"** forecast
would make on the training data. So **MASE = 1.0 means "no better than assuming
nothing changes"**, below 1.0 beats it, above 1.0 is worse than doing nothing —
which is a result worth being able to detect.

*Why not MAPE*, the metric everybody reaches for: it divides by the actual, so it
is **undefined on zeros** (one product sells nothing on 67.9% of days) and it
**punishes low-volume products for being low-volume** — on a category averaging
23 units a week, a five-unit miss reads as a 22% error even though five units is
an excellent forecast. *Why not RMSE*: it is in the units of the series, so a
40-unit error on paracetamol and a 2-unit error on sedatives cannot be averaged
into anything meaningful.

### The routing statistics, in plain words

```
ADI  = periods ÷ non-zero periods       how far apart the sales are
CV²  = (sd ÷ mean of the NON-ZERO sales)²   how wildly the sizes vary
```

ADI is an **interval, not a rate**: higher ADI means *longer gaps*. The
restriction of CV² to non-zero values is what makes the pair work — ADI separates
irregular **timing**, CV² separates erratic **size**. The cut-offs (1.32 / 0.49)
are Syntetos–Boylan's: the point where Croston's method stops beating exponential
smoothing in theoretical mean-squared error. They are not ours and not arbitrary.

**Say this plainly: at weekly grain on this file, all eight series come out
`smooth`.** The routing is not doing dramatic work *here*. It does real work at
**daily** grain — N05C is `intermittent` daily (ADI 3.12, one selling day in
three) and `smooth` weekly (ADI 1.13), because summing seven sparse days fills
the gaps. Classifying once on weekly data would send the *daily* forecast to the
wrong model family, which is why the class is recomputed **per grain**.

### 1 · SeasonalNaive — the control

```
forecast(t + h) = y(t + h − m)        m = 7 daily, 52 weekly, 12 monthly
```

Next Monday equals last Monday. That is the entire model — nothing fitted.

**Two jobs.** It is the **benchmark line** (MASE **1.1175**): the thing every
forecasting project must beat to have accomplished anything. And it is a
**stabiliser inside the median** — it structurally cannot extrapolate, diverge,
or go negative, because it returns a value that actually happened. When another
member misfits badly, having a member anchored to reality drags the median back.

**Where it is genuinely best:** N02BA (aspirin), 0.671. Nothing fancier helped.
**Its weakness:** it carries last year's noise forward as signal, and cannot
react to a level shift at all.

### 2 · AutoARIMA — short-run memory

```
        d          p                    q
(1 − B) y_t  =  Σ φ_i·y_{t−i}   +   Σ θ_j·ε_{t−j}  +  ε_t
```

* **AR(p)** — today is a weighted sum of the last *p* **values**. This is
  momentum and mean reversion: was this week high because next week will be too,
  or because it is about to snap back?
* **I(d)** — model the *change* rather than the level, which makes a drifting
  series stationary.
* **MA(q)** — today is affected by the last *q* **shocks**, not values. This is
  how a one-off event decays out of the forecast over a few periods instead of
  vanishing instantly or persisting forever.

**"Auto"** searches (p, d, q): a KPSS test picks `d`, then a stepwise search
minimises **AICc** = fit quality *minus a penalty for complexity*, which is what
stops it choosing a 10-parameter model that memorises the training data.

**Why it is in the portfolio:** it is the only member with a mechanism for
**short-run autocorrelation**. A decomposition model (Prophet, MSTL) models trend
plus season plus noise and by construction treats that noise as independent — it
has no way to use "last week was high."

**Its weakness, and what we did about it:** seasonal ARIMA at m=52 is
pathological — the order search explores lags 52 apart on ~300 observations and
**never terminated** (killed at 20 minutes; at daily grain, 139 s vs 7.3 s). So
it is fitted **non-seasonally at every grain**, and MSTL and Prophet carry
seasonality.

**Measured 1.1148 overall** — nearly the weakest shipping member. But on **M01AB
it is the best model in the entire bench (0.6047)**. That is precisely the case
for combining rather than selecting: a member that is mediocre on average can be
the best one somewhere, and you do not know where in advance.

### 3 · MSTL — seasonality without assuming a shape

Multiple Seasonal-Trend decomposition using **Loess**:

```
y_t = Trend + Season¹ + Season² + … + Remainder
```

**Loess** is *locally estimated smoothing*: to get the curve at point *t*, fit a
small polynomial to the points **near** *t*, weighting the near ones more, and
slide that window along. It is a smoother with **no global shape** — you never
say "the trend is a line" or "the season is a sine wave."

**Why that matters here.** Our eight products peak in different months *and with
different shapes* — R06's pollen peak is a sharp spring spike, N02BE's flu wave a
broad winter hump. A parametric seasonal term imposes one shape on all of them.

**"Multiple"** means it handles several cycles at once — at daily grain, the
**weekly** cycle and the **annual** cycle together. Both genuinely exist in
pharmacy demand and a single-seasonality model has to throw one away.

**And it is robust:** Loess iterations **down-weight outliers**. That pairs
deliberately with a decision two layers earlier — `clean.py` **flags outliers and
never alters `y`**, because the New Year stock-up and the January flu peak are
real events and removing them removes the behaviour the system exists to
anticipate. So we keep the spikes and use a model whose trend is not dragged by
them. **Measured 1.0144.**

### 4 · Prophet — a named calendar

```
y(t) = g(t) + s(t) + h(t) + noise
```

* **g(t), trend** — piecewise linear with **changepoints**: candidate dates where
  the slope may bend, with a prior of scale 0.05. A small prior means the trend
  must be *strongly* supported to bend, which is the main guard against fitting a
  wobbly trend and then extrapolating it.
* **s(t), seasonality** — a **Fourier series**,
  `Σ [a_n·cos(2πnt/P) + b_n·sin(2πnt/P)]`. We use 10 harmonics at daily/weekly
  and **4** at monthly, because with ~70 monthly points, 20 seasonal coefficients
  is more flexibility than the data supports. **The number of harmonics is the
  smoothness dial.**
* **h(t), holidays** — each named holiday gets its **own fitted coefficient**,
  with an **asymmetric window** (`−2, +1` daily): people stock up in the two days
  *before* a closure and demand is suppressed the day *after*. A plain dummy
  variable cannot express that shape.

**Best single model here, 0.935**, because our series are exactly its target
structure: strong annual cycle, modest trend, real calendar effects.

**Its weaknesses:** it is curve-fitting, not a stochastic process — no short-run
autocorrelation (hence ARIMA beside it); its trend **can extrapolate badly** past
the last changepoint, which is exactly what a median protects against; and it is
the slow one (4.32 s against LightGBM's 1.10 s).

**A real bug it produced, and the fix:** at **monthly** grain we drop holidays
entirely, because every holiday falls in the same month every year — its effect
is **collinear** with the annual seasonal term. Fitting ~14 holiday coefficients
on ~70 monthly observations made the model attribute season to the calendar. It
showed up on screen as a **+34-unit holiday effect on a 104-unit baseline** —
visibly absurd, and the reason we *look at* the explanation panel rather than
trusting it.

### 5 · LightGBM — the only member that sees all eight products

**What boosting is:** fit a small tree, look at what it got wrong, fit the next
tree to **that error**, add them up. 300 rounds of that.

**Why the quantile objective is the whole point.** Most regressors minimise
squared error and therefore estimate the **mean**. We do not want a mean — we
want the distribution, because the decision layer reads a *specific quantile* off
it. LightGBM trains under the **pinball loss**:

```
L_q =      q  · (actual − predicted)     when we under-predicted
      (1 − q) · (predicted − actual)     when we over-predicted
```

In words: **over- and under-shooting are charged different prices, and the price
ratio is `q`.** At `q = 0.9`, being under costs 9× being over, so the fitted
value settles where 90% of the mass is below it — the definition of the 90th
percentile. Minimising this loss **is** estimating that quantile, straight from
the data, with **no assumption that errors are Gaussian**. Which matters, because
demand is a non-negative count with a fat right tail.

We fit **one model per quantile level**, each **global** across all eight
products.

**Why "global" is an architecture decision, not a preference.** Every other
member fits one model per series — `O(number of products)`, which dies at scale.
One global model with `series_id` as a feature is `O(1)` in models. It is also
the **only** member that can see structure *shared across products*: a winter
illness period lifts several drug groups together, and a per-series model is
structurally incapable of noticing, because it never sees the other series.
Measured cost: **1.10 s**, the cheapest thing in the portfolio, at **0.961** —
second-best single model.

**What it is fed, and the two features that deserve a note:**

*Fourier terms* — a tree can split on `month = 5`, but it needs a separate split
for every month to express an annual cycle and will over-fit whichever months
were extreme in training. Fourier terms give the cycle as two smooth continuous
columns per harmonic, so the model can say "the annual wave is near its top." And
because the peak lands in a different month per drug group, the basis must have
**arbitrary phase** — which a sine/cosine pair has and a month index does not.

*Rolling statistics are computed on `shift(1)`* — every window excludes today. A
rolling mean that includes the current period is a feature containing the answer.

**What is banned outright:**

```python
banned = {"price", "promotion"}
```

There is **no price or promotion column in this dataset**. If we generated one, a
fitted coefficient on it would describe noise — and the explainability screen
would then present that noise to a buyer as a *commercial driver*.

**Its real weakness:** a tree **cannot extrapolate**. Its output is always an
average of training values in some leaf, so it can never exceed anything it has
seen. If demand doubles permanently, it lags until the new level is inside its
lags and rolling windows. Prophet's linear trend *can* extrapolate — one concrete
reason the two belong in the same ensemble.

### 6 · Croston and TSB — for series that are mostly zero

**The problem they exist for.** Average a series that is zero 68% of days and you
get "0.7 units per day." That is simultaneously the best possible average and
completely useless — you cannot order 0.7 units, and the series never once sold
0.7. Every averaging method converges to it.

**Croston models two things separately, and only updates when a sale happens:**

```
on each non-zero period:
    size     z ← α·y      + (1−α)·z          how big a sale is
    interval p ← α·gap    + (1−α)·p          how far apart sales are
forecast rate = z / p
```

Because zeros do not trigger an update, they cannot drag the size estimate down.
The output is "about 3 units, roughly every 4 days" — two statements a human can
act on. `CrostonOptimized` fits `α` instead of fixing it.

**TSB** fixes Croston's known defect: because Croston updates only on a sale, a
product that **stops selling** keeps its old forecast forever. TSB updates the
*probability of demand* every period instead, so a series going quiet is
reflected immediately — which matters for a discontinued line.

**Croston is biased high** (a ratio of two estimates); the Syntetos–Boylan
correction multiplies by `(1 − α/2)`. Know that — it is the standard follow-up
question when someone hears "Croston."

**Where it lands here, honestly:** it is routed to `intermittent` and `lumpy`,
and at weekly grain no series on this file is either — so it does **not** ship in
the weekly ensemble. It scores 1.0851 on the bench and is the best single model
on **N05C (0.7066)** and **R03 (1.0844)**, the two most irregular series. That is
the evidence the routing aims at something real.

### The bench — scored, not shipped

| Model | MASE | What it is |
|---|---|---|
| **Naive** | 1.3317 | `forecast = last value`. The floor. Best on M01AE (0.8899) — a useful reminder how noisy per-series "best model" claims are |
| **WindowAverage(8)** | 1.1655 | the mean of the last 8 periods — what a spreadsheet does. Best on N05B (0.5562) |
| **AutoETS** | 1.1244 | exponential smoothing with automatic Error/Trend/Season selection by AICc. ARIMA's sibling: ARIMA models *autocorrelation*, ETS models *weighted recency* — geometrically decaying weights on past values |
| **DynamicOptimizedTheta** | 1.1486 | the Theta method (M3 competition winner): decompose into lines of modified curvature, classically the average of a long-run regression and simple exponential smoothing |

> **A documentation error we corrected rather than hid:**
> `PHARMAPULSE_ARCHITECTURE.md` §5.2 lists **Theta** in the smooth route and
> quotes Prophet at 0.950. Both are wrong — Theta is **not** in the shipped
> ensemble, and Prophet measured **0.935**. That file was written before anything
> was benchmarked; it now carries a banner and is retitled *"as submitted, not as
> built."* **If a slide says Theta ships, the slide is out of date.**

---

## 11.6 How five models become one number

### The median, not the mean

```python
combined = subset.groupby(["series_id", "ds"])["value"].median()
```

The failure we are protecting against is **one member misfitting badly on one
period** — an extrapolating trend, a mis-detected changepoint. A **mean** carries
that error in proportion to its size: one member off by 300 units moves a
5-member mean by 60. A **median ignores it entirely.** The cost is a little
efficiency when everything is well-behaved. On demand data with occasional
pathological fits, that trade is obviously right.

For intervals we take the median **at each quantile level** and then **sort**.
That sort is not cosmetic: independent medians do not guarantee the levels stay
ordered, and **an unordered quantile set is not a distribution** — it would be
invalid input to the newsvendor.

### The experiment that justifies it

The obvious alternative is *pick the best model per product*. We built it and
measured it honestly — the choice for fold *k* uses only folds `1..k−1`, so it
never sees the answer it is scored on:

```
selection    0.9678     pick each series' best from previous folds
combination  0.9070     the median of five            ← SHIPS
oracle       0.8434     perfect hindsight — a BOUND, not a model
```

**Combination beats selection by 6.3%, and this is the most important result in
the project.** Why: with ~300 weekly observations and 4 folds, "best on the last
fold" is **mostly noise**, so selection chases noise and switches models for
reasons that do not persist. The oracle is what selection would get with *perfect
hindsight* — the gap 0.843 → 0.968 is the price of not knowing the future, and it
is large. Meanwhile independent models make **independent mistakes**, and the
median cancels them.

`bounded_weights()` exists and is **off by default**. The bound `[0.05, 0.40]` is
the point: unbounded weighting converges toward putting everything on one model,
which *is* selection — the strategy this ablation just ruled out.

### Then calibration, which is the part to be proudest of

**The problem.** The decision layer reads a **specific quantile** to size an
order. If the distribution is the wrong width, the quantity read at "95%"
corresponds to a different true probability, and the system silently orders the
wrong amount **while displaying a service level it is not achieving**. The error
is **directional and invisible** — it never appears as a bad point forecast, and
it is worst on the products with the most uncertainty, which are exactly the
products where the decision matters most.

**Why conformal prediction.** It is **distribution-free** — it assumes nothing
about the shape of the errors and gives a finite-sample guarantee. Demand is a
non-negative count with an asymmetric right tail, so the Gaussian assumption
behind a model's default interval is simply not appropriate.

```python
standardised = |actual − point| / spread            on data the model did not see
empirical    = quantile(standardised, 0.80)         what the data says
assumed      = norm.ppf(0.90) = 1.2816              what the model assumed
scale        = clip(empirical / assumed, 0.25, 5.0)
```

Then every quantile is stretched or shrunk **about its own median**, and
monotonicity is re-enforced. Three deliberate details: residuals are **pooled
across series** (per-series calibration on ~32 points would overfit the
correction itself); the scale is **clamped**, so one bad series cannot destroy
every interval; and it uses **out-of-fold** residuals, because calibrating on
data the model was fitted on measures the fit, not the uncertainty.

**And it ran opposite to what we predicted.** We expected intervals too narrow.
Measured:

```
nominal    before    after
 0.50      0.6758   0.5312
 0.80      0.9219   0.8203     ← the target
 0.90      0.9648   0.9141
 0.95      0.9805   0.9375
scale 0.7179   ·   n = 256 points (8 series × 8 steps × 4 folds)
```

A stated 80% interval was covering **92.2%**. The correction is a **shrink**.

**Have this sentence ready, because the instinct in the room is that wide is
safe:**

> The decision layer reads a **high quantile** to size an order. If the interval
> is too wide, that quantile sits further out than the stated confidence
> justifies, so the order is **larger than the pharmacy's own cost ratio asks
> for**. Over-wide intervals do not buy safety — they buy **cash tied up in
> stock and expiry risk on medicines with a shelf life**, while displaying a
> service level that is not the one being delivered. Both directions are wrong;
> they are just wrong in different currencies.

**What we do not claim:** 256 points establishes the **direction** and rough
magnitude of miscalibration. It does **not** certify a per-series level, and
`n_points` ships beside the numbers for exactly that reason.

### The leaderboard, read in one breath

```
Oracle                0.8434   BOUND — perfect hindsight, cannot ship
Ensemble              0.9070   ← WHAT SHIPS
Prophet               0.9350   best single model
LightGBM              0.9610
MSTL                  1.0144
CrostonOptimized      1.0851
AutoARIMA             1.1148
SeasonalNaive         1.1175   ← THE BENCHMARK LINE
AutoETS               1.1244
DynamicOptimizedTheta 1.1486
WindowAverage         1.1655
Naive                 1.3317
```

The ensemble beats the seasonal naive by **18.8%**, beats the best single model
by 3%, and sits **7.6% from the oracle bound** — the most that *perfect* model
selection could ever have bought.

**Four things to say about the per-series table before you are asked:**

1. **"Best single model" means best of all 11 for that series — including models
   we do not ship.** The column supports the selection ablation. The Evidence
   screen header now says exactly that, with the five shipped members named
   underneath, because a reader seeing `WindowAverage` there will reasonably
   assume we ship it.
2. **The ensemble beats the seasonal naive on all eight series** — not on
   average, on every one.
3. **R03 (1.14) and R06 (1.65) are above 1.0**, meaning worse than a *one-step*
   naive. They are the most irregular series in the file and they ship on screen
   in amber. The honest reading: the ensemble still beats the *seasonal* naive on
   both (1.29 → 1.14, 1.88 → 1.65) — they are simply hard, and the right response
   is a wider interval, which is exactly what the decision layer consumes.
4. **M01AE ties naive at exactly 1.0000.** Earlier code counted a tie as a loss.
   A tie is a tie, and the UI says so.

---

## 11.7 From a distribution to a purchase order, worked through

`decision/newsvendor.py` is a pure function — no I/O, no database, no imports
from `core/` or `api/`. It is the file a judge is most likely to ask to see.

**Step 1 — how long must this order survive?**

```
protection interval = lead time + review period = 4 + 7 = 11 days
```

Not the lead time alone, which is the intuitive answer and was in the code first.
In a **periodic-review** system, once you place today's order you cannot place
another until the next review — so today's order must last until the order
**after next** arrives. This was a real bug; the replay surfaced it as persistent
stockouts under *both* policies, and fixing it took simulated shortfall from
**2,207 units to 121**.

**Step 2 — what do the two mistakes cost?**

```
Cu = unit gross margin                                       being 1 SHORT
Co = unit_cost × holding_rate × (lead_time / 365)
     + unit_cost × expiry_rate                               being 1 OVER
```

`Cu` is profit you did not make. `Co` has two parts, and the second is the
pharmacy-specific one: **holding** is capital and shelf space; **expiry** is the
fraction of overstock written off unsold. Medicines have a shelf life, and a
model that omits the expiry term will over-order every slow-moving line.

**Step 3 — the critical fractile.**

```
q* = Cu / (Cu + Co)
```

The derivation in one line: order one more unit if the expected gain from
covering demand beats the expected cost of not needing it — `Cu·P(demand > Q) ≥
Co·P(demand ≤ Q)`. Set them equal and `P(demand ≤ Q*) = Cu/(Cu + Co)`.

In words: **if being short costs three times as much as being over, q\* = 0.75 —
order the amount you would exceed only 25% of the time.** That question is
*unanswerable* from a point forecast and answerable in one line from a
distribution. It is the entire reason the forecast is a range.

**With the shipped defaults, worked out:**

```
unit_margin 4.00 · unit_cost 12.50 · holding 22%/yr · expiry 1.5% · lead 4 days

Cu = 4.00
Co = 12.50 × 0.22 × (4/365)  +  12.50 × 0.015
   = 0.0301                  +  0.1875          =  0.2176
q* = 4.00 / 4.2176 = 0.948
```

Two things worth noticing in that arithmetic: `q*` lands near 0.95 **because of
the economics**, not because somebody typed 0.95 — and **expiry is 86% of the
overage cost**, six times larger than holding. On a short-lead-time, decent-margin
medicine, the thing that punishes over-ordering is the expiry date, not the
warehouse.

**Step 4 — read the quantile, subtract stock, round to packs.**

```
target = quantile(protection_interval_demand, q*)
units  = max(0, target − stock_on_hand)
order  = round_to_pack(units)
```

**Rounding is asymmetric**, and it is a small function carrying a real decision:

```python
return int(math.ceil(packs) if cu >= co else math.floor(packs))
```

Rounding to the *nearest* pack is wrong, because the two rounding errors do not
cost the same. With `Cu > Co`, being one pack short costs more than being one
pack long, so the correct direction is **up** — chosen by the cost ratio, not
assumed.

**The quantile grid is anchored at (0, 0):** interpolating below the lowest
stored level runs to zero rather than clamping there, because demand genuinely is
a non-negative quantity whose quantile function approaches zero. Clamping instead
would mean a product whose shortage is nearly free still gets ordered up to the
1st percentile — a floor with no economic justification.

**The cost curve, and why the slider feels instant.** For each of 16 service
levels we compute the quantity and the expected cost:

```
E[cost] = Σ wᵢ · [ max(dᵢ − position, 0)·Cu  +  max(position − dᵢ, 0)·Co ]
```

over the stored quantile grid, with `wᵢ` the probability mass around each point.
All 16 ship **with the response**, so dragging the slider interpolates in the
browser and never touches the network. Closed form, no solver, no request.

**Status, in evaluation order** — and the second rule is why a slow mover can
show 23 days of cover and still say *order now*: cover is measured against an
**average day**, the reorder point against the **quantile of the protection
interval**.

```
cover > 30 days                    → overstocked
stock < reorder point              → order now
cover < lead time + review period  → watch
otherwise                          → ok
```

**Risks are ranked by money, not probability.** A 30% chance on your
highest-volume product costs more than a 90% chance on something that sells twice
a month.

---

## 11.8 The ERP question — "the pharmacy already has software for this"

This is the question the project is graded on, and we have a **measured** answer,
including where the answer is "no."

### What commercial inventory software actually does

SAP MM, Oracle, Tally, Marg, or any pharmacy POS with a reorder module almost
universally implements an **(s, S) policy with safety stock**. It does not
forecast in the sense we mean. From recent sales it computes:

```
mu    = mean daily demand over a trailing window
sigma = standard deviation over that window

reorder point  s = mu·L  +  z · sigma · √L
order up to    S = s (+ a review-period term)
```

Three parts: `mu·L` is expected demand over the interval; `z·sigma·√L` is the
**safety stock**, with `z` the normal quantile for a chosen service level
(`z = 1.645` at 95%); and `√L` — **not** `L` — because independent periods add in
**variance**, so `sd = sigma·√L`. That last one is the most common error in the
textbook version, and we implement it **correctly for the baseline**, so the
baseline is not a strawman.

**What is genuinely good about it:** closed form, no model, robust, forty years
in production, and it **carries safety stock** — so it is not naive. Anyone who
works in inventory will discount a comparison against plain min/max instantly,
which is why min/max is not our headline.

**What it structurally cannot do:**

1. **It has no forecast.** `mu` and `sigma` come from a trailing window, so it is
   always looking backwards. It cannot anticipate a seasonal turn — only react
   after the turn is already inside the window.
2. **`z` is a guess** — a policy setting, typically one number for everything,
   unrelated to the individual product's margin, cost or expiry risk. Our `q*` is
   **derived** from exactly those.
3. **It assumes demand is normal.** `mu + zσ` *is* a normal quantile. Demand is a
   skewed non-negative count, so the approximation is systematically wrong **at
   the tail** — which is precisely where the ordering decision is made.
4. **It cannot explain itself.** No decomposition, no attribution, no interval,
   no measured coverage.

### So we compare against four rungs, not one

| Policy | Sizes at | Gets our forecast? | What it isolates |
|---|---|---|---|
| `minmax` | `mean × (L + R)` | no | the "no system at all" floor |
| `safety_stock` | `mu·L + z·σ·√L` from its own trailing stats | no | **what an ERP does** |
| `normal_approx` | `median + z·σ` from **our** distribution | **yes** | normal approximation vs empirical quantile |
| `pharmapulse` | empirical quantile at `q*` | yes | — |

**`normal_approx` is the rung that carries the claim.** It gets our forecast, our
protection interval and our service level, and differs in **exactly one thing**:
it sizes with `mu + zσ` instead of reading the empirical quantile off the
calibrated distribution. Forecast quality is held constant, so whatever separates
it from us is attributable to the **distribution** and nothing else.

> If we only beat min/max, the win is the forecast, and any team with a decent
> model gets it. If we also beat `normal_approx`, the win is the thing this
> project is actually about.

Its `sigma` is **recovered from the interval** rather than assumed: for a normal,
`p90 − p50 = 1.2816σ`. Inverting that is what a practitioner does with a
published interval, and it does not require the distribution to really *be*
normal to be computed — which is the point, because ours is not. And every
baseline gets **our** service level, not an arbitrary 95%: handing them a
different target would make the comparison about the target instead of the
method.

### The honest result

Positive means PharmaPulse is cheaper. Cost = lost margin + holding.

```
                   Jan–Mar 19    Apr–Jun 19    Oct–Dec 18
minmax                  +6.0%        +48.8%        +61.1%
safety_stock            −2.9%        +23.1%         −1.8%
normal_approx          +17.9%         +8.1%         +0.4%
```

1. **We beat the normal approximation in every window.** That is the claim, and
   it is what the tests gate on.
2. **We are level with a real ERP policy** — one clear win, two losses of a
   couple of percent. On screen, in amber, not omitted.
3. **We beat "no system at all" comfortably**, which is the least interesting of
   the three.

### ★ Why the ERP wins where it wins — the actual mechanism

Be ready for this, and answer it specifically rather than defensively.

**Because in a trailing-window experiment nobody can see the seasonal turn — and
a policy that simply holds more survives the turn by accident.**

Every policy sizes off the last 180 days. On 1 January, the last 180 days are
**autumn**; paracetamol's January peak has not happened yet and is in nobody's
window. When demand jumps:

* **We** ordered the `q*` quantile of *autumn* demand. Correct given the
  information — and short.
* **The ERP policy** ordered `mu·L + z·σ·√L` of autumn demand, and because it
  adds a buffer proportional to `σ√L` over an 11-day interval on a volatile
  series, it is simply **holding more**. That buffer absorbs the turn.

It was not anticipation. It was carrying more stock, and in a window where demand
rises, carrying more stock is cheaper. Worth ~2% in the two rising windows.

**Now look at what the same behaviour costs it in Apr–Jun 19, a falling window:
it loses by 23.1%** — the buffer is now money sitting on a shelf with an expiry
date. **The ERP is not better; it is differently biased**, and its bias happens
to pay in two of the three windows.

### The limit of this experiment, stated

**The replay does not exercise the forecast layer at all.** Every policy,
including ours, sizes off a trailing window. Anticipating a seasonal turn is
*exactly* what the forecast layer is for, and this experiment structurally cannot
show it — that needs a forecast produced **at each review point** rather than one
vintage. `--as-of` (§10.1) makes it buildable, and it is the single most valuable
next experiment.

### So — are we better, or the same?

The defensible three-part answer:

* **On the distribution, measurably better.** +17.9% / +8.1% / +0.4% against the
  normal approximation with forecast quality held constant — three independent
  windows, same direction every time.
* **On total cost against a real ERP policy in this experiment, level.** One win,
  two small losses. We say so.
* **On everything cost does not capture, structurally ahead** — and this is where
  the argument actually lives:
  * `z` comes from **this pharmacy's own margin, holding cost and expiry rate**,
    per product, instead of a consultant's single default.
  * The interval is **calibrated against outcomes** — 92.2% → 82.0% at nominal
    80% — where an ERP's normal assumption is never checked at all.
  * Every number **explains itself**: demand class, seasonal profile, Prophet
    decomposition in units, provenance lane, and the cost curve the quantity came
    from.
  * The comparison itself is **reproducible**: real days, real sales, four
    policies, the ladder shipped in full including where we lose.

And the closing line, which is stronger than an inflated number:

> A tuned ERP policy is a good baseline, and on total cost over these windows we
> are level with it. What we add is that our service level is **derived from the
> pharmacy's economics rather than guessed**, our interval is **verified against
> outcomes rather than assumed normal**, and every order can be **explained**.
> The forecast layer's real advantage — anticipating a seasonal turn before it
> enters a trailing window — is not measured by this experiment, and we are not
> claiming it until it is.

---

## 11.9 Thirty questions a panel can ask

Short answers. Every one is defended above.

**The data**

1. *Why only 8 products?* That is what the dataset has — 8 ATC-2 drug groups,
   2,106 days, 2014–2019. We did not sample it down.
2. *Why ignore the supplied weekly and monthly files?* `salesmonthly.csv` is
   corrupt — January 2017 reads ~zero against ~2,700 real units in the daily
   file. We derive both grains by resampling the daily rows, so they agree **by
   construction**, and `assert_reconciles` fails the build if they ever do not.
3. *What do you do with outliers?* Flag, never alter. The New Year stock-up and
   the January 2019 flu peak are real events; removing them removes the behaviour
   the system exists to anticipate.
4. *And closures?* Masked, not imputed and not deleted. Imputation invents demand
   that did not happen; deletion leaves a gap a seasonal model reads as missing
   data. Marking the state says the true thing: demand is **unobserved**, not
   zero.
5. *How do I know the screen matches the file you claim?* Every row carries a
   **SHA-256 `snapshot_id`**, and so does the forecast store. Change the file and
   every claim tied to it visibly becomes a claim about different data.

**The models**

6. *Why five models instead of the best one?* Measured: selection 0.968,
   combination 0.907, oracle 0.843. Combination wins by 6.3%.
7. *Why the median and not a weighted mean?* One member misfitting moves a mean
   in proportion to the error and does not move a median at all. Weights exist
   and are bounded `[0.05, 0.40]` precisely so weighting cannot collapse into
   selection.
8. *Is Theta in your ensemble?* **No.** An architecture document says so and is
   wrong; it carries a correction banner. The five are Prophet, AutoARIMA, MSTL,
   SeasonalNaive, LightGBM.
9. *Do you use SHAP?* **No.** Prophet gives an exact additive decomposition in
   units; SHAP would approximate the same thing more slowly. It is optional and
   not installed.
10. *Why is ARIMA non-seasonal?* Seasonal ARIMA at m=52 never terminated on ~300
    observations. MSTL and Prophet carry seasonality; ARIMA contributes short-run
    autocorrelation, which a decomposition model has no mechanism for.
11. *Why is a "naive" model in a shipping ensemble?* It is the benchmark line
    (1.1175) and a stabiliser that cannot extrapolate, diverge or go negative. On
    N02BA it is the best model available.
12. *R06 is 1.65 — worse than doing nothing?* Worse than a **one-step** naive,
    yes, and we ship that on screen. It still beats the **seasonal** naive
    (1.88 → 1.65). It is the hardest series in the file; the right response is a
    wider interval, which the decision layer consumes.
13. *How do you avoid look-ahead leakage?* Features truncate to an explicit
    cutoff as their **first operation**, and a test asserts a feature at *t* is
    identical whether or not rows after *t* exist. `as_of` truncates gold before
    the demand class is even computed — a zero rate that includes future days is
    future information.
14. *Why MASE?* MAPE is undefined on zeros and punishes low-volume series; RMSE
    is unit-dependent and optimises the mean. MASE is scale-free and
    interpretable: 1.0 means "no better than assuming nothing changes."
15. *Why not an LSTM / N-BEATS / a transformer?* 300 weekly observations per
    series, 8 series. Those need orders of magnitude more data to beat a
    well-specified statistical portfolio, cost far more to fit, and cannot
    produce the additive decomposition the explainability screen is built on. And
    the ensemble is already **7.6% from the oracle bound** — there is very little
    headroom left to buy.

**The intervals**

16. *Conformal prediction in one line?* A distribution-free way to make the
    stated confidence the achieved one, by measuring the empirical quantile of
    standardised residuals on data the model did not see.
17. *You said 80% and got 92% — isn't wide the safe direction?* No — see the
    boxed sentence in §11.6. Over-wide buys cash tied up in stock and expiry
    risk, while displaying a service level it is not delivering.
18. *Why clamp the scale to [0.25, 5.0]?* So one badly behaved series cannot
    destroy every interval in the system.
19. *256 points is small.* Agreed, and it says so on screen. Enough to establish
    the direction and rough magnitude; not enough to certify a per-series level.

**The decision**

20. *Where does the service level come from?* `q* = Cu/(Cu + Co)` — the
    pharmacy's own margin against holding plus expiry. With the shipped settings
    that is 0.948, and **expiry is 86% of the overage cost**.
21. *Why 11 days and not 4?* Lead time plus review period: today's order must
    last until the order *after next* arrives. Fixing it took simulated shortfall
    from 2,207 units to 121.
22. *Why not `round()`?* The two rounding errors do not cost the same. With
    `Cu ≥ Co`, round up — the direction is chosen by the cost ratio.
23. *Why does the slider not hit the network?* The 16-point cost curve ships with
    the response and the newsvendor is closed form. No solver runs in a request.
24. *Why rank risks by money and not probability?* A 30% chance on your
    highest-volume product costs more than a 90% chance on something that sells
    twice a month.

**The competition**

25. *Every pharmacy already has reordering software.* §11.8. Its service level is
    a guess, its normal assumption is never checked against outcomes, and it
    cannot explain a number. We beat its sizing method on the same forecast in
    all three windows; on total cost we are level, and we say so.
26. *Your headline was 69.5% — where did it go?* We found it was comparing
    forecast **vintages** rather than decision rules, and took it down (§10.2).
27. *Where do you lose?* `safety_stock` beats us by 2.9% and 1.8% in the two
    rising windows, because it happens to carry a bigger buffer. In the falling
    window the same buffer loses it 23.1%.
28. *Isn't min/max a strawman?* On its own, yes — which is why there are four
    rungs and the claim rests on `normal_approx`.

**The engineering**

29. *What happens if the model layer dies?* The degradation ladder: the API
    serves captured fixtures, sets `meta.degraded = "fixtures"`, and the
    interface shows a badge. **The app always runs; it just tells you what it is
    running on.**
30. *What is not finished?* No scheduler — the nightly job is run by hand; no
    warm start, so every run refits from scratch; `api/routers/datasets.py` has
    zero tests; jobs are in-memory and die with the process; no reset endpoint on
    a hosted instance; the root `Dockerfile` has not been built end to end; the
    replay does not yet exercise the forecast layer; and `recharts` is a declared
    dependency that is never imported.

---

> ### The system's output is not a forecast. It is a purchase quantity, a probability, and the reason behind both.
