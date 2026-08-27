# PHARMAPULSE — Architecture (final)

> **PharmaPulse turns six years of pharmacy sales history into one number a buyer can act on:
> how many boxes of each medicine to order this week.**
>
> It forecasts demand, says how confident it is, converts that confidence into a purchase quantity
> using the pharmacy's own costs, explains where the number came from, and reports honestly on its
> own accuracy, latency and resource use.

**The document set — read the right one for the job:**

| File | What it is | Use it for |
|---|---|---|
| **`PHARMAPULSE_CONCEPT.md`** | The design proposal. Component by component: inputs, processing, outputs, and the technology chosen for each. No measurements. | Presenting the plan · onboarding a teammate · deciding what to build |
| **`PHARMAPULSE_ARCHITECTURE.md`** *(this file)* | The engineering reference. Measured results, failure modes, evaluation design, self-critique. | Implementation decisions · defending a number · the Q&A |
| **`pharmapulse_architecture.svg`** | The system diagram. Component numbers match both documents. | Slides · README |
| **`mkdiagram.py`** | Diagram source. Edit the content lists, re-run, layout recomputes. | Keeping the diagram current |
| **`day1_benchmark.py`** | Reproduces every accuracy figure in this file from a clean clone. | Verifying before building on a number |
| **`artifacts/benchmarks.json`** | Machine-generated metrics the Ops Console reads. **Never hand-edited.** | Wiring the Ops Console |

**Component numbering is shared across all three artefacts.** `2.3 Combiner` means the same thing in
the diagram, in the proposal, and here.

---

## Document map

| Part | Contents |
|---|---|
| **I** | Why this exists — the decision being made, and what the data actually contains |
| **II** | What the user gets, screen by screen |
| **III** | ★ The data model — one source of truth, and the provenance rule |
| **IV** | ★ Forecasting: router, portfolio, combiner, calibrator, decision engine, planning horizons |
| **V** | The product surface — screens, live stock position, replay mode |
| **VI** | API |
| **VII** | Execution — batch vs request, latency, degradation, security, ★ new data, stress testing, ★ failure-mode catalogue |
| **VIII** | ★ The complete pipeline, wired end to end |
| **IX** | Build — stack, phases, team |
| **X** | Evaluation |
| **XI** | ★ Self-critique — the weakest points, stated before anyone else finds them |
| **XII** | Risks |

## Component index

Where each numbered component is specified (`PHARMAPULSE_CONCEPT.md`) and where its engineering detail
lives (this file).

| # | Component | Proposal | Engineering detail here |
|---|---|---|---|
| 1.1 | Ingester | Concept §3.1 | §3.1 one source of truth · §7.8 rows 1, 14–16 |
| 1.2 | Validator | Concept §3.2 | §3.4 quality gates · §7.8 rows 9, 13 |
| 1.3 | Cleaner | Concept §3.3 | §1.4 findings · §7.8 rows 2, 3, 6 |
| 1.4 | Feature Builder | Concept §3.4 | §4.x anti-leakage rules |
| 1.5 | Gold Store | Concept §3.5 | §3.3 gold schema |
| 2.1 | Demand Classifier | Concept §4.1 | §4.3 routing · §7.8 row 4 |
| 2.2 | Model Portfolio | Concept §4.2 | §4.1, §4.3 |
| 2.3 | Combiner | Concept §4.3 | §4.1 combination vs selection |
| 2.4 | Calibrator | Concept §4.4 | §4.4 calibration |
| 2.5 | Reconciler | Concept §4.5 | §4.5 coherence · §4.9 planning horizons |
| 2.6 | Forecast Store | Concept §4.6 | §7.1 batch/serve split |
| 3.1 | Stock Ledger | Concept §5.1 | §5.4 live stock position |
| 3.2 | Order Calculator | Concept §5.2 | §4.6 decision engine |
| 3.3 | Risk Detector | Concept §5.3 | §5.1 screen 4 |
| 3.4 | Recommendation Builder | Concept §5.4 | §5.4 suggestions table |
| 4.1–4.3 | Intelligence | Concept §6 | §4.7 attribution · §5.3 assistant |
| 5.x | Service | Concept §7 | Part VI API · §7.2 latency · §7.5 security |
| 6.x | Product | Concept §8 | §5.1 screens · §5.5 replay mode |
| 9.x | Robustness | Concept §9 | §7.6 new data · §7.7 stress harness · §7.8 failure modes |

---

# PART I — WHY THIS EXISTS

## 1.1 The problem: the order is guessed, not calculated

**Every week, somebody in a pharmacy decides how much of each medicine to buy.** That decision is
made from memory, a wall chart, or a spreadsheet of last month's sales.

**Getting it wrong costs money in two directions at once.**

| Direction | What happens | What it costs |
|---|---|---|
| **Too little** | A patient asks for a medicine you don't have. They go to the pharmacy across the road. | The lost sale, and often the customer permanently |
| **Too much** | Cash sits on a shelf. Medicines reach their expiry date. | Holding cost on capital, plus a total write-off at expiry |

**The scale of the second one is documented.** US hospitals discard roughly **$3 billion** of
medication annually. One mid-size Boston hospital reported **~$200,000/year** in expired drugs alone;
a single cardiac-OR refrigerator at Sentara Norfolk General ran **$70,000/year** in expirations before
intervention.

**And the fix is proven to pay.** Brigham and Women's Hospital cut expired medications by **91.6%**
(over $20,000/month saved). OhioHealth Riverside Methodist reported **41%** less drug waste. The lever
works. What is missing at the retail-pharmacy tier is the forecast quality upstream of it.

**The first direction is worse, because it is invisible.** A stockout never appears in sales data —
by definition, nothing was sold. So a system that only reads sales history systematically
under-forecasts exactly the products that run out most often, which causes more stockouts. We handle
this explicitly and we state its limits honestly (§11.3).

## 1.2 The thesis

> ### A forecast is not the product. The purchase order is the product.

The brief asks for "sales analysis and forecasting … to optimise sales strategies, inventory
management, and resource allocation." **Forecasting is the middle of that sentence, not the end.**
The end is inventory.

So PharmaPulse is built as a chain, and the forecast is one link in it:

```
   history  →  forecast  →  uncertainty  →  order quantity  →  cost of being wrong
```

**A system that stops at "forecast" leaves the hard, valuable half of the problem to the user.** The
buyer still has to decide what a prediction of 187 units means when the delivery takes four days, they
have 40 in stock, and running out costs more than over-ordering.

## 1.3 Why the last step is where the value is

The mathematics of the last step is a hundred years old and it is exact.

> **The newsvendor problem.** If understocking one unit costs `Cu` and overstocking one unit costs
> `Co`, the optimal quantity is the demand level you will meet with probability
> `q* = Cu / (Cu + Co)`.

**This is why the forecast must be a range, not a number.** If understocking costs three times as much
as overstocking, `q* = 3/(3+1) = 0.75` — you order the amount you'd exceed only 25% of the time. That
question is unanswerable from a single point forecast, and answerable in one line from a distribution.

**It also gives the product its central control.** A slider labelled *"how often am I willing to run
out?"* moves `q*`, which moves the order quantity and the expected cost, live. **That slider is the
demo.**

## 1.4 ★ What the dataset actually contains

**We profiled the files before designing anything.** Everything below is measured, and the profiling
script is in the repo.

| | |
|---|---|
| Source | Kaggle — *Pharma Sales Data* (milanzdravkovic). Point-of-sale records from a single pharmacy |
| Period | **2 January 2014 → 8 October 2019** |
| Grains supplied | hourly (50,532 rows), daily (2,106), weekly (302), monthly (70) |
| Series | **8 ATC-2 drug groups**, in units dispensed |
| Personal data | **none.** Aggregated counts only. No patient, no prescriber, no transaction id |

### The eight series

| ATC | What it is | Daily mean | Days with zero sales |
|---|---|---|---|
| **M01AB** | Anti-inflammatory, acetic acid derivatives (diclofenac) | 5.03 | 1.9% |
| **M01AE** | Anti-inflammatory, propionic acid derivatives (ibuprofen) | 3.90 | 1.7% |
| **N02BA** | Salicylic acid derivatives (aspirin) | 3.88 | 3.7% |
| **N02BE** | Anilides (paracetamol) — the largest by volume | 29.92 | 1.2% |
| **N05B** | Anxiolytics | 8.85 | 2.0% |
| **N05C** | Hypnotics and sedatives | 0.59 | **67.9%** |
| **R03** | Obstructive airway drugs (asthma, COPD) | 5.51 | 23.0% |
| **R06** | Antihistamines for systemic use | 2.90 | 12.2% |

### ★ Nine findings that changed the design

**1 — One of the supplied files is corrupt.**
`salesmonthly.csv` reports **January 2017 as zero** for seven of the eight categories and 1.0 for the
eighth. The daily file for that same month totals **2,700 units**. Checked systematically, **53
series-months** in the monthly file disagree with a rollup of the daily file by more than 5%. The
weekly file is clean — **0 disagreements out of 2,416** buckets checked.

> **This is why §3.1 exists.** We read the daily file and derive everything else. It costs one line of
> code and it is the difference between a correct system and one trained on a month that never happened.

**2 — 26 days are closures, not zero demand.**
On 26 days every one of the eight categories reads exactly zero. These are not slow days — the shop
was shut. The pattern identifies the calendar precisely:

| Date pattern | Occurrences | What it is |
|---|---|---|
| 7 January | 2014–2019, every year | **Orthodox Christmas** |
| Orthodox Easter Sunday | 20 Apr 2014 · 12 Apr 2015 · 1 May 2016 · 16 Apr 2017 · 8 Apr 2018 · 28 Apr 2019 | **all six years, exact** |
| 1 January | 2015, 2016, 2018, 2019 | New Year |
| 19 December | 2014–2018, every year | **St. Nicholas (Nikoljdan)** — a Serbian household slava |
| 1 May | 2014, 2016 | Labour Day |
| 5 others | scattered | unexplained one-off closures |

> **21 of 26 map to the Serbian Orthodox calendar.** That tells us which holiday calendar to load —
> a Western Gregorian calendar would miss Orthodox Christmas and every Easter. It also tells us the
> pharmacy's likely country, which matters in §11.5.

**Training on these as observed zeros teaches the model a demand collapse that never happened.** They
are masked, and the closure flag becomes a feature the model can use — because closures are known in
advance.

**3 — The last bucket is truncated.** Data stops on 8 October 2019. October reads 295 units of N02BE
against 984 in September — an apparent **70% collapse** that is purely an artefact of a partial month.

**4 — One series is genuinely intermittent.** N05C sells nothing on 67.9% of days and **98.3% of
hours**. Its average demand interval is 3.12. Models built for continuous demand produce a flat,
useless line on it.

