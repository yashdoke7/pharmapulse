# PharmaPulse Glossary

A quick reference for the core forecasting, inventory, and provenance terms used
in PharmaPulse.

For any term in the context of the screen it appears on, see
[WEB_REFERENCE.md](WEB_REFERENCE.md).

---

## MASE — Mean Absolute Scaled Error

**Mean Absolute Scaled Error** measures forecast error relative to a naive
forecasting baseline.

* **Lower is better.**
* Absolute forecast errors are divided by the **in-sample mean absolute one-step
  difference** of the training data — that is, `mean(|y[t] − y[t−1]|)` computed
  over the training window, never the test window.
* That denominator is what makes the number interpretable rather than merely
  comparable: **MASE = 1.0 means "no better than assuming next week equals this
  week."** Below 1.0 beats that baseline; above 1.0 is worse than it.
* PharmaPulse uses MASE rather than MAPE because MAPE divides by the actual
  value and is undefined when demand is zero — and one product sells nothing on
  67.9% of days.

*Code: `core/backtest.py::mase_denominator` (m = 1).*

## ADI — Average Demand Interval

**Average Demand Interval** is the average number of periods **between**
non-zero sales, computed as `periods ÷ non-zero periods`.

It is an *interval*, not a rate: **a higher ADI means longer gaps and less
frequent demand.** An ADI of 1.0 means the product sells every period; N05C's
daily ADI of 3.12 means roughly one selling day in three.

Used with CV² to classify demand patterns. Routing threshold: **ADI = 1.32**.

## CV² — Squared Coefficient of Variation

**CV²** is the squared coefficient of variation of the **non-zero** demand
quantities. It measures variability in demand *size*.

The pairing matters: ADI separates irregular **timing**; CV² separates erratic
**size**. Used together they place every product in one of four quadrants.
Routing threshold: **CV² = 0.49**.

## Demand class

The **demand class** is the quadrant that ADI and CV² place a product in — the
Syntetos–Boylan scheme. It decides which models the product is routed to.

| | CV² < 0.49 | CV² ≥ 0.49 |
|---|---|---|
| **ADI < 1.32** | **smooth** — sells most days, stable sizes | **erratic** — steady timing, wild sizes |
| **ADI ≥ 1.32** | **intermittent** — long gaps between sales | **lumpy** — irregular timing *and* wild sizes |

It is **recomputed every night, per grain**, from the data — never configured,
and nothing is hardcoded to a product name. Aggregation removes sparsity, so a
product can be intermittent daily and smooth weekly; N05C is exactly that.

*Code: `core/classify.py::ROUTES`.*

## Croston / TSB

Forecasting methods built for **intermittent** demand. Instead of modelling the
quantity directly, they model two separate processes: the **size** of a sale and
the **gap** between sales.

They exist in the portfolio because averaging methods applied to a series that
is zero most days return the mean rate — a flat, fractional, non-actionable
line.

## Ensemble

The **ensemble** is the forecast PharmaPulse ships: the **median** of five
independently fitted models — `Prophet · AutoARIMA · MSTL · SeasonalNaive ·
LightGBM` — the same five for every product.

Median, not mean, and **not best-of-five**. We built per-series selection and
measured it losing: **0.968 against 0.907**. With ~300 weekly observations,
"best on the last fold" is mostly noise, so selection chases noise; independent
models make independent mistakes and the median cancels them.

## Rolling-origin cross-validation

The evaluation protocol. The model is repeatedly fitted on data up to a cutoff
and scored on what follows, with the cutoff rolling forward — so it **only ever
sees data from before the point it is forecasting.**

PharmaPulse uses 4 non-overlapping folds, weekly grain, horizon 8, seed 42.

## Oracle

The score achievable with **perfect hindsight** — always picking the best model
after seeing the answer. **A bound, not a model** (0.843). It is reported so a
reader knows how much room is left, and it can never be shipped.

## Protection interval

The **protection interval** is the period an order needs to cover in a
periodic-review inventory system.

```
Protection interval = Lead time + Review period
```

A 4-day lead time and a 7-day review period gives an **11-day protection
interval**. If you order today, the stock must last until the *next* order
arrives — not just until this one does.

Sizing against the lead time alone was a real bug; it surfaced as persistent
stockouts, and fixing it took the simulated shortfall from 2,207 units to 121.

## Critical fractile

The **critical fractile** is the target probability that balances the cost of
under-ordering against the cost of over-ordering.

```
q* = Cu / (Cu + Co)
```

* **`Cu`** — the **unit gross margin**: the profit lost when a customer asks and
  you do not have it.
