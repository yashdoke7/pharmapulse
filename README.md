# PharmaPulse

> **Every pharmacy guesses how much to order. We calculate it — with the odds, the cost of being
> wrong, and the reason behind the number.**

PharmaPulse turns six years of pharmacy sales history into one number a buyer can act on: **how many
boxes of each medicine to order this week.** It forecasts demand as a distribution, measures whether
its own confidence intervals are honest and corrects them, converts the distribution into a purchase
quantity using the pharmacy's own costs, explains the result in units, and reports on its own
accuracy.

```
history  →  forecast  →  uncertainty  →  order quantity  →  cost of being wrong
```

Cognizant campus drive · Healthcare · Pharma Sales Analysis & Forecasting.

---

## The documents

| Document | What it is |
|---|---|
| **[docs/PHARMAPULSE_SYSTEM.md](docs/PHARMAPULSE_SYSTEM.md)** | **Start here.** The whole project in one file: how the pieces connect, every decision and the alternative it beat, the results, and where the code is |
| **[docs/ARCHITECTURE_DELTA.md](docs/ARCHITECTURE_DELTA.md)** | **What changed against the submitted design.** 4 components removed, 2 moved layer, 5 added — plus 3 design claims the data contradicts. Read it next to the design documents |
| [docs/DEMONSTRATION.md](docs/DEMONSTRATION.md) | Run it, then present it — with the words |
| [docs/PHARMAPULSE_RESULTS.md](docs/PHARMAPULSE_RESULTS.md) | Condensed results and the demo script |
| [docs/MODEL_CARD.md](docs/MODEL_CARD.md) | Intended use, evaluation, seven named limitations |
| [team/results/](team/results/) | Per-workstream deep dives with code walkthroughs |
| [CONTRACTS.md](CONTRACTS.md) | The five frozen interfaces |
| [docs/PHARMAPULSE_CONCEPT.md](docs/PHARMAPULSE_CONCEPT.md) · [ARCHITECTURE](docs/PHARMAPULSE_ARCHITECTURE.md) | The original design proposal and engineering reference |

---

## Run it

```bash
python -m venv .venv && source .venv/Scripts/activate     # Windows Git Bash
pip install -r requirements.txt
python scripts/check_data.py                              # verifies the dataset
python -m pipelines.run_nightly --stage all               # ~3 min: gold + forecast store
python scripts/day1_benchmark.py                          # ~45 s: every accuracy number
uvicorn api.main:app --port 8000                          # API
cd web && npm install && npm run dev                      # app on :5173
```

Or in containers — verified, and the API auto-detects the store:

```bash
docker compose up --build          # api on :8000, web on :5173
python scripts/reset_demo.py       # put the board back before a rehearsal
```

**Dataset:** Kaggle *Pharma Sales Data* (milanzdravkovic). Put **`salesdaily.csv` only** into
`data/observed/`. The supplied monthly file is corrupt — weekly and monthly grains are derived.

If the forecast store is missing, the API automatically serves `contracts/fixtures/*.json` and
labels itself degraded, so the app always runs.

---

## What it does, measured

### Forecast accuracy

`make benchmark` reproduces every figure from a clean clone in ~45 s. Weekly grain, horizon 8,
4 rolling-origin folds, MASE, seed 42.

| Model | MASE |
|---|---|
| Naive | 1.332 |
| SeasonalNaive — *the benchmark to beat* | **1.117** |
| AutoARIMA | 1.115 |
| MSTL | 1.014 |
| LightGBM (global, quantile) | 0.961 |
| Prophet | 0.935 |
| **Ensemble (median of 5) — what we ship** | **0.907** |
| *Oracle (perfect hindsight — a bound, not a model)* | *0.843* |

**18.8% better than the seasonal-naive benchmark.**

### The result worth leading with

We implemented the obvious approach — pick each product's best model — and measured it losing.

| Strategy | MASE |
|---|---|
| Pick the best model per series | 0.968 |
| **Combine them (median)** | **0.907** |
| Perfect hindsight | 0.843 |

With ~300 weekly observations, "best on the last fold" is mostly noise, so selection chases noise.
Independent models make independent mistakes and the median cancels them.

### Calibration

A nominal 80% interval actually covered **92.2%** of outcomes — too *wide*, which causes
over-ordering and ties up capital. Conformal correction brings it to **82.0%**. Both curves are
shown in the product on the *Why* screen. n = 256, which establishes a consistent direction and
does not certify a per-series level — stated rather than glossed over.

### Business case

Our policy against a min/max policy, replayed over the identical real days with identical costs,
lead time, review cadence and protection interval. The only difference is that min/max sizes against
the **mean** while we size against the quantile the cost ratio implies.

