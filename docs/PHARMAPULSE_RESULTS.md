# PHARMAPULSE — Results, Decisions and Demonstration

> **What was built, what was measured, why each choice was made over the obvious
> alternative, and how to show it.**

This is the third document in the set. `PHARMAPULSE_CONCEPT.md` proposes the design,
`PHARMAPULSE_ARCHITECTURE.md` is the engineering reference, and **this file reports what
actually happened when it was built.**

Every number here is reproducible:

```bash
python scripts/check_data.py                  # snapshot sha256:49e4f1c5c3da
python -m pipelines.run_nightly --stage all   # ~3 min
python scripts/day1_benchmark.py              # ~45 s -> artifacts/benchmarks.json
pytest -q                                     # 138 tests
```

---

## Contents

| § | Section |
|---|---|
| **1** | What the system does |
| **2** | ★ Decisions: what we chose *instead of what*, and why |
| **3** | ★ Final results |
| **4** | ★ What we got wrong and corrected |
| **5** | What is deliberately not built |
| **6** | ★ The demonstration, step by step |
| **7** | Q&A drill |

---

# 1. What the system does

**One sentence:** it reads a pharmacy's sales history and answers *"how many boxes of each
medicine should I order this week?"* — with the odds, the cost of being wrong, and the reason
behind the number.

## 1.1 The chain

```
history → forecast → uncertainty → order quantity → cost of being wrong
```

Most tools in this market stop at the first arrow. **The last two arrows are the product.**

## 1.2 Capabilities, by layer

| Layer | What it does |
|---|---|
| **Data** | Ingests the daily POS file, runs 9 validation gates, detects 26 pharmacy closures, flags outliers without altering them, tracks period completeness, derives week and month grains from daily and asserts they reconcile |
| **Features** | Lags, rolling statistics, Fourier seasonal basis, calendar and event flags — every one computed as of an explicit cutoff, with a test proving no future value can leak |
| **Routing** | Computes ADI and CV² per series **per grain** and routes each product to the model family its demand pattern requires |
| **Forecasting** | Fits five members in parallel, combines by median, calibrates the intervals conformally, publishes 21 quantiles per series per horizon at three grains |
| **Decision** | Turns the distribution plus the pharmacy's own costs into an integer order quantity, with the expected cost at ±1 pack and a 16-point cost curve |
| **Stock** | Event-sourced ledger: opening stock plus receipts, sales, wastage and adjustments. Accepting an order moves the shelf |
| **Risk** | Four rules, each carrying a probability *and* a rupee exposure, ranked by money |
| **Explanation** | Attribution in units that sums to the total, plus the reliability diagram showing whether our own confidence is honest |
| **Replay** | Steps the real 2019 history one day at a time and measures our policy against a min/max policy over identical days |
| **Governance** | Hash-chained order log, provenance lane on every value, degradation ladder, staleness badges |

## 1.3 The seven screens

| Screen | Question it answers |
|---|---|
| Dashboard | *What needs my decision today?* |
| Orders & Risk | *What do I order, and what does being wrong cost?* |
| Forecast | *Do I believe this number?* |
| Why | *Where did it come from, and is your confidence real?* |
| Live Ops | *Is this alive, and is it actually better?* |
| Ops | *Are your numbers honest?* |
| Settings | *What if my lead time or margin were different?* |

---

# 2. ★ Decisions: what we chose instead of what, and why

**This section is the technical case.** Each row is a fork where the obvious choice was
available and we took a different one — with the reason, and where possible the measurement.

## 2.1 Data

### We ingest `salesdaily.csv` only, instead of the supplied weekly and monthly files

**The obvious choice:** use the pre-aggregated files that ship with the dataset. They are right
there and they save a `resample()` call.

**Why not:** `salesmonthly.csv` is corrupt. January 2017 reads ~zero for seven of eight groups;
the daily file totals ~2,700 units for the same month. **53 series-months disagree with a daily
rollup by more than 5%.**

