# ARCHITECTURE DELTA — what changed against the submitted design, and why

> The design documents (`PHARMAPULSE_CONCEPT.md`, `PHARMAPULSE_ARCHITECTURE.md`) were written
> **before** the system was built. This file reports every place the built system **differs** from
> them — what changed, why, what it cost or gained, and where the code is.
>
> **Read this alongside the design documents.** If a judge holds you to something in them, this is
> the file that says whether it survived contact with the implementation.

Five parts:

| | |
|---|---|
| **0** | **Structural** — the component map: what was removed, added, or moved between layers |
| **A** | **Behavioural** — the system computes something different from what was specified |
| **B** | **Simplifications** — specified components deliberately not built |
| **C** | **Additions** — things built that were not in the design |
| **D** | **Corrections to stated facts** — the design asserted something the data contradicts |

---

# 0 · Structural — the component map

**This is the part that changes the architecture diagram.** Everything in §A is about what the
components *compute*; this section is about which boxes exist and where they sit.

## 0.1 Every numbered component, and what happened to it

| # | Component (design) | Status | Where it lives now |
|---|---|---|---|
| 1.1 | Ingester | as designed | `pipelines/ingest.py` |
| 1.2 | Validator | as designed | `pipelines/validate.py` |
| 1.3 | Cleaner | as designed | `pipelines/clean.py` |
| 1.4 | Feature Builder | as designed | `pipelines/features.py` |
| 1.5 | Gold Store | as designed | `pipelines/gold.py` |
| 2.1 | Demand Classifier | as designed | `core/classify.py` |
| 2.2 | Model Portfolio | as designed | `core/portfolio/` |
| 2.3 | Combiner | as designed | `core/combine.py` |
| 2.4 | Calibrator | as designed | `core/calibrate.py` |
| **2.5** | **Reconciler** | **REMOVED** | — see 0.2 |
| 2.6 | Forecast Store | as designed | `core/forecast_store.py` |
| 3.1 | Stock Ledger | **split in two** | `decision/ledger.py` + settings — see 0.4 |
| 3.2 | Order Calculator | as designed | `decision/newsvendor.py` |
| 3.3 | Risk Detector | as designed | `decision/risk.py` |
| **3.4** | **Recommendation Builder** | **MERGED into 3.3** | `decision/risk.py::build_recommendation()` |
| **4.1** | **Attribution Engine** | **MOVED to Layer 2** | `core/explain.py` — see 0.3 |
| **4.2** | **Scenario Engine** | **REMOVED** | — |
| **4.3** | **Assistant** | **REMOVED** | — |
| 5.x | Service | as designed, widened | `api/` — 7 endpoints became 16 |
| 6.x | Product | as designed, minus replay | `web/src/screens/` — see 0.3 |
| **9.4** | **Stress Harness** | **REMOVED** | — |

**Score: 4 components removed, 1 merged, 2 moved between layers, 5 added.**

## 0.2 The one removal that changes the shape of the system

**2.5 Reconciler is gone entirely.** It was the only component that made the three grains and the
product hierarchy *cohere*. With it removed:

- day, week and month forecasts are produced and served **independently**. They are not guaranteed to
  sum. Nothing on any screen depends on them summing, but the design's "three clocks, one system"
  claim does not hold in the build.
- the design's *two hierarchies, one mechanism* argument (§4.9) — that cross-sectional and temporal
  MinT are the same code with a different summing matrix — is untested, because neither half exists.

**Why it went.** The cross-sectional half needs a store network, which would be lane-3 synthetic, and
lane 3 cannot back a claim. The temporal half is real and defensible, but no screen depends on it.
**Temporal MinT is the first thing to add.**

## 0.3 Two components moved between layers

**Attribution: Layer 4 (Intelligence) → Layer 2 (Forecast Engine).**

The design puts the attribution engine in a separate Intelligence layer consuming a finished
forecast. We built it as `core/explain.py`, inside the forecast engine.

*Why:* it reads Prophet's fitted trend / seasonality / holiday components **directly**. Keeping it in
a higher layer would mean either re-fitting the model or shipping fitted component frames across a
layer boundary. Sitting next to the model that produces them is the smaller interface.

**Replay: Layer 6 (Product) → Layer 3 (Decision).**

The design describes replay as a *screen* — §5.5, "Live Ops — the replay mode", inside the Product
layer. We built `decision/replay.py` as a **policy simulator in the decision layer**, with the screen
as a thin client over it.

