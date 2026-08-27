# PHARMAPULSE — System Design Proposal

### Problem statement, architecture, and the technology we intend to build it with

> **We are building a system that reads a pharmacy's sales history, projects future demand as a range
> rather than a single number, and converts that range into a purchase order sized against the
> pharmacy's own costs — with the reasoning shown alongside it.**

This document proposes the design. It states what each component does, what it takes in, what it
produces, and which technology we intend to use for it. Where a choice is made, the reason given is
what the problem requires — not a benchmark.

---

## Contents

| § | Section |
|---|---|
| **1** | Problem statement and design requirements |
| **2** | System overview |
| **3** | Layer 1 — Data Foundation |
| **4** | Layer 2 — Forecast Engine *(includes what each forecasting method does)* |
| **5** | Layer 3 — Decision Engine |
| **6** | Layer 4 — Intelligence |
| **7** | Layer 5 — Service |
| **8** | Layer 6 — Product |
| **9** | Robustness and operations |
| **10** | Consolidated technology stack |
| **11** | Data provenance rules |
| **12** | Delivery plan and ownership |

---

# 1. Problem statement and design requirements

## 1.1 The decision the system exists to support

A pharmacy buyer periodically commits capital to inventory under uncertainty. For each product they
must choose a quantity, knowing that:

- **understocking** costs the lost gross margin on the sale, and frequently the customer;
- **overstocking** costs the carrying charge on the capital plus the full value of anything that
  expires before it sells.

The quantity that minimises expected total cost depends on the **distribution** of future demand over
the supplier's lead time, and on the ratio between those two costs. A single-point demand estimate is
not sufficient input for that calculation.

**The system must therefore produce a demand distribution, not a demand number**, and must own the
step from that distribution to an order quantity.

## 1.2 Characteristics of the data that shape the design

The dataset is six years of point-of-sale records from one pharmacy: **2,106 daily rows, 2 January
2014 to 8 October 2019, eight ATC-2 drug groups**, in units dispensed. It contains no patient,
prescriber, or transaction identifiers.

Inspection of the files establishes seven properties that the architecture must accommodate.

| # | Property observed in the data | Requirement it creates |
|---|---|---|
| **R1** | The supplied monthly aggregate file disagrees with a roll-up of the daily file, including one month recorded as near-zero against roughly 2,700 units in the daily records | Ingest a **single source of truth** (the daily file) and derive all other grains, with a reconciliation assertion |
| **R2** | 26 days show zero units across all eight groups, concentrated on Orthodox Christmas, Orthodox Easter, New Year and St. Nicholas | Model **closure** as a distinct state from zero demand; hold a holiday calendar; mask closures from model fitting |
| **R3** | The series ends mid-week and mid-month | Track **period completeness**; exclude partial periods from fitting and mark them in the interface |
| **R4** | One group (N05C, hypnotics/sedatives) records zero on roughly two days in three | Support a **separate model family for sporadic demand**; select it by rule rather than by hand |
| **R5** | Seasonal peaks occur in different months per group — antihistamines in late spring, analgesics in winter and mid-autumn, respiratory products in winter | Fit **per-series seasonality**; do not impose one shared seasonal profile |
| **R6** | Day-of-week effects run in opposite directions across groups (over-the-counter analgesics rise at weekends; prescription anxiolytics fall) | Allow **per-series day-of-week coefficients**; a shared coefficient would cancel |
| **R7** | Individual days show extreme values traceable to identifiable events (year-end, a winter illness peak) | **Retain outliers, flag them, and supply a calendar feature** so they can be attributed rather than absorbed as level |

Two further properties are **absent** from the data and drive §11:

- No stock level, delivery lead time, cost, price, promotion, region or distributor field exists.
- Demand is **censored**: a period in which a product was unavailable records zero sales, indistinguishable from genuine zero demand.

## 1.3 Scope of this proposal

**In scope:** ingestion and validation, feature construction, demand forecasting with quantified
uncertainty, temporal and cross-sectional coherence, inventory decision logic, explanation, an API,
six interface screens, and the operational machinery to keep the system correct as new data arrives.

**Out of scope for the first delivery:** batch-level expiry tracking (requires ERP data), live POS
integration (simulated by replaying historical records), and multi-tenant billing.

---

# 2. System overview

## 2.1 Six layers

| Layer | Responsibility | Produces |
|---|---|---|
| **1 · Data Foundation** | Acquire, validate, clean and shape history | A verified analytical table |
| **2 · Forecast Engine** | Project demand with quantified uncertainty | A demand distribution per product, per horizon, at three time grains |
| **3 · Decision Engine** | Convert distribution plus stock and cost into an action | An order quantity, a risk classification, a recommendation |
| **4 · Intelligence** | Explain and interrogate the output | Attribution, scenarios, natural-language answers |
| **5 · Service** | Expose it over HTTP, quickly and safely | Seven endpoints |
| **6 · Product** | Present it to a buyer | Six screens |
| **Cross-cutting · Operations** | Keep it correct as data changes | Drift signals, gated model promotion, stress reports |

## 2.2 Execution model

The system separates a **scheduled batch stage** from a **request-time stage**, and the boundary is a
materialised forecast store.

```
   BATCH  (scheduled, nightly)
   ─────────────────────────────────────────────────────────────────────
   ingest → validate → clean → features → classify → fit models →
   combine → calibrate → reconcile → write forecast store (versioned)

   ═══════════════ materialised forecast store ═══════════════

   REQUEST  (per user action)
   ─────────────────────────────────────────────────────────────────────
   read stored distribution → apply this pharmacy's stock and cost
   parameters → compute order quantity → respond
```

**No model is fitted or evaluated during a request.** The rationale is threefold:

1. **Latency.** Model fitting is measured in seconds; a lookup is measured in milliseconds. Interactive
   controls — a service-level slider that recomputes an order as it moves — are only possible if the
   demand distribution is already resolved.
2. **Determinism.** Two users opening the same product on the same day must see the same forecast.
   Fitting per request would make the answer depend on when it was asked.
3. **Cost scaling.** Batch work scales with the number of products; request work scales with the number
   of users. Keeping fitting on the batch side means user growth does not multiply compute.

## 2.3 Reference diagram

See `pharmapulse_architecture.svg`. Components in this document are numbered to match it.