**What we do:** one source of truth. Weekly and monthly grains are derived, and
`assert_reconciles()` fails the build if they ever diverge. Cost: one line. Benefit: an entire
class of silent inconsistency becomes impossible.

### Closures are masked, instead of imputed or deleted

**The obvious choices:** fill the 26 all-zero days with an average (imputation), or drop them.

**Why not:** imputation invents demand that did not occur. Deletion leaves a gap that a
seasonal model reads as a *missing period*, shifting every subsequent lag.

**What we do:** mark `is_closed` and exclude those rows from the fitting loss. The state is
recorded accurately — demand was *unobserved*, not zero — and the flag becomes a feature the
model can use, because closures are known in advance.

### Outliers are flagged, instead of winsorised

**The obvious choice:** clip values beyond 4σ; they look like data errors.

**Why not:** they are not errors. The five extreme N02BE days are 30–31 December 2016 (New Year
stock-up) and three days in January 2019 (a flu peak). **Removing them removes the behaviour the
system exists to anticipate.**

**What we do:** flag them, never alter `y`, and give the model a calendar feature so it can
attribute the spike to a cause instead of raising its baseline.

### `completeness` is a column, instead of a filter

**The obvious choice:** drop partial periods so charts look clean.

**Why not:** October 2019 then simply disappears, and a missing bar looks like the data ended
for an unknown reason. **The truncated bucket is a fact about the data and the user should see
it.** It renders hatched and labelled "partial", and is excluded from fitting by the flag.

## 2.2 Modelling

### We combine models, instead of selecting the best one — **measured**

**The obvious choice:** pick each product's best model. Five different models win across eight
series, so per-series selection looks obviously right.

**We implemented it and measured it losing.**

| Strategy | MASE |
|---|---|
| Pick each series' best model from previous folds | **0.968** |
| Median combination | **0.907** |
| Perfect hindsight (a bound, not a model) | 0.843 |

**Why selection loses:** with ~300 weekly observations you get a handful of folds. "Best on the
last fold" is mostly noise, so selection chases noise and locks in whichever model got lucky.
Combination does the opposite — independent models make independent mistakes, and the median
cancels them.

Selection is scored honestly: the choice for fold *k* uses only folds 1…*k*−1, so it never sees
the answer it is graded on.

### Median, instead of mean

**Why:** the failure we protect against is one member blowing up on one period. A mean carries
that error in proportion to its size; a median does not. A test drives this: with members at
100, 102, 98, 101 and **9000**, the mean is above 1,000 and the median is 101.

### Five members, each for a reason nothing else covers

| Member | The one thing only it contributes |
|---|---|
| **Prophet** | Holidays as **named, individually fitted regressors**, and a trend/season/holiday decomposition in the units of the series — which *is* the explainability screen |
| **AutoARIMA** | Short-run autocorrelation. A decomposition model has no mechanism for momentum or mean reversion |
| **MSTL** | Two overlapping seasonal cycles, non-parametrically, with Loess down-weighting the outliers we deliberately kept |
| **SeasonalNaive** | The control — "the calendar alone". It cannot extrapolate, diverge, or go negative |
| **LightGBM (global, quantile)** | The only member learning structure **shared across products**, and the only one whose cost does not grow with product count |

### AutoARIMA is fitted **non-seasonally** at weekly grain

**The obvious choice:** `season_length=52`, since the data has annual seasonality.

**Why not:** it never finished. Seasonal ARIMA at m=52 searches seasonal lags 52 apart on 300
observations — **over 20 minutes without completing**, which would have made the backtest
impossible to run in CI.

**What we do:** MSTL and Prophet carry the annual season; ARIMA contributes short-run
dependence, which is why it is in the portfolio at all. Fit time went from *never* to **1.2 s**.
Honest cost: its MASE is 1.115 rather than the 1.039 the design document projected.

### Demand class is recomputed **per grain** — a bug a test caught