*Why:* replay does not display a policy, it **runs** one — sell, deliver, decide, repeat. As a
decision-layer component it can be driven headlessly, which is what let it become the delivery
mechanism for evaluation **E5** (the business case) and the closest thing the project has to an
end-to-end integration test. As a screen it could have been neither.

**Consequence:** `decision/replay.py` contains a **second, independent policy implementation**
(min/max). The design mentions min/max only as an evaluation baseline, never as something the system
itself contains.

## 0.4 Component 3.1 split into two stores that compose

The design describes one Stock Ledger with opening stock *"seeded, editable in settings"*. It never
says how the seed and the movements relate. Built naively they are two sources of truth that
disagree — and in the first implementation the API read stock from settings while the ledger sat
unused.

```
   settings (ops.db)            ledger (ops.db)
   opening_stock          +     SUM(movements)        =    live position
   lane 2, user-edited          receipts · sales ·         api/deps.py::live_stock()
                                wastage · adjustments
```

That is a component-boundary decision the design does not make, and it is what allows accepting an
order to actually move the shelf.

## 0.5 Five components with no design number

| New component | What it is | Why it exists |
|---|---|---|
| `core/pipeline.py` | forecast-stage orchestrator | The design has `run_nightly` calling stages directly. Once routing became per-grain, the fit → combine → calibrate → publish sequence needed its own coordinator |
| `decision/replay.py` | policy simulator + a second policy | See 0.3 |
| `api/deps.py` | envelope, settings, cache, live stock | The design implies these are per-route concerns. Centralising them is what puts provenance on **every** response rather than the ones an author remembered |
| `contracts/fixtures/` + `scripts/make_fixtures.py` | a **fallback data plane** | Not in the design at all. It is degradation rung 5 and the parallel-work unblocker. Captured from the live API, so shapes cannot drift |
| `scripts/day1_benchmark.py` → `artifacts/benchmarks.json` | the **evidence artifact**, promoted to a contract | The design uses MLflow. Making the artifact a file the API only *reads* is what makes "no number on this screen is typed by a human" literally true and checkable |

## 0.6 Infrastructure components removed from the diagram

Five boxes in the design's stack table do not exist in the build:

| Design | Built | Effect |
|---|---|---|
| Redis | in-process `lru_cache` | one fewer service |
| PostgreSQL + row-level security | SQLite | one fewer service; **no tenancy boundary** |
| MLflow + model registry | `benchmarks.json` | no registry; **no champion/challenger gate** |
| APScheduler / Prefect | none — `run_nightly` by hand or CI | **no scheduler**; the batch is triggered, not scheduled |
| OpenTelemetry / prometheus | none | **no tracing**; `/metrics` reports process-local counters |

**The promotion gate (§9.2) is the notable casualty.** The design has a challenger model that must
beat SeasonalNaive on every series before publication. Without a registry there is no champion to
pin, so `write_version()` publishes unconditionally, and the gate survives only as the CI benchmark
failing a build.

## 0.7 Contracts: three became five, and they became files

The design freezes **three** contracts (§9.3). The build has **five**, materialised under
`contracts/`:

| | | |
|---|---|---|
| C1 | Gold schema | in the design |
| C2 | **Forecast store schema** | **added** — the `core` → `decision` boundary was undefined |
| C3 | HTTP API | in the design |
| C4 | `benchmarks.json` | in the design |
| C5 | **Fixtures** | **added** — see 0.5 |

## 0.8 The redrawn diagram

```
  LAYER 1  DATA          ingest -> validate -> clean -> gold -> features     unchanged
  LAYER 2  FORECAST      classify -> portfolio -> combine -> calibrate -> store
                         + attribution                   <- MOVED IN from L4
                         - reconciler                    <- REMOVED
  LAYER 3  DECISION      newsvendor · risk (+ recommendation) · ledger
                         + replay simulator + min/max policy   <- MOVED IN from L6
  LAYER 4  INTELLIGENCE  EMPTY - attribution moved down, scenarios and
                         assistant not built
  LAYER 5  SERVICE       16 endpoints; envelope centralised in deps.py
  LAYER 6  PRODUCT       7 screens; replay is now a thin client
  SIDECAR  EVIDENCE      benchmark script -> benchmarks.json    (contract C4)
                         fixtures <- captured from the live API (contract C5)
```

**Layer 4 no longer exists as a distinct layer.** That is the single biggest structural difference
between the design and the build.

---

# A · Behavioural changes

These change what the system actually computes. **A1 is the most important thing on this page.**

