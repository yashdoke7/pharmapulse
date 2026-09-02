# POD B — Forecast Engine · RESULTS

> What was built, what it measured, what broke, and where the code is.
> Original brief: `../02_POD_B_FORECAST_ENGINE.md`

**Owns:** `core/` · `artifacts/` · `scripts/day1_benchmark.py`
**Delivers:** contract **C2** (forecast store) and **C4** (`benchmarks.json`).
**Owns every reported number.**

---

## 1. Scorecard

| Deliverable | Status | Result |
|---|---|---|
| Benchmark harness reproducing every figure | **done** | 43 s from a clean clone |
| ADI/CV² router | **done** | matches the doc's quadrant table exactly |
| 5-member portfolio | **done** | Prophet, ARIMA, MSTL, SNaive, LightGBM |
| Median combination | **done** | MASE **0.907** |
| Conformal calibration | **done** | 92.2% → **82.0%** at nominal 80% |
| Forecast store, pointer swap | **done** | 7,056 rows, 3 grains |
| Attribution in units | **done** | components sum to total, asserted |
| Temporal MinT reconciliation | **not built** | below the cut line, stated |

---

## 2. ★ The headline: the docs reproduce

The architecture document's numbers were **not backed by anything in the repository** — the script
that produced them did not exist. Rebuilding `scripts/day1_benchmark.py` was the first task, and the
result is close to an exact reproduction:

| Model | Doc | **Measured** | Δ |
|---|---|---|---|
| Naive | 1.330 | **1.332** | +0.002 |
| WindowAverage(8) | 1.164 | **1.165** | +0.001 |
| SeasonalNaive | 1.118 | **1.117** | −0.001 |
| CrostonOptimized | 1.089 | **1.085** | −0.004 |
| MSTL | 1.011 | **1.014** | +0.003 |
| LightGBM | 0.973 | **0.961** | −0.012 |
| Prophet | 0.950 | **0.935** | −0.015 |
| **Ensemble** | **0.906** | **0.907** | **+0.001** |
| Oracle | 0.883 | 0.843 | −0.040 |

Protocol: weekly · h=8 · 4 non-overlapping rolling origins · MASE(m=1) · 8 series · seed 42.

**Three honest deviations, all of which change the deck:**

| # | Doc said | We measure | Why |
|---|---|---|---|
| 1 | selection 1.091 | **0.968** | Combination still wins (0.907), smaller margin. Quote 0.968. |
| 2 | coverage 0.750, too narrow | **0.922, too WIDE** | Opposite direction. Business story flips. |
| 3 | AutoARIMA 1.039 | **1.115** | Now fitted non-seasonally — see §4.1 |

---

## 3. The routing

**ADI/CV² computed per series, per grain, nightly.** A rule, not configuration.

```python
# core/classify.py
ADI_CUTOFF, CV2_CUTOFF = 1.32, 0.49        # Syntetos-Boylan

def adi_cv2(y):
    nonzero = y[y > 0]
    adi = len(y) / len(nonzero)
    cv2 = (nonzero.std(ddof=1) / nonzero.mean()) ** 2
    return adi, cv2, 1 - len(nonzero) / len(y)
```

**Measured at daily grain — lands exactly on the architecture document's table:**

| Series | ADI | CV² | Zero-rate | Class |
|---|---|---|---|---|
| M01AB | 1.019 | 0.271 | 1.9% | smooth |
| M01AE | 1.017 | 0.278 | 1.7% | smooth |
| N02BA | 1.038 | 0.326 | 3.7% | smooth |
| N02BE | 1.012 | 0.256 | 1.2% | smooth |
| N05B | 1.021 | 0.372 | 2.0% | smooth |
| **N05C** | **3.115** | 0.410 | **67.9%** | **intermittent** |
| **R03** | 1.298 | **0.818** | 23.0% | **erratic** |
| R06 | 1.138 | 0.488 | 12.2% | smooth |

Doc predicted ADI 3.12 for N05C and CV² 0.82 for R03. **Measured 3.115 and 0.818.**

### ★ Bug found by a test: demand class depends on the GRAIN

A test asserting "N05C is intermittent" **failed at weekly grain** — because aggregation removes
sparsity. N05C is intermittent daily and **smooth** weekly.