**5 — Units are fractional.** Only **14.1%** of M01AE daily values are whole numbers — partial packs
are dispensed. Forecasts are continuous; **orders are not.**

**6 — Seasonality has a different phase for every drug.**

| Series | Peak month | Multiple of annual mean | Almost certainly |
|---|---|---|---|
| **R06** antihistamines | May | **1.73×** | pollen season |
| **N02BE** paracetamol | January / October | 1.38× / 1.40× | flu waves |
| **R03** asthma | December | 1.44× | cold-air exacerbation |
| **N05C** sedatives | January | 1.33× | — |

**One global seasonal pattern would smear all four peaks.** Each series gets its own.

**7 — Weekday effects run in opposite directions.** N02BE (over-the-counter) sells **more** at
weekends: 33.6 Saturday vs 28.1 Wednesday. N05B (prescription anxiolytics) sells **less**: 5.8 Sunday
vs 10.1 Wednesday, because clinics are closed. A shared day-of-week coefficient would cancel out and
help neither.

**8 — There is a real level shift in 2017.** N02BE annual totals run 13,336 (2016) → **9,259 (2017)**
→ 11,231 (2018). N02BA declines monotonically, 1,616 → 880 over six years. Long training windows
anchor forecasts to a level that no longer exists.

**9 — The outliers are events, not errors.** Five N02BE days exceed mean + 4σ: 30–31 December 2016
(New Year stock-up) and three days in January 2019 (flu peak). **Deleting them destroys real signal.**
They are flagged and given a calendar feature so the model can explain them instead of absorbing them
as noise.

## 1.5 Who else does this, and where the gap is

**Pharmaceutical analytics is a crowded, expensive market — pointed at the wrong end of the chain.**

| Tier | Who | What they sell | Who buys |
|---|---|---|---|
| **Enterprise** | IQVIA (OCE+), ZS (ZAIDYN/Javelin), Veeva (Vault CRM + Nitro), SAS Viya, Axtria SalesIQ, ODAIA, IntegriChain | Brand forecasting, field-force targeting, next-best-action, market access | **Manufacturer** commercial teams. Six-figure contracts, 3–9 month implementations |
| **Retail** | LEAFIO, BestRx, wholesaler ordering portals | Reorder points, min/max levels, manual overrides | Pharmacies — but the forecasting inside is typically a moving average |
| **Open source** | Nixtla, Darts, Prophet, AutoGluon-TS, Chronos-2, TimesFM | Model libraries | Engineers. **Libraries, not systems** — no decision layer, no governance, no product |

**The gap, stated as four specifics:**

1. **Enterprise tools forecast the brand, not the shelf.** They tell a manufacturer how much product a
   region will absorb. They do not tell a pharmacy what to order on Tuesday.
2. **Almost nothing closes the loop to a quantity.** Dashboards end at the chart. The step from
   "demand will be ~187" to "order 214, and here's what it costs if I'm wrong" is left to the user.
3. **Confidence intervals are displayed but not checked.** A band is drawn; whether it actually
   contains the right answer 80% of the time is nobody's published metric. We measured ours at **75%**
   before correction (§4.4) — over-confidence that would quietly cause under-ordering.
4. **No vendor publishes its own cost.** Latency, memory footprint, compute cost per forecast — none
   of it is exposed. §7.2 and §5.1 make ours a product screen.

---

# PART II — WHAT THE USER GETS

## 2.1 The one-sentence product

> **Open it on a Tuesday morning and it tells you the three things that need a decision today,
> what to order, how sure it is, and what it costs if it's wrong.**

## 2.2 Worked examples

### The buyer — the everyday case

**Situation.** Priya owns a pharmacy. It is Tuesday, the distributor order closes at 11:00, she has
six minutes.

**Without PharmaPulse.** She scans last month's sales report, remembers that flu season is starting,
adds "a bit extra" to paracetamol, and hopes.

**With PharmaPulse.** The home screen shows three exception cards ranked by rupee impact: *N02BE —
stockout risk, 82% probability within 8 days.* She clicks it. The order screen proposes 214 boxes at a
95% service level, and shows that moving to 97% costs 23 more boxes and ₹1,840 more in holding cost.
She accepts.

> **Why this beats a chart:** the chart makes her do the arithmetic and carry the risk. The order
> screen does the arithmetic and shows her the risk she is choosing.

### The category manager — the seasonal case

**Situation.** Dr. Meera owns the respiratory portfolio. It is March; allergy season is coming.

**Without PharmaPulse.** She knows May is busy. She does not know by how much, for which products, or
how early to build stock given a four-day lead time.

**With PharmaPulse.** The Explainability screen shows R06 peaking at **1.73× the annual mean in May**, with
the build-up beginning in April. The What-if & Live Ops screen lets her ask what happens if pollen arrives three
weeks early. The answer comes back as boxes and rupees, not as a coefficient.

### The regional planner — the coherence case

**Situation.** Arjun runs 12 stores and reports a regional total to the owner.

**Without PharmaPulse.** Twelve store forecasts, produced independently, that do not add up to the
regional forecast. The moment somebody notices, trust is gone.

**With PharmaPulse.** Forecasts are reconciled across the hierarchy so children sum to parents
exactly. The UI shows the coherence check.

### ★ The case that proves the system is honest

**Situation.** A judge asks: *"where did that stockout risk number come from?"*

**With PharmaPulse.** Click the number. It shows the forecast distribution it came from, the model
combination that produced it, the calibration curve proving the interval is trustworthy, the four
backtest folds it was scored on, and the pharmacy settings used in the calculation — each one labelled
**observed data**, **your setting**, or **synthetic demo data**.

> **Nothing on screen is unattributed. That is a design rule, not a feature (§3.3).**

## 2.3 What PharmaPulse is, functionally

It is a **demand and replenishment system**, not a dashboard with a model attached. It ingests,
validates, forecasts, quantifies uncertainty, decides, explains, and monitors itself. The forecast is
the hardest component; the decision layer is the one that creates the value.

---

# PART III — ★ THE DATA MODEL

## 3.1 Design rule: one source of truth

> **We read `salesdaily.csv` and derive everything else from it. The supplied weekly and monthly files
> are never ingested.**

**Why, in one table:**

| | |
|---|---|
| The monthly file is corrupt | Jan 2017 = 1 unit; 53 series-months disagree with the daily rollup by >5% |
| The weekly file is fine — but | it is fine *today*. Deriving it costs one `resample()` call and removes an entire class of silent inconsistency forever |
| Aggregation must be ours anyway | closure masking (§1.4) has to happen **before** aggregation, or a closed day quietly drags a weekly total down |
| Reproducibility | one input file, one checksum, one lineage. Any number can be traced to a row |

A reconciliation test asserts that derived weekly and monthly totals match a rollup of the daily file.
**It fails loudly rather than warning quietly**, because a silent 5% drift in a training input is
indistinguishable from a real trend.

## 3.2 The three-lane provenance rule

**This is the most important rule in the system, and it exists because the dataset does not contain
everything a replenishment system needs.**

It contains dates and units sold. It does **not** contain inventory levels, lead times, prices,
promotions, regions or distributors. A system that invents those and then trains on them is learning
from a random number generator — and any explanation it produces afterwards is an explanation of noise.

**So every value in the system belongs to exactly one of three lanes, and the lanes have different
rights.**

```
 LANE 1  OBSERVED          salesdaily.csv + derived calendar
         ├─ may train models            YES
         ├─ may feed explanations       YES
         └─ may back an accuracy claim  YES

 LANE 2  USER SETTING      lead time · holding cost · margin · stock on hand · pack size
         ├─ may train models            NO
         ├─ may feed explanations       YES  (as a stated input, e.g. "at your 4-day lead time")
         └─ may back an accuracy claim  NO

 LANE 3  SYNTHETIC DEMO    the 40-store demonstration network
         ├─ may train models            NO — blocked in code
         ├─ may feed explanations       NO
         └─ may back an accuracy claim  NO — filtered out of benchmarks.json
```

**Lane 2 is not a compromise, it is how every inventory system on earth works.** No software knows a
pharmacy's lead time or cost of capital; it asks. We ship sensible defaults so the demo runs, and the
settings screen makes them editable. **The stockout risk and the reorder quantity are then real
calculations on a real forecast**, and they survive any question about where the numbers came from.

**Lane 3 exists so the hierarchy, roll-up and map screens have something to display.** It is generated
by a seeded script, lives in its own directory, is watermarked *SYNTHETIC DEMO DATA* wherever it
appears, and is physically prevented from reaching the trainer.

### How the rule is enforced, not merely intended

| Mechanism | Effect |
|---|---|
| `data/observed/` and `data/synthetic/` are separate roots | the training entrypoint takes a path and **raises** on a synthetic path. One test asserts this |
| Every gold table carries an `origin` column | values: `observed` · `user_setting` · `synthetic`. The API returns it; the UI renders a badge from it |
| `benchmarks.json` filters on `origin = observed` | enforced by the benchmark script, not by anyone remembering |
| Two features are excluded by name | **price** and **promotion**. They do not exist in this dataset, so they may appear as *what-if levers with a stated assumption*, and never as model inputs |

> **The point of the rule:** the single fastest way to lose a technical audience is to have them
> discover that an impressive-looking feature importance chart was computed over invented columns.
> Declaring the lanes converts the project's biggest vulnerability into a point of credibility.

## 3.3 The gold schema

One long table, one row per series per period, plus derived feature columns.

```
  ds            date            bucket start (store-local calendar)
  series_id     text            ATC-2 code, e.g. "N02BE"
  y             float           units dispensed
  origin        enum            observed | user_setting | synthetic
  is_closed     bool            pharmacy closure — masked from the training loss
  completeness  float           1.0 = full bucket; <1.0 = partial, excluded
  snapshot_id   text            content hash of the source file this row was built from
```

**Why `completeness` is a column and not a filter:** the truncated final week (§1.4) must be *visible*
in the UI as a partial bucket, not silently absent. A hatched bar labelled "partial" is honest; a
missing bar looks like the data ends early for an unknown reason.

**Why `snapshot_id` exists:** every reported metric records which version of the data produced it, so
a number computed on Day 3 can still be reproduced on Day 7 after the pipeline has changed.

## 3.4 Data quality gates

Every gate below has a test, and every gate **quarantines the batch rather than passing it through**.

| Gate | Catches |
|---|---|
| Schema + dtype contract | a renamed or added ATC column |
| Expected row count per grain | the two hourly days with 16 and 20 rows instead of 24 |
| Completeness ratio per bucket | the truncated final week and month |
| Daily-rollup reconciliation | the corrupt monthly file, and any future equivalent |
| All-zero row detector | closures — routed to the closure calendar, not to the loss |
| Range and monotonicity checks | negative units, impossible spikes, out-of-order dates |
| Duplicate key check | `(series_id, ds)` must be unique; ingest is an idempotent upsert |