## ★ A1 — The order is sized against the protection interval, not the lead time

| | |
|---|---|
| **The design says** | §5.4: *"**Reorder point** — quantile of demand over the lead time, at service level `q*`"* |
| **We built** | quantile of demand over **lead time + review period** |
| **Where** | `decision/newsvendor.py::protection_interval_days()`, used by `api/routers/decisions.py::_order_for()` and `decision/replay.py::_decide()` |
| **Status** | The phrase "protection interval" appears **zero times** in either design document. This is a genuine correction to the specified algorithm. |

**Why the design was wrong.** In a periodic-review system you cannot reorder until the next review.
With a 7-day review and a 4-day lead time, today's order must survive **11 days** — until the order
*after* next arrives. Sizing against the lead time alone systematically under-orders.

**How it was found.** Building the replay simulation. It produced persistent stockouts under *both*
policies, which is the signature of a systemic under-order rather than a policy difference.

**What it changed — the largest single correctness fix in the project:**

| Sizing against | Units unsupplied, Jan–Mar 2019 |
|---|---|
| Lead time (4 days), as designed | **2,207** |
| Protection interval (11 days), as built | **121** |

**Knock-on effect:** every reorder point rose, which turned the demo board from a realistic mix into
eight red rows. The seeded lane-2 stock levels were re-tuned in `api/deps.py::DEFAULT_SETTINGS` to
restore a plausible board (4 healthy, 3 order-now, 1 overstocked).

---

## A2 — Lead-time demand is aggregated by √n, not by summing quantiles

| | |
|---|---|
| **The design says** | nothing — it specifies *that* a lead-time distribution is consumed, not how it is formed |
| **We built** | centre scales linearly with the horizon, spread scales with `sqrt(n)` |
| **Where** | `core/forecast_store.py::lead_time_demand()` |

**Why.** The 95th percentile of a sum is **not** the sum of 95th percentiles unless the days are
perfectly correlated. Summing the stored daily quantiles would inflate the tail and make the system
over-order at every service level.

```python
    median = float(per_day.get(0.50, per_day.median()))
    centre = median * n
    deviation = (float(v) - median) * np.sqrt(n)
```

**Honest caveat:** `sqrt(n)` assumes independent daily errors. Real demand has positive
autocorrelation, so the true lead-time spread is somewhere between `sqrt(n)` and `n`. This is a
stated approximation, not a derived result.

---

## A3 — AutoARIMA is fitted non-seasonally at weekly grain

| | |
|---|---|
| **The design implies** | seasonal ARIMA — it is listed as handling annual structure alongside MSTL |
| **We built** | `season_length=1` whenever the seasonal period exceeds 24 |
| **Where** | `core/portfolio/statistical.py::_build_models()` |

**Why.** `season_length=52` **never terminated** — the order search explores seasonal lags 52 apart
on ~300 observations. It ran over 20 minutes on one fold and had to be killed.

**Cost, stated in the model card:** MASE **1.115** rather than the 1.039 the design projected.
**Gain:** fit time went from *never* to **1.2 s**, which is what makes the full 43-second backtest
affordable in CI on every push. MSTL and Prophet carry the annual season; ARIMA contributes
short-run autocorrelation, which is the only thing it is in the portfolio for.

---

## A4 — Prophet's holiday regressors are dropped at monthly grain

| | |
|---|---|
| **The design says** | §4.2.1 — holidays as named, individually fitted regressors, as a headline reason Prophet is in the portfolio |
| **We built** | holidays at **daily and weekly** grain only |
| **Where** | `core/portfolio/prophet_model.py::fit_predict()` |

**Why.** Every holiday falls in the same month every year, so its coefficient is collinear with the
annual seasonal term. Fitting ~14 holiday coefficients on 70 monthly observations attributed
**+34 units on a 104-unit baseline** to "holidays" — visible on the explainability screen.

| R06 attribution | Before | After |
|---|---|---|
| seasonality | −59.8 | **−23.7** |
| holiday | **+34.4** | — |
| trend | +3.9 | +4.0 |

**Weekly grain is unaffected, so no benchmark number moves.** The design's claim about named holiday
regressors still holds where it is identifiable.

---

## A5 — The conformal scale is a single global factor

| | |
|---|---|
| **The design says** | §4.4 — conformalised quantile regression, *"plus a coverage report per product"* |
| **We built** | one pooled scale factor (0.718), applied uniformly to every series and horizon |
| **Where** | `core/calibrate.py::conformal_scale()` → `core/pipeline.py::_conformal_scale()` |

