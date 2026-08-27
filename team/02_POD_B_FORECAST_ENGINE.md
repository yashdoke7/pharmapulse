# POD B — Forecast Engine & Explainability

> Paste `team/00_PROJECT_BRIEF.md` first, then this file. Then read `CONTRACTS.md` sections C1, C2, C4.

**Two people. B1 and B2.**

| | Owns files | One-line job |
|---|---|---|
| **B1** | `scripts/day1_benchmark.py` `core/backtest.py` `core/classify.py` `core/portfolio/statistical.py` `core/portfolio/prophet_model.py` | **Owns every reported number.** The only person who may approve one. |
| **B2** | `core/portfolio/lgbm_global.py` `core/combine.py` `core/calibrate.py` `core/forecast_store.py` `core/explain.py` | The distribution, its honesty, and the explanation of it |

**Your mission:** *given clean history, produce a probability distribution of demand for each product
at each future period, such that the stated probabilities are actually true — and explain the result
in units a buyer understands.*

**You own:** `core/` `artifacts/` `scripts/day1_benchmark.py` `tests/unit/test_core*.py`
**You never edit:** `pipelines/` `decision/` `api/` `web/` `docs/`

---

## ⚠ Read this before anything else

**The accuracy numbers in `docs/PHARMAPULSE_ARCHITECTURE.md` are not reproduced in this repository.**
`day1_benchmark.py`, `artifacts/benchmarks.json` and the diagram source are referenced by those docs
but do not exist here — the analysis was run elsewhere. `artifacts/benchmarks.json` currently holds
those figures with a `PLACEHOLDER` key.

**Your single most important deliverable on Day 1 is regenerating them.** Every claim in the deck —
MASE 0.906, seasonal naive 1.118, selection 1.091, coverage 0.750 — rests on a script that must
exist and run from a clean clone. If the regenerated numbers differ, **the new numbers are the truth
and the deck changes**, not the other way round. Finding that on Day 1 costs an hour; finding it in
Q&A costs the competition.

---

## Day plan

| Day | B1 | B2 | Evening gate |
|---|---|---|---|
| **1** | `day1_benchmark.py` reproducing the baseline table; ADI/CV² classifier | `forecast_store.py` with **stubbed `lead_time_demand()`** so Pod C is unblocked by noon | `make benchmark` prints the leaderboard; `SeasonalNaive` figure confirmed or corrected |
| **2** | statistical portfolio fitted per series, routed by class; per-member store | LightGBM global quantile model; median combination; real forecast store written | Real quantiles land in the store; Pod C serves a real `/forecast` |
| **3** | selection-vs-combination ablation; per-series table; final `benchmarks.json` | conformal calibration + reliability curve; `explain.py` attribution in units | Ensemble MASE reproduced; the reliability diagram has real before/after data |
| **4** | **the holdout is evaluated once**; model card written | support Pod C/D; no new work | numbers frozen |

---

## 1 · `scripts/day1_benchmark.py` (B1) — build this first

**Protocol, fixed and stated on the slide:** weekly grain · horizon 8 · rolling-origin CV · 4 windows
· MASE averaged over the 8 series · `seed = 42`.

```bash
make benchmark      # writes artifacts/benchmarks.json and prints the leaderboard
```

Write exactly the shape in `CONTRACTS.md` C4, and **delete the `PLACEHOLDER` key** once real.

Models to score, in this order (the cheap ones first so you get a table within the hour):

```
Naive · WindowAverage(8) · SeasonalNaive(52) · AutoETS · AutoTheta ·
DynamicOptimizedTheta · CrostonOptimized · AutoARIMA · MSTL      -> statsforecast
LightGBM global quantile                                          -> mlforecast
Prophet                                                           -> prophet
Median of {Prophet, AutoARIMA, MSTL, SeasonalNaive, LightGBM}     -> the ensemble we ship
Oracle (best per series in hindsight)                             -> the bound, not a model
```

**Also compute the two ablations, because they are the actual result:**