---

# 3. Layer 1 — Data Foundation

**Responsibility:** produce an analytical table that downstream components can trust without
re-checking. Every defect not caught here propagates silently into model coefficients.

## 3.1 Ingestion

| | |
|---|---|
| **Input** | `salesdaily.csv` — date plus one column per ATC group; a public-holiday calendar (static CSV) |
| **Processing** | Parse dates to a store-local calendar; unpivot the wide file into long form `(series_id, ds, y)`; compute a SHA-256 of the source file as `snapshot_id`; upsert into a bronze table keyed on `(series_id, ds)` |
| **Output** | Bronze table, append-only, with `ingest_batch_id` and `snapshot_id` on every row |
| **Technology** | Python 3.11, `pandas` for parsing, `pyarrow` for Parquet writes, `hashlib` for the checksum |

**Design rationale.** The upsert is keyed on the natural key so that re-ingesting the same file is a
no-op — a property we need because the nightly job must be safely re-runnable after a failure, and
because a real POS feed will resend records after a network interruption. Bronze is append-only so
that any load can be reverted or replayed without reconstructing history by hand.

Only the daily file is read (**R1**). Weekly and monthly views are produced by resampling, which
guarantees they agree with the daily records by construction rather than by trust.

## 3.2 Validation

| | |
|---|---|
| **Input** | Bronze rows for the current batch |
| **Processing** | Seven declarative checks run as a schema contract |
| **Output** | Rows that pass, plus a quarantine table with a failure reason per row |
| **Technology** | `pandera` (typed DataFrame schemas), executed inside the pipeline and again as a unit test in CI |

| Check | Detects |
|---|---|
| Column set and dtypes | a renamed, added or removed drug group |
| Row count per period | incomplete ingestion |
| Period completeness ratio | partial weeks and months (**R3**) |
| Derived-vs-daily reconciliation | any divergence of the kind described in **R1** |
| Duplicate key detection | double-posted batches |
| Range and sign checks | negative or implausible unit counts |
| Date ordering and gaps | out-of-sequence or missing days |

**Design rationale.** A failing batch is quarantined rather than passed through with a warning. A
five-percent drift in a training input is indistinguishable from a genuine change in the business once
it reaches a model, so it must be stopped at the boundary where it is still attributable to a file.

## 3.3 Cleaning

| | |
|---|---|
| **Input** | Validated rows |
| **Processing** | Detect all-zero days and mark `is_closed` (**R2**); join the holiday calendar; compute `completeness` per period; identify statistical outliers and set `is_outlier` **without altering `y`** (**R7**) |
| **Output** | Silver table with `y`, `is_closed`, `is_outlier`, `completeness` |
| **Technology** | `pandas`/`numpy`; holiday calendar as a versioned CSV (a `holidays` package call is a later refinement) |

**Design rationale.** Closure days are excluded from the fitting loss rather than imputed. Imputation
would invent demand that did not occur; deletion would leave a gap that a seasonal model interprets as
a missing period. Marking the state and masking the loss represents the fact accurately: demand is
unobserved, not zero.

Outliers are flagged rather than winsorised because the extremes in this data correspond to real
events (**R7**). Removing them would remove the very behaviour the system needs to anticipate; the
flag plus a calendar feature lets a model attribute the spike to a cause instead of raising its
baseline.

## 3.4 Feature engineering

| | |
|---|---|
| **Input** | Silver table + a `cutoff` timestamp |
| **Processing** | Construct the feature matrix used by the machine-learning member and by any model taking exogenous regressors |
| **Output** | One row per `(series_id, ds)` with the columns below |
| **Technology** | `mlforecast` lag/rolling transforms over `pandas`; `numpy` for Fourier terms |

| Feature group | Columns |
|---|---|
| Autoregressive | `lag_1, lag_2, lag_3, lag_4, lag_8, lag_52` |
| Rolling statistics | rolling mean and standard deviation over 4, 13 and 52 periods; expanding mean |
| Calendar | week-of-year, month, quarter, day-of-week |
| Seasonal basis | Fourier sine/cosine pairs at the annual period, per series (**R5**) |
| Event | `is_holiday`, `is_closed`, `days_to_holiday`, `is_outlier` |
| Identity | `series_id` as a categorical, enabling per-series effects in a shared model (**R6**) |

**Design rationale.** Every feature is computed as of an explicit `cutoff` argument, and a unit test
asserts that a feature value at time *t* is identical whether or not rows after *t* exist in the frame.
Look-ahead leakage is the most common defect in forecasting pipelines and the hardest to notice after
the fact, because it produces results that look excellent; it therefore needs a structural guarantee
rather than a review convention.

Calendar and holiday features are permitted at inference because they are known in advance. Any
externally-sourced covariate (weather, pollen, illness surveillance) is treated as unknown-future and
must be supplied by its own forecast or by a climatological normal.

## 3.5 Storage schema

**Gold table** — the single interface between Layer 1 and everything above it.

```sql
CREATE TABLE gold_demand (
  series_id     TEXT     NOT NULL,   -- ATC-2 code, e.g. 'N02BE'
  ds            DATE     NOT NULL,   -- period start, store-local calendar
  grain         TEXT     NOT NULL,   -- 'day' | 'week' | 'month'
  y             DOUBLE,              -- units dispensed
  origin        TEXT     NOT NULL,   -- 'observed' | 'user_setting' | 'synthetic'
  is_closed     BOOLEAN  NOT NULL,
  is_outlier    BOOLEAN  NOT NULL,
  completeness  DOUBLE   NOT NULL,   -- 1.0 = full period
  snapshot_id   TEXT     NOT NULL,   -- checksum of the source file
  PRIMARY KEY (series_id, ds, grain)
);
```

Stored as **Parquet with ZSTD compression**, partitioned by `grain` and year, and queried through
**DuckDB**.

**Design rationale for the storage choice.** The workload is analytical — full-column scans over a
narrow table, grouped by series — which is what a columnar format is for. DuckDB executes SQL directly
over Parquet files with no server process, no port, and no credentials, so the same code path runs on a
developer laptop, in CI, and in a container. Partition pruning means a single-product query does not
read the whole dataset, which is the property that lets this design survive growth without a rewrite.