Aggregation removes sparsity. **N05C is intermittent at daily grain (ADI 3.12, 67.9% zero days)
and smooth at weekly grain.** Classifying once on weekly data would have routed the daily
forecast to the wrong model family. Routing is now computed for each grain independently.

### Prophet's holidays are dropped at **monthly** grain

**Why:** every holiday falls in the same month every year, so its coefficient is collinear with
the annual seasonal term. Fitting ~14 holiday coefficients on 70 monthly observations attributed
**+34 units on a 104-unit baseline** to "holidays" — visible on the explainability screen. With
them removed, R06 reads: seasonality −23.7, trend +4.0. Weekly grain is unaffected.

### Conformal calibration, instead of trusting the model's own interval

**The obvious choice:** ship the prediction interval each model reports.

**Why not:** we checked, and it was wrong. A nominal 80% interval covered **92.2%** of outcomes.

**Why it matters, in money:** the decision layer reads a specific quantile to pick a quantity. A
mis-sized interval moves that quantity. Too *wide*, as ours was, means over-ordering and capital
tied up on the shelf. The error is invisible in a point-forecast metric.

Conformal prediction is used because it assumes nothing about the shape of the error
distribution and gives a finite-sample guarantee — appropriate for a non-negative count with an
asymmetric tail. **Residuals are pooled across series**, because per-series calibration on ~32
points would overfit.

### MASE, instead of MAPE

**The flattering metric was available and we did not take it.** MAPE divides by the actual
value, so on N05C — zero on 68% of days — it is undefined or explosive. On a category averaging
23 units a week, a five-unit miss reads as 22% error even though five units is an excellent
forecast. MASE is defined on zeros and comparable across categories of very different volume.

**We also report the harder grain.** Summing all eight categories into one monthly series gives
a much prettier number and is useless to a buyer who orders paracetamol and antihistamines
separately, every week.

## 2.3 Decision

### Order against the **protection interval**, not the lead time — a real bug replay caught

**The obvious choice:** size the order against demand over the lead time. It is what "lead-time
demand" suggests.

**Why it is wrong:** in a periodic-review system you cannot reorder until the next review. With
a 7-day review and a 4-day lead time, **today's order must survive 11 days, not 4** — until the
order *after* next arrives.

**How we found it:** the replay simulation produced persistent stockouts under both policies
(2,207 units short). Sizing against `lead_time + review_period` cut that to **121**.

### Rounding is asymmetric, instead of `round()`

Rounding to the nearest pack is wrong: the two rounding errors do not cost the same. With
`Cu > Co`, the correct direction is **up**. A small function carrying a real decision.

### The quantile grid is anchored at (0, 0)

**The bug:** clamping at the lowest stored quantile meant a product whose shortage is nearly
free still got ordered up to the 5th percentile — an order floor with no economic justification.
Demand is non-negative, so the quantile function genuinely approaches zero. The **upper** tail is
still clamped, because extrapolating a tail we did not estimate would invent confidence.

### The whole cost curve ships in one response

**The obvious choice:** fetch a new recommendation as the service-level slider moves.

**Why not:** it stutters, and it throws away the reason the maths is closed-form. `/recommend`
returns the order quantity and expected cost at **16 service levels**; the browser interpolates
locally and makes **zero network calls while dragging**.

### Live stock = opening stock **+** ledger movements

The ledger existed and nothing called it — the API read stock straight from settings, so the
audit log and the position could disagree. Now settings hold the *opening* position and the
ledger holds every movement since. **Accepting an order posts a goods receipt**, so the decision
actually moves the shelf.

## 2.4 Architecture

### Batch once, serve instantly

**No model runs during a request.** The nightly batch pays O(n) so every request is O(1). This
is why the response is fast, why two users see the same number on the same day, and why the
slider is possible at all. The cache key includes `model_version`, so publishing a model
self-invalidates.

### Parquet + DuckDB, instead of Postgres for analytics