---

# PART IV — ★ FORECASTING AND DECISION

**This is the technical core.**

## 4.1 The failure mode, named properly

**We ran a full model comparison on the real data before choosing an architecture.** Protocol:
weekly grain, horizon 8 weeks, rolling-origin cross-validation, 4 windows, MASE averaged over the 8
series. **MASE = 1.0 means "no better than a naive forecast"; lower is better.**

| Model | MASE |
|---|---|
| Naive | 1.330 |
| WindowAverage(8) | 1.164 |
| **SeasonalNaive(52)** | **1.118** ← the benchmark everything must beat |
| AutoETS | 1.114 |
| AutoTheta | 1.108 |
| DynamicOptimizedTheta | 1.104 |
| CrostonOptimized | 1.089 |
| AutoARIMA | 1.039 |
| MSTL | 1.011 |
| LightGBM, global, quantile | 0.973 |
| **Prophet** | **0.950** ← best single model |
| **Median of Prophet + ARIMA + MSTL + SeasonalNaive + LightGBM** | **0.906** ← what we ship |
| *Oracle — perfect per-series hindsight* | *0.883* |

**Two results in that table are not obvious, and both shape the design.**

### Result 1 — no single model wins

| Series | MSTL | ARIMA | Croston | DOTheta | SNaive | LightGBM | Winner |
|---|---|---|---|---|---|---|---|
| M01AB | 0.653 | 0.614 | 0.616 | **0.610** | 0.978 | 0.78 | DOTheta |
| M01AE | 1.252 | 1.114 | 1.243 | 1.266 | **1.015** | 1.07 | SeasonalNaive |
| N02BA | 0.778 | 0.673 | 0.736 | 0.678 | 0.685 | **0.63** | LightGBM |
| N02BE | **0.877** | 1.137 | 1.441 | 1.328 | 0.998 | 1.10 | MSTL |
| N05B | 0.785 | 0.590 | 0.589 | **0.585** | 0.953 | 0.70 | DOTheta |
| N05C | 0.828 | 0.719 | **0.693** | 0.699 | 1.162 | 0.76 | Croston |
| R03 | 1.230 | 1.115 | 1.093 | 1.093 | 1.305 | **1.06** | LightGBM |
| R06 | **1.688** | 2.355 | 2.303 | 2.571 | 1.847 | 1.68 | MSTL / LightGBM |

**Five different models win across eight series, and the spread inside a single series reaches 4×**
(R06: 1.688 against 2.571). **"We used ARIMA" is not a result on this data.**

### Result 2 — ★ picking the best model makes things worse

The obvious response to Result 1 is to pick each series' best model automatically. **We implemented
that and measured it.**

| Strategy | MASE |
|---|---|
| Pick each series' best model from previous folds | **1.091** |
| Simple median of four statistical models | 0.961 |
| Median of five, including Prophet and LightGBM | **0.906** |

> ### Selection scored 1.091. Averaging scored 0.906. Choosing the winner lost to not choosing.

**Why.** With ~300 weekly observations you get a handful of validation folds. "Best on the last fold"
is mostly noise, so selection chases noise and locks in a model that happens to have got lucky.
Combination does the opposite — **independent models make independent mistakes, and the median cancels
them.** This is a well-established result in forecasting; what makes it worth a slide is that we
measured it on our own data rather than citing it.

**Design consequence:** the system **combines**, it does not select. The per-model leaderboard stays as
a UI screen because it is informative, but the ensemble serves the forecast.

## 4.2 The pipeline

```
   history (observed lane only)
        │
   (1)  CLASSIFY      ADI / CV² per series → smooth · intermittent · erratic
        │
   (2)  ROUTE         demand class selects the eligible model family
        │
   (3)  FIT           every eligible model, per series, on the training fold
        │
   (4)  COMBINE       median across models — not the best, the middle
        │
   (5)  CALIBRATE     ★ conformal correction so the stated interval is the real one
        │
   (6)  RECONCILE     make SKU → group → store → region sum correctly
        │
   (7)  DECIDE        newsvendor q* × pharmacy settings → integer order quantity
        │
   (8)  EXPLAIN       attribution in units, not coefficients
```

## 4.3 Steps 1–4: classify, route, fit, combine

**(1) Classify.** Two numbers computed per series, every night:

- **ADI** — average demand interval. How many periods pass between non-zero sales.
- **CV²** — squared coefficient of variation of the non-zero values. How erratic the sizes are.

The Syntetos–Boylan cutoffs (ADI 1.32, CV² 0.49) split the plane into four quadrants:

| Quadrant | Our series | Model family |
|---|---|---|
| **Smooth** — ADI < 1.32, CV² < 0.49 | M01AB · M01AE · N02BA · N02BE · N05B · R06 | Prophet · MSTL · AutoARIMA · Theta · global LightGBM |
| **Intermittent** — ADI ≥ 1.32, CV² < 0.49 | **N05C** (ADI 3.12) | Croston / TSB + temporal aggregation |
| **Erratic** — ADI < 1.32, CV² ≥ 0.49 | **R03** (CV² 0.82) | quantile LightGBM, robust decomposition, wider intervals by design |
| **Lumpy** — both high | none today | TSB + bootstrap simulation, held as a guard rail |

> **This is a rule, not a preference.** When N05C's demand pattern changes, the route changes on its
> own. Nothing is hardcoded to a series name.

**(2)–(3) Route and fit.** Every eligible model is fitted per series on the training fold only.
The whole portfolio — ten model families, eight series, four backtest folds — completes in about
**25 seconds on one CPU**, which is what allows the entire backtest to run inside CI on every push and
live on stage during the demo.

**(4) Combine.** Median, not mean. The median is robust: one model blowing up on one week moves the
mean and does not move the median. Weights, where used, are bounded to **[0.05, 0.40]** — a constraint
derived directly from Result 2, since unbounded weighting collapses toward selection.

## 4.4 ★ Step 5 — calibration, and why it is not optional

**Every model in the portfolio can emit a prediction interval. We checked whether those intervals are
true.**

> ### A nominal 80% interval covered the actual value only **75.0%** of the time.

**That gap is not cosmetic — it is directional, and it costs money.** An over-confident interval is too
narrow. A too-narrow interval understates the upside of demand. The newsvendor formula then picks a
quantile that is lower than intended, and **the system silently under-orders on exactly the products
where uncertainty is highest.** The user sees "95% service level" on screen and gets something else.

**The fix: conformalised prediction.** Hold out a calibration fold, measure the actual distribution of
residuals, and widen or narrow the interval so the stated coverage is the empirical coverage. It makes
no distributional assumption and it gives a finite-sample guarantee.

**And it is shown, not asserted.** The Explainability screen carries a reliability diagram: stated
confidence on one axis, achieved coverage on the other, with the before and after curves. **A system
that can prove its own uncertainty is trustworthy is doing something no dashboard in this market does.**

## 4.5 Step 6 — coherence

Forecasts produced independently at SKU, drug-group, store and region level **will not add up.** A
buyer who spots that once stops trusting every number on the screen.

MinT reconciliation with a shrinkage covariance estimator projects the independent forecasts onto the
space where children sum to parents. Two notes worth stating because they are real engineering:

- The naive form inverts an *n×n* covariance matrix — **O(n³)**, and unstable when you have more series
  than observations, which is exactly our situation. The **shrinkage estimator with a sparse summing
  matrix is O(n²)** and stays invertible.
- Reconciliation usually **improves accuracy as a side effect**, because it pools information across
  the hierarchy. Coherence is the requirement; the accuracy gain is a bonus.

## 4.6 Step 7 — the decision engine

```
   inputs
     forecast distribution        21 quantiles, calibrated        ← LANE 1
     lead time L                  days                            ← LANE 2
     stock on hand                units                           ← LANE 2
     understock cost  Cu          lost gross margin per unit      ← LANE 2
     overstock cost   Co          holding + expiry risk per unit   ← LANE 2
     pack size                    units per orderable pack         ← LANE 2

   compute
     q*        = Cu / (Cu + Co)                     critical fractile
     demand_L  = distribution of demand over L days
     target    = quantile(demand_L, q*)
     order     = ceil_to_pack( target − stock_on_hand )
     cost      = E[holding] + E[stockout]  at that order, and at ±1 pack
```

**Three properties that matter:**

1. **It is closed form.** No optimisation solver runs during a request, which is why the response is
   fast and why the service-level slider can update live as it moves.
2. **Rounding is asymmetric.** Rounding to the nearest pack is wrong; the direction is chosen by which
   error costs more. With `Cu > Co` the system rounds up.
3. **Every input is labelled by lane on screen.** The user can see that the forecast is observed and
   the lead time is theirs.

## 4.7 Step 8 — explanation in units

**Feature importance charts explain the model. Buyers need an explanation of the number.**

So attribution is produced by **ablation**: re-run the forecast with one driver group removed, and
report the difference in units.

> *"R06 is up 41 boxes next month: +28 from the May pollen season, +9 from the underlying trend,
> +4 from the holiday calendar."*

The components reconcile to the total within rounding, and that reconciliation is asserted by a test.
SHAP values on the LightGBM member and Prophet's own trend/seasonality decomposition are both available
one level deeper, for the audience that wants them — computed on observed features only (§3.2).

## 4.8 What is genuinely ours

| | |
|---|---|
| **We do not claim to have invented** | ensemble combination (Bates & Granger, 1969), Croston's method (1972), the ADI/CV² classification (Syntetos & Boylan), MinT reconciliation (Wickramasuriya et al.), conformal prediction, or the newsvendor model |
| **C1 — the measured case against model selection** | selection 1.091 vs combination 0.906 on this data, with the oracle bound at 0.883 showing exactly how much headroom selection could ever buy. A result, not a citation |
| **C2 — calibration as a product surface** | the 0.750 coverage measurement, the correction, and the reliability diagram shown to the user. Nobody in this market exposes it |
| **C3 — the three-lane provenance rule** | every displayed number carries its origin, and synthetic data is blocked from training in code rather than by convention |
| **C4 — the decision layer** | forecast distribution × the pharmacy's own costs → an integer order quantity with the cost of being wrong attached |

---

## 4.9 ★ Planning horizons — one system, three clocks

**A pharmacy makes three different decisions on three different rhythms, and they need three different
forecasts.** Producing one weekly forecast and reading it three ways does not work, and we measured why.