`origin` and `snapshot_id` are carried on every row rather than in a side table so that provenance
cannot be lost by a join (**§11**).

## 3.6 Layer 1 technology summary

| Concern | Choice |
|---|---|
| Language | Python 3.11 |
| Transformation | `pandas` (`polars` if profiling justifies it) |
| Columnar storage | Parquet + ZSTD via `pyarrow` |
| Query engine | DuckDB |
| Schema contracts | `pandera` |
| Feature transforms | `mlforecast` lag/rolling utilities |

---

# 4. Layer 2 — Forecast Engine

**Responsibility:** given clean history, produce a **probability distribution** of demand for each
product, at each future period, at three time grains, such that the stated probabilities are
trustworthy and the grains agree with one another.

## 4.1 Demand classification (2.1)

| | |
|---|---|
| **Input** | A product's history |
| **Processing** | Compute two statistics: **ADI**, the average number of periods between non-zero sales, and **CV²**, the squared coefficient of variation of the non-zero quantities. Place the product in a quadrant using the Syntetos–Boylan boundaries (ADI 1.32, CV² 0.49) |
| **Output** | `demand_class ∈ {smooth, intermittent, erratic, lumpy}` per product, per grain, recomputed nightly |
| **Technology** | `numpy`; ~20 lines, no dependency |

| Class | Meaning | Routed to |
|---|---|---|
| **Smooth** | sells most periods, stable quantities | the full portfolio (§4.2) |
| **Intermittent** | long gaps between sales, stable quantities | Croston / TSB (§4.2.6) |
| **Erratic** | sells most periods, highly variable quantities | quantile gradient boosting, widened intervals |
| **Lumpy** | long gaps and variable quantities | TSB with bootstrap simulation |

**Why the system needs this.** Requirement **R4** establishes that at least one product in this data
sells on roughly one day in three. Averaging-based methods applied to such a series return the mean
rate — a flat, fractional, non-actionable line — because they model a quantity that is usually zero.
The methods designed for this case model *two separate processes*, the size of a sale and the gap
between sales, and only exist as a distinct family for that reason.

The classification is expressed as a **computed rule rather than a configuration entry** so that a
product whose behaviour changes is re-routed automatically. Hard-coding a product name would require a
human to notice the change and edit the code.

## 4.2 ★ The model portfolio (2.2) — what each method does

The forecast for a product is produced by several methods running in parallel over the same history.
They are not variations on one idea; each represents a **different structural assumption about how
demand is generated**, and the portfolio is assembled so that those assumptions cover the behaviours
present in this data.

---

### 4.2.1 Prophet — decomposition with explicit calendar effects

**What it models.** Demand as an additive sum of interpretable components:

```
   y(t) = trend(t) + seasonality(t) + holiday(t) + noise
```

**Mechanism.** The trend is a piecewise-linear curve whose breakpoints are inferred automatically.
Seasonality is represented as a Fourier series — a sum of sine and cosine terms at the annual period,
whose coefficients are fitted. Holidays are supplied as a named table and fitted as individual
regressors with configurable windows before and after each date. Parameters are estimated by
maximum a posteriori optimisation under Stan.

| | |
|---|---|
| **Input** | `(ds, y)` per product; a holiday table; optional additional regressors |
| **Output** | A point forecast, an interval, **and the fitted components separately** — trend, annual seasonality, and the effect of each holiday |

**Why it is in the portfolio.**

- Requirement **R2** gives us named calendar events that materially move demand. Prophet is the member
  that treats a holiday as a **first-class object with its own fitted coefficient**, rather than as an
  anonymous dummy variable, and supports asymmetric effect windows — which matches the observed
  behaviour of stock-up before a closure and suppressed demand after it.
- Requirement **R5** requires per-product seasonal shape. Fourier seasonality fits a smooth annual
  curve of arbitrary phase, which is what differing peak months demand.
- Its component decomposition is the **direct input to the attribution feature** in Layer 4 (§6.1).
  No other member exposes trend, season and holiday as separate additive quantities in the units of the
  series, so choosing Prophet means the explanation screen is derived from the model rather than
  approximated after the fact.

**Structural limitation we account for.** It assumes a smooth additive process and does not represent
short-run autocorrelation. That gap is covered by the next member.

---

### 4.2.2 AutoARIMA — short-run dependence on recent history

**What it models.** The current value as a linear function of its own recent values and of recent
forecast errors, after differencing to remove trend:

```
   ARIMA(p,d,q) :  differenced y(t) = Σ φᵢ·y(t−i)  +  Σ θⱼ·ε(t−j)  +  ε(t)
                                      └ autoregressive   └ moving average
```

**Mechanism.** The Hyndman–Khandakar procedure selects the differencing order by unit-root testing,
then searches the space of `(p, q)` orders, choosing by corrected Akaike information criterion.
Estimation is by maximum likelihood.

| | |
|---|---|
| **Input** | `(ds, y)` per product; optional exogenous regressors (calendar, holiday flags) |
| **Output** | A point forecast plus an interval derived from the estimated innovation variance |

**Why it is in the portfolio.**

- It is the member that represents **momentum and mean reversion** — the tendency of an unusually busy
  week to be followed by an above-average week, and of a series to return toward its level afterwards.
  A decomposition model has no mechanism for this; it fits the calendar and treats the remainder as
  independent noise.
- Its interval is derived from an explicitly estimated error process, giving the ensemble an
  uncertainty estimate constructed on different grounds from the others. Diversity in **how uncertainty
  is derived** matters as much as diversity in the point forecast, because the decision layer consumes
  the distribution rather than the mean.
- With exogenous regressors it can absorb the same calendar information as Prophet while modelling the
  residual dependence Prophet leaves behind.

---

### 4.2.3 MSTL — robust multiple-seasonality decomposition

**What it models.** The series as trend plus one or more seasonal components plus a remainder, where
each component is estimated non-parametrically:

```
   y(t) = trend(t) + Σ seasonal_k(t) + remainder(t)
```

**Mechanism.** Seasonal-Trend decomposition using Loess, applied iteratively for each seasonal period
supplied (for example weekly and annual). Loess is a locally-weighted regression: each fitted point is
a regression over its neighbourhood, with distant and extreme points down-weighted. The remainder is
then forecast by a simple method and the components are recombined.