Columnar layout matches a scan-and-group workload, with **no server, no port, no credentials** —
identical on a laptop, in CI, and in a container. Operational state (settings, ledger, audit) is
SQLite, because a running balance under concurrent writes needs transactions, not scan
throughput. **No Redis:** an in-process LRU does the job at this scale and adds no service to
operate.

### Three lanes, enforced in code

The dataset has dates and units. It does **not** have stock, lead times, prices or promotions. A
system that invents those and trains on them is learning from a random number generator, and any
explanation it then produces is an explanation of noise.

```
LANE 1  observed      trains YES · explains YES · backs a claim YES
LANE 2  user_setting  trains NO  · explains YES (as a named input) · backs a claim NO
LANE 3  synthetic     trains NO (raises in code) · explains NO · backs a claim NO
```

`price` and `promotion` are excluded **by name**. The ingest entrypoint raises on a synthetic
path, asserted by a test. Every value carries its lane to the UI, which renders a badge.

---

# 3. ★ Final results

Protocol: weekly grain · horizon 8 · 4 non-overlapping rolling origins · MASE (in-sample naive
denominator) · averaged over 8 series · seed 42 · **43 s**, 292 series-model-folds, one CPU.

## 3.1 Forecast accuracy

| Model | MASE | |
|---|---|---|
| Naive | 1.332 | |
| WindowAverage(8) | 1.165 | |
| DynamicOptimizedTheta | 1.149 | |
| AutoETS | 1.124 | |
| **SeasonalNaive** | **1.117** | ← the benchmark to beat |
| AutoARIMA | 1.115 | |
| CrostonOptimized | 1.085 | |
| MSTL | 1.014 | |
| LightGBM | 0.961 | |
| Prophet | 0.935 | best single model |
| **Ensemble (median of 5)** | **0.907** | ← **what we ship, 18.8% better than the benchmark** |
| *Oracle* | *0.843* | a bound, not a model |

## 3.2 Per series — including the weak ones

| Series | SeasonalNaive | Ensemble | Best single | Verdict |
|---|---|---|---|---|
| M01AB | 0.971 | **0.651** | AutoARIMA | strong |
| M01AE | 1.019 | **1.000** | Naive | ⚠ effectively a tie |
| N02BA | 0.671 | **0.618** | SeasonalNaive | strong |
| N02BE | 0.993 | **0.799** | Prophet | strong |
| N05B | 0.939 | **0.621** | WindowAverage | strong |
| N05C | 1.174 | **0.785** | CrostonOptimized | routing pays off |
| R03 | 1.294 | **1.137** | CrostonOptimized | above 1.0 |
| **R06** | 1.880 | **1.646** | Prophet | ⚠ **worst series** |

The ensemble beats seasonal naive on all eight, but **R06 is 1.646 and M01AE is a tie.** Both go
on the slide. The May pollen peak is sharp and its timing moves year to year.

## 3.3 Selection versus combination

| Strategy | MASE |
|---|---|
| Pick each series' best model | 0.968 |
| **Median combination** | **0.907** |
| Perfect hindsight | 0.843 |

## 3.4 Calibration

| | |
|---|---|
| Nominal interval | 80% |
| Achieved, raw model | **92.2%** — too wide |
| Achieved, after conformal correction | **82.0%** |
| Scale factor | 0.718 |
| Points behind the estimate | 256 |

## 3.5 Decision quality — the business case, measured

Both policies replayed over the **same real days**, with identical costs, lead time, review
cadence and protection interval. The only difference: min/max sizes against the **mean**, we size
against the quantile the cost ratio implies.

| Window | Min/max total | PharmaPulse total | Lower by | Units unsupplied |
|---|---|---|---|---|
| Jan–Mar 2019 | ₹4,608 | **₹1,479** | **67.9%** | 349 → **121** |
| Apr–Jun 2019 | ₹3,362 | **₹1,200** | **64.3%** | 325 → **76** |
| Oct–Dec 2018 | ₹4,942 | **₹1,211** | **75.5%** | 343 → **48** |

