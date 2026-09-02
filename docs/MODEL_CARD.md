# Model card — PharmaPulse demand ensemble

Generated alongside `artifacts/benchmarks.json`. Every figure here is reproducible with
`python scripts/day1_benchmark.py` from a clean clone.

---

## 1. Model details

| | |
|---|---|
| **Name** | PharmaPulse ensemble, `ens-v1` |
| **Type** | Median combination of five forecasters, with conformal interval calibration |
| **Members** | Prophet · AutoARIMA · MSTL · SeasonalNaive · LightGBM (global, quantile) |
| **Routing** | ADI / CV² (Syntetos–Boylan, cutoffs 1.32 / 0.49), recomputed per grain, nightly |
| **Output** | 21 quantiles per series, per horizon step, at day / week / month grain |
| **Training data** | `salesdaily.csv`, snapshot `sha256:49e4f1c5c3da` |
| **Owner** | Yash Doke |

**Why a combination rather than the best model:** measured. See §4.

---

## 2. Intended use

**In scope.** Suggesting a replenishment quantity for a single retail pharmacy, over eight ATC-2
drug groups, at a horizon of up to one quarter of the available history.

**Out of scope.**

- Clinical decisions of any kind. This forecasts a shelf, not a patient.
- Products with no history — the cold-start path is designed, not built.
- Batch-level expiry management. **This dataset has no batches**, so the feature is described as
  the next integration and is not shipped.
- Any claim about a store network. The design contemplates one; no synthetic network was built, and
  lane 3 could not back an accuracy claim anyway.

**The system recommends; a person commits.** Every order is accepted or overridden by a human, and
an override requires a reason, recorded in a hash-chained log.

---

## 3. Data

| | |
|---|---|
| Source | Kaggle *Pharma Sales Data* (milanzdravkovic); point-of-sale records, one pharmacy |
| Period | 2 January 2014 → 8 October 2019 |
| Volume | 2,106 daily rows → 302 weekly, 70 monthly buckets, 8 series |
| Personal data | **none.** Aggregated counts by drug group. No patient, prescriber or transaction id |

**Excluded by design:** the supplied `salesmonthly.csv` (53 series-months disagree with a daily
rollup by more than 5%) and `saleshourly.csv`. Weekly and monthly grains are derived from the daily
file, asserted by a reconciliation test.

**Held out of fitting:** 26 closure days (masked from the loss, not deleted) and every period with
`completeness < 1.0` (the truncated first and last buckets).

**Not in the data, and therefore never modelled as features:** stock levels, lead times, prices,
promotions, regions, distributors. `price` and `promotion` are excluded by name in code.

---

## 4. Evaluation

**Protocol.** Weekly grain, horizon 8, 4 non-overlapping rolling origins, MASE with an in-sample
naive (m=1) denominator, averaged over 8 series, seed 42. Runtime ~45 s on one CPU.

| Model | MASE |
|---|---|
| Naive | 1.332 |
| WindowAverage(8) | 1.165 |
| **SeasonalNaive** | **1.117** |
| AutoETS | 1.124 |
| DynamicOptimizedTheta | 1.149 |
| CrostonOptimized | 1.085 |
| AutoARIMA | 1.115 |
| MSTL | 1.014 |
| LightGBM | 0.961 |
| Prophet | 0.935 |
| **Ensemble (median of 5)** | **0.907** |
| *Oracle* | *0.843* |

### Per series — including where the margin is thin

| Series | SeasonalNaive | Ensemble | Best single | Ensemble wins |
|---|---|---|---|---|
| M01AB | 0.971 | 0.651 | AutoARIMA | yes |
| M01AE | 1.019 | 1.000 | Naive | yes, barely |
| N02BA | 0.671 | 0.618 | SeasonalNaive | yes |
| N02BE | 0.993 | 0.799 | Prophet | yes |
| N05B | 0.939 | 0.621 | WindowAverage | yes |
| N05C | 1.174 | 0.785 | CrostonOptimized | yes |
| R03 | 1.294 | 1.137 | CrostonOptimized | yes |
| **R06** | 1.880 | **1.646** | Prophet | yes, but **worst series** |

**R06 is above 1.0 and is our weakest result.** The May pollen peak is sharp and its timing moves
year to year. M01AE is effectively a tie with the naive forecast.

### Ablation — selection versus combination

| Strategy | MASE |
|---|---|
| Pick each series' best model from previous folds | 0.968 |
| Median combination | **0.907** |
| Perfect hindsight | 0.843 |