| | |
|---|---|
| **Input** | `(ds, y)` plus a list of seasonal periods |
| **Output** | A forecast, plus the trend/seasonal/remainder decomposition |

**Why it is in the portfolio.**

- It is the member that handles **more than one seasonal cycle simultaneously**. Requirement **R6**
  establishes a day-of-week effect and **R5** an annual effect; at daily grain both are present, and
  MSTL is built to separate overlapping periodicities rather than fold them together.
- Loess down-weights extreme observations by construction. Requirement **R7** commits us to keeping
  outliers in the data, so we need at least one member whose seasonal estimate is **not distorted by the
  spikes we deliberately retain**.
- It makes no parametric assumption about seasonal shape, so it can fit a sharp, narrow seasonal peak
  that a low-order Fourier basis would smooth away.

---

### 4.2.4 Seasonal naïve — the calendar-repetition reference

**What it models.** The value one full seasonal cycle ago:

```
   ŷ(t) = y(t − m)      where m = 52 weeks, 12 months, or 7 days
```

**Mechanism.** None. A lookup. The interval is derived from the spread of historical differences at
that lag.

| | |
|---|---|
| **Input** | `(ds, y)` and a seasonal period |
| **Output** | Point forecast and an empirical interval |

**Why it is in the portfolio — two distinct roles.**

1. **As a control.** It is the definition of "the calendar alone." Any member that cannot improve on
   repeating last year's value for a given product is not contributing information, and we want that
   comparison available continuously rather than as a one-off study. It is wired into the automated test
   suite as a gate on model promotion (§9.2).
2. **As a stabiliser inside the ensemble.** It cannot extrapolate, cannot diverge, and cannot produce
   a negative or explosive value. For a product with a strong seasonal profile and a stable level it is
   a reasonable estimate in its own right, and its presence bounds how far the combined forecast can be
   pulled by a member that has misfitted.

---

### 4.2.5 LightGBM (global, quantile) — cross-product learning and native uncertainty

**What it models.** A single supervised regressor trained across **all products at once**, mapping the
engineered feature row to demand — and, by training separate objectives, directly to each quantile of
demand.

**Mechanism.** Gradient-boosted decision trees: an ensemble of shallow trees fitted sequentially, each
on the gradient of the loss left by its predecessors. Trained under the **pinball (quantile) loss** at
each required probability level, which produces an estimate of that quantile rather than of the mean.

| | |
|---|---|
| **Input** | The feature matrix from §3.4 — lags, rolling statistics, calendar, Fourier terms, event flags, `series_id` as a categorical |
| **Output** | One predicted value per requested quantile level, per product, per horizon step |

**Why it is in the portfolio.**

- It is the only member that learns **structure shared across products**. A winter illness period lifts
  several drug groups together; a per-series model cannot observe that because it never sees the other
  series. With `series_id` as a categorical feature the model can still express per-product behaviour,
  including the opposite-signed weekday effects of **R6**, while pooling everything else.
- It **accepts arbitrary covariates without redesign.** Adding weather, pollen or illness-surveillance
  data means adding columns. Every other member would need a different specification.
- It produces the **distribution directly**. The other members produce a point estimate and derive an
  interval from an assumed error distribution; quantile boosting estimates each quantile from the data,
  which matters because demand is a non-negative count with an asymmetric right tail.
- It is the member whose **cost does not grow with product count**. Fitting one model per product is
  linear in products; one global model is not. This is what allows the same architecture to serve a
  network without a re-design, and it is the reason the member is included from the start rather than
  added later.

---

### 4.2.6 Croston / TSB — the sporadic-demand route

**What it models.** Two separate processes, updated only when a sale occurs:

```
   z(t)  = smoothed size of a sale, when one happens
   p(t)  = smoothed interval between sales
   rate  = z(t) / p(t)
```

**Mechanism.** Exponential smoothing applied independently to sizes and intervals. The **TSB** variant
smooths the *probability* of demand each period rather than the interval, so the estimate decays when a
product stops selling instead of remaining frozen at its last observed rate.

| | |
|---|---|
| **Input** | `(ds, y)` for a product classified `intermittent` or `lumpy` |
| **Output** | A demand rate per period, converted to a lead-time demand distribution by simulation |

**Why it is in the portfolio.** It is the direct answer to requirement **R4**. Because it models size
and frequency separately, it can express "roughly one unit every three days" — a statement the other
members cannot make, since they model a quantity per period whose most common value is zero. TSB is
preferred over classical Croston because product discontinuation is a state this system must detect
(§9.3), and classical Croston does not decay.

---

### 4.2.7 Why several methods rather than one

**The methods encode different generative assumptions, and the eight products in this data do not
share a single one.** Requirements **R4**, **R5**, **R6** and **R7** each describe a behaviour that one
family represents well and another does not: sporadic sales, per-product seasonal phase, opposite
weekday effects, and retained outliers.

Selecting a single method would require assuming that one structural story fits every product.
Combining them (§4.3) instead treats the choice of structure as **itself uncertain**, and lets the
disagreement between members inform the width of the interval that Layer 3 consumes.

## 4.3 Combination (2.3)

| | |
|---|---|
| **Input** | Per-member quantile forecasts for a product and horizon |
| **Processing** | Take the **median across members at each quantile level**, then enforce monotonicity across quantile levels |
| **Output** | A single quantile forecast per product, horizon and grain |
| **Technology** | `numpy` |

**Design rationale.** The median is used rather than the mean because the failure mode we must protect
against is one member misfitting badly on one period — an extrapolating trend, a mis-detected
changepoint — and a mean carries that error into the result in proportion to its size, while a median
does not. Enforcing monotonicity afterwards guarantees the output is a valid distribution, since taking
medians independently at each level does not by itself preserve ordering.

Members are weighted equally at first. Where weighting is introduced it will be **bounded**, so that no
single member can approach full weight; unbounded weighting converges toward selecting one method,
which reintroduces the single-structure assumption §4.2.7 exists to avoid.

## 4.4 Uncertainty calibration (2.4)

| | |
|---|---|
| **Input** | Combined quantile forecasts; a held-out calibration window |
| **Processing** | Conformalised quantile regression — measure the empirical distribution of residuals on data the model did not see, and adjust interval widths so that the stated coverage matches achieved coverage |
| **Output** | Calibrated quantiles, plus a coverage report per product |
| **Technology** | `statsforecast`'s conformal utilities; `numpy` |