| Horizon | The question | Grain | Who asks | Where it appears |
|---|---|---|---|---|
| **Next 1–7 days** | *"Will I run out before the next delivery?"* | daily | counter staff, owner | Live stock position (§5.4) |
| **Next 1–8 weeks** | *"What do I order on Tuesday?"* | weekly | the buyer | Orders & Risk (screen 4) |
| **Next 1–6 months** | *"How much cash do I need, and when do I pre-book allergy stock?"* | monthly | owner, category manager | Planning view |

### Why not just forecast weekly and add it up

**We tested exactly that.** Direct monthly forecasts against weekly forecasts summed into calendar
months, same models, same folds, MASE on monthly actuals:

| Approach | MASE (monthly) |
|---|---|
| **Forecast monthly directly** | **0.912** |
| Forecast weekly, sum to months | 0.954 |

> **Direct monthly is 4.4% better.** Aggregation removes week-to-week noise that the weekly model
> cannot see through, so a model fitted on monthly data sees a cleaner signal. Summing a noisy weekly
> forecast carries the noise up with it.

**And the reverse is also true.** The monthly view knows things the weekly view does not — it sees the
seasonal shape more clearly — so it should constrain the weekly numbers rather than merely summarise them.

### Temporal reconciliation

So we forecast at **all three grains independently** and then reconcile across time, the same way §4.5
reconciles across products:

```
        MONTH        ← fitted on monthly data, sees the season most clearly
          ▲
          │  reconcile: days must sum to weeks, weeks must sum to months
          ▼
        WEEK         ← the ordering grain, the primary model
          ▲
          │
          ▼
        DAY          ← the stockout-alarm grain
```

**Two hierarchies, one mechanism.** The cross-sectional hierarchy (SKU → drug group → store → region)
and the temporal hierarchy (day → week → month) both use MinT with a shrinkage estimator. Building one
gives you the other for the cost of a different summing matrix.

**What the user gets from it:** the monthly number on the planning screen and the weekly number on the
order screen are guaranteed to agree. A buyer who orders four weeks of stock and a owner who budgets a
month of cash are looking at the same forecast, not two that happen to be near each other.


# PART V — THE PRODUCT SURFACE

## 5.1 Six screens

| # | Screen | The job it does | Key elements |
|---|---|---|---|
| **1** | **Dashboard** | *"What needs my decision today?"* | Exception cards ranked by rupee impact — stockout risks, overstock/expiry risks, anomalies. KPIs, sales trend, top movers. **Never opens on a chart** |
| **2** | **Forecast Center** | *"Do I believe this number?"* | Fan chart with 50/80/95 bands, horizon slider, historical vs forecast overlay, per-model comparison, the four backtest folds shown as a strip |
| **3** | **Explainability** | *"Why?"* | Attribution in units, Prophet trend/seasonality/holiday decomposition, SHAP on the ML member, **and the calibration reliability diagram** |
| **4** | **Orders & Risk** | *"What do I order?"* | The order table. Service-level slider with a live cost curve, pack rounding, stockout probability, Accept / Override with a mandatory reason |
| **5** | **What-if & Live Ops** | *"What if I'm wrong about the season?"* | Sliders — demand shift, lead-time change, price change — that re-forecast and compare, every assumption stated on screen. **Also hosts replay mode (§5.5)** |
| **6** | **Ops Console** | *"Is this thing efficient?"* | Latency, memory, CPU, cache hit ratio, cost per 1,000 forecasts, drift gauges, model leaderboard, head-to-head against a naive implementation |

## 5.2 The interaction rule: exception-first

> **The home screen answers "what needs attention", not "what happened".**

A dashboard that opens on a time series makes the user do the work of finding the problem. A screen
that opens on *"three things need your decision today, worth ₹18,400"* has already done it. **Everything
else in the product is one click from an exception card.**

Second rule, applied everywhere: **every number is one click from why, and every why is one click from
how confident.** If somebody points at any figure on any screen and asks where it came from, the answer
is a click, not a sentence.

## 5.3 The assistant

A single natural-language input on the home screen: *"why did paracetamol spike in January 2019?"*

**It is scoped deliberately and narrowly, and the scoping is the safety control:**

- The question resolves to a **parameterised metric query** drawn from a fixed allowlist — series, date
  range, metric, comparison. The model never emits SQL and never touches the database.
- It receives a small JSON object of **already-computed** results and writes prose about it.
- **It cannot invent a number**, because it is never given the ability to compute one.

> That constraint is also why it behaves reliably in a live demo, which is the second reason to build
> it this way.

---

## 5.4 ★ Live stock position — what is on the shelf right now

**A forecast of demand is only half of a reorder decision. The other half is what you already have.**

So the system maintains a **stock ledger** per product:

```
   opening stock
   + goods received        (delivery notes)
   − sales                 (point of sale)
   − wastage / expiry      (write-offs)
   ± stock-take adjustment (physical count)
   ────────────────────────
   = stock on hand
```

**From that one number plus the daily forecast, four live indicators fall out:**

| Indicator | Formula | What it means |
|---|---|---|
| **Days of cover** | stock on hand ÷ forecast daily demand | *"you have 3.2 days left"* |
| **Reorder point** | quantile of demand over the lead time, at service level `q*` | the level at which you must order |
| **Status** | on hand vs reorder point vs max | `OK` · `watch` · **`order now`** · `overstocked` |
| **Projected stockout date** | when the cumulative forecast exceeds stock on hand | *"empty on Thursday; delivery lands Friday"* |

**The status chip is the whole product in one glyph.** The home screen is a list of products that are
not `OK`, sorted by rupee impact.

### Suggestions the live position enables

| Suggestion | Trigger |
|---|---|
| **Order now** | on hand will fall below the reorder point before the next order window |
| **Order early** | a seasonal build-up starts within the lead time — pollen and flu are both known months ahead (§1.4) |
| **Do not order** | on hand already exceeds the forecast for the whole review period |
| **Transfer, don't buy** | another store in the network is overstocked on the same product |
| **Slow mover** | days of cover exceeds a threshold — capital is stuck; consider a markdown |
| **Expiry watch** | batch expiry is closer than the projected sell-through date |

### Where the data comes from — stated plainly

**This dataset contains no inventory.** So the ledger is a **Lane 2** structure (§3.2): the pharmacy's
own operational data, which a real pharmacy has in its POS and goods-receipt system and a Kaggle export
does not.

| Field | In production | In our build |
|---|---|---|
| Sales | live POS feed | **the real daily CSV, replayed** (§5.5) |
| Goods received | supplier delivery note | a receipts screen, plus simulated deliveries during replay |
| Opening stock | stock take | seeded, editable in settings |
| Wastage, expiry batches | ERP batch records | **not modelled — named as requiring real data** |

> **Expiry watch is deliberately listed as needing batch-level data we do not have.** Claiming a
> batch-expiry feature on a dataset with no batches is exactly the kind of thing §3.2 exists to prevent.
> We describe it as the next integration, not as a shipped feature.

## 5.5 ★ Live Ops — the replay mode

**The demo problem:** a real-time system is hard to show when the data ends in 2019.

**The solution, which uses only real data:** replay it.

> **Live Ops mode replays a chosen 90-day window of the actual history at one day per second.** Sales
> post to the ledger, stock depletes, days-of-cover counts down, status chips flip from `OK` to `watch`
> to `order now`, alerts fire, forecasts refresh on their schedule, and suggested orders appear.

**Why this is worth building:**

- **It is honest.** Nothing is invented — it is the real 2019 data, arriving in the order it originally
  did. The screen is watermarked `REPLAY · Jan–Mar 2019`.
- **It proves the system is live, not static.** A dashboard that redraws when new data lands is a very
  different claim from a dashboard that renders a fixed file.
- **It makes the January 2019 flu wave visible in ninety seconds.** The judges watch paracetamol demand
  climb, cover collapse, the alert fire, and the order suggestion appear — the whole value proposition,
  compressed, on real data.
- **It is also the integration test.** The same code path a real POS feed would drive.


# PART VI — API

Seven endpoints. The OpenAPI 3.1 spec is generated from the type definitions, so the frontend contract
cannot drift from the implementation.

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /forecast` | 21 calibrated quantiles per series per horizon step | Served from the precomputed store. **No model runs during this request** |
| `GET /explain` | attribution in units, Prophet components, SHAP values | Observed features only |
| `GET /risk` | stockout / overstock / anomaly flags with severity and probability | Forecast × settings |
| `POST /recommend` | order quantity, timing, expected cost at ±1 pack | The decision engine |
| `POST /simulate` | re-forecast under modified assumptions | Assumptions echoed back so they can be displayed |
| `POST /assistant` | prose answer over computed metrics | Allowlisted queries only |
| `GET /metrics` | dashboard KPIs and `benchmarks.json` | What the Ops Console reads |

**Cross-cutting on every endpoint:** the `origin` lane of every returned value, the `model_version` and
`snapshot_id` that produced it, and a correlation id for tracing.

---

# PART VII — EXECUTION

## 7.1 The central trade: batch once, serve instantly

```
   NIGHTLY  (~4 min)          ingest → validate → features → fit → combine
                              → calibrate → reconcile → write forecast store

   PER REQUEST  (p95 < 250ms) read store → apply settings → decide → respond
