# PharmaPulse — Project Brief

> **Paste this file into your coding agent first, then paste your pod's file.
> Nothing else is required context.**

---

## 1. What we are building

**PharmaPulse turns six years of pharmacy sales history into one number a buyer can act on: how
many boxes of each medicine to order this week.**

The chain, and the forecast is only the middle of it:

```
history  →  forecast  →  uncertainty  →  order quantity  →  cost of being wrong
```

A system that stops at "forecast" leaves the hard half to the user. The buyer still has to decide
what "187 units" means when delivery takes four days, they hold 40, and running out costs more than
over-ordering. **The purchase order is the product.**

**The maths of the last step (the newsvendor problem):** if being one unit short costs `Cu` and
being one unit over costs `Co`, the optimal quantity is the demand level you meet with probability
`q* = Cu / (Cu + Co)`. This is why the forecast must be a **distribution, not a number** — and it is
why the demo centrepiece is a slider labelled *"how often am I willing to run out?"* that moves `q*`,
which moves the order quantity and the expected cost, live.

**Hackathon:** Cognizant campus drive. **Use case:** Healthcare — Pharma Sales Analysis &
Forecasting. **Time:** 4 days. **Team:** 8 people in 4 pods of 2, plus a lead.

---

## 2. The data — and the seven facts that shape every design decision

Kaggle *Pharma Sales Data* (milanzdravkovic). Point-of-sale records from **one pharmacy**,
**2 January 2014 → 8 October 2019**, **2,106 daily rows**, **8 ATC-2 drug groups**, units dispensed.
No patient, prescriber, or transaction identifiers — **no personal data at all.**

| ATC | What it is | Daily mean | Zero-sale days |
|---|---|---|---|
| M01AB | Anti-inflammatory, acetic acid (diclofenac) | 5.03 | 1.9% |
| M01AE | Anti-inflammatory, propionic acid (ibuprofen) | 3.90 | 1.7% |
| N02BA | Salicylic acid derivatives (aspirin) | 3.88 | 3.7% |
| N02BE | Anilides (paracetamol) — largest by volume | 29.92 | 1.2% |
| N05B | Anxiolytics | 8.85 | 2.0% |
| N05C | Hypnotics and sedatives | 0.59 | **67.9%** |
| R03 | Obstructive airway drugs (asthma, COPD) | 5.51 | 23.0% |
| R06 | Antihistamines | 2.90 | 12.2% |

**The findings you must not design around:**

1. **The supplied monthly file is corrupt.** `salesmonthly.csv` reports January 2017 as ~zero for
   seven of eight groups; the daily file totals ~2,700 units for that month. 53 series-months
   disagree by >5%. → **We ingest `salesdaily.csv` only and derive weekly and monthly ourselves.**
2. **26 days are closures, not zero demand.** All eight groups read exactly 0. 21 of 26 map to the
   Serbian Orthodox calendar (7 January, all six Orthodox Easters, 19 December St. Nicholas, New
   Year, 1 May). → **Mark `is_closed`, mask from the training loss. Never impute, never delete.**
3. **The last bucket is truncated.** Data stops 8 October 2019. October looks like a 70% collapse
   and is not. → **Track `completeness` per period; exclude partial periods from fitting; render
   them hatched and labelled "partial" rather than hiding them.**
4. **N05C is genuinely intermittent** (67.9% zero days, ADI 3.12). Smooth models return a flat
   fractional line on it. → **A demand-class router sends it to Croston/TSB.**
5. **Units are fractional** — only 14.1% of M01AE daily values are whole numbers. Forecasts are
   continuous; **orders are not.** → Pack rounding in the decision layer.
6. **Seasonality has a different phase per drug** — R06 peaks in May (1.73× annual mean, pollen),
   N02BE in January and October (flu), R03 in December. → **Per-series seasonality. One global
   seasonal profile smears all four peaks.**
7. **Weekday effects run in opposite directions** — N02BE (OTC) sells more at weekends, N05B
   (prescription) sells less because clinics are shut. → **Per-series day-of-week effects. A shared
   coefficient cancels and helps neither.**

Plus: **a real level shift in 2017** (N02BE 13,336 → 9,259 → 11,231 annual), and **outliers that are
events, not errors** (30–31 December 2016 New Year stock-up, January 2019 flu peak). **Flag them,
give them a calendar feature, never delete them** — a spike the model can attribute to a cause does
not become the new baseline; an unexplained one does.

---

## 3. The rule that protects the whole project — three provenance lanes