| Ablation | Compares | Why it matters |
|---|---|---|
| **E2 selection vs combination** | pick-each-series-best-from-previous-folds · median combination · oracle | *"We tested the obvious approach and it lost"* is a result. *"We averaged some models"* is not — same code, different claim. **Lead the deck with this.** |
| **E3 calibration** | empirical coverage of the nominal 80% interval, before and after conformal correction | The over-confidence is directional: too-narrow intervals make the newsvendor under-order while the screen says 95%. |

**Metric choice, and defend it:** MASE, not MAPE. MAPE divides by the actual, so on N05C (zero on
68% of days) it is undefined or explosive, and on a 23-unit-per-week category a 5-unit miss reads as
22% error even though 5 units is an excellent forecast. MASE is defined on zeros and comparable
across categories of very different volume. Report **weekly, per category** — summing all eight into
a monthly total gives a much prettier number and is useless to a buyer who orders paracetamol and
antihistamines separately, every week.

**Report the losses.** Include `ensemble_wins: false` rows. The ensemble is expected to lose to
seasonal naive on M01AE, and R06 is the hardest series. Both go on the slide.

---

## 2 · `core/classify.py` (B1)

```python
def classify(y: pd.Series) -> DemandClass:
    """ADI/CV^2 -> 'smooth' | 'intermittent' | 'erratic' | 'lumpy'."""
```

- **ADI** = mean number of periods between non-zero sales.
- **CV²** = squared coefficient of variation of the **non-zero** quantities.
- Syntetos–Boylan boundaries: **ADI 1.32, CV² 0.49**.

| Quadrant | Expected here | Routed to |
|---|---|---|
| smooth | M01AB M01AE N02BA N02BE N05B R06 | the full portfolio |
| intermittent (ADI ≥ 1.32, CV² < 0.49) | **N05C** (ADI 3.12) | Croston / TSB |
| erratic (ADI < 1.32, CV² ≥ 0.49) | **R03** (CV² 0.82) | quantile LightGBM, robust decomposition, wider bands |
| lumpy | none today | TSB + bootstrap, held as a guard rail |

**This is a computed rule, not configuration.** Nothing is hardcoded to a series name — when N05C's
behaviour changes, the route changes on its own. Recompute nightly, write to the `demand_class`
table in C2, and let the UI render it as a chip.

---

## 3 · `core/portfolio/` (B1 statistical + Prophet, B2 LightGBM)

One interface for every member so the combiner does not care which is which:

```python
class Member(Protocol):
    name: str
    def fit(self, y: pd.DataFrame, cutoff: str) -> None: ...
    def predict(self, h: int, levels: list[float]) -> pd.DataFrame: ...
        # returns: ds, horizon, quantile, value
```

| File | Members | Library |
|---|---|---|
| `statistical.py` | AutoARIMA, MSTL, SeasonalNaive, CrostonOptimized/TSB, AutoETS, Theta | `statsforecast` — one API for all, Numba-compiled, whole portfolio fits in ~25 s so the backtest runs in CI on every push |
| `prophet_model.py` | Prophet | `prophet` — the only member exposing **named holiday regressors** and an additive component decomposition as output |
| `lgbm_global.py` | LightGBM, global, quantile | `lightgbm` via `mlforecast` — native pinball objective, native categorical `series_id`, cutoff-aware lag generation |

**Prophet degradation path.** Prophet can fail to install (cmdstanpy, Windows). Wrap the import:

```python
try:
    from prophet import Prophet
    PROPHET_AVAILABLE = True
except ImportError:
    PROPHET_AVAILABLE = False
```

If it is unavailable, the ensemble runs on four members and **`benchmarks.json` records which
members were present.** Never silently ship a different ensemble than the one on the slide.

**Fit rules for every member:**
- Fit on the training fold only. `is_closed` rows are **masked out of the loss**, never imputed.
- Rows with `completeness < 1.0` are excluded from fitting.
- Feed the holiday table to Prophet with asymmetric windows — stock-up before a closure, suppressed
  demand after it, which is the observed behaviour.