```

> **Pay O(n) once a night so every request is O(1).** That single decision is what makes the product
> feel instant, and it is why the cache key includes the model version — a new deploy invalidates
> itself with no manual step.

**The only path that touches a model during a request** is a series with no precomputed forecast — a
newly stocked product. That path is explicitly slower and the UI shows a determinate progress state
rather than pretending otherwise.

## 7.2 Latency budget

Published as a budget, asserted by a load test in CI, displayed on the Ops Console. A regression
against these numbers fails the build.

| Hop | p95 budget | Technique |
|---|---|---|
| Static shell | 20 ms | CDN, route-level code splitting, Brotli |
| Auth + tenant scoping | 12 ms | JWT verified in-process; tenant claim → database session variable |
| Cache hit | 5 ms | key = `series · cutoff · model_version · horizon` |
| Forecast store read (miss) | 40 ms | Parquet row-group pruning + covering index |
| Decision engine | 22 ms | closed form, vectorised, no solver |
| Serialise + transfer | 35 ms | compact arrays for chart payloads, server-side pagination, virtualised tables |
| **End to end, cached** | **< 250 ms** | |
| Cold path, new product | < 1.5 s | model runs; progress shown |

## 7.3 Scale — the honest arithmetic

Today: 8 series. Design target: **10,000 stores × 2,000 products = 20 million series.** Claiming that
without arithmetic loses the Q&A, so:

| Quantity | Value | Basis |
|---|---|---|
| Measured throughput | 288 series-model-folds in ~23 s | 8 series × 9 models × 4 folds, one CPU |
| Per unit of work | ~0.08 s | derived |
| **Per-series fitting at 20M series** | **~440 CPU-hours per night** | **infeasible** |
| **Global-model approach** | **~3 CPU-hours per night** | ~40 models (one per region × demand class); inference is one vectorised pass |
| Forecast store size | ~2 GB compressed per night | 20M × 8 horizons × 21 quantiles |

> **The scaling thesis in one sentence:** fitting one model per series is O(series) and dies; a global
> model plus hierarchical disaggregation is O(segments) and does not. **That is why the portfolio
> contains a global LightGBM and not only per-series statistical models** — it is an architecture
> decision, not a modelling preference.

Supporting mechanics: partition by `hash(store_id)` so shards are independent and restartable; a
stateless API so replicas scale on CPU; columnar storage with partition pruning so a single-store query
never scans the network; bounded queues that reject with `429` rather than buffer into an OOM.

## 7.4 Degradation ladder

**When something fails the system descends one rung and says which rung it is on.** A chaos test kills
each dependency in turn and asserts an order quantity still renders.

| Rung | State | Serves | User sees |
|---|---|---|---|
| 1 | Healthy | calibrated ensemble, reconciled | nothing unusual |
| 2 | Covariate source down | same models, seasonal climatology substituted | *"using seasonal averages"*, intervals visibly wider |
| 3 | Cache down | direct store reads | slower page, no functional change |
| 4 | Nightly job failed | yesterday's forecasts | amber staleness badge with the exact vintage |
| 5 | Model runtime down | statistical fallback computed in-process | *"fallback model"* chip on every forecast |
| 6 | Everything down | seasonal naive from the last cached table | read-only banner; **ordering disabled** so a bad commit cannot happen |

## 7.5 Security and privacy

**Context matters here: this is healthcare-adjacent software, and the dataset contains no personal
data at all.** It is aggregated counts by drug group — no patient, no prescriber, no transaction. We
say that plainly rather than implying a privacy problem we do not have. Everything below exists so that
a real deployment ingesting patient-linked dispensing records already has the controls.

| Threat | Control | Verified by |
|---|---|---|
| One tenant reading another's demand | **Row-level security in the database**, keyed on a session variable set from the token — so an application bug cannot leak | a test that authenticates as A and asserts zero rows for B |
| Stolen token replay | OIDC, 15-minute access tokens, rotating refresh with reuse detection | auth integration tests |
| Poisoned ingest feed | anomaly gate **before** training: a batch shifting any series' mean by >5σ is quarantined; bronze layer is append-only and revertible | poisoning fixture |
| *"I never approved that order"* | hash-chained append-only audit log: who, when, old value, new value, reason. Each entry stores the previous entry's hash, so deletion is detectable | chain-integrity test |
| Abuse of the expensive cold path | token-bucket rate limit per key and per IP, with a tighter bucket on the cold endpoint | load profile |
| Injection through the assistant | allowlisted parameterised queries; the model never emits SQL and never sees credentials | contract test |
| Spreadsheet formula injection | exported cells beginning `= + - @` are quote-prefixed, so an order export cannot run a macro | unit test |
| Leaked secrets | `.env.example` only in git; `gitleaks` in pre-commit and CI; pinned dependencies; container scan; non-root image | CI gate |

**Governance:** a model card and data card per released model recording the training window,
`snapshot_id`, per-series metrics, known limitations, and who approved promotion. **The system
recommends; a person commits.** Every override captures a reason code, and those reason codes are the
roadmap.

---

## 7.6 ★ Handling new data

**A forecasting system that is only correct on the data it was built with is a report, not a product.**
New sales arrive every day; new products appear; demand patterns change. Three mechanisms handle it.

### Two update modes, deliberately separated

| Mode | Runs | Does | Why separate |
|---|---|---|---|
| **Fast update** | every few minutes, or on POS post | recomputes features for the affected window and **re-runs inference with the existing model** | The system reacts to today's sales within minutes. **No model is refitted**, so nothing can become unstable between one hour and the next |
| **Full refit** | nightly | refits the entire portfolio, re-runs the backtest, recalibrates, reconciles, publishes a new snapshot | Refitting is where accuracy improves — and where it can regress. It happens on a schedule, behind a gate |

> **The reason for the split:** refitting a model on every incoming row makes the forecast jump around
> for reasons the user cannot see, and makes any accuracy number impossible to reproduce. Fitting on a
> schedule and serving continuously gives you responsiveness without instability. The full refit costs
> about 25 seconds at this scale, so nightly is trivially affordable — and the same architecture holds
> when it costs three hours (§7.3).

### Late, corrected and out-of-order data

| Situation | Handling |
|---|---|
| Sales posted late | 48-hour watermark. Any bucket touched by late data is marked **dirty**; its features and forecasts are recomputed |
| A sale is refunded or restated | Bronze is append-only, so history is rebuilt rather than edited. The new `snapshot_id` means yesterday's reported metric is still reproducible from yesterday's snapshot |
| A duplicate batch is resent | Idempotent upsert on `(tenant, store, series, ds)`. Re-ingesting the same file changes nothing |
| A new product appears | Cold-start path: the parent drug group's seasonal profile is borrowed as a prior, blended toward the product's own fitted model over roughly 12 weeks as history accumulates |
| A new column appears | The data contract quarantines the batch (§3.4). It never auto-passes |

### The promotion gate — a new model does not automatically win

```
   nightly refit produces a CHALLENGER
        │
        ├─ backtest on the same rolling folds
        ├─ must beat SeasonalNaive on every series
        ├─ must not regress the ensemble MASE by more than 5%
        ├─ interval coverage must stay within tolerance of nominal
        │
        ├─ PASS → promoted to CHAMPION, cache invalidated by model_version
        └─ FAIL → CHAMPION stays pinned; alert raised; yesterday's forecasts continue to serve