* **`Co`** — the carrying charge over the protection interval **plus expiry
  write-off risk**:

  ```
  Co = unit_cost × holding_rate × (lead_time ÷ 365) + unit_cost × expiry_rate
  ```

The expiry term matters in a pharmacy and is not optional. The resulting
probability selects the corresponding demand quantile.

## Newsvendor

The **newsvendor** is the inventory framework for choosing an order quantity
when demand is uncertain and shortage and overstock cost different amounts.

It is a hundred years old and **exact** — not an approximation and not a
heuristic. Because it is closed form, the service-level slider recomputes in the
browser with no network call.

PharmaPulse reads the critical fractile's quantile off the forecast distribution
and applies pharmacy-specific cost settings to get the target order quantity.

## Conformal prediction

**Conformal prediction** calibrates forecast intervals so their achieved
coverage matches the stated confidence level.

* It is **distribution-free** — it assumes nothing about the shape of the
  residuals, which is the reason it was chosen over parametric widening.
* Historical residuals on data the model did not see are standardised, and the
  empirical quantile is compared to the assumed one to give a scale factor.
* The factor is **clamped to [0.25, 5.0]**, so one badly behaved series cannot
  destroy every interval.

Measured on this dataset: a stated 80% interval covered **92.2%** of outcomes —
too *wide*, which sounds like the safe direction and is not, because an
over-wide interval pushes the order quantity up. Correction brings it to
**82.0%**.

## Interval coverage

The proportion of outcomes that actually fell inside a stated interval. If the
system says "80% confident" and is honest, coverage is 80%. **Above** the stated
level means intervals are too wide (over-orders, ties up cash); **below** means
over-confident (runs out).

## Lane

A **lane** identifies the provenance and permitted use of every value in the
system.

| Lane | What it is | Trains a model | Explains | Backs an accuracy claim |
|---|---|---|---|---|
| **1 — observed** | real sales history and features derived from it | **yes** | yes | **yes** |
| **2 — user setting** | lead time, holding cost, margin, stock on hand, pack size | **no** | yes, as a named input | **no** |
| **3 — synthetic** | generated data used for demonstration | **no** | **no** | **no** |

**Enforced in code, not by policy** — which is the part that matters:

* `pipelines/ingest.py` **raises** on a synthetic path loaded under any other
  lane. Loading lane 3 is allowed; loading it *silently* is not.
* `pipelines/validate.py` refuses a **mixture** of lanes in one batch. A frame
  that is mostly real with some invented rows produces a number nobody can
  characterise.
* Every row carries an `origin` column, the forecast store records the lane it
  was fitted on, the API returns it on every response, and the interface renders
  it as a badge that turns amber when it is not `observed`.

## as_of — the system's clock

**The day the system is deciding for: the day after the last observation.**

It is *not* the browser's date. A buyer decides for the next period, not for
whenever the page was opened. It moves on its own when a different dataset is
published — `2019-10-09` on the real file, `2026-10-01` on the synthetic
extension, with nothing configured.

Shown on the Decisions screen as **"Deciding for · 9 October 2019"**.

## Snapshot ID

A **SHA-256 hash of the input file**, carried on every row and recorded in the
forecast store. If the data changes, the hash changes, and every claim tied to
it is visibly a claim about different data.

## Reorder point, target level, days of cover

* **Days of cover** — current stock ÷ average daily demand. How long the shelf
  lasts if nothing arrives.
* **Reorder point** — the position at which an order must be placed. It covers
  demand over the protection interval *plus safety stock*, which is why a slow
  mover can show 23 days of cover and still say "order now".
* **Target level** — the position to order *up to*: the critical fractile's
  quantile of protection-interval demand.

## Pack rounding

Medicines come in packs; you cannot order 23.4 units. The quantity is rounded to
a whole number of packs — **up when `Cu ≥ Co`**, because rounding up is correct
when running out is the more expensive mistake.

## Lost margin · holding · units unsupplied

The three components of the replay's cost comparison.

* **Lost margin** — demand arrived and there was nothing to sell, charged at the
  unit margin. This is the number that dominates.
* **Holding** — stock that sat on the shelf overnight, charged at the annual
  holding rate plus expiry risk.
* **Units unsupplied** — total units of real demand that could not be met.

Where PharmaPulse is cheaper, its **holding cost is higher** — the saving comes
entirely from running out less often, and a test asserts that relationship so
the claim cannot quietly invert.

## Degradation ladder

The defined sequence of fallbacks when something upstream is missing. If the
forecast store is absent, the API serves captured fixtures and sets
`meta.degraded = "fixtures"`, which the interface renders as a badge.

**The app always runs; it just tells you what it is running on.**