**The saving comes from lost sales, not from holding less.** We deliberately hold *more* stock
and pay *more* holding cost — a test asserts both. That is the cost ratio working as designed.

## 3.6 System

| | |
|---|---|
| Full backtest | 43 s, one CPU |
| Nightly batch (gold + 3 grains of forecasts) | ~3 min |
| Forecast store | 7,056 quantile rows, published by atomic pointer swap |
| Tests | **138** — unit, property, contract, concurrency |
| Endpoints | 17 |
| Screens | 7 |
| Docker | `docker compose up --build`, verified serving real forecasts |

---

# 4. ★ What we got wrong and corrected

**Every one of these was found by measuring rather than by review.** They are here because a
team that reports only its wins gets discounted, and experienced judges do it quickly.

| # | What was wrong | How it was found | Fix |
|---|---|---|---|
| **1** | **The decision engine under-ordered.** Sized against the lead time, not the protection interval | Replay produced 2,207 units short under *both* policies | `protection_interval_days()`; short units fell to 121 |
| **2** | **Our first business case was rigged.** We fixed our horizon but left the baseline on the old one — an 88% saving | The number was implausibly good, so we checked it | Same protection interval for both; a defensible ~70% |
| **3** | **Concurrent replay ticks corrupted runs.** 121 units short became 547 | Clicking "skip a week" while the poller ran | A per-session lock; three independent paths now agree to the paisa |
| **4** | **Stockout risk never fired.** It was evaluated *after* the proposed order was added | Nothing ever appeared on the exception list | Evaluate at the current shelf position |
| **5** | **Demand class was computed once on weekly data** | A test asserting N05C is intermittent failed at weekly grain | Recompute per grain |
| **6** | **Prophet attributed +34 units to holidays** on a 104-unit baseline | Reading the explainability screen | Drop holidays at monthly grain |
| **7** | **The quantile grid clamped at its lowest level**, so a free-shortage product still got ordered | A property test: "free shortage means order nothing" | Anchor at (0, 0) |
| **8** | **Docker ran in fixture mode**, and the Vite proxy pointed at the wrong container | Actually running `docker compose up` | Auto-detect; `VITE_PROXY_TARGET=http://api:8000` |
| **9** | **The stock ledger was tested and unused** | Auditing what the API actually calls | Live position = opening + ledger movements |

## 4.1 Two corrections to our own design documents

**7 January is not a closure every year.** The architecture document claimed 2014–2019. On
**7 January 2017 the pharmacy was open and sold 59.9 units**. It is a closure in five of six
years. The "21 of 26 map to the Orthodox calendar" total is unaffected and is now asserted by a
test.

**Calibration runs the opposite way from what we predicted.** The document said intervals were
over-confident at 75% coverage, causing silent under-ordering. Measured, they are **too wide at
92.2%** — causing over-ordering. The methodology is unchanged; the business story flips.

---

# 5. What is deliberately not built

Saying this plainly is stronger than a half-built version.

| Not built | The line to use |
|---|---|
| **OIDC auth, multi-tenant row-level security** | *"Designed and specified. Tenant isolation is the one failure whose consequence is disclosing another pharmacy's commercial data, so it belongs in the database, not application code — and half-building that is worse than not building it."* |
| **Redis, Postgres, Prefect, OpenTelemetry** | *"Production choices for a production load. At eight series they add services to operate and change nothing a judge can see."* |
| **Batch-level expiry tracking** | *"This dataset has no batches. Claiming a batch-expiry feature on data without batches is exactly what our provenance rule exists to prevent."* |
| **Cross-sectional reconciliation** | *"It needs a store network that would be lane-3 synthetic — and lane 3 cannot back a claim, so reconciling across it would prove nothing."* |
| **Temporal MinT reconciliation** | *"The three grains are served independently and no screen depends on their coherence. It is the first thing we would add."* |
| **The stress-test harness** | *"Specified in the architecture document with a ten-scenario catalogue. It reuses the backtest harness; roughly half a day."* |
| **Natural-language assistant** | *"Below our cut line precisely because a live external API in a demo is a risk we chose not to take."* |
| **Live drift monitoring** | *"Needs production traffic. The calibration measurement is the offline version of the same idea."* |