```python
def test_demand_class_depends_on_the_grain(gold_day, gold_week):
    """MEASURED: routing MUST be recomputed per grain - classifying once on
    weekly data would send the daily forecast to the wrong model family."""
    assert classify(gold_day).set_index("series_id").loc["N05C", "demand_class"] == INTERMITTENT
    assert classify(gold_week).set_index("series_id").loc["N05C", "demand_class"] == SMOOTH
```

**Fix** — `core/pipeline.py::forecast_grain()` now classifies its own grain:

```python
    classes = classify(gold)          # THIS grain, not weekly
    classes["grain"] = grain
    route = dict(zip(classes["series_id"], classes["demand_class"], strict=True))
```

**Impact:** the daily forecast for N05C now routes to Croston/TSB, which is the entire reason the
router exists.

---

## 4. The portfolio: what each member is for

| Member | Contributes what nothing else does |
|---|---|
| Prophet | Named holiday regressors + an additive decomposition **in units** — the explainability screen |
| AutoARIMA | Short-run autocorrelation; a decomposition model has no mechanism for it |
| MSTL | Two seasonal cycles at once, Loess down-weighting the outliers we kept |
| SeasonalNaive | The control, and a stabiliser that cannot diverge |
| LightGBM | Structure **shared across products**; cost does not grow with product count |

### 4.1 ★ AutoARIMA non-seasonal — a fit that never terminated

`season_length=52` is the obvious choice on annual data. **It ran over 20 minutes on 300
observations without completing** and had to be killed.

```python
# core/portfolio/statistical.py
# Seasonal ARIMA at m=52 is pathological: the order search explores seasonal
# lags 52 apart on ~300 observations and takes minutes per series without
# improving accuracy. Weekly annual seasonality is better handled by MSTL and
# Prophet, which are in the portfolio for exactly that. So ARIMA is fitted
# NON-seasonally and contributes what only it can - short-run autocorrelation.
"AutoARIMA": AutoARIMA(season_length=1 if m > 24 else m),
```

**Per-model fit time after the change, one fold:**

| Model | Time | MASE (fold 1) |
|---|---|---|
| AutoARIMA | **1.2 s** | 1.316 |
| MSTL | 0.1 s | 1.105 |
| AutoETS | 3.3 s | 1.373 |
| DynamicOptimizedTheta | 27.9 s | 1.068 |

**Impact:** the full backtest is 43 s, which is what makes it affordable in CI on every push.

### 4.2 Prophet's install is self-healing

The 1.1.6 wheel ships a **precompiled** `prophet_model.bin` but no cmdstan `makefile`, which
`cmdstanpy.validate_cmdstan_path()` requires. The import succeeds and the *fit* dies with
`'Prophet' object has no attribute 'stan_backend'`.

```python
# core/portfolio/prophet_model.py
def _repair_cmdstan() -> None:
    """The wheel ships a PRECOMPILED prophet_model.bin, so nothing needs to be
    built - but cmdstanpy refuses a cmdstan directory with no `makefile`."""
    for cmdstan_dir in (pathlib.Path(_p.__file__).parent / "stan_model").glob("cmdstan-*"):
        makefile = cmdstan_dir / "makefile"
        if cmdstan_dir.is_dir() and not makefile.exists():
            makefile.write_text(note, encoding="utf-8")

try:
    _repair_cmdstan()
    from prophet import Prophet
    from prophet.models import CmdStanPyBackend
    CmdStanPyBackend()            # fail here rather than mid-backtest
    PROPHET_AVAILABLE = True
except Exception:
    Prophet, PROPHET_AVAILABLE = None, False
```

**Verified** by deleting the makefile and re-importing. Also confirmed on Ubuntu in CI.

### 4.3 Prophet holidays dropped at monthly grain

Attribution for R06 showed **+34 units on a 104-unit baseline** attributed to "holidays". Every
holiday falls in the same month every year, so its coefficient is collinear with the annual seasonal
term — ~14 coefficients on 70 observations is overfitting.

```python
    holidays = _holiday_frame(grain) if grain != "month" else None
```

| | Before | After |
|---|---|---|
| R06 seasonality | −59.8 | **−23.7** |
| R06 holiday | **+34.4** | — |
| R06 trend | +3.9 | +4.0 |
| Headline | "down 22 units" | "down 20 units" |

Weekly grain is unaffected, so **no benchmark number moves.**