**Why the system needs this.** Layer 3 selects an order quantity by reading a specific quantile of the
demand distribution. If the distribution is too narrow, the quantity read at "95%" corresponds to a
lower true probability, and the system under-orders while displaying a service level it is not
achieving. The error is **directional and invisible** — it does not appear as a bad point forecast, and
it is worst on the products with the most uncertainty, which are the products where the decision matters
most.

Conformal prediction is used because it requires **no assumption about the shape of the error
distribution** and provides a finite-sample guarantee. Demand here is a non-negative count with an
asymmetric tail, so the Gaussian assumption behind a model's default interval is not appropriate.

The achieved-versus-stated coverage curve is surfaced in the interface (§8, screen 3) rather than kept
internal, because a confidence claim the user cannot verify is not a confidence claim.

## 4.5 Reconciliation (2.5)

| | |
|---|---|
| **Input** | Independently produced forecasts at every node of two hierarchies |
| **Processing** | MinT reconciliation with a shrinkage covariance estimator — project the independent forecasts onto the subspace where aggregation constraints hold |
| **Output** | Coherent forecasts: children sum exactly to parents in both hierarchies |
| **Technology** | `scipy.sparse` for the summing matrix; `numpy.linalg` for the projection |

Two hierarchies, one mechanism:

| Hierarchy | Levels |
|---|---|
| **Cross-sectional** | product → drug group → store → region |
| **Temporal** | day → week → month |

**Why both are required.** The three time grains answer three different operational questions — a
stockout alarm is daily, an order is weekly, a cash plan is monthly — and each grain is fitted on data
of that grain, because a model fitted on monthly observations sees a cleaner seasonal signal than one
fitted on weekly data whose short-run noise has not been aggregated away. Fitting each grain separately
is therefore deliberate, but it produces three sets of numbers that will not agree. Reconciliation
resolves that.

The shrinkage estimator is used rather than the full covariance form because the full form requires
inverting a dense matrix that is ill-conditioned when the number of series exceeds the number of
observations — the regime this system operates in.

## 4.6 Forecast store (2.6)

```sql
CREATE TABLE forecast (
  series_id      TEXT   NOT NULL,
  grain          TEXT   NOT NULL,   -- 'day' | 'week' | 'month'
  cutoff         DATE   NOT NULL,   -- last observation used
  ds             DATE   NOT NULL,   -- period being forecast
  horizon        INT    NOT NULL,   -- steps ahead
  quantile       DOUBLE NOT NULL,   -- 0.01 … 0.99
  value          DOUBLE NOT NULL,
  model_version  TEXT   NOT NULL,
  snapshot_id    TEXT   NOT NULL,
  PRIMARY KEY (series_id, grain, cutoff, ds, quantile)
);
```

Written to a new versioned directory each night and made live by a **single pointer update**, so a
partially-written run is never readable. `model_version` participates in the cache key (§7.2), which
makes a deployment self-invalidating.

## 4.7 Layer 2 technology summary

| Component | Library | Reason for this library |
|---|---|---|
| Prophet | `prophet` (Stan backend) | The only widely-used implementation exposing named holiday regressors and an additive component decomposition as a first-class output |
| AutoARIMA, MSTL, Seasonal naïve, Croston/TSB | `statsforecast` (Nixtla) | One consistent API across all four; Numba-compiled, so the full portfolio fits fast enough to run inside CI on every commit rather than as an offline exercise |
| Global quantile model | `lightgbm` via `mlforecast` | Native quantile objective, native categorical handling for `series_id`, and lag/rolling feature generation that is cutoff-aware by construction |
| Combination, classification | `numpy` | Small, explicit, and testable — no dependency justified |
| Calibration | `statsforecast` conformal utilities | Integrates with the same forecast objects; avoids a second modelling framework |
| Reconciliation | `scipy.sparse`, `numpy` | Summing matrices are sparse and structured; a general-purpose linear algebra dependency is sufficient |
| Experiment tracking | `mlflow` with a SQLite backend | Run comparison and a model registry with no server process to operate, which suits a short project and a free-tier deployment |

---

# 5. Layer 3 — Decision Engine

**Responsibility:** convert a demand distribution into an action, using parameters supplied by the
pharmacy.

## 5.1 Stock ledger (3.1)

| | |
|---|---|
| **Input** | Goods receipts, sales postings, write-offs, physical stock counts |
| **Processing** | Maintain a running balance per product: `opening + received − sold − wastage ± adjustment` |
| **Output** | `stock_on_hand`, plus derived indicators below |
| **Technology** | PostgreSQL (or SQLite) — an event table plus a materialised current-balance view |

| Derived indicator | Definition |
|---|---|
| **Days of cover** | `stock_on_hand ÷ forecast mean daily demand` |
| **Reorder point** | the quantile of demand over the lead time at the configured service level |
| **Status** | `OK` · `watch` · `order now` · `overstocked`, from position relative to reorder point and maximum |
| **Projected stockout date** | first date at which cumulative forecast demand exceeds `stock_on_hand` |

**Data sourcing.** In production the sales feed is the POS system and receipts come from delivery
notes. For this build, the sales feed is the historical daily file **replayed in sequence** (§8), and
receipts are entered through a settings screen. This is a transactional store rather than an analytical
one, so it uses a row-oriented database with real transactions — the requirement is correctness of a
running balance under concurrent writes, not scan throughput.

## 5.2 Order calculation (3.2)

| | |
|---|---|
| **Input** | Calibrated demand distribution over the lead time; `stock_on_hand`; cost parameters; pack size |
| **Processing** | Newsvendor critical fractile, then integerisation |
| **Output** | `order_quantity`, `expected_cost`, `P(stockout)`, and the cost at ±1 pack |
| **Technology** | `numpy`; a pure function with no I/O, unit-tested against closed-form cases |

```
   q*        = Cu / (Cu + Co)                    # target service probability
   target    = quantile(lead_time_demand, q*)    # units needed to meet it
   order     = round_to_pack(target − stock_on_hand)
```

Where `Cu` is the cost of being one unit short (lost gross margin) and `Co` the cost of one unit
excess (carrying charge plus expiry risk).