---

# 6. ★ The demonstration, step by step

**Total: 6–7 minutes.** Run `python scripts/reset_demo.py` and restart the API first.

## 6.0 Before you start

```bash
docker compose up --build      # or the venv path
python scripts/reset_demo.py && docker compose restart api
```

Board should read **4 healthy, 3 needing an order, 1 overstocked, ₹1,099 exposure.**

---

## Step 1 — Open on the Dashboard *(45 s)*

> *"Every pharmacy makes this decision every week, from memory or a spreadsheet. This is what it
> looks like when you calculate it instead."*

**Do not open on a chart.** The screen says: **"4 products need your decision today, worth
₹1,099."** Ranked by money at risk, not by probability.

> *"A 30% chance on your biggest seller matters more than a 90% chance on something that sells
> twice a month. So the list is sorted by rupees."*

---

## Step 2 — Click the top exception → Orders & Risk *(90 s)* **← the core**

> *"Paracetamol. We hold 310, the reorder point is 524, and the system says order 220."*

Point at **"Where each input came from"**:

> *"Green means measured — the forecast. Grey means your setting — lead time, margin, stock. The
> grey never trains a model. It enters here, at the decision, and nowhere else."*

**Now move the slider.**

> *"This is 'how often are you willing to run out?'. Watch the quantity and the expected cost."*

Drag it. Then say the thing that matters:

> *"Open the network tab. Nothing is being fetched. The whole cost curve arrived with the
> recommendation, because the newsvendor calculation is closed form and the distribution was
> resolved last night. No model runs during a request."*

Point at the ±1 pack row:

> *"₹15.75 at the recommendation, ₹15.97 one pack under, ₹16.57 one pack over. It knows the cost
> of being slightly wrong in each direction."*

**Click Accept.**

> *"That posts a goods receipt. Stock goes 310 to 530, the status flips to OK, the suggestion
> drops to zero — and it is written to a hash-chained log. The system recommends; a person
> commits, and an override needs a reason."*

---

## Step 3 — "Why?" *(60 s)*

> *"Paracetamol is up 311 units next month: +310 from the January flu wave, +1 from trend."*

> *"Feature-importance charts explain the model. A buyer needs an explanation of the **quantity**,
> so the answer is in units — and the parts sum to the whole. A test asserts that, because an
> explanation that does not add up to the number it explains is worse than no explanation."*

**Scroll to the reliability diagram. This is the differentiator.**

> *"We measured whether our own confidence intervals are true. Our nominal 80% band actually
> covered 92% of outcomes — too wide, which means over-ordering and capital stuck on the shelf.
> Red is before correction, green is after. We corrected it to 82%."*

> *"Every dashboard in this market draws a confidence band. Nobody publishes whether theirs is
> right. And we tell you it rests on 256 points — enough to establish a direction, not enough to
> certify a per-series level."*

---

## Step 4 — Live Ops: the proof *(90 s)* **← the strongest evidence**

> *"The data ends in 2019, so showing a live system is hard. We replay it."*

**Press Start.** Let it run ~15 seconds.

> *"That is the real January 2019, one day per tick. Real sales posting, stock depleting, orders
> going out, deliveries landing four days later. Nothing is invented — the screen is watermarked
> with the window."*

**Scroll to "What it was worth."**

> *"Same real days. Same costs, same lead time, same review cadence, same protection interval.
> The only difference is that min/max orders to the average and we order to the quantile your
> cost ratio implies."*

> *"₹4,608 against ₹1,479. Sixty-eight percent lower — and it holds in three separate quarters,
> 64% and 76%. That is a measurement, not a projection."*

**The honest half — say it before anyone asks:**