Selection is scored honestly: the choice for fold *k* uses only folds 1…*k*−1.

### Calibration

| | |
|---|---|
| Nominal interval | 80% |
| Achieved, raw model | **92.2%** |
| Achieved, after conformal correction | **82.0%** |
| Scale factor applied | 0.718 |
| Points behind the estimate | 256 (8 series × 8 steps × 4 folds) |

The intervals were too **wide**, not too narrow — which causes over-ordering and ties up capital.
256 points establishes a consistent *direction*; it does not certify a per-series coverage level.
Residuals are pooled across series, because per-series calibration on ~32 points would overfit.

### Decision quality

Both policies replayed over identical real days, identical costs, lead time, review cadence and
protection interval. The only difference is mean versus cost-derived quantile.

| Window | Min/max | PharmaPulse | Lower by |
|---|---|---|---|
| Min/max on the mean | +6.0% | +48.8% | +61.1% |
| (s, S) safety stock — what an ERP does | −2.9% | +23.1% | −1.8% |
| Our forecast, sized with a normal approximation | +17.9% | +8.1% | +0.4% |

Columns are Jan–Mar 2019, Apr–Jun 2019, Oct–Dec 2018; positive means PharmaPulse is cheaper.
Every policy sizes off the same trailing window of real sales, so the comparison isolates the
decision rule. The third row holds forecast quality constant and is therefore the only row that
attributes a difference to the calibrated distribution.

**We do not dominate.** Against an ERP-style safety-stock policy we win one window and lose two by
a couple of percent. **Known limitation:** because every policy sizes off a trailing window, none
can anticipate a seasonal turn — on 1 January the last 180 days are autumn. Exercising the forecast
layer here requires a forecast produced at each review point rather than one vintage.

---

## 5. Known limitations

**1 — We forecast sales, not demand.** *The deepest limitation, and it is inherent to the data.* A
stockout records zero sales, so observations are right-censored, worst on the products that stock
out most. Left uncorrected it is self-reinforcing. We flag suspicious ceilings; we cannot verify the
correction without an on-hand-stock column this dataset does not have. **First thing a real
deployment fixes.**

**2 — One pharmacy, eight categories, ~300 weekly observations.** Small. What makes it worth
building on is that the *failure modes* are not small: intermittency, censoring, level shifts,
closure days, multi-phase seasonality and calibration failure are all present here and all appear at
scale.

**3 — The country is inferred, not stated.** The Serbian Orthodox calendar was identified from the
closure pattern (21 of 26 fit). Strong, but an inference. External covariates that would need a
location to join on — weather, pollen — are therefore **not used**. Calendar features derived from
the series itself are safe, because a holiday's effect is observable regardless of which country
produced it.

**4 — The 2017 regime shift is real.** N02BE annual totals run 13,336 → 9,259 → 11,231. Long
training windows anchor forecasts to a level that no longer exists.

**5 — AutoARIMA is fitted non-seasonally at weekly grain.** Seasonal ARIMA at m=52 did not complete
in over 20 minutes on 300 observations. MSTL and Prophet carry the annual season; ARIMA contributes
short-run autocorrelation, which is why it is in the portfolio.

**6 — Prophet's holidays are dropped at monthly grain.** Every holiday falls in the same month every
year, so its coefficient is collinear with the annual seasonal term; fitting ~14 of them on 70
observations attributed large swings to the calendar that belong to the season.

**7 — Not built:** authentication, multi-tenant isolation, drift monitoring on live traffic,
cross-sectional reconciliation, the stress-test harness. Designed and documented; out of scope here.

---

## 6. Ethical and safety considerations

The dataset contains **no personal data** — aggregated counts by drug group only. We say that
plainly rather than implying a privacy problem we do not have.

A real deployment ingesting patient-linked dispensing records would need the access controls,
tenant isolation and audit trail described in the architecture document. The hash-chained order log
is built; the rest is not.

**The system must not be read as clinical guidance.** It sizes a purchase order. Under-ordering a
medicine has patient consequences that no cost model captures, which is a reason to keep a human in
the loop and to prefer the conservative side of the cost ratio — not a reason to trust the number
more.

---

## 7. Reproducing this card

```bash
python scripts/check_data.py          # confirms snapshot sha256:49e4f1c5c3da
python -m pipelines.run_nightly --stage all
python scripts/day1_benchmark.py      # writes artifacts/benchmarks.json
pytest -q                             # 135 tests
```

Every number above comes from `artifacts/benchmarks.json` or from
`decision/replay.py::compare_policies`. None is typed by hand.