```

> **A failed refit never replaces a good model.** The worst outcome of a bad night is stale forecasts
> with a visible staleness badge, never bad forecasts presented as fresh.

### Knowing that the world changed

| Monitor | Fires when |
|---|---|
| **Rolling MASE per series** | 8-week rolling accuracy degrades past a threshold for two consecutive weeks |
| **Feature drift (PSI)** | the distribution of an input feature moves away from the training distribution |
| **Coverage drift** | the calibrated interval stops achieving its stated coverage — the earliest sign that uncertainty has changed |
| **Changepoint detection** | a level or trend break is detected in the series itself (we already found the real 2017 shift, §1.4) |
| **Demand-class change** | a series crosses an ADI/CV² boundary and should be routed to a different model family |

Two consecutive breaches trigger a retrain and an Ops Console alert. **Coverage drift is the most
sensitive of the four**, because uncertainty widens before the point forecast visibly degrades.

## 7.7 ★ The stress-test harness — proving robustness, not asserting it

**Claiming "our system is robust to changing patterns" is worthless. Measuring it is not.**

So we built a harness that takes the **real series**, injects a **known, labelled disturbance** at a
known time, and measures how the system behaves afterwards. Same models, same folds, same metric —
the only difference is the injected event.

### Measured results

Rolling 4-week-ahead forecasts across 36 weeks following the event, averaged over all 8 series. MASE
denominator fixed on pre-event history so the windows are comparable.

| Scenario | Weeks 1–4 | 5–8 | 9–12 | 13–16 | 17–24 | 25–36 | Mean vs baseline |
|---|---|---|---|---|---|---|---|
| **No event (reference)** | 1.41 | 1.17 | 0.96 | 1.07 | 0.88 | 0.73 | 1.00× |
| **+40% level shift** | 1.41 | 1.17 | 0.87 | 1.15 | 0.93 | 0.76 | **1.02×** |
| **4× demand spike for 8 weeks** | **12.44** | 5.47 | **11.01** | 1.20 | 1.09 | 0.80 | **4.05×** |
| **Product discontinued** | 1.41 | 1.17 | **3.97** | 1.48 | 0.60 | 0.33 | 1.19× |

**Three findings, and the second one is the important one.**

**1 — Level shifts are handled.** A permanent 40% change in demand costs **2%** relative accuracy. The
models re-learn the level within the first refit cycle. This is the scenario everyone worries about,
and it turns out not to be the problem.

**2 — ★ Transient spikes are the real danger, and the damage comes *after* the spike ends.**
Error peaks at **12×** during the surge, which is expected. But look at weeks 9–12: error is **11×**
baseline *after demand has already returned to normal*. **The model absorbed the spike as a new level
and kept forecasting high.** In inventory terms that is weeks of over-ordering into a market that has
gone back to normal — the classic post-panic-buying overstock, and it costs real money.

> **This is why §1.4 finding 9 says outliers are flagged, never deleted, and given a calendar feature.**
> An event the model can attribute to a cause does not become the new baseline. An unexplained spike does.
> The stress test is what turned that from a principle into a requirement.

**3 — Discontinuation is detected but slowly.** Error spikes to 4× when demand collapses and takes about
8–12 weeks to settle. Acceptable, but it argues for an explicit "product delisted" flag in the UI rather
than waiting for the model to work it out.

### The full scenario catalogue

The four above are the ones we have measured. The harness is built to run all of these, and each is a
row in a CI report:

| Scenario | Injection | What it tests |
|---|---|---|
| Level shift | step change ±40% | re-learning a new baseline |
| **Transient spike** | ×4 for 8 weeks, then normal | **post-event over-forecasting** |
| Product discontinued | demand → 0 | does it stop recommending orders |
| New product | truncate history to 4 weeks | cold-start quality at week 1, 4, 12 |
| Seasonality phase shift | move the seasonal peak 3 weeks earlier | adaptation vs a full-year lag |
| Intermittency onset | a smooth series becomes sporadic | does the ADI/CV² router re-classify |
| Data outage | 2 weeks missing | graceful degradation, no silent zero-fill |
| Corrupt batch | 10× outlier injected | does the quality gate quarantine it |
| Unit change | series scaled ×10 (pack size changed) | detected, or silently learned as growth |
| Two events at once | shift + outage | compounding failure |

**Reported metrics per scenario:** peak error, **time to recover** (periods until MASE returns within
10% of baseline), **detection latency** (periods until a drift monitor fires), and **false-alarm rate**
on the unperturbed control run.

> **This harness is the single most "industry-grade" thing in the project.** It is chaos engineering for
> a forecasting system: deliberately break the input, measure the blast radius, and publish the number.


## 7.8 ★ Failure-mode catalogue

**Twenty-two ways this pipeline can produce a wrong answer**, each with the evidence that it is real in
this data or inevitable in production, what breaks if it is ignored, and the control. Rows 1–11 are
already visible in the dataset; the rest are structural. Every row should end the project either with a
test or with a documented known limitation — nothing in between.

| # | Failure mode | Evidence / trigger | If ignored | Control |
|---|---|---|---|---|
| 1 | **Corrupt pre-aggregated file** | January 2017 in `salesmonthly.csv` reads 0 for seven of eight groups; the daily file totals ~2,700 units. 53 series-months disagree by >5%. The weekly file is clean (0 of 2,416). | A model trains on a month that never happened; every monthly chart is wrong | Ingest `salesdaily.csv` only; derive weekly and monthly. Reconciliation assertion in CI |
| 2 | **Closure days read as zero demand** | 26 days with all eight groups at exactly 0, on Orthodox Christmas, Orthodox Easter, New Year, St. Nicholas | Phantom demand collapse learned on holidays; under-orders before, over-orders after | Closure calendar; masked from the loss; treated as censored, not observed-zero. Holiday flag becomes a known-future covariate |
| 3 | **Truncated final bucket** | Data ends 8 Oct 2019; October reads 295 units of N02BE against 984 in September | Dashboard reports a 70% collapse; models learn a downtrend that does not exist | Completeness ratio per bucket; buckets under 100% excluded from fitting, rendered hatched and labelled "partial" |
| 4 | **Intermittent series** | N05C zero on 67.9% of days and 98.3% of hours; ADI 3.12 | Smooth models emit a flat fractional line, unusable for ordering; MAPE undefined on zeros | ADI/CV² router → Croston/TSB + temporal aggregation; MASE and pinball loss instead of MAPE |
| 5 | **Fractional units** | Only 14.1% of M01AE daily values are whole numbers | System recommends ordering 3.67 boxes | Integerisation and pack rounding in the decision layer; direction chosen by the cost asymmetry, not `round()` |
| 6 | **Level shift / regime change** | N02BE annual: 13,336 (2016) → 9,259 (2017); N02BA declines 1,616 → 880 over six years | Long windows anchor forecasts to a level that no longer exists; errors one-sided for months | Changepoint detection; exponential recency weighting; training window tuned per series in CV |
| 7 | **Event outliers** | Five N02BE days beyond mean+4σ: 30–31 Dec 2016, three days in Jan 2019 | Winsorising removes real flu-wave signal; keeping them raw inflates variance everywhere | Flag, never delete. Robust decomposition; add the causal calendar feature so the model explains the spike instead of absorbing it |
| 8 | **Opposite weekday effects** | N02BE Sat 33.6 vs Wed 28.1; N05B Sun 5.8 vs Wed 10.1 | A shared day-of-week coefficient cancels and helps neither | Per-series Fourier + day-of-week interactions; `series_id` categorical in the global model |
| 9 | **Multi-seasonality, different phases** | R06 peaks May 1.73×; N02BE Jan 1.38× and Oct 1.40×; R03 Dec 1.44× | One global seasonal period smears every peak | MSTL with per-series period sets; annual + weekly terms; covariates carry the phase |
| 10 | **Incomplete hourly days** | 2,104 days have 24 hourly rows; two have 16 and 20 | Daily aggregates silently under-count on those days | Expected-row-count assertion per grain; failure quarantines the partition |
| 11 | **Negative or impossible forecasts** | Any linear model on a low-mean series | "Order −2 boxes"; nonsensical intervals | Poisson/Tweedie objective or `log1p` with bias-corrected back-transform; hard clip at zero; monotonic quantile sorting |
| 12 | **Censored demand (stockouts)** | Not observable in POS data by construction | Sales during a stockout read as low demand → forecast drops → order drops → another stockout. Self-reinforcing | On-hand-stock join where available; otherwise flag suspicious ceilings and treat as right-censored. **Documented as a known limitation of this dataset** (§11.3) |
| 13 | **Cold start** | New product or new store on day one | Classical models cannot fit; the system has nothing to show | Parent-group seasonal profile as a prior, blended toward the fitted model over ~12 weeks by an age-dependent weight |
| 14 | **Schema drift** | A ninth ATC column appears; a column renames | Silent column misalignment; a model trains on the wrong feature | Contract on every gold table; unknown columns quarantine the batch and alert — they never auto-pass |
| 15 | **Duplicate & late-arriving records** | POS resends after a network outage | Double-counted sales; irreproducible history | Idempotent upsert on `(tenant, store, series, ds)`; append-only bronze with an ingest-batch id so any load is replayable |
| 16 | **Out-of-order events** | Backdated corrections | Features computed before the correction lands stay wrong | 48-hour watermark; any bucket touched by late data is marked dirty and its features and forecasts recomputed |
| 17 | **History restatement** | A refund reverses a sale from three weeks ago | Yesterday's reported accuracy silently changes; nobody can reproduce a number | Snapshot-versioned gold tables; every run records the `snapshot_id` it read |
| 18 | **Covariate source unavailable** | Weather/pollen API down or rate-limited at 03:00 | Pipeline crashes, or silently fills nulls with zero | Circuit breaker → climatological normals → `degraded_covariates` flag that widens intervals and shows a banner |
| 19 | **Training job fails or degrades** | OOM on a free tier; a bad data batch | No forecasts at 08:00 — or worse, bad forecasts at 08:00 | Champion pinned until a challenger passes the gate (§9.2). Last-good forecasts served with a staleness badge |
| 20 | **Horizon beyond support** | User drags the slider to 104 weeks on 302 weeks of history | Confident-looking nonsense | Max horizon = ¼ of series length, enforced in the API; beyond that the UI shows a seasonal-climatology band and says so |
| 21 | **Timezone & DST** | Hourly grain, European source, UTC storage | Duplicate or missing hour twice a year; wrong day boundaries | Store UTC + store-local timezone; bucket by store-local date; explicit DST tests including the repeated hour |
| 22 | **Long tail of near-zero products** | At scale, most products sell <1 unit/week | Millions of models fitted to noise, burning the compute budget | Aggregate-then-disaggregate with proportion-of-history disaggregation; the tail gets one hierarchical model, not thousands |

> **How to use this table in implementation.** Rows 1–5 and 14–15 are Day-1 work — they sit in the
> ingest and validation path and everything downstream assumes them. Rows 6–11 belong with the model
> layer. Rows 16–22 are hardening. When a row is genuinely out of scope, say so in the model card
> rather than leaving it unmentioned; row 12 is the one that must be stated out loud in any
> presentation, because it bounds what the whole system can claim.

The behaviour when a control fires is specified by the degradation ladder in §7.4.


# PART VIII — ★ THE COMPLETE PIPELINE

**One nightly run and one request, end to end, with every component named.**

```
 ┌─ NIGHTLY BATCH ────────────────────────────────────────────────────────────┐
 │                                                                            │
 │  salesdaily.csv  ─┐                                                        │
 │  holiday calendar ┼→ INGEST      checksum · idempotent upsert · append-only │
 │                   │              (synthetic root rejected here)             │
 │                   └→ VALIDATE    schema · row counts · completeness         │
 │                                  daily-rollup reconciliation                │
 │                                  all-zero detector → closure calendar       │
 │                          │                                                  │
 │                          ▼                                                  │
 │                     GOLD TABLES   ds · series_id · y · origin               │
 │                                   is_closed · completeness · snapshot_id    │
 │                          │                                                  │
 │                          ▼                                                  │
 │                     FEATURES      lags · rolling stats · Fourier terms      │
 │                                   week/month · holiday · closure mask       │
 │                                   (computed with a cutoff — no leakage)     │
 │                          │                                                  │
 │                          ▼                                                  │
 │                     CLASSIFY      ADI / CV² per series                      │
 │                          │                                                  │
 │            ┌─────────────┼─────────────┐                                    │
 │            ▼             ▼             ▼                                    │
 │        SMOOTH       INTERMITTENT    ERRATIC                                 │
 │      Prophet         Croston/TSB   quantile LGBM                            │
 │      MSTL·ARIMA      + ADIDA       robust STL                               │
 │      Theta·LGBM                    wider bands                              │
 │            └─────────────┼─────────────┘                                    │
 │                          ▼                                                  │
 │                     COMBINE       median across members  → MASE 0.906       │
 │                          ▼                                                  │
 │                     CALIBRATE     conformal   0.750 → nominal coverage      │
 │                          ▼                                                  │
 │                     RECONCILE     MinT(shrink)  children sum to parents     │
 │                          ▼                                                  │
 │                  FORECAST STORE   21 quantiles × series × horizon           │
 │                                   versioned; published by pointer swap      │
 │                                   (atomic — no partial state is readable)   │
 └────────────────────────────────────────────────────────────────────────────┘
                             │
                             │  read only — no model runs below this line
                             ▼
 ┌─ PER REQUEST  (p95 < 250 ms) ──────────────────────────────────────────────┐
 │                                                                            │
 │  browser → API gateway    OIDC · row-level tenant scope · rate limit        │
 │              │                                                             │
 │              ▼                                                             │
 │          REDIS CACHE      key: series · cutoff · model_version · horizon    │
 │              │ miss                                                        │
 │              ▼                                                             │
 │        FORECAST STORE  ──────── no entry? → cold path: fit now (< 1.5 s)    │
 │              │                                                             │
 │              ▼                                                             │
 │       DECISION ENGINE     q* = Cu/(Cu+Co)  ×  pharmacy settings [LANE 2]    │
 │                           → integer order · cost at ±1 pack · P(stockout)   │
 │              │                                                             │
 │              ▼                                                             │
 │          RESPONSE         quantity · interval · attribution                 │
 │                           + origin lane of every value                      │
 │                           + model_version · snapshot_id · correlation id    │
 └────────────────────────────────────────────────────────────────────────────┘
                             │
                             ▼
 ┌─ FEEDBACK ─────────────────────────────────────────────────────────────────┐
 │  accepted orders · buyer overrides + reason codes · observed stockouts      │
 │  → audit log (hash-chained)  → next night's training signal                 │
 │  → drift monitor: rolling MASE + feature PSI → retrain trigger             │
 └────────────────────────────────────────────────────────────────────────────┘