**Design rationale.** The critical fractile has a closed form, so the calculation is a single quantile
lookup rather than an optimisation. That is what allows the service-level control in the interface to
recompute the order and its cost continuously as the user moves it — an interactive control is only
possible if the underlying computation is O(1).

Rounding is to the pack, and **in the direction implied by the cost ratio** rather than to nearest,
because the two rounding errors are not equally expensive.

## 5.3 Risk detection (3.3)

| | |
|---|---|
| **Input** | Forecast distribution, stock position, order history |
| **Processing** | Evaluate four rules per product and attach a probability and a monetary exposure to each |
| **Output** | A ranked risk list |
| **Technology** | `numpy`; rules expressed declaratively so thresholds are configuration, not code |

| Risk | Rule |
|---|---|
| **Stockout** | `P(lead-time demand > stock_on_hand)` exceeds a threshold |
| **Overstock** | days of cover exceeds a configured maximum |
| **Expiry exposure** | projected sell-through date is later than the nearest batch expiry |
| **Demand anomaly** | the most recent observation falls outside the forecast's own interval |

Ranking is by **monetary exposure rather than by probability**, because a 30% chance of running out of
the highest-volume product matters more to a buyer than a 90% chance on a product that sells twice a
month.

## 5.4 Recommendation builder (3.4)

Converts risks into proposed actions: *order now*, *order early* (a known seasonal build-up begins
within the lead time), *do not order*, *transfer from another store*, *slow mover — consider markdown*.

Each recommendation carries the inputs that produced it, so the interface can show its basis rather
than presenting it as an unexplained instruction.

---

# 6. Layer 4 — Intelligence

## 6.1 Attribution engine (4.1)

| | |
|---|---|
| **Input** | A forecast and its fitted components |
| **Processing** | Two complementary decompositions — Prophet's additive components read directly, and covariate ablation: re-forecast with one driver group removed and report the difference |
| **Output** | A breakdown in **units**, summing to the total change |
| **Technology** | `prophet` component output; `shap` (TreeExplainer) for the gradient-boosted member |

**Design rationale.** The explanation is expressed in the same unit as the decision — boxes — because
the audience is a buyer choosing a quantity, not an analyst inspecting a model. A reconciliation test
asserts that the components sum to the total, so the explanation cannot drift from the number it claims
to explain.

Attribution is computed only over **observed** features (§11). A driver that does not exist in the data
cannot appear in an explanation.

## 6.2 Scenario engine (4.2)

Re-runs the forecast and decision chain under modified assumptions — a seasonal peak shifted earlier, a
doubled lead time, an assumed price elasticity — and returns both outcomes for comparison. Every
assumption used is returned with the result so the interface can display it beside the number.

**Technology:** the same forecasting code path with an override object; no separate implementation, so
a scenario cannot diverge from the live model.

## 6.3 Assistant (4.3)

| | |
|---|---|
| **Input** | A natural-language question |
| **Processing** | Resolve to a **parameterised metric query** from a fixed allowlist (series, date range, metric, comparison); execute it; pass the small result object to a language model with an instruction to describe it |
| **Output** | Prose, with the underlying figures attached |
| **Technology** | Hosted LLM API; a query-resolution layer in Python; no database credentials in the model's context |

**Design rationale.** The model is positioned as a **presentation layer over computed results**, never
as a source of figures. Language models do not compute reliably, and a number a pharmacist spends money
on must come from a code path that can be tested and reproduced. Restricting resolution to an allowlist
of parameterised queries is simultaneously the safety control — there is no query-injection surface if
the model never emits a query — and the reliability control.

---

# 7. Layer 5 — Service

## 7.1 API

Seven endpoints. The OpenAPI 3.1 document is generated from the Python type definitions, and the
frontend's TypeScript types are generated from that document, so the contract has one source.

| Endpoint | Method | Returns |
|---|---|---|
| `/forecast` | GET | quantile forecast for a product, grain and horizon |
| `/explain` | GET | attribution components and calibration diagnostics |
| `/risk` | GET | ranked risk list with probability and exposure |
| `/recommend` | POST | order quantity, timing and expected cost |
| `/simulate` | POST | scenario re-forecast plus the assumptions used |
| `/assistant` | POST | prose answer plus the figures behind it |
| `/metrics` | GET | dashboard KPIs and system-health measurements |

Every response envelope carries `origin` per value, `model_version`, `snapshot_id` and a correlation id.

```json
{
  "series_id": "N02BE",
  "grain": "week",
  "cutoff": "2019-09-29",
  "horizon": 4,
  "quantiles": { "0.05": 142.1, "0.5": 187.4, "0.95": 249.8 },
  "origin": "observed",
  "model_version": "2026-08-26T02:14Z/ens-v3",
  "snapshot_id": "sha256:9f2c…",
  "calibrated": true
}
```

**Technology:** FastAPI with Pydantic v2, served by Uvicorn. FastAPI is chosen because the schema is
derived from the same type annotations that validate requests at runtime — a contract that cannot go
stale relative to the implementation, which matters when frontend and backend are built in parallel by
different people.

## 7.2 Caching

Key: `fc:{tenant}:{series}:{grain}:{cutoff}:{model_version}:{horizon}`. Time-to-live set to the next
scheduled run.

**Technology:** Redis, with an in-process LRU as a drop-in fallback so local development needs no extra
service. Including `model_version` in the key means publishing a model invalidates the cache implicitly
rather than requiring a flush step that could be forgotten.

## 7.3 Scheduling

**Technology:** APScheduler embedded in the API process for the first delivery; Prefect if the DAG
grows enough to need retries and observability per task.

The nightly job is idempotent end to end, so a failed run can be re-executed without manual cleanup.

## 7.4 Security

| Concern | Mechanism | Technology |
|---|---|---|
| Authentication | OIDC; short-lived access tokens with rotating refresh | Auth.js on the frontend, JWT verification in FastAPI |
| Authorisation | Role checks at the route, **plus row-level security in the database** so an application bug cannot leak across tenants | PostgreSQL RLS keyed on a session variable |
| Rate limiting | Token bucket per key and per IP, tighter on compute-bearing endpoints | `slowapi` backed by Redis |
| Transport | TLS, HSTS, CSP with nonces, strict CORS allowlist | platform TLS + FastAPI middleware |
| Input validation | Typed request models; parameterised queries only | Pydantic v2 |
| Audit | Append-only, hash-chained log of every order and override: actor, timestamp, previous value, new value, reason | PostgreSQL table with a SHA-256 chain column |
| Supply chain | Pinned dependencies, secret scanning, image scanning, non-root container | `pip-audit`, `gitleaks`, `trivy` |