- Per-series seasonality (peaks differ by month) and per-series day-of-week effects (they run in
  opposite directions across products — a shared coefficient cancels).
- **Clip at zero.** Demand is a non-negative count. "Order −2 boxes" is a real failure mode of a
  linear model on a low-mean series.

---

## 4 · `core/combine.py` (B2)

```python
def combine(members: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Median across members at each quantile level, then enforce monotonicity."""
```

**Median, not mean.** The failure we protect against is one member misfitting badly on one period —
an extrapolating trend, a mis-detected changepoint. A mean carries that error in proportion to its
size; a median does not.

**Then sort the quantiles.** Taking medians independently at each level does not preserve ordering,
and an unordered quantile set is not a distribution. A test asserts monotonicity.

Weights are equal to start. If weighting is introduced it is **bounded to [0.05, 0.40]** — unbounded
weighting converges toward selecting one method, which is exactly the strategy the ablation measured
at 1.091.

---

## 5 · `core/calibrate.py` (B2) — the differentiator

```python
def conformalise(combined: pd.DataFrame, calibration_residuals: pd.DataFrame) -> pd.DataFrame:
def coverage_curve(forecasts, actuals, levels) -> list[dict]:
    """[{'nominal': 0.80, 'achieved': 0.75}, ...] - drives the reliability diagram."""
```

**Why this is not optional.** The decision layer reads a specific quantile to pick an order quantity.
If the distribution is too narrow, the quantity read at "95%" corresponds to a lower true
probability, and the system **under-orders while displaying a service level it is not achieving.**
The error is directional and invisible — it never shows up as a bad point forecast, and it is worst
on the products with the most uncertainty, which are the products where the decision matters most.

Conformalised quantile regression: hold out a calibration fold, measure the empirical residual
distribution, adjust interval widths so stated coverage matches achieved coverage. No assumption
about the error distribution and a finite-sample guarantee — which matters because demand here is a
non-negative count with an asymmetric right tail, not a Gaussian.

**Calibrate on pooled residuals across series, not per series.** Per-series calibration on ~32
points overfits. Report coverage **with a confidence interval, not as a point** — the whole result
rests on 8 series × 8 steps × 4 folds = 256 points, which is enough to establish a consistent
direction of over-confidence and not enough to certify a precise per-series level. Say that before a
judge does.

**Ship the before/after curve to the UI.** A confidence claim the user cannot verify is not a
confidence claim.

---

## 6 · `core/forecast_store.py` (B2) — **CONTRACT C2. Build the stub on Day 1 morning.**

Exact signatures are in `CONTRACTS.md` C2. The one Pod C actually needs:

```python
def lead_time_demand(series_id: str, lead_time_days: int) -> dict[str, float]:
    """Distribution of TOTAL demand over the next `lead_time_days` days."""
```

**Day 1, 10:00: return `{q: daily_median * lead_time_days * factor(q)}` from a hardcoded dict.**
Pod C's entire decision engine can then be built and tested. Replace with the real read on Day 2 and
nothing on their side changes. **Do not let Pod C wait for your models.**

**Publication is a pointer swap:** write `version=<slug>/` fully, then rewrite `CURRENT` as the last
operation. A partially-written run is never readable. `model_version` participates in the API cache
key, so a deploy self-invalidates with no manual flush.

---

## 7 · `core/explain.py` (B2) — attribution in **units**

```python
def attribute(series_id: str, grain: str, horizon: int) -> Attribution:
    """Breakdown in units that sums to the total change."""
```

Two complementary decompositions:
1. **Prophet's additive components read directly** — trend, annual seasonality, per-holiday effect,
   already in the units of the series.
2. **Covariate ablation** — re-forecast with one driver group removed, report the difference.

Target output, in the buyer's language:

> *"R06 is up 41 units next month: +28 from the May pollen season, +9 from the underlying trend,
> +4 from the holiday calendar."*