The dataset contains dates and units sold. It does **not** contain stock levels, lead times, prices,
promotions, regions, or distributors. A system that invents those and trains on them is learning
from a random number generator, and any explanation it then produces is an explanation of noise.

```
LANE 1  observed       salesdaily.csv + calendar features derived from it
        may train models            YES
        may feed explanations       YES
        may back an accuracy claim  YES

LANE 2  user_setting   lead time, holding cost, margin, stock on hand, pack size
        may train models            NO
        may feed explanations       YES, as a named input ("at your 4-day lead time")
        may back an accuracy claim  NO

LANE 3  synthetic      any demo-only generated data
        may train models            NO - blocked in code, asserted by a test
        may feed explanations       NO
        may back an accuracy claim  NO - filtered out of benchmarks.json
```

**Two hard consequences.** *Price and promotion are excluded as model features by name* — they may
appear only as what-if levers with a stated assumption. And *`data/observed/` and `data/synthetic/`
are separate roots*; the training entrypoint takes a path and **raises** on a synthetic path.

Lane 2 is not a compromise — it is how every inventory system on earth works. No software knows a
pharmacy's cost of capital; it asks. We ship defaults so the demo runs and make them editable.

> **Why this matters more than it sounds:** the fastest way to lose a technical judge is for them to
> discover that an impressive feature-importance chart was computed over invented columns. Declaring
> the lanes converts the project's biggest vulnerability into its most credible feature.

---

## 4. Architecture in one screen

```
NIGHTLY BATCH (about 4 minutes)
  salesdaily.csv + holiday calendar
     -> INGEST     checksum, idempotent upsert, append-only bronze
     -> VALIDATE   schema, row counts, completeness, daily-rollup reconciliation
     -> GOLD       ds, series_id, y, origin, is_closed, is_outlier, completeness, snapshot_id
     -> FEATURES   lags, rolling stats, Fourier, calendar, closure mask  (cutoff-aware)
     -> CLASSIFY   ADI / CV^2 -> smooth | intermittent | erratic | lumpy
     -> FIT        route to the eligible model family, fit every eligible member
     -> COMBINE    median across members, then enforce quantile monotonicity
     -> CALIBRATE  conformal correction so the stated interval is the real one
     -> RECONCILE  day/week/month must sum correctly (MinT, shrinkage)
     -> FORECAST STORE   21 quantiles, versioned, published by pointer swap

============ the line: nothing below runs a model ============

PER REQUEST (p95 under 250 ms)
  read stored distribution
     -> apply this pharmacy's stock + cost settings   [LANE 2 enters HERE and only here]
     -> newsvendor q* -> integer order quantity, cost at +/-1 pack, P(stockout)
     -> respond with origin lane, model_version, snapshot_id, correlation id
```

**Why the split.** Fitting is seconds; a lookup is milliseconds — the live slider is only possible
if the distribution is already resolved. Two users opening the same product on the same day must see
the same number. And batch work scales with products while request work scales with users.

**The model portfolio, and why each member is there:**

| Member | What it contributes that nothing else does |
|---|---|
| **Prophet** | Holidays as **named, individually fitted regressors** with asymmetric windows, and an additive trend/season/holiday decomposition that the explainability screen consumes directly. Best single model here. |
| **AutoARIMA** | Short-run autocorrelation — momentum and mean reversion. A decomposition model has no mechanism for this. |
| **MSTL** | Two seasonal cycles at once (weekly + annual), non-parametrically, with Loess down-weighting the outliers we deliberately kept. |
| **Seasonal naive** | The control. "The calendar alone." Any member that cannot beat it contributes nothing. Also a stabiliser — it cannot diverge. |
| **LightGBM (global, quantile)** | The only member that learns structure **shared across products**, takes arbitrary covariates as extra columns, produces the distribution directly from pinball loss, and whose cost does not grow with product count. |
| **Croston / TSB** | Models sale **size** and **gap** separately — the only way to express "one unit every three days" for N05C. TSB rather than Croston because it decays when a product stops selling. |

**We combine, we do not select.** Prior analysis on this data measured per-series *selection* at MASE
1.091 against *median combination* at 0.906, with a perfect-hindsight oracle at 0.883. With ~300
weekly observations, "best on the last fold" is mostly noise, so selection chases noise. Independent
models make independent mistakes and the median cancels them. **"We tested the obvious approach and
it lost" is a result; "we averaged some models" is not — same code, different claim.**

---

## 5. Repository map — and who owns what