Authorisation is enforced in the database rather than only in application code because tenant isolation
is the one failure whose consequence is disclosure of another pharmacy's commercial data.

---

# 8. Layer 6 — Product

**Technology:** React 18 + TypeScript, built with Vite; Tailwind CSS with shadcn/ui for components;
TanStack Query for server state; Recharts for standard charts and visx for the two custom marks — the
fan chart and the calibration curve — which no chart library provides.

| # | Screen | Contents |
|---|---|---|
| **1** | **Dashboard** | Exception cards ranked by monetary exposure; KPI row; sales trend |
| **2** | **Forecast Center** | Fan chart with 50/80/95 bands; horizon control; per-member comparison overlay; grain switch (day/week/month) |
| **3** | **Explainability** | Attribution in units; seasonal decomposition; **stated-versus-achieved coverage curve** |
| **4** | **Orders & Risk** | Order table; service-level control with live cost curve; accept/override with a reason field |
| **5** | **What-if & Live Ops** | Scenario controls; **replay mode** — historical records replayed in sequence while the stock ledger depletes and risks fire |
| **6** | **Ops Console** | Response time, memory, cache hit rate, compute cost per thousand forecasts, model registry state, drift indicators |

**Interface principles.**

The dashboard opens on **exceptions, not a chart** — the buyer's question is which products need a
decision, and a time series requires them to find the answer themselves.

Every displayed figure is one interaction from its explanation, and every explanation is one further
interaction from its uncertainty.

**Replay mode** exists because the system must demonstrate behaviour over time while the available data
is historical. Replaying real records in their original order exercises the same code path a live feed
would drive, so it doubles as an integration test.

---

# 9. Robustness and operations

## 9.1 Update modes

| Mode | Trigger | Action |
|---|---|---|
| **Fast update** | new sales posted | recompute features for the affected window and re-run **inference** with the existing model |
| **Full refit** | nightly schedule | refit the portfolio, re-run evaluation, recalibrate, reconcile, publish a new version |

**Design rationale.** Separating the two keeps the system responsive without making it unstable.
Refitting on every arriving record would cause the forecast to change for reasons the user cannot
observe, and would make any figure impossible to reproduce, since the model that produced it would no
longer exist.

## 9.2 Promotion gate

A newly fitted model is a **challenger**; it replaces the champion only after passing an automated
evaluation on a fixed protocol. The gate includes the seasonal-naïve control from §4.2.4.

A failed evaluation leaves the champion in place and raises an alert. The worst outcome of a bad
nightly run is therefore forecasts that are one day old and visibly labelled as such — never fresh
forecasts that are wrong.

## 9.3 Drift monitoring

| Monitor | Signal |
|---|---|
| Rolling accuracy per product | sustained degradation against recent history |
| Feature distribution shift | population stability index against the training window |
| **Coverage drift** | achieved interval coverage departing from stated |
| Changepoint detection | level or trend break within a series |
| Demand-class transition | a product crossing an ADI/CV² boundary and needing a different route |

Coverage drift is monitored explicitly because it is the earliest available signal — the width of the
required interval changes before the central estimate visibly degrades.

## 9.4 Stress-test harness

An offline harness that takes real history, injects a **labelled synthetic disturbance** at a known
point, and reports how the system behaves afterwards.

| Scenario | Injection |
|---|---|
| Level shift | permanent step change in demand |
| Transient spike | a multiple for a fixed window, then return to normal |
| Discontinuation | demand falls to zero permanently |
| New product | history truncated to a few periods |
| Seasonal phase shift | the annual peak moved earlier |
| Data outage | a contiguous block of periods removed |
| Corrupted batch | an implausible value introduced |
| Unit change | the series rescaled, as by a pack-size change |

Reported per scenario: peak error, periods until error returns to its pre-event range, periods until a
drift monitor fires, and the false-alarm rate on an unperturbed control run.

**Why it is part of the architecture rather than a test.** The system's purpose is to keep producing
correct decisions while the world changes. That property cannot be established by evaluating on a fixed
historical split, because a fixed split contains only the disturbances that happened to occur. Injecting
them deliberately is the only way to measure the response.

---

# 10. Consolidated technology stack

| Area | Choice | Chosen because |
|---|---|---|
| **Language (backend, ML)** | Python 3.11 | The forecasting libraries the design depends on exist here and nowhere else in comparable maturity |
| **Language (frontend)** | TypeScript | The API contract is generated as types; a typed client means a contract change breaks the build rather than the demo |
| **Transformation** | pandas (Polars if profiling justifies) | Ubiquitous, and every team member can modify it without a learning cost the schedule cannot absorb |
| **Analytical storage** | Parquet + ZSTD | Columnar layout matches a scan-and-group workload; compresses well; readable by every tool in the stack |
| **Analytical query** | DuckDB | SQL directly over Parquet with no server, no port and no credentials — identical behaviour on a laptop, in CI and in a container |
| **Operational storage** | PostgreSQL (SQLite for local) | Settings, orders, overrides and the audit chain need transactions and row-level security; this is a row-oriented workload, not an analytical one |
| **Data contracts** | pandera | Schema assertions expressed as code, runnable both inside the pipeline and as tests |
| **Statistical models** | statsforecast | One API across AutoARIMA, MSTL, seasonal naïve and Croston/TSB; Numba-compiled, so the whole portfolio fits inside a CI run |
| **Decomposition model** | prophet | Named holiday regressors and an additive component decomposition exposed as output, which the attribution feature consumes directly |
| **Machine-learning model** | LightGBM via mlforecast | Native quantile objective, native categorical features, and cutoff-aware lag generation |
| **Calibration** | conformal utilities in statsforecast | Distribution-free; no second modelling framework introduced |
| **Reconciliation** | scipy.sparse + numpy | Summing matrices are sparse and structured; no specialised dependency needed |
| **Explanation** | shap (TreeExplainer) + prophet components | Two complementary views over the two model families that support them |
| **Experiment tracking** | MLflow, SQLite backend | Run comparison and a model registry with no server to operate |
| **Scheduling** | APScheduler (Prefect if the DAG grows) | Embedded, no broker, adequate for a single nightly DAG |
| **API** | FastAPI + Pydantic v2 + Uvicorn | Schema generated from the same annotations that validate at runtime, so the contract cannot drift |
| **Cache** | Redis (in-process LRU fallback) | Key includes the model version, making deployment self-invalidating |
| **Frontend framework** | React 18 + Vite | Fast iteration; the largest pool of familiarity in the team |
| **Styling / components** | Tailwind + shadcn/ui | A consistent component set without designing one, which the schedule does not allow for |
| **Charts** | Recharts + visx | Recharts for standard marks; visx for the fan chart and calibration curve, which are not standard |
| **Server state** | TanStack Query | Caching, retry and invalidation handled once rather than per screen |
| **Containers** | Docker + Compose | One command brings the whole system up, which is also how CI runs it |
| **CI** | GitHub Actions | Lint, type-check, tests, data contracts, evaluation gate, image scan, deploy on every push |
| **Hosting** | Vercel (web) · Render or Fly.io (API) | Free tier, public HTTPS, and no infrastructure to operate during a short build |
| **Observability** | OpenTelemetry + prometheus-client + structured JSON logs | Traces span frontend to model; ML-specific metrics sit alongside service metrics rather than in a separate system |
| **Quality gates** | ruff, mypy, pytest, hypothesis | Static and property-based checks on the pure functions where correctness is load-bearing — the decision arithmetic in particular |