**Feature-importance charts explain the model. A buyer needs an explanation of the number.** SHAP on
the LightGBM member and Prophet's decomposition sit one level deeper for the audience that wants
them — and SHAP is optional, below the cut line if it costs a day.

**A test asserts the components sum to the total within ±0.5.** An explanation that does not add up
to the number it explains is worse than no explanation.

**Attribution is computed over observed features only.** A driver that does not exist in the data
cannot appear in an explanation.

---

## 8 · Below the cut line — start only when 1–7 are merged

| Item | Note |
|---|---|
| `core/reconcile.py` — temporal MinT (day/week/month must sum) | Genuinely strong: the *three clocks* story, and prior analysis measured direct-monthly at 0.912 vs summed-from-weekly at 0.954. Use `scipy.sparse` for the summing matrix and a **shrinkage** covariance estimator — the full form inverts a dense ill-conditioned matrix when series outnumber observations, which is our regime. |
| Cross-sectional reconciliation (product → group → store → region) | **Cut.** It needs a store network that would be lane-3 synthetic, which may not back any claim. Do not build it. |
| Stress-test harness (level shift, transient spike, discontinuation) | The single most "industry-grade" thing available, and it reuses `backtest.py`. **Scale-normalise the MASE denominator per scenario** — a ×4 multiplicative shock scales the errors, so a fixed pre-shock denominator reports a false failure of exactly the shock's magnitude. That artifact has already cost this project a day once. |
| MLflow tracking | Cut. Use a CSV of runs. |
| Drift monitors (rolling MASE, PSI, coverage drift) | Ship as **static gauges reading `benchmarks.json`**. Live monitoring needs production traffic we do not have. |

---

## Tests you own

| File | Asserts |
|---|---|
| `tests/unit/test_classify.py` | N05C classifies intermittent, R03 erratic, N02BE smooth |
| `tests/unit/test_combine_monotone.py` | combined quantiles are non-decreasing and non-negative |
| `tests/unit/test_store_roundtrip.py` | write → `CURRENT` swap → read returns the same values |
| `tests/unit/test_lead_time_demand.py` | longer lead time gives a wider, higher distribution |
| `tests/unit/test_attribution_sums.py` | components sum to the total within ±0.5 |
| `tests/unit/test_synthetic_blocked.py` | the trainer raises on a `data/synthetic/` path |

## Definition of done

- [ ] `make benchmark` on a clean clone writes a real `artifacts/benchmarks.json` with no
      `PLACEHOLDER` key, and the leaderboard is reproducible twice with identical values
- [ ] The forecast store holds 21 calibrated quantiles for all 8 series at week grain
- [ ] `lead_time_demand()` returns real numbers and Pod C consumes them
- [ ] The reliability diagram has real before/after coverage data
- [ ] Attribution returns units that sum to the total, for at least R06 and N02BE
- [ ] Model card written: training window, `snapshot_id`, per-series metrics, **known limitations
      including censored demand**, who approved promotion

## Your handoffs

| To | What | When |
|---|---|---|
| **Pod C** | `lead_time_demand()` stub | **Day 1 by 12:00** |
| **Pod C** | real forecast store + `read_quantiles()` + `model_meta()` | end of Day 2 |
| **Pod C, D** | real `artifacts/benchmarks.json` | end of Day 3 |
| **Pod C** | `attribute()` returning the `/explain` payload | Day 3 |

## Traps

1. **Building models before the benchmark harness.** Without a scored baseline you cannot tell
   whether anything you built helps. Harness first, every time.
2. **Fitting on rows where `is_closed` or `completeness < 1.0`.** Pod A flags them; you must honour
   the flags. This is the most likely silent accuracy bug in the project.
3. **Reporting a number you cannot regenerate.** B1 owns every number. If it is not in
   `benchmarks.json`, it does not go on a slide.
4. **Per-series conformal calibration.** 32 points per series overfits; pool them.
5. **Letting Prophet's install block the pipeline.** Guard the import on Day 1, not Day 3.
6. **Touching the holdout.** `ds >= 2019-07-01` is evaluated once, on Day 4.
