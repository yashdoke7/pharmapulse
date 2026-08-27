# `core/` — Forecast Engine

**Owner:** Pod B (B1 benchmark + statistical portfolio, B2 ML + distribution + explanation)
**Full brief:** `team/02_POD_B_FORECAST_ENGINE.md`
**Contracts produced:** C2 (`contracts/schemas/forecast.sql`), C4 (`artifacts/benchmarks.json`)

---

## Target

> Given clean history, produce a **probability distribution** of demand for each product at each
> future period — such that the stated probabilities are actually true, and the result can be
> explained in units a buyer understands.

Not a point forecast. The decision layer reads a *quantile*, so the width of the distribution is the
product, not a decoration on it.

## Inputs

| Path | Shape | From |
|---|---|---|
| `data/warehouse/gold/**` | contract C1 | Pod A |
| `data/warehouse/features/**` | lags, rolling, Fourier, calendar, event flags | Pod A |

Rows with `is_closed = true` are **masked out of the fitting loss**. Rows with `completeness < 1.0`
are **excluded from fitting**. Honouring those two flags is the most likely silent accuracy bug in
the project.

## Outputs

| Path | Shape | Consumed by |
|---|---|---|
| `data/warehouse/forecast/version=<slug>/` | **contract C2** — 21 quantiles × series × grain × horizon | Pod C |
| `data/warehouse/forecast/CURRENT` | pointer file, **written last** so a partial run is never readable | Pod C |
| `artifacts/benchmarks.json` | **contract C4** — leaderboard, per-series, ablations, calibration | Pod C, Pod D |
| `core/explain.attribute()` | attribution in units, summing to the total | Pod C |

## Files

| File | Owner | Responsibility |
|---|---|---|
| `backtest.py` | B1 | rolling-origin CV, 4 folds, h=8, MASE. **Build this before any model.** |
| `classify.py` | B1 | ADI / CV², Syntetos–Boylan boundaries (1.32, 0.49) → routing |
| `portfolio/statistical.py` | B1 | AutoARIMA, MSTL, SeasonalNaive, Croston/TSB, ETS, Theta (`statsforecast`) |
| `portfolio/prophet_model.py` | B1 | Prophet — **guarded import**, named holiday regressors, component decomposition |
| `portfolio/lgbm_global.py` | B2 | one global quantile model across all series (`mlforecast` + `lightgbm`) |
| `combine.py` | B2 | median across members at each level, then enforce monotonicity |
| `calibrate.py` | B2 | conformalised quantiles + the coverage curve the UI draws |
| `forecast_store.py` | B2 | **contract C2** read/write; `lead_time_demand()` is what Pod C needs |
| `explain.py` | B2 | attribution in units; Prophet components; optional SHAP |
| `reconcile.py` | B2 | temporal MinT (day/week/month). **Below the cut line.** |

## Why each portfolio member exists

Each represents a **different structural assumption about how demand is generated**, and the eight
products here do not share one.

- **Prophet** — the only member treating a holiday as a first-class object with its own fitted
  coefficient and an asymmetric window, and the only one exposing trend/season/holiday as separate
  additive quantities in the units of the series. That decomposition *is* the explainability screen.
- **AutoARIMA** — momentum and mean reversion. A decomposition model has no mechanism for it.
- **MSTL** — two overlapping seasonal cycles, non-parametric, with Loess down-weighting the outliers
  we deliberately retained.
- **SeasonalNaive** — the control ("the calendar alone") and a stabiliser that cannot diverge.
- **LightGBM global quantile** — the only member learning structure shared across products, taking
  new covariates as new columns, producing quantiles directly from pinball loss, and whose cost does
  not grow with product count.
- **Croston / TSB** — models sale size and gap separately; the only way to express "one unit every
  three days" for N05C. TSB rather than Croston because it decays when a product stops selling.

**We combine, we do not select.** Prior analysis measured per-series selection at 1.091 against
median combination at 0.906, oracle 0.883. With ~300 weekly observations, "best on the last fold" is
mostly noise.

## Run it

```bash
make benchmark       # -> artifacts/benchmarks.json + the printed leaderboard
make forecast        # gold -> fit -> combine -> calibrate -> forecast store
```

## Definition of done

- [ ] `make benchmark` reproduces identical values on two consecutive clean runs
- [ ] `artifacts/benchmarks.json` has **no `PLACEHOLDER` key**
- [ ] The store holds 21 calibrated quantiles for all 8 series at week grain, with a `CURRENT` pointer
- [ ] `lead_time_demand()` returns real numbers and Pod C consumes them
- [ ] Attribution components sum to the total within ±0.5, asserted by a test
- [ ] Model card written, including censored demand as a stated limitation