```

**The three properties this diagram is designed to make visible:**

- **The line in the middle.** Nothing below it runs a model. Remove the forecast store and every
  request becomes a training job — which is precisely the difference between 250 ms and several seconds.
- **Lane 2 enters only at the decision engine.** Settings never reach the trainer. The provenance rule
  is enforced by the shape of the pipeline, not by discipline.
- **The feedback loop is what makes it a system rather than a script.** Overrides and observed stockouts
  are signal, not exhaust.

---

# PART IX — BUILD

## 9.1 Stack

| Layer | Choice | Why this one |
|---|---|---|
| **Source** | `salesdaily.csv` only | §3.1 — the monthly file is corrupt; deriving costs one line |
| **Processing** | Polars, or pandas | Polars is lazy and multi-threaded, so lag/rolling feature builds are several times faster with predictable memory. **At this data size pandas is fine — do not lose a day to unfamiliar syntax** |
| **Analytical store** | **Parquet + DuckDB** | Columnar, compressed, queryable with plain SQL, **zero infrastructure**, identical on a laptop and a free container |
| **Operational store** | Postgres (or SQLite) | Settings, orders, overrides, audit log. Postgres if the row-level-security tenancy story is wanted; SQLite is sufficient otherwise |
| **Data contracts** | pandera | Schema, ranges, and completeness-per-bucket — the last one is what catches the truncated week automatically |
| **Statistical models** | **Prophet** + StatsForecast (AutoARIMA, MSTL, SeasonalNaive, Croston) | Prophet is the **best single model here (0.950)** and its components feed the explainability screen for free. StatsForecast is Numba-compiled, so the full backtest runs in ~25 s — fast enough for CI on every push |
| **ML model** | **LightGBM**, global, quantile objective | One model across all series, not one per series. Learns shared structure, gives the prediction interval directly, and is the **only member that scales to millions of series** (§7.3) |
| **Calibration** | conformalised quantiles | Distribution-free; fixes the measured 0.750 coverage |
| **Reconciliation** | MinT with shrinkage | O(n²), stable when series outnumber observations |
| **Tracking** | MLflow, SQLite backend | Run comparison and a model registry with no server to operate |
| **API** | FastAPI + Pydantic | OpenAPI 3.1 generated from types, so the frontend contract cannot go stale |
| **Cache** | Redis, or an in-process LRU | Key includes `model_version`, so deploys self-invalidate |
| **Frontend** | React + Vite + Tailwind + Recharts | Recharts covers everything except the fan chart and the reliability diagram; build those two directly in SVG |
| **Assistant** | any hosted LLM, over computed results | Never sees the database (§5.3) |
| **Deploy** | Vercel (web) · Render or Fly (API) · GitHub Actions | All free tier, all give a public HTTPS URL. **Warm the services before the demo** |

## 9.2 Phases — seven days

**Each phase has a gate checked at the evening demo. If a gate fails, the next day begins by fixing it
and nothing new starts.**

| Phase | Deliverable | Gate |
|---|---|---|
| **0** — evening before | Repo, Docker Compose, CI skeleton green, dataset checksummed, everyone's environment verified by a merged one-line PR | Every one of the 8 has merged a PR; a placeholder page is live at a public URL |
| **1** — Day 1 | Ingest daily → gold, closure calendar, completeness gates. Backtest harness with baselines. **Contracts frozen by 18:00:** OpenAPI spec, gold schema, `benchmarks.json` shape | `make benchmark` reproduces **SeasonalNaive = 1.118** exactly |
| **2** — Day 2 | Portfolio fitted, ADI/CV² router live, `/forecast` returning real quantiles, Forecast Center rendering a real fan chart | **The vertical slice works on the deployed URL.** Real series → real model → real API → real chart. *The most important gate of the week* |
| **3** — Day 3 | Median combination, conformal calibration, decision engine, settings screen, Orders & Risk | Reproduces **MASE 0.906**. A buyer can move the service-level slider and watch the order quantity and cost change |
| **4** — Day 4 | Explainability (attribution in units, Prophet components, SHAP, reliability diagram), `/explain`, `/risk`, inventory-cost simulation on the 2019 holdout | Three differentiators demonstrable in the deployed app |
| **5** — Day 5 | Security pass, observability, Ops Console, load test, chaos test, provenance badges. **Feature freeze 20:00** | CI fully green; latency budget met; **anything unmerged at 20:00 is deleted, not carried** |
| **6** — Day 6 | Polish on the demo path, deck, ROI model, README, model card, demo video recorded. **The 2019 holdout is evaluated once.** Code freeze 20:00 | Deck done, video recorded, public URL stable |
| **7** — Day 7 | Three timed rehearsals, Q&A drill, submit early | Submitted; fallback video offline on two devices |

### Stretch — below the cut line

**These start only when everything above is merged and deployed.** Each is genuinely valuable and none
is load-bearing.

| Item | Why it is below the line |
|---|---|
| Natural-language assistant | Depends on an external API that can rate-limit mid-pitch. Cache one canned answer as a fallback |
| Synthetic 40-store network + map | Presentation value only; proves nothing about accuracy |
| Notifications / alert delivery | An alert list on screen already conveys this. Real delivery adds infrastructure for no judging points |
| Foundation-model cold start (Chronos-2 zero-shot for new products) | Genuinely novel, but heavy on a free CPU tier. If attempted, precompute offline and ship as fixtures |
| Hierarchical reconciliation across stores | Only meaningful once the store network exists, which is the item above |

> **The rule that protects the project:** at the Day-5 demo somebody reads the list aloud and marks each
> item done or not done. Unfinished work is cut **on the spot**. Deleting a half-built feature is free;
> debugging one at 3 a.m. costs the demo.

## 9.3 Team split (8)

**Every person owns something that appears on screen during the demo.** That is what stops a team of
eight becoming a team of three.

| | Owns | Their moment in the demo |
|---|---|---|
| **D1** | **Data & platform** — ingest, gold tables, quality gates, closure calendar, synthetic generator, Docker, CI/CD, deployment | *"here is the gate catching the corrupted month"* |
| **M1** | **Modelling lead & evaluation** — backtest harness, baselines, statistical portfolio, metrics, model card. **Owns every reported number**; the only person who can approve one | the per-series table and the selection-vs-combination result |
| **M2** | **Features & uncertainty** — cutoff-aware feature builder, anti-leakage tests, global LightGBM, quantiles, conformal calibration, drift | the reliability diagram: 0.750 → nominal |
| **M3** | **Explainability & scenarios** — attribution engine, Prophet components, SHAP, scenario engine, assistant. **Deck owner** | *"why is R06 up 41 boxes?"* answered in units |
| **B1** | **API & decision engine** — all seven endpoints, caching, background jobs, newsvendor logic, pack rounding, order commit, cost simulation | the service-level slider moving cost live |
| **B2** | **Security, performance, observability** — auth, tenancy, rate limiting, audit log, tracing, load and chaos tests, the CI benchmark harness | the cross-tenant isolation test, run on stage |
| **F1** | **Frontend lead** — design system, app shell, screens 1, 2 and 4, accessibility, responsive. **Demo driver** | the whole product narrative |
| **F2** | **Frontend & visualisation** — chart primitives, screens 3, 5 and 6, demo video | the Ops Console live benchmark run |

### The three contracts that make parallel work possible

**Frozen Day 1 at 18:00. After Day 3 a change requires the lead's approval and a note in the decision log.**

| Contract | Producer → Consumer | Without it |
|---|---|---|
| OpenAPI spec + generated types | B1 → F1, F2 | the frontend waits for the backend all week |
| Gold Parquet schema | D1 → M1, M2, M3 | modelling waits for the pipeline |
| `benchmarks.json` shape | B2 → F2 | the Ops Console cannot be built before the numbers exist |

### Working agreements

- **Trunk-based.** Short-lived branches, PRs under ~400 lines, one approval, CI green to merge.
  `main` is always deployable and always deployed.
- **Review SLA 30 minutes** during working hours. A blocked teammate is the most expensive thing in a
  seven-day sprint.
- **Daily rhythm:** standup 09:30 · sync 14:00 · working-software demo 20:00. Nothing is "done" until
  it is merged and visible in the deployed app.
- **Named backup per area** — M1↔M2, B1↔B2, F1↔F2, D1↔B2. Nobody is the only person who can start
  the demo.
- **Banned:** notebook-only work after Day 2 · "I'll integrate at the end" · touching the 2019 holdout
  before Day 6 · two people silently building the same chart component.

---

# PART X — EVALUATION

| # | What | Method | Target |
|---|---|---|---|
| **E1** | **Forecast accuracy — the headline** | Rolling-origin CV, 4 windows, h=8, MASE per series and averaged | **0.906 vs the 1.118 seasonal-naive benchmark.** Reproducible with `make benchmark` |
| **E2** | **Combination vs selection ablation** | Same folds: best-single, per-series selection, median combination, oracle | **1.091 selection / 0.906 combination / 0.883 oracle.** The core empirical claim |
| **E3** | **Interval calibration** | Empirical coverage of the nominal 80% interval, before and after conformal correction | **0.750 → nominal.** Shown as a reliability diagram in-product |
| **E4** | Demand-class routing | MASE on N05C and R03 with routing on vs off | Croston must beat the smooth-series models on N05C |
| **E5** | **Business value** | Inventory simulation over the 2019 holdout: our policy vs a min/max reorder-point policy | Total cost = holding + stockout. The number on the ROI slide |
| **E6** | Coherence | Child-sum minus parent, before and after reconciliation | Exactly zero after |
| **E7** | **Latency and footprint** | k6 against the published budget; `psutil` for RSS and CPU; measured cost per 1,000 forecasts | p95 < 250 ms cached. All of it on the Ops Console |
| **E8** | Robustness | Chaos test killing each dependency in turn | The degradation ladder holds; an order quantity still renders |
| **E9** | Isolation | Authenticate as tenant A, query tenant B | Zero rows |

**Reporting rules:**

- Every figure is generated by CI into `benchmarks.json`. **No number on the Ops Console is typed by a
  human**, and that sentence is said out loud in the demo.
- **Losses are reported alongside wins.** R06 is the worst series; the ensemble does not beat seasonal
  naive on M01AE. Both go on the slide (§11.2).
- **The 2019 holdout is evaluated once, on Day 6.** That number is final.

## 10.1 The business case

An illustrative single-store model. **Every input is stated so any of them can be challenged and the
number recomputed live** — which is far stronger than a figure with hidden assumptions.

| Input | Value | Basis |
|---|---|---|
| Annual purchases | ₹1,20,00,000 | assumption — mid-size urban pharmacy |
| Gross margin | 20% | assumption → revenue ₹1.5 Cr |
| Days of inventory | 45 → 38 | tighter safety stock at the same service level |
| Holding cost rate | 22%/yr | capital + storage + insurance + shrinkage |
| Expiry write-off | 1.5% of purchases, reduced 35% | conservative against the 41–92% reductions in published hospital deployments (§1.1) |
| Stockout rate | 6% → 4% | downstream of the accuracy gain plus calibrated service levels |

| Saving | Amount |
|---|---|
| Holding cost | ₹50,630 |
| Expiry write-off | ₹63,000 |
| Lost margin recovered | ₹66,489 |
| **Total per store per year** | **₹1,80,119** — against a ₹23,988 subscription, **7.5×**, payback under two months |

> **These are assumptions and they are labelled as such.** The forecast accuracy numbers are
> measurements. Keeping that distinction visible is the difference between a claim and a number.

---

# PART XI — ★ SELF-CRITIQUE

**The weakest points, stated before anyone else finds them.** Items 2, 3 and 6 were found by breaking
our own system after the first list was written, which is why this section is kept open rather than
closed.

### 1. "One pharmacy, eight categories. That is not a forecasting problem."

**Partly fair.** 302 weekly observations across 8 series is a small problem, and it limits what can be
claimed. The defence has three parts and none of them is "it's bigger than it looks":

- **The problem is small; the failure modes are not.** Intermittent demand, censored demand, level
  shifts, closure days, multi-phase seasonality and calibration failure are all present in this data and
  all are exactly the problems that appear at scale.
- **The architecture is chosen for the scale it does not yet have.** The global LightGBM member exists
  because per-series fitting is O(series) and dies at 20M (§7.3). On 8 series a global model is
  unnecessary; including it is the design decision, not an accident.
- **We do not claim more.** The synthetic network is labelled, and no accuracy figure is computed on it.

### 2. ⚠️ "Your ensemble is worse than seasonal naive on one series."

**True, and we found it by reading our own per-series output rather than the headline.**

On **M01AE** the merged ensemble scores **1.061** where plain SeasonalNaive scores **1.015**. Averaging
helps on seven of eight series and costs us slightly on one. **R06 is the hardest series overall at
1.671**, and while that beats seasonal naive's 1.847, it is still well above 1.0 — the May pollen peak
is sharp and its timing moves year to year.

**Why we still combine.** The alternative — detecting per-series that seasonal naive is better and
switching — **is exactly the selection strategy that measured 1.091 overall** (§4.1). Fixing M01AE by
selection would cost more elsewhere than it gains here.

> **Both numbers go on the slide.** A team that reports where its method loses reads as scientists; a
> team that reports only wins gets discounted entirely, and experienced judges do that quickly.

### 3. ⚠️ "You are forecasting sales, not demand."

**The deepest limitation in the project, and it is inherent to the data rather than to our method.**

Point-of-sale data records what was *sold*. When a product is out of stock, demand exists and sales are
zero. So the observations are **right-censored**, and the censoring is worst precisely on the products
that stock out most — which are the products the system most needs to get right. Left uncorrected this
is self-reinforcing: a stockout depresses recorded sales → the forecast falls → the order falls → a
further stockout.

**What we do:** flag days where sales hit a suspicious ceiling and treat them as censored rather than
observed. **What we cannot do:** verify it, because this dataset has no on-hand-stock column.

> **Stated as a limitation in the model card, out loud in the demo, and named as the first thing a real
> deployment fixes** — by joining the pharmacy's own inventory ledger, which a real pharmacy has and a
> Kaggle export does not.

### 4. "Your calibration result rests on 256 points."

**Correct.** The 0.750 coverage figure comes from 8 series × 8 horizon steps × 4 folds. That is enough
to establish that the intervals are **over-confident in a consistent direction**, which is the claim we
make. It is **not** enough to certify a precise coverage level per series after correction.

**Mitigation:** report coverage with a confidence interval, not as a point; use pooled residuals across
series for the conformal correction rather than per-series ones, since per-series calibration on 32
points would overfit; and track coverage continuously in production so the estimate improves with use.

### 5. "A median of five models is not machine learning."

**The objection worth taking seriously, because it is the one that fails projects like this.**

The response is that the ML content is not in the combination step:

- the **global LightGBM** is a learned multi-horizon quantile model over engineered features;
- the **conformal calibration** is a distribution-free statistical procedure with a finite-sample guarantee;
- the **admission of a model into the portfolio** is decided by rolling-origin evaluation, not by taste;
- the **demand-class router** is a classification rule with published decision boundaries;
- and there are **four ablations on measured data** (E2, E3, E4, E6).

> **Lead with E2 and E3, not with the ensemble.** "We tested the obvious approach and it lost" is a
> result. "We averaged some models" is not, even though they describe the same code.

### 6. ⚠️ "You inferred the pharmacy's country from holiday dates."

**We did, and it matters more than it sounds.**

The dataset states no location. We identified the calendar as Serbian Orthodox from the closure pattern
— all six Orthodox Easters, 7 January every year, 19 December every year (§1.4). **21 of 26 closures
fit; 5 do not.** The inference is strong but it is an inference.

**Why it matters:** the weather and pollen covariates that would explain the R06 May peak and the R03
December peak **require a location to join on.** Joining Belgrade weather to this series is an
assumption stacked on an inference.

**So the rule we adopted:** external covariates are **optional and flagged**. The core model uses only
calendar features derived from the data itself — which are safe, because a holiday's *effect* is
observable in the series regardless of which country produced it. If external data is added, the
location assumption is displayed on screen next to the forecast that used it.

> **The general lesson:** an inference that is 80% likely is fine as a design input and dangerous as a
> silent assumption inside a data join.

### 7. "Your metrics are chosen to flatter you."

**A fair challenge, and the honest answer is that the reverse is true.** MASE was chosen *because* the
flattering metrics were available:

| Grain | MAE | RMSE | MAPE |
|---|---|---|---|
| Monthly, all categories summed into one series | 263 | 341 | **13.6%** |
| Monthly, per category | 47 | 106 | **18.4%** |
| Weekly, per category — *the grain a buyer actually orders at* | 12 | 18 | **38.9%** |

**We report the last row.** Summing all eight categories into one monthly total produces a much easier
problem and a much prettier percentage, and it is useless to a buyer who orders paracetamol and
antihistamines separately, every week.

**Why MAPE is not our primary metric:** it divides by the actual value, so on N05C — zero on 68% of days
— it is undefined or explosive, and on a category averaging 23 units a week a five-unit miss reads as a
22% error even though five units is an excellent forecast. **MASE is defined on zeros and comparable
across categories of very different volume.**

### 8. "The ₹1.8 lakh figure is made up."

**It is a model built on stated assumptions, and it is labelled that way in §10.1.** Three defences:

1. Every input is on the slide, so a judge can change one and watch the number move.
2. The *direction* is anchored to published deployments — 41% and 91.6% waste reductions are measured
   results from real hospitals, and we assume 35%.
3. **We lead with the accuracy measurement, not the rupee figure.** The 0.906 is a measurement; the
   ₹1.8 lakh is an argument. Presenting them as the same kind of claim would undermine both.

### 9. ⚠️ "Your first stress test result was a metric artifact."

**Found by disbelieving our own output, which is the only reason it was found at all.**

The first run of the level-shift scenario (§7.7) reported error at **1.43× baseline and not recovering
after 36 weeks.** We wrote it up as a serious robustness failure and started designing fixes — trailing
training windows, changepoint-triggered truncation. **None of them helped: every variant landed between
1.43× and 1.45×.**

**That uniformity was the clue.** A ×1.4 multiplicative shock scales the series, so it scales the
absolute errors too — while the MASE denominator was fixed on *pre-shock* history. The metric was
guaranteed to rise by ≈1.4× no matter how well the model performed. **Dividing out the scale gives
1.02×: the models had recovered essentially completely all along.**

**Two things this changed:**

1. The harness now **scale-normalises the denominator per scenario**, and every scenario declares
   whether it is scale-preserving. Without that, any multiplicative perturbation reports a false failure.
2. It redirected the work. We would have spent a day building changepoint truncation to fix a problem
   that did not exist — and would have missed the spike-aftermath failure (§7.7 finding 2), which is
   real, expensive, and was sitting in the same table.

> **The general lesson, and it applies to every metric in this document:** a number that looks like a
> failure deserves the same scrutiny as a number that looks like a success. We check the wins by habit
> and accept the losses without checking, and that asymmetry is itself a bug.


---

# PART XII — RISKS

| Risk | Response |
|---|---|
| **Free-tier cold start kills the live demo** | Keep-alive ping; warm 30 min before the slot; local Docker Compose on the presenter's laptop as hot standby; recorded video as last resort. **Rehearse the fallback switch itself** |
| **Integration collapses on Day 6** | Contracts frozen Day 1, vertical slice Day 2, daily merges to `main`, nightly deploy. If you are integrating on Day 6 you already failed — so do not arrive there |
| **Scope sprawl** | The cut line in §9.2 and the Day-5 feature freeze. The lead can cut unilaterally; cuts are logged, not debated |
| **"This is a notebook with a UI"** | Open on the order screen, not a chart. Lead with rupees, then E2, then the Ops Console |
| **Accuracy challenged in Q&A** | `make benchmark` reproduces every figure from a clean clone; protocol on the slide; losses reported (§11.2); holdout evaluated once |
| **Data is too small to impress** | The failure-mode argument in §11.1 plus the scale arithmetic in §7.3. Do **not** inflate the dataset to compensate |
| **Synthetic data credibility** | The three-lane rule (§3.2), enforced in code, visible as badges, watermarked on screen |
| **Assistant fails live** | External API; below the cut line; one cached answer as fallback |
| **A teammate goes dark** | Named backup per area, everything in git, credentials in a shared vault, no single demo laptop |
| **Environment problems eat Day 1** | Phase 0 exists for this. Anyone still broken at the Day-1 standup pairs until fixed |

---

# APPENDIX A — Reproducing every number in this document

```bash
git clone --depth 1 https://github.com/mcallara/pharma-sales-data.git
pip install statsforecast mlforecast lightgbm prophet pandas numpy
python day1_benchmark.py pharma-sales-data
```

Writes `artifacts/benchmarks.json` and prints the model table. **Run this on Day 1 and confirm the
numbers match before building anything on top** — if they differ, something in the pipeline is wrong,
and finding that on Day 1 costs an hour instead of costing the demo.

| Figure | Where it comes from |
|---|---|
| SeasonalNaive 1.118, Prophet 0.950, ensemble 0.906 | rolling-origin CV, 4 windows, h=8, weekly |
| 80% interval coverage 0.750 | conformal intervals on the same folds |
| Corrupt monthly file: Jan 2017, 53 series-months | daily rollup compared against `salesmonthly.csv` |
| 26 closure days, 21 mapping to the Orthodox calendar | all-zero row detector + holiday cross-reference |
| ADI/CV² per series, seasonality multiples, weekday means | the profiling block in the same script |

> **Note on reproducibility:** the ensemble prints **0.902** when weekly is regenerated from the daily
> file (the correct approach, §3.1) and **0.906** when scored against the supplied weekly file on
> identical folds. Both are ~19% better than the benchmark. **Pin `random_state` on the LightGBM and
> quote one figure consistently throughout the deck.**

---

> **The first slide:**
> ### ***Every pharmacy guesses how much to order. We calculate it — with the odds, the cost of being wrong, and the reason behind the number.***