| Window | Min/max | PharmaPulse | Lower by |
|---|---|---|---|
| Jan–Mar 2019 | ₹4,608 | ₹1,479 | 67.9% |
| Apr–Jun 2019 | ₹3,362 | ₹1,200 | 64.3% |
| Oct–Dec 2018 | ₹4,942 | ₹1,211 | 75.5% |

Measured, not assumed. The saving comes from fewer lost sales — we deliberately hold *more* stock
and pay *more* holding cost, and a test asserts that.

---

## The seven screens

| Screen | The question it answers |
|---|---|
| **Dashboard** | *What needs my decision today?* Exceptions ranked by rupee exposure. Never opens on a chart. |
| **Orders & Risk** | *What do I order?* The service-level slider, with the cost curve interpolated locally. |
| **Forecast** | *Do I believe this?* Fan chart with 50/80/90 bands, and the members behind the median. |
| **Why** | *Where did the number come from?* Attribution in units, plus the reliability diagram. |
| **Live Ops** | *Is it alive?* The real 2019 history replayed a day at a time, with the business case. |
| **Ops** | *Is it honest?* Leaderboard, ablation, per-series results including where we lose. |
| **Settings** | Lane-2 parameters. Change the lead time and watch the order quantity move. |

---

## The rule that protects the project

Every value belongs to one of three lanes, and the lanes have different rights.

```
LANE 1  observed       salesdaily.csv + calendar features derived from it
        trains models YES · explains YES · backs an accuracy claim YES

LANE 2  user_setting   lead time, holding cost, margin, stock on hand, pack size
        trains models NO  · explains YES (as a named input) · backs a claim NO

LANE 3  synthetic      demo-only data
        trains models NO — raises in code · explains NO · backs a claim NO
```

Enforced, not intended: the ingest entrypoint **raises** on a synthetic path, every row carries an
`origin` column, the API returns it, and the UI renders a badge from it. `price` and `promotion` are
excluded by name — no such column exists, so a fitted coefficient on one would describe noise, and
the explainability screen would then present that noise to a buyer as a commercial driver.

---

## What we found in the data

Seven properties drove the architecture, all measured before anything was designed:

1. **The supplied monthly file is corrupt** — January 2017 reads ~zero against ~2,700 real units.
   We ingest `salesdaily.csv` only and derive the rest, asserted by a reconciliation test.
2. **26 days are closures, not zero demand** — 21 of 26 map to the Serbian Orthodox calendar.
   Masked from the loss, never imputed, never deleted.
3. **The last bucket is truncated** — October 2019 looks like a 70% collapse and is not. Partial
   periods stay visible as hatched bars.
4. **N05C is intermittent** (67.9% zero days, ADI 3.12) and routes to Croston/TSB.
5. **Units are fractional** — forecasts are continuous, orders are not.
6. **Seasonality has a different phase per drug** — R06 peaks in May, N02BE in January.
7. **Weekday effects run in opposite directions** — a shared coefficient would cancel.

**Two corrections we made to our own design documents after measuring:**

- The doc claimed 7 January is a closure every year 2014–2019. It is not — on 7 January 2017 the
  pharmacy was open and sold 59.9 units. Corrected; the "21 of 26" total is unaffected.
- The doc claimed intervals were over-confident at 75% coverage. Our measurement runs the opposite
  way — 92.2%, too wide. The lesson is unchanged, the business story flips.

---

## The limitation we state out loud

**We forecast *sales*, not *demand*.** A stockout records zero sales, indistinguishable from zero
demand, so the observations are right-censored — and the censoring is worst on exactly the products
that matter most. Left uncorrected it is self-reinforcing: a stockout depresses recorded sales, the
forecast falls, the order falls, another stockout.

We flag suspicious ceilings. We cannot verify the correction, because this dataset has no
on-hand-stock column. It is named in the model card and it is the first thing a real deployment
fixes, by joining the pharmacy's own inventory ledger.

---

## Layout

```
pipelines/   ingest · validate · clean · features · nightly runner
core/        classify · portfolio · combine · calibrate · store · explain
decision/    newsvendor · ledger · risk · replay
api/         FastAPI, 15 endpoints
web/         React + TypeScript + Vite + Tailwind
scripts/     check_data · day1_benchmark · make_fixtures · dump_openapi
contracts/   schemas, fixtures, generated openapi.json
tests/       unit · property · contract  (135 tests)
docs/        design proposal · architecture · RESULTS · model card
```

Each folder has a README stating its target, inputs, outputs and definition of done.
`CONTRACTS.md` is the authority on every shape.

---

## Status

| | |
|---|---|
| Data pipeline, forecast engine, decision engine, API, six screens, replay | **working on real data** |
| `make benchmark` reproducing every number | **yes**, from a clean clone |
| Tests | **135 green** |
| Docker / Compose | **verified** — `docker compose up --build`, API serves real forecasts |
| Auth, multi-tenancy, Redis, Postgres | **deliberately not built** — see `team/05` §10 |