**Why pooled:** the design's own self-critique (§11.4) calls for it — per-series calibration on ~32
points would overfit. **We follow the self-critique rather than the main text.**

**What we did not build:** a *per-horizon* scale. Interval width should grow with horizon at a rate
the data could tell us; we apply one factor and let the `sqrt(h)` spread model carry the horizon
dependence. Stated as an approximation.

---

## A6 — Demand class per grain: we broke the spec, then a test restored it

| | |
|---|---|
| **The design says** | §4.1 — `demand_class` *"per product, **per grain**, recomputed nightly"* |
| **First implementation** | classified once on weekly data, reused for all three grains |
| **Now** | recomputed per grain, as specified |
| **Where** | `core/pipeline.py::forecast_grain()` |

**This is a deviation we introduced and then removed.** It is reported because the failure is
instructive: N05C is **intermittent at daily grain and smooth at weekly**, so classifying once sent
the daily forecast to the wrong model family. Caught by
`tests/unit/test_core.py::test_demand_class_depends_on_the_grain`.

---

## A7 — The quantile grid is anchored at (0, 0)

| | |
|---|---|
| **The design says** | nothing about behaviour outside the stored quantile range |
| **We built** | interpolate to zero below the lowest stored level; **clamp** above the highest |
| **Where** | `decision/newsvendor.py::quantile_of()` |

**Why.** Clamping at the low end meant a product whose shortage is nearly free still got ordered up
to the 5th percentile — an order floor with no economic justification. Demand is non-negative, so
the quantile function genuinely approaches zero. The **upper** tail stays clamped, because
extrapolating a tail we did not estimate would invent confidence.

---

## A8 — Live stock is composed, not stored

| | |
|---|---|
| **The design says** | §5.4 — a stock ledger, with opening stock *"seeded, editable in settings"* |
| **We built** | `live position = settings opening stock + Σ ledger movements` |
| **Where** | `api/deps.py::live_stock()` |

**Why.** The design describes both a ledger and an editable opening stock but never says how they
compose. Built naively they are two halves that disagree — and in the first implementation the API
read stock straight from settings, so **the ledger was complete, tested, and called by nothing**.
Composing them means accepting an order actually moves the shelf: 310 → 530 units, status flips
`order_now` → `ok`.

---

# B · Simplifications — specified, deliberately not built

Each has a line to say. None is hidden.

| # | Specified | Built instead | Why |
|---|---|---|---|
| **B1** | `pandera` schema contracts | 9 explicit checks in plain pandas | Same assertions, one fewer dependency, readable failure output on stage |
| **B2** | Redis cache | in-process `lru_cache` keyed on `model_version` | A service to operate for no scoring points at eight series |
| **B3** | PostgreSQL + row-level security | SQLite | Transactions are needed; multi-tenancy is not, at one pharmacy |
| **B4** | MLflow + model registry | `benchmarks.json` written by a script | Run comparison without a server to operate |
| **B5** | OIDC auth, tenant isolation | **nothing** | Tenant isolation belongs in the database. Half-building it is worse than not building it |
| **B6** | APScheduler / Prefect nightly job | `run_nightly.py`, run by hand or by CI | No scheduler needed for a demo; the job is idempotent either way |
| **B7** | **Cross-sectional MinT reconciliation** | **not built** | It needs a store network that would be lane-3 synthetic — and lane 3 cannot back a claim, so reconciling across it would prove nothing. **This is an internal contradiction in the design that we resolved by cutting.** |
| **B8** | **Temporal MinT reconciliation** (day↔week↔month) | **not built** | Real and defensible; no screen depends on grain coherence. **The first thing we would add.** |
| **B9** | Stress-test harness, 10 scenarios | **not built** | Reuses `backtest.py`; roughly half a day |
| **B10** | Drift monitors (rolling MASE, PSI, coverage drift) | **not built** | Needs production traffic. Calibration measurement is the offline version |
| **B11** | `/simulate` what-if endpoint | **not built** | Below the cut line |
| **B12** | `/assistant` natural-language layer | **not built** | A live external API mid-pitch is a risk we chose not to take |
| **B13** | SHAP on the LightGBM member | **not built** | Attribution in units already answers "why"; SHAP is the layer below |
| **B14** | Synthetic 40-store network | **not built** | Presentation value only; proves nothing about accuracy |
| **B15** | Degradation rung 2 (covariate source down) | **not applicable** | We use no external covariates, by choice (see the location-inference limitation) |