---

## 5. ★ Combination beats selection — measured

Five different models win across the eight series, so per-series selection looks obviously right.

| Strategy | MASE |
|---|---|
| Pick each series' best from previous folds | **0.968** |
| **Median combination** | **0.907** |
| Perfect hindsight | 0.843 |

**Scored honestly** — the choice for fold *k* uses only folds 1…*k*−1:

```python
# core/backtest.py::selection_score
    for i, f in enumerate(folds):
        if i == 0:
            continue                      # no history to choose from yet
        history = allf[allf["fold"].isin(folds[:i])]
        best = (history.groupby(["series_id", "model"])["mase"].mean()
                .reset_index().sort_values("mase")
                .groupby("series_id").first()["model"])
```

**Median, not mean** — because one member blowing up on one period moves a mean and does not move a
median:

```python
def test_median_ignores_one_member_blowing_up():
    preds = _preds(Prophet=[100.0], AutoARIMA=[102.0], MSTL=[98.0],
                   SeasonalNaive=[101.0], LightGBM=[9000.0])
    assert combine_point(preds)["value"].iloc[0] == pytest.approx(101.0)
    assert preds["value"].mean() > 1000
```

**Then sort.** Taking medians independently at each level does not preserve ordering, and an
unordered quantile set is not a distribution:

```python
def enforce_monotonic(quantiles):
    df["value"] = df.groupby(["series_id", "ds"])["value"].cummax()
    return df["value"].clip(lower=0.0)
```

---

## 6. ★ Calibration — and the direction is opposite to what was predicted

| | |
|---|---|
| Nominal | 80% |
| Achieved, raw | **92.2%** |
| Achieved, corrected | **82.0%** |
| Scale | 0.718 |
| n | 256 |

The architecture doc predicted **over**-confidence at 75%, causing silent under-ordering. **Measured,
the intervals are too WIDE** — which causes over-ordering and capital tied up.

**The lesson is unchanged; the business story flips.** Both curves ship to the *Why* screen with
`n = 256` printed on the chart, because a confidence claim the user cannot verify is not a confidence
claim.

```python
# core/calibrate.py
def conformal_scale(calibration, level=0.80) -> float:
    resid = (calibration["y"] - calibration["point"]).abs()
    standardised = (resid / calibration["spread"].replace(0, np.nan)).dropna()
    empirical = float(np.quantile(standardised, level))
    assumed = float(norm.ppf(0.5 + level / 2.0))
    return float(np.clip(empirical / assumed, 0.25, 5.0))
```

**Pooled across series**, because per-series calibration on ~32 points would overfit. Reported with
its `n`, because 256 points establishes a consistent *direction* and does not certify a per-series
level.

---

## 7. The forecast store

**7,056 quantile rows** — 21 levels × 8 series × (28 daily + 8 weekly + 6 monthly horizons).
Built in **170 s**.

**Published by pointer swap**, so a partial run is never readable:

```python
# core/forecast_store.py::write_version
    # Last operation. Until this line runs, the new version is invisible.
    POINTER.write_text(slug, encoding="utf-8")
```

**The one function the decision engine needs**, and the subtlety inside it:

```python
def lead_time_demand(series_id, lead_time_days) -> dict[str, float]:
    """Daily quantiles are aggregated over the lead time by scaling the central
    estimate linearly and the spread by sqrt(n) - independent-ish daily errors
    partially cancel. Summing the quantiles directly would overstate the tail."""
    median = float(per_day.get(0.50, per_day.median()))
    for q, v in per_day.items():
        centre = median * n
        deviation = (float(v) - median) * np.sqrt(n)
        out[f"{float(q):.2f}"] = round(max(0.0, centre + deviation), 2)
```

**Why not just sum the daily quantiles?** The 95th percentile of a sum is not the sum of 95th
percentiles unless the days are perfectly correlated. Summing inflates the tail and would make the
system over-order at every service level.

---

## 8. Attribution in units

```
Paracetamol is up 311 units next month
   seasonality  +309.8   moving into the flu wave
   trend          +1.3   underlying level
   ─────────────────────
   total        +311.0
```

**Feature-importance charts explain the model. A buyer needs an explanation of the quantity**, so the
answer is in units — and the parts sum to the whole, forced and then asserted:

```python
def _reconcile(components, total):
    """Force the parts to sum to the whole, absorbing rounding into the largest.
    The adjustment is bounded and applied to the component best able to carry it."""
    drift = total - sum(c["units"] for c in components)
    biggest = max(components, key=lambda c: abs(c["units"]))
    biggest["units"] = round(biggest["units"] + drift, 2)
```

```python
# tests/contract/test_api.py
def test_explain_components_sum_to_the_total():
    total = sum(c["units"] for c in d["components"])
    assert total == pytest.approx(d["total_change_units"], abs=0.5)
```

**Falls back gracefully.** If Prophet is unavailable, `_seasonal_attribution()` answers the same
question with a seasonal index plus a linear trend, and `method` says so.

---

## 9. Tests owned — 20 in `test_core.py`

| Test | Protects |
|---|---|
| `test_n05c_routes_to_the_intermittent_family_at_daily_grain` | the router does its job |
| `test_demand_class_depends_on_the_grain` | **the per-grain bug** |
| `test_classification_is_a_rule_not_a_lookup` | nothing hardcoded to a series name |
| `test_median_ignores_one_member_blowing_up` | why median, not mean |
| `test_combined_quantiles_are_monotone` | the output is a valid distribution |
| `test_folds_never_see_their_own_test_window` | backtest integrity |
| `test_a_perfect_forecast_scores_zero` | MASE is wired correctly |
| `test_conformal_scale_widens_an_overconfident_interval` | calibration direction, both ways |
| `test_store_roundtrip` | pointer swap works |
| `test_lead_time_demand` | longer lead time is wider and higher |

---

## 10. Honest gaps

- **R06 is 1.646** — our worst series, above 1.0. The May pollen peak is sharp and its timing moves
  year to year; we have six observations of it. On the slide, in red.
- **M01AE is 1.000 against seasonal naive's 1.019** — effectively a tie.
- **256 calibration points.** Enough for a direction, not for a per-series level. Stated.
- **Temporal MinT reconciliation not built.** The three grains are served independently and no screen
  depends on their coherence. First thing we would add.
- **The stress-test harness not built.** Specified with a ten-scenario catalogue; reuses
  `backtest.py`; roughly half a day.

---

## 11. Second pass — the engine says where its numbers came from

The portfolio, the routing and the combination were correct and are unchanged.
What changed is that the engine now records *what it was fitted on*, can be
asked to run as of any past date, and no longer asserts a single thing it did
not compute.

### 11.1 The one claim in the engine that was typed, not measured

`core/explain.py` produced sentences like *"coming off the pollen season"*. The
**magnitude** was always real — Prophet's fitted `yearly` component, read
directly, in units. The **noun** was a lookup table:

```python
SEASON_HINTS = {"R06": "pollen season", "N02BE": "flu wave",
                "R03": "cold-air exacerbation", "N05C": "winter"}   # deleted
```

Two problems. It was the only thing any screen displayed that the code had not
derived, and it would have been **silently wrong on anyone else's data** — a
different pharmacy's R06 has no reason to peak in May.

Replaced by `seasonal_profile()`, which computes a month-by-month index from
observed rows only, and `_season_detail()`, which names the season from the
measured peak:

```python
def _season_detail(profile, season_delta) -> str:
    peak = max(profile, key=lambda m: m["index"])
    if peak["index"] < 1.08:
        return "a flat annual cycle"
    peak_name = MONTHS[peak["month"] - 1]
    return (f"moving towards its {peak_name} peak" if season_delta >= 0
            else f"coming off its {peak_name} peak")
```

Measured, on the real file:

```
R06    peak May       1.74x its own average    low Dec 0.47x
N02BE  peak January   1.49x                    low Jul 0.67x
R03    peak December  1.46x                    low Jul 0.54x
M01AB  peak August    1.10x                    low Feb 0.92x
```

The hardcoded labels were roughly right — which is exactly why this was
dangerous. It looked correct until the data changed. On the synthetic extension
R06's peak walks to March and the sentence follows it.

The profile also excludes incomplete trailing periods, so a part-month cannot
drag its own index down.

### 11.2 Running as of a past date

`forecast_grain` takes `as_of` and truncates gold before anything is computed:

```python
gold = fitting_frame(grain)
if as_of is not None:
    gold = gold[gold["ds"] <= pd.Timestamp(as_of)]
```