```
pharmapulse/
  CONTRACTS.md          THE frozen interfaces. Read before coding. Lead owns.
  docs/                 The submitted design documents. Lead owns. DO NOT EDIT.
  team/                 These briefs.
  contracts/
    schemas/            gold.sql, forecast.sql
    fixtures/           mock API responses - Pod D builds against these from hour one
    openapi.json        generated by Pod C
  data/
    observed/           salesdaily.csv  (lane 1)
    synthetic/          demo-only data  (lane 3, blocked from training)
    warehouse/          gold/, features/, forecast/, ops.db   (gitignored)
  pipelines/            POD A   ingest, validate, clean, features, nightly runner
  core/                 POD B   classify, portfolio, combine, calibrate, reconcile,
                                forecast_store, backtest, explain
  decision/             POD C   ledger, newsvendor, risk, recommend
  api/                  POD C   FastAPI app, routers, schemas
  web/                  POD D   React application
  scripts/              shared  check_data, day1_benchmark, make_fixtures, dump_openapi
  tests/                everyone writes tests for their own folder
  infra/                POD A   Dockerfiles, compose, CI workflows
  artifacts/            benchmarks.json - written ONLY by day1_benchmark.py
```

| Pod | Owns these paths | Never edits |
|---|---|---|
| **A — Data & Platform** | `pipelines/ infra/ scripts/check_data.py data/` | everything else |
| **B — Forecast Engine** | `core/ scripts/day1_benchmark.py artifacts/` | everything else |
| **C — Decision & API** | `decision/ api/ scripts/dump_openapi.py scripts/make_fixtures.py` | everything else |
| **D — Product** | `web/` | everything else |

**Need a change in someone else's folder? Ping the owner. Do not "just fix it."** In a 4-day sprint
with 8 people, cross-folder edits are the single largest source of lost time.

---

## 6. Non-negotiables

1. **`make benchmark` reproduces every accuracy number in the deck from a clean clone.** No number on
   a slide or on the Ops Console is typed by a human. That sentence is said out loud in the demo, so
   it has to be true.
2. **No leakage.** Every feature is computed as of an explicit `cutoff`. `tests/unit/test_no_leakage.py`
   asserts a feature at time *t* is identical whether or not rows after *t* exist. **If that test is
   red, every number we report is meaningless.**
3. **The 2019 holdout (`ds >= 2019-07-01`) is touched exactly once, on Day 4.** That number is final.
4. **Losses go on the slide next to wins.** The ensemble loses to seasonal naive on M01AE (1.061 vs
   1.015); R06 is our worst series. Report both. A team that reports only wins gets discounted, and
   experienced judges do it fast.
5. **The deepest limitation, stated out loud:** we forecast *sales*, not *demand*. A stockout records
   zero sales, indistinguishable from zero demand, so observations are right-censored — worst on
   exactly the products that matter most. We flag suspicious ceilings; we cannot verify without an
   inventory column this dataset does not have. **It goes in the model card and in the demo script.**
6. **Every displayed figure is one click from why, and every why is one click from how confident.**
7. **The dashboard opens on exceptions, never on a chart.** *"Three things need your decision today,
   worth ₹18,400"* has already done the work a time series makes the user do.

---

## 7. Working agreements

- **Trunk-based.** Branch `pod-x/short-name`, PR under ~400 lines, one approval, CI green to merge.
  `main` is always deployable and always deployed.
- **Review inside 30 minutes** during working hours. A blocked teammate is the most expensive thing
  in a 4-day sprint.
- **Daily rhythm:** standup 09:30 · sync 14:00 · **working-software demo 20:00**. Nothing is "done"
  until it is merged and visible in the deployed app.
- **Named backup per pod** so nobody is the only person who can run the demo.
- **Banned:** notebook-only work after Day 1 · "I'll integrate at the end" · touching the holdout
  early · two people silently building the same component.
- **Anything unmerged at the Day-3 feature freeze is deleted, not carried.** Deleting a half-built
  feature is free. Debugging one at 3 a.m. costs the demo.

---

## 8. Where to look things up

| Question | File |
|---|---|
| What exactly does my pod build? | `team/0X_POD_*.md` |
| What shape does X have? | `CONTRACTS.md` — the only authority |
| Why was this designed this way? | `docs/PHARMAPULSE_CONCEPT.md` |
| What number can I defend, and how? | `docs/PHARMAPULSE_ARCHITECTURE.md` |
| What are we cutting, and when? | `team/06_PLAN_AND_CUTS.md` |
| How do I run the whole thing? | `team/05_INTEGRATION_DOCKER_OPS.md` |

> **The first slide:**
> ### *Every pharmacy guesses how much to order. We calculate it — with the odds, the cost of being wrong, and the reason behind the number.*