**The design's 7 endpoints became 16** — see C2.

---

# C · Additions beyond the design

## C1 — Fixture mode as an explicit degradation rung

The design has a six-rung degradation ladder. It does **not** include "serve captured fixtures".

We added it as rung 5, wired to `meta.degraded`, and kept it working and tested throughout:

```bash
PHARMAPULSE_FIXTURES=1     # the whole app runs, labelled "demo data · model layer offline"
```

**Why it earns its place:** it is the switch to flip if the model layer dies on stage, and because
fixtures are **captured from the live API** (`scripts/make_fixtures.py`) rather than hand-written,
their shapes cannot drift.

## C2 — Nine endpoints the design did not specify

The design lists 7. The build has 16, because the described UI is not renderable from 7:

| Added | Why it was necessary |
|---|---|
| `/api/series` | nothing listed the products |
| `/api/history` | nothing returned actuals for a chart |
| `/api/positions` | the dashboard's shelf table |
| `/api/settings` (GET/PUT) | lane-2 parameters had no read or write path |
| `/api/orders` | accept/override into the audit log |
| `/api/ledger` | the movement trail behind the position |
| `/api/health` | liveness and degradation rung |
| `/api/replay/{start,tick,stop}` | replay mode was described but had no interface |
| `/api/replay/business-case` | evaluation **E5** was specified with no delivery mechanism |

## C3 — The business case is a live endpoint, not an offline study

The design specifies **E5** — *"Inventory simulation over the 2019 holdout: our policy vs a min/max
reorder-point policy"* — as an evaluation to run once for a slide.

We built it as `decision/replay.py::compare_policies()`, exposed at
`/api/replay/business-case`, and put it **on the Replay screen**. It runs on demand over any window.

**Consequence:** the ROI figure is a measurement a judge can re-run, not a number on a slide.

## C4 — Per-session locking in replay

Not in the design. Necessary because FastAPI runs sync endpoints in a threadpool, so two requests
interleaved inside the sell → deliver → order sequence and turned 121 units short into 547.

## C5 — `scripts/reset_demo.py`

Not in the design. Necessary *because* of A8 — once accepting an order genuinely moves the shelf, a
rehearsal leaves the board wherever the last run ended.

---

# D · Corrections to stated facts

These are not architecture, but the design documents assert them and they are wrong.

| # | The design says | Measured | Where corrected |
|---|---|---|---|
| **D1** | 7 January is a closure *"2014–2019, every year"* | **5 of 6 years.** On 7 Jan 2017 the pharmacy was open and sold **59.9 units** | `ARCHITECTURE.md` edited in two places; asserted by `test_orthodox_christmas_is_a_closure_in_five_of_six_years` |
| **D2** | Interval coverage **0.750** — over-confident, causing silent under-ordering | **0.922** — too **wide**, causing over-ordering and tied-up capital | Direction flips; the methodology is unchanged |
| **D3** | Per-series selection scores **1.091** | **0.968** | Combination still wins (0.907), smaller margin. **Quote 0.968.** |
| **D4** | The ensemble *loses* to seasonal naive on M01AE (1.061 vs 1.015) | Ensemble **1.000** vs 1.019 — wins, barely | We now win on all 8, but M01AE is a tie and R06 (1.646) is the weak one |
| **D5** | AutoARIMA **1.039** | **1.115** | Consequence of A3 |
| **D6** | Oracle bound **0.883** | **0.843** | Different portfolio composition |

**D2 is the one to volunteer.** The design predicted the failure direction and got it backwards. The
lesson — *measure your own intervals* — is unchanged and is arguably stronger for having been wrong
about it.

---

# Summary — what a judge should be told

**Three things in the design turned out to be wrong, and we found all three by measuring:**

1. **The order was sized against the wrong window.** Lead time, not protection interval. Fixed;
   2,207 → 121 units unsupplied.
2. **The calibration direction was backwards.** Predicted over-confident, measured too wide.
3. **A stated fact about the data was false.** 7 January 2017 was a trading day.

**Two things in the design were internally inconsistent, and we cut them:**

4. Cross-sectional reconciliation needs a store network that the provenance rule forbids from backing
   any claim.
5. Seven endpoints cannot render the six screens the same document describes.

**Everything else is either built as specified, or cut with a stated reason.**

The design documents remain the right description of *what this system is for* and *why each
component exists*. This file is the record of where building it taught us something the design could
not know.