> *"And notice we hold **more** stock and pay **more** holding cost. The entire saving comes from
> lost sales we did not have. That is the cost ratio doing its job."*

---

## Step 5 — Ops Console *(45 s)*

> *"Every number on this screen was written by the benchmark script. None is typed by a human."*

> *"Ensemble 0.907 against the seasonal-naive benchmark at 1.117 — 19% better."*

**Point at the ablation:**

> *"We implemented the obvious approach — pick each product's best model — and measured it
> losing. 0.968 against 0.907. With 300 weekly observations, 'best on the last fold' is mostly
> noise, so selection chases noise."*

**Point at the per-series table, at the red rows:**

> *"R06 is our worst series at 1.646, and M01AE is effectively a tie with a naive forecast. Both
> are on the screen in red. A system that only shows you where it wins is not telling you
> anything."*

---

## Step 6 — Close *(30 s)*

**State the limitation first.**

> *"The deepest limitation: we forecast **sales**, not demand. A stockout records zero sales, so
> our observations are right-censored — worst on exactly the products that matter most. It is in
> the model card, and it is the first thing a real deployment fixes by joining the pharmacy's own
> inventory ledger."*

Then:

> *"Every pharmacy guesses how much to order. We calculate it — with the odds, the cost of being
> wrong, and the reason behind the number."*

---

## 6.1 How to show ours is better — the three comparisons

| Against | Our line | The evidence |
|---|---|---|
| **A forecasting dashboard** | *"They stop at the chart. The buyer still has to decide what 187 units means at a 4-day lead time with 40 in stock."* | The order screen, the slider, the cost at ±1 pack |
| **A wholesaler's min/max reorder tool** | *"They order to the average. Average demand is met half the time."* | 67.9% lower total cost on identical real days |
| **A better single model** | *"Picking the best model is the obvious move. We implemented it and it lost."* | 0.968 vs 0.907, with the oracle bound at 0.843 |

## 6.2 If something breaks

| Failure | Response |
|---|---|
| API dies | `PHARMAPULSE_FIXTURES=1` — the app runs fully on fixtures and labels itself degraded. Rehearse this. |
| Deployed URL is cold | Local `docker compose up` already running as hot standby |
| Replay misbehaves | Skip it. The business-case card at the bottom of Live Ops loads independently |
| Everything | Recorded video, offline, on two devices |

---

# 7. Q&A drill

**"Isn't a median of five models just an average?"**
> The combination is one step. The ML is the global LightGBM quantile model, the conformal
> calibration, and the ADI/CV² router. But lead with the *result*: we tested selection against
> combination and measured selection losing. That is a finding, not a technique.

**"Eight products from one pharmacy. That's not a forecasting problem."**
> The problem is small; the failure modes are not. Intermittency, censoring, level shifts,
> closure days, multi-phase seasonality and calibration failure are all present here and all
> appear at scale. The global LightGBM member exists because per-series fitting is O(series) and
> dies at 20 million — on eight series it is unnecessary, and including it is the design decision.

**"How do I know your numbers are real?"**
> `git clone && pip install -r requirements.txt && python scripts/day1_benchmark.py`. Forty-five
> seconds, from a clean clone, on the committed dataset. It runs in CI on every push.

**"Your intervals were wrong."**
> They were, and we are the ones who found it. A nominal 80% band covered 92%. We corrected it
> and we show you both curves. The alternative was not measuring.

**"Why is R06 so bad?"**
> The May pollen peak is sharp and its timing moves year to year, and we have six observations of
> it. It is our worst series at 1.646, it still beats the benchmark's 1.880, and it is on screen
> in red.

**"Where's the ROI number?"**
> On the Live Ops screen, and it is a simulation over real days rather than an assumption. We
> deliberately do not quote a headline rupee figure per store per year, because that would be an
> argument dressed as a measurement.

**"What would you build next?"**
> Join a real inventory ledger, to fix the censoring. Then temporal reconciliation so the three
> grains are coherent. Then the stress-test harness.