### Repository layout

```
  pharmapulse/
    pipelines/        ingest · validate · clean · features · forecast · publish
    core/             classifier · portfolio · combiner · calibrator · reconciler
    decision/         ledger · newsvendor · risk rules · recommendations
    api/              FastAPI app, routers, schemas, auth, rate limiting
    web/              React application
    data/
      observed/       the real dataset
      synthetic/      demonstration data — the trainer refuses this path
    tests/            unit · property · contract · evaluation · chaos
    infra/            Dockerfiles, Compose, CI workflows
```

---

# 11. Data provenance rules

The dataset supplies dates and quantities. It does not supply stock, lead time, cost, price,
promotion, region or distributor. The architecture therefore distinguishes three classes of value,
with different permissions.

| Lane | Contents | May train a model | May appear in an explanation | May support an accuracy claim |
|---|---|---|---|---|
| **`observed`** | the sales history and calendar features derived from it | **yes** | yes | **yes** |
| **`user_setting`** | lead time, holding cost, margin, stock on hand, pack size | no | yes, as a named input | no |
| **`synthetic`** | the demonstration store network | **no** | no | no |

**Enforcement.**

- `data/observed/` and `data/synthetic/` are separate roots; the training entry point takes a path and
  raises on a synthetic path, asserted by a test.
- `origin` is a column on every gold and forecast row (§3.5, §4.6) and is returned by the API, so the
  interface renders it rather than inferring it.
- Evaluation artefacts filter on `origin = 'observed'` in code.
- Synthetic content is watermarked wherever it is displayed.

**Two consequences.**

**Price and promotion are excluded as model features.** No such column exists, so a fitted coefficient
on a generated one would describe noise, and §6.1 would then present that noise to a buyer as a
commercial driver. They remain available as scenario levers, with the assumed elasticity displayed.

**Settings are a legitimate input, not a substitute for data.** No inventory system knows a pharmacy's
lead time or cost of capital; all of them ask. Defaults ship so the system is usable immediately.

---

# 12. Delivery plan and ownership

## 12.1 Sequence

| Stage | Components | Complete when |
|---|---|---|
| **Foundation** | 1.1 – 1.5; API contract and gold schema frozen | The gold table is reproducible from the raw file, and both contracts are committed |
| **Vertical slice** | 2.1, 2.2, 2.6, `/forecast`, screens 1 and 2 | One product, one model, one endpoint, one chart, end to end on the deployed URL |
| **Core** | 2.3 – 2.5, 3.1 – 3.2, `/recommend`, screen 4 | A buyer can move the service-level control and see the order and cost change |
| **Depth** | 3.3 – 3.4, 4.1, 9.1 – 9.3, security, screens 3 and 6 | Explanations, risks, monitoring and the operations screen are live |
| **Extension** | 4.2, 4.3, 9.4, replay mode, screen 5 | Only after everything above is merged and deployed |

**Extension items are cut rather than carried.** An unfinished component is removed at the last
checkpoint before delivery; the cost of removing one is zero and the cost of debugging one under time
pressure is the demonstration.

## 12.2 Ownership

| Owner | Components |
|---|---|
| **Data & platform** | 1.1 Ingestion · 1.2 Validation · 1.3 Cleaning · containers · CI · deployment |
| **Modelling lead** | 2.1 Classifier · 2.2 Portfolio · evaluation protocol · 9.2 Promotion gate |
| **Models & uncertainty** | 1.4 Features · 2.3 Combination · 2.4 Calibration · 9.3 Drift monitoring |
| **Explanation & scenarios** | 2.5 Reconciliation · 4.1 Attribution · 4.2 Scenarios · 4.3 Assistant |
| **Service & decisions** | 3.2 Order calculation · 7.1 API · 7.2 Cache · 7.3 Scheduling |
| **Security & robustness** | 7.4 Security · 9.1 Update modes · 9.4 Stress harness · load testing |
| **Interface lead** | Screens 1, 2, 4 · design system · shared components |
| **Interface & visualisation** | Screens 3, 5, 6 · chart primitives · replay mode |

## 12.3 Interfaces frozen first

Three contracts are agreed and committed before parallel work begins, so that no component waits on
another:

| Contract | Between |
|---|---|
| **Gold table schema** (§3.5) | Data & platform → all modelling |
| **OpenAPI document and generated types** (§7.1) | Service → both interface roles |
| **Metrics payload shape** (§7.1 `/metrics`) | Security & robustness → interface & visualisation |

Each is developed against fixtures and mock servers until the real implementation lands.

---

> ### **The system's output is not a forecast. It is a purchase quantity, a probability, and the reason behind both.**