Placement is the whole point. Everything below that line — `classify`, the
route, the fits, the conformal scale — sees a frame that cannot contain the
future. Filtering a finished forecast instead would have leaked through the
demand class alone: N05C's ADI is computed from the zero rate, and a zero rate
that includes future days is future information.

The as-of date is recorded in the store metadata **and** in the version slug,
so two runs from the same file at different cutoffs are distinguishable
artefacts rather than a silent overwrite.

### 11.3 The store now records its own lineage

Three fields were added to the version metadata, and each fixes a specific way
the old store could mislead:

| Field | Fixes |
|---|---|
| `origin` | The API defaulted `meta.origin` to `"observed"` per route — a *hope*, stated as a fact. The store now records the lane it was fitted on and the API reads it back, so a synthetic run cannot serve under an observed badge. |
| `as_of` | Nothing distinguished a full-history store from a truncated one. |
| `snapshot_id`, corrected | It re-hashed the hardcoded input file, so a store built from any other file claimed the first file's lineage. It now reads the snapshot off the gold it actually fitted. |

`_origin_of_gold()` reports the **weakest** lane present, never the most common
one: a store that is 99% observed and 1% synthetic cannot back an accuracy
claim, and averaging the label away is precisely the failure the lanes exist to
prevent.

### 11.4 What the portfolio costs, measured

"Why five models?" is a fair question and the honest answer needs a price on it.
`scripts/day1_benchmark.py` now accumulates wall clock per model family and
writes a `compute` block:

```json
{ "by_family_seconds": { "statistical": 24.28, "Prophet": 4.32, "LightGBM": 1.10 },
  "total_fit_seconds": 29.69, "model_fits": 292, "seconds_per_fit": 0.1017 }
```

292 model-fold fits in 29.7 s — about 102 ms each. The statistical family
dominates because it fits **per series**; LightGBM is one global model across
all eight, which is why it is the cheapest thing in the portfolio and also why
it generalises across them.

The trade is worth making because per-series *selection* scored 0.968 against
combination's 0.907. Five models cost roughly five times one, and none of it
happens while anyone is waiting.

### 11.5 What is NOT cached, said out loud

Serving is cached: an in-process LRU keyed on `model_version`, so publishing a
new version self-invalidates. **The batch is not.** It refits everything from
scratch every run — no warm start, no incremental update, yesterday's work
discarded.

That is affordable at 8 products and it is the first thing that breaks at
8,000. It is now stated in amber on the Evidence screen rather than left to be
discovered. The original design had it (`Update Modes: test update minutes no
refit / full refit nightly`) and it was never built.

One cache bug found while building the dataset switcher: the LRU key is
`model_version`, so publishing a *new* version invalidates itself, but
**activating an OLD one brings a stale key back into scope with stale data
behind it**. `deps.clear_caches()` now runs on every pointer swap.

### 11.6 A documentation error worth recording

`docs/PHARMAPULSE_ARCHITECTURE.md` §5.2 lists the smooth route as
`Prophet · MSTL · AutoARIMA · Theta · global LightGBM`. **Theta is not in the
shipped ensemble.** It also quotes Prophet at 0.950 against a measured 0.935,
because it was written before anything was benchmarked.

Both are now flagged by a banner at the top of that file rather than silently
corrected, and the file is retitled *"as submitted, not as built"*. The shipped
five, from `core/combine.py`, are:

```
Prophet · AutoARIMA · MSTL · SeasonalNaive · LightGBM
```

This mattered in practice: the Evidence screen's per-series table has a
"Best model" column showing `Naive`, `WindowAverage` and `CrostonOptimized` —
none of which we ship. It means *the best single model out of all eleven for
that product*, which is the comparison behind the ablation, and the header said
none of that. It now reads "Best single model, of all 11" with a line
underneath naming the five we actually ship.

### 11.7 Honest gaps, updated

- **No warm start.** §11.5.
- **The conformal scale is still a single global factor**, and it is now
  recomputed on whatever dataset is live — including a synthetic one, where it
  is meaningless and must not be quoted.
- **`as_of` is not exercised by the replay.** The business case sizes every
  policy off trailing actuals rather than a forecast produced at each review
  point, so the forecast layer's seasonal foresight is not being measured
  there. That is the single most valuable next experiment.
