# The web application — every screen, every panel, every term

**What this is.** A reference for the running interface: what each screen shows,
what every number on it means, how it was computed, and which endpoint and file
produced it. If you can see it in a browser, it is described here.

**What this is not.** A presenter's script — that is
[SCREEN_GUIDE.txt](SCREEN_GUIDE.txt), which covers the same screens in plain
language for someone who did not build the system. This file assumes you will
be asked *"where does that number come from?"* and want to answer with a file
path.

| | |
|---|---|
| Base URL | `http://localhost:5173` in development, or the deployed origin |
| API | every screen reads `/api/*`; **no screen computes a forecast** |
| Contract | [../CONTRACTS.md](../CONTRACTS.md) §C3, generated into `contracts/openapi.json` |

---

## 0. Things that are true on every screen

### 0.1 The response envelope

Every API response has the same shape. The `meta` block is built once in
`api/deps.py::meta()` and is on **every** response, so no route can forget it.

```jsonc
{
  "data": { /* whatever the endpoint returns */ },
  "meta": {
    "origin": "observed",                    // the LANE — see 0.2
    "as_of": "2019-10-09",                   // the system's clock — see 0.3
    "model_version": "2026-09-02T0803Z/ens-v1",
    "snapshot_id": "sha256:49e4f1c5c3da",    // hash of the input file
    "generated_at": "2026-09-02T08:03:43Z",
    "stale": false,
    "degraded": null,                        // "fixtures" when serving fallbacks
    "correlation_id": "c-4fad746a"
  }
}
```

### 0.2 `origin` — the provenance lane

The single most important field in the system. Every value belongs to exactly
one lane and the lanes have different rights.

| Lane | What it is | Trains a model | Explains | Backs an accuracy claim |
|---|---|---|---|---|
| `observed` | `salesdaily.csv` and calendar features derived from it | **yes** | yes | **yes** |
| `user_setting` | lead time, holding cost, margin, stock on hand, pack size | **no** | yes, as a named input | **no** |
| `synthetic` | any generated or demo data | **no** | no | **no** |

Enforced in code, not by convention: `pipelines/ingest.py` refuses a synthetic
path loaded under any other lane, `pipelines/validate.py` refuses a *mixture* of
lanes in one batch, every row carries an `origin` column, the forecast store
records the lane it was fitted on, and the **Data** screen renders it as a badge
that turns amber when it is not `observed`.

### 0.3 `as_of` — the system's clock

**The day the system is deciding for: the day after the last observation.**

It is *not* the browser's date. A buyer decides for the next period, not for
whenever the page happened to be opened. It moves on its own when a different
dataset is published — `2019-10-09` on the real file, `2026-10-01` on the
synthetic extension, with nothing configured.

Computed in `core/forecast_store.py::as_of()`. Shown on the Decisions screen as
**"Deciding for · 9 October 2019"**.

### 0.4 The degradation ladder

If the forecast store is missing, the API serves `contracts/fixtures/*.json` and
sets `meta.degraded = "fixtures"`. The interface renders a badge from it. The
app always runs; it just tells you what it is running on.

### 0.5 Nothing on any screen fits a model

Every expensive computation happens in an offline batch that writes a versioned
forecast store. Serving a screen is a **read**. That is why the service-level
slider recomputes with no network call, and why two people opening the same
product on the same day see the same number.

---

## 1. DECISIONS — `/`

> *What needs my decision today?*

The landing screen. It opens on exceptions, never on a chart: a screen that
opens on a time series makes the user do the work of finding the problem.

**Endpoints:** `GET /api/risk?limit=20`, `GET /api/positions`

| Panel | What it shows | Where it comes from |
|---|---|---|
| **Headline** | *"Four products need a decision, ₹1,236 at risk."* A sentence, not a KPI row. | `risk.total_exposure` |
| **"Deciding for"** | The system clock. See §0.3. | `meta.as_of` |
| **Three counters** | ORDER NOW / CAPITAL STUCK / HEALTHY, accounting for all eight products | `positions[].status` |
| **Exception list** | One row per product needing attention, ranked by **money** | `decision/risk.py` |
| **Runway chart** | Days of cover per product as a bar, with the protection interval drawn through it | `positions[].days_of_cover` |
| **Shelf position** | The full table — stock, cover, reorder point, run-out date, suggestion | `GET /api/positions` |

### Terms on this screen

**`STOCKOUT` / `OVERSTOCK` badge** — one of four rules in `decision/risk.py`. The
stockout rule is evaluated at the **current** shelf position, *before* any order
is placed. An earlier version evaluated it after ordering, so it never fired.

**"85% likely"** — a real probability read off the calibrated forecast
distribution, not a threshold somebody set.

**"₹276 at risk"** — for a shortage, the gross margin lost on the units expected
to be missing. For overstock, the holding cost on capital sitting idle.

**Why the list is ranked by money, not probability.** Look at the rows: one is
99% certain and ranked *last* because it is worth ₹163; one is 34% likely and
ranked above it because it is worth ₹276. *A 30% chance on your biggest seller
matters more than a 90% chance on something that sells twice a month.*

**The dashed line on the runway chart** — the **protection interval**, 11 days.
A bar ending left of it runs out before the next delivery can land.

**Why a slow mover can clear the line and still say "order now"** — its reorder
point carries safety stock for how erratic it is. Sedatives sit at 23.7 days of
cover and still need ordering, because their demand is intermittent and the
reorder point reflects that. This looks like a bug and is not; the chart says so
in its own footnote.

---

## 2. ORDER — `/orders`

> *What do I actually buy?*

The screen the whole system exists for.

**Endpoint:** `POST /api/recommend`, `POST /api/orders`, `GET /api/ledger`

| Panel | What it shows |
|---|---|
| **The slider** | *"How often are you willing to run out?"* — the only input a buyer has an opinion about |
| **Causality line** | *"Accept a 4.8% chance of running out and you order 240 units (24 packs) at ₹38.61."* |
| **Four readouts** | Service level · Stockout risk · Cost this cycle · vs cheapest |
| **Cost curve** | Expected cost at every service level. U-shaped; the marked point is the bottom |
| **±1 pack** | What one pack fewer and one pack more actually cost |
| **Position** | On hand, reorder point, days of cover, run-out date, target level, recommendation |
| **What the position is made of** | The ledger trail: opening stock + every movement since |
| **Lead-time demand** | p5 / p25 / p50 / p75 / p95 of demand over the protection interval |
| **Where each input came from** | Provenance: MEASURED vs YOUR SETTING, per input |

### Terms on this screen

**`q*` — the critical fractile.** `q* = Cu / (Cu + Co)`.

- **`Cu`** — the cost of ordering one unit too *few*: the gross margin you lose
  when a customer asks and you do not have it.
- **`Co`** — the cost of one too *many*: holding cost on the capital for the
  protection interval, plus expiry risk.

If a shortage costs 3× an excess, `q* = 0.75` and you order the quantity you
exceed only one cycle in four. This is the **newsvendor** formula — a hundred
years old and *exact*, not an approximation and not a heuristic.

**Why the slider is instant.** `q*` is closed form, and `POST /api/recommend`
ships the whole cost curve — 16 service levels with the quantity and cost at
each. `web/src/components/ServiceLevelSlider.tsx` interpolates locally.
**Zero network calls while dragging.** Verified.

**Protection interval.** `lead_time + review_period` = 4 + 7 = **11 days**. If
you order today, the stock must last until the *next* order arrives, not just
until this one does. Sizing against the lead time alone was a real bug; the
replay surfaced it as persistent stockouts, and fixing it took the simulated
shortfall from 2,207 units to 121.

**Lead-time demand (p5 … p95).** The demand distribution over the whole
protection interval, not one day. The centre scales linearly with the number of
days; the spread scales with **√n**, because independent periods add in variance
rather than in standard deviation.

**Rounding.** `round_to_pack` **ceils** when `Cu >= Co` — medicines come in
packs and you cannot order 23.4 units. Rounding up is correct when running out
is the more expensive mistake.

**"On hand 310" is not stored.** It is opening stock **plus** every ledger
movement since — `api/deps.py::live_stock()`. Accepting an order actually moves
the shelf.

---

## 3. FORECAST — `/forecast`

> *What will sell, and how sure are we?*

**Endpoint:** `GET /api/forecast?series_id=&grain=&horizon=`

| Panel | What it shows |
|---|---|
| **Grain toggle** | Daily / Weekly / Monthly — three clocks, three questions |
| **Fan chart** | Blue = actuals, black = median forecast, three grey bands = 50/80/90% |
| **Horizon slider** | How many periods ahead |
| **Members behind the median** | The five models' individual predictions per horizon |
| **Series profile** | Demand class, ADI, CV², daily mean, zero-sale %, peak month |

### Terms on this screen

**The three grains answer different questions.** Daily: *will I run out before
the next delivery?* Weekly: *what do I order on Tuesday?* Monthly: *how much
cash do I need, and when?*

**The bands are conformally calibrated** — see §4.

**"part period" and the dashed stub.** The last bucket is *truncated*: the file
ends 8 October 2019, so the week beginning 7 October holds two days of sales.
The fan is anchored to the last **complete** bucket and the partial tail is
drawn dashed with a hollow marker. Without that the chart appeared to ignore its
own last observation.

**ADI** — average demand interval, the mean number of periods between non-zero
sales.

**CV²** — squared coefficient of variation of the **non-zero** quantities. ADI
separates irregular *timing*; CV² separates erratic *size*.

**Demand class** — the Syntetos–Boylan quadrant, cutoffs `ADI 1.32` and
`CV² 0.49`:

| | CV² < 0.49 | CV² ≥ 0.49 |
|---|---|---|
| **ADI < 1.32** | **smooth** → Prophet · AutoARIMA · MSTL · SeasonalNaive · LightGBM | **erratic** → LightGBM · MSTL · SeasonalNaive · AutoARIMA |
| **ADI ≥ 1.32** | **intermittent** → CrostonOptimized · SeasonalNaive · LightGBM | **lumpy** → CrostonOptimized · LightGBM · SeasonalNaive |

Recomputed **every night, per grain**, from the data — never configured.
Aggregation removes sparsity, so a product can be intermittent daily and smooth
weekly. N05C is exactly that: 67.9% zero days at daily grain, smooth at weekly.

**The five ensemble members** are `Prophet · AutoARIMA · MSTL · SeasonalNaive ·
LightGBM`, the same five for every product (`core/combine.py`). Combined by
**median**, not mean, and not best-of-five.

---

## 4. WHY — `/explain`

> *Where did that number come from, and should I trust it?*

**Endpoint:** `GET /api/explain?series_id=&grain=&horizon=`

| Panel | What it shows |
|---|---|
| **Attribution, in units** | *"Antihistamines is down 20 units next month"*, decomposed |
| **Seasonal profile** | That medicine's own month-by-month demand index |

### Terms on this screen

**Why the explanation is in units.** A feature-importance chart explains the
*model*. A buyer needs an explanation of the *quantity*. So the answer is
`-23.7 units from seasonality, +4.0 from trend`, and **the parts are forced to
sum to the total** — `core/explain.py::_reconcile()`, asserted by a test. An
explanation that does not add up to the number it explains is worse than none.

**Where the components come from.** Prophet's fitted `trend`, `yearly` and
`holidays` components, read directly. That is why Prophet is in the portfolio at
all — the components are already in the units of the series.

**The seasonal label is derived, not looked up.** *"Coming off its May peak"* is
computed from the measured peak month. It used to be a hardcoded table
(`"R06": "pollen season"`), which was the only claim on any screen the code had
not computed — and would have been silently wrong on anyone else's data.

**The seasonal profile chart.** Every month indexed against that product's own
average; `1.0` is a typical month. It is the *evidence* for the sentence beside
it. Measured on the real file: R06 peaks in May at **1.74×**, N02BE in January
at **1.49×**, R03 in December at **1.46×** — which is why a single global
seasonal profile would have smeared them.

**`price` and `promotion` are absent by name.** No such column exists in the
data, so a fitted coefficient on one would describe noise — and this screen
would then present that noise to a pharmacist as a commercial driver.

---

## 5. REPLAY — `/live`

> *What would this have been worth?*

**Endpoints:** `POST /api/replay/start`, `POST /api/replay/tick`,
`GET /api/replay/business-case`

| Panel | What it shows |
|---|---|
| **Window tabs** | Three real quarters of 2018–2019 history |
| **Simulated date + controls** | Start / Pause, a speed picker, *Step 1 day* |
| **Scorecard** | Orders placed, units short, holding cost, total cost |
| **Shelf, right now** | Live position per product as the replay runs |
| **Event feed** | Sales, deliveries, orders, status flips |
| **What it was worth** | **Four** policies compared |
| **Reading this comparison** | Definitions of every term used above |

### The four policies

| Policy | Sizes at | Gets our forecast? | What it is |
|---|---|---|---|
| **PharmaPulse** | empirical quantile at `q*` | yes | what we ship |
| `normal_approx` | `median + z·σ` | **yes** | **the rung that carries the claim** |
| `safety_stock` | `μ·L + z·σ·√L` from trailing statistics | no | what an ERP actually does |
| `minmax` | `mean · (L + R)` | no | the "no system at all" floor |

**Read `normal_approx`.** It gets our forecast, our protection interval and our
service level, and differs in exactly one thing — it sizes with a normal
approximation instead of reading the quantile off the calibrated distribution.
Forecast quality is held constant, so the gap is attributable to the
**distribution** and nothing else.

**Every policy sizes off the same trailing window of real sales**, strictly
before the simulated day. Anything else makes the replay a comparison of
forecast vintages rather than of decision rules.

### The measured result

Positive means PharmaPulse is cheaper:

```
                   Jan-Mar 19   Apr-Jun 19   Oct-Dec 18
minmax                  +6.0%       +48.8%       +61.1%
safety_stock            -2.9%       +23.1%        -1.8%
normal_approx          +17.9%        +8.1%        +0.4%
```

We beat the normal approximation on all three. **We are level with a real ERP
policy** — one win, two small losses — and those cells ship in amber rather than
being cropped out.

### Terms on this screen

**Lost margin** — demand arrived and there was nothing to sell, charged at the
unit margin. This is the number that dominates.

**Holding** — stock that sat on the shelf overnight, charged at the annual
holding rate plus expiry risk. **Ours is deliberately higher.**

**Units unsupplied** — total units of real demand that could not be met.

**Why the saving is credible.** It does not come from holding *less* stock — we
hold more. It comes entirely from running out less often, and a test asserts
that relationship so the claim cannot quietly invert.

**What this does not yet measure.** Because every policy sizes off a trailing
window, none can anticipate a **seasonal turn** — on 1 January the last 180 days
are autumn. Anticipating it is what the forecast layer is for, and exercising it
here needs a forecast produced at each review point rather than one vintage.

**Concurrency.** Each replay session holds a `threading.Lock`. Concurrent ticks
used to corrupt a run — the shortfall went from 121 units to 547 — so ticks are
serialised and the client pauses its poller while one is in flight.

---

## 6. EVIDENCE — `/ops`

> *Prove it.*

Every number on this screen was written by `scripts/day1_benchmark.py` running
from a clean clone. The interface only *reads* `artifacts/benchmarks.json`.

**Endpoint:** `GET /api/metrics`

| Panel | What it shows |
|---|---|
| **In plain terms** | The answer, in words, before any number |
| **Four readouts** | Ensemble MASE · benchmark · interval coverage · fitting cost |
| **The result worth leading with** | selection 0.968 vs combination 0.907 vs oracle 0.843 |
| **Model leaderboard** | All eleven models, best first |
| **Calibration** | The reliability diagram, before and after correction |
| **Per series** | Including where we lose |
| **What the portfolio costs** | Fit time by family, and what does and does not cache |
| **Provenance** | Snapshot hash, model version, audit chain, runtime |

### Terms on this screen

**MASE** — Mean Absolute Scaled Error, against an in-sample naive denominator
(m = 1). Below 1.0 beats the naive baseline; above 1.0 is worse than repeating
last week. **We use MASE and not MAPE** because MAPE is undefined when the
actual is zero, and one product sells nothing on 67.9% of days.

**The protocol** — weekly grain, horizon 8, rolling-origin cross-validation with
4 non-overlapping folds, 8 series, seed 42. Rolling-origin means the model only
ever sees data from before the point it is forecasting.

**Selection vs combination.** We built the obvious approach — pick each
product's best model — and measured it **losing**: 0.968 against 0.907. With
~300 weekly observations, "best on the last fold" is mostly noise, so selection
chases noise. Independent models make independent mistakes and the median
cancels them. Scored honestly: the choice for fold *k* uses only folds 1…*k*−1.

**Oracle (0.843)** — perfect hindsight. A bound, not a model. Included so you
know how much room is left.

**Calibration / the reliability diagram.** Every interval we ever stated,
checked against what actually happened. A stated 80% band covered **92.2%** of
outcomes — too *wide*, which sounds like the safe direction and is not: an
over-wide band pushes the order quantity up and the buyer pays holding cost for
confidence the model has not earned. Conformal correction pulls it to **82.0%**.

- X axis: how confident we *said* we were. Y axis: how often we were *right*.
- Dashed diagonal: perfect. **Above** = too wide (over-orders). **Below** = too
  narrow (over-confident, runs out).
- `n = 256` is stated on purpose: enough to establish a consistent *direction*
  of miscalibration, not enough to certify a per-series level.

**Conformal prediction** — distribution-free. It assumes nothing about the shape
of the residuals: it takes the actual historical residuals, finds the empirical
quantile, and rescales the interval by the ratio. The scale factor is clamped to
[0.25, 5.0] so one bad series cannot destroy every interval.

**"Best single model, of all 11"** — the per-series column shows `Naive`,
`WindowAverage`, `CrostonOptimized`. **These are not what we ship.** The column
names the best single performer out of all eleven for that product, which is the
comparison behind the ablation above. We ship the same five-model ensemble for
every product.

**`wins` / `ties naive` / `above naive`.** The ensemble beats seasonal-naive on
all eight, so that comparison is not the interesting one. The honest column is
absolute: MASE above 1.000 is worse than repeating last week — **R03 at 1.137
and R06 at 1.646 are**, and **M01AE at exactly 1.000 ties**. A tie is not a loss.

**Fitting cost.** 292 model-fold fits in 29.7 s — about 102 ms each. The
statistical family dominates (24.3 s) because it fits *per series*; LightGBM is
one global model across all eight (1.1 s) and is the cheapest thing in the
portfolio.

**What does and does not cache.** Serving is cached — an in-process LRU keyed on
`model_version`, so no model runs inside a request. **The batch is not**: it
refits from scratch every run, no warm start, no incremental update. Affordable
at 8 products; the first thing that breaks at 8,000. Stated in amber rather than
left to be discovered.

---

## 7. DATA — `/data`

> *Which dataset is live, and what date is it running as of?*

**Endpoints:** `GET /api/datasets`, `POST /api/datasets/rebuild`,
`POST /api/datasets/upload`, `POST /api/datasets/activate`,
`GET /api/datasets/jobs/{id}`

| Panel | What it shows |
|---|---|
| **Live dataset** | Version, clock, as-of, snapshot hash, warehouse path, **lane badge** |
| **Run as of a different date** | Source file picker + date + Rebuild |
| **Use your own file** | CSV upload with column validation |
| **Every version built** | All versions, with Activate |

### Terms on this screen

**"Deciding for" vs "Fitted as of".** The first is the clock — the day after the
last observation. The second is the truncation point, or *"the whole file"* when
none was applied.

**As-of rebuild.** The data is truncated **before** anything is fitted, so the
demand class, the routing, the models and the calibration are all recomputed on
what was knowable that day. It is **not** a filter over a finished forecast —
that would already have leaked, through the demand class alone. Takes about 20
seconds.

**The lane badge** turns amber when the live dataset is not `observed`. A
synthetic dataset may demonstrate the pipeline and may never back an accuracy
claim.

**Activation is instant** because publication was always a pointer swap and the
version directories are immutable. Switching back after a demo refits nothing.

**Upload validation happens in the request that sent the file** — columns are
checked before anything expensive starts, so a wrong file fails while you are
still looking at it.

**Not built:** authentication, quotas, and any attempt to survive a restart.
Jobs live in memory and die with the process.

---

## 8. SETTINGS — `/settings`

> *These are my shop's numbers, not yours.*

**Endpoints:** `GET /api/settings`, `PUT /api/settings`

| Panel | What it shows |
|---|---|
| **Shop-wide** | Lead time, review period, holding cost rate, expiry risk rate, currency |
| **Per product** | Pack size, unit cost, unit margin, stock on hand, **lead time override**, live `q*` |

### Terms on this screen

**Everything here is lane 2.** It is entered by you, it is labelled as a setting
everywhere it appears, and **it never trains a model**. In a real deployment it
comes from the pharmacy's own system.

**Why that matters.** The dataset has dates and units sold. It has no stock, no
price, no cost, no lead time. A system that invents those and trains on them is
learning from a random number generator — and the *Why* screen would then
present that noise to a pharmacist as a commercial driver.

**Per-product lead time.** Lead time genuinely varies by line: a controlled drug
from one licensed distributor does not arrive on the same clock as generic
paracetamol from a wholesaler who calls twice a week. **Blank means "follow the
shop"**, not zero — an untouched product keeps tracking a change to the global
value, which is why the cell shows a placeholder rather than a number.

**`q*` is computed live from these values.** Raise the margin and the system
orders more; raise the holding cost and it orders less. That is the whole
decision, visible here rather than buried.

**The demo to run.** Change lead time from 4 to 9 days and go back to *Order* —
the quantity jumps, because the order now has to cover a longer protection
interval. Nothing was retrained; the forecast did not change. Only the decision
did.

---

## 9. The limitation printed on several screens

> **We forecast *sales*, not *demand*.**

A stockout records zero sales, which is indistinguishable from zero demand. So
the observations are **right-censored**, and the censoring is worst on exactly
the products the system most needs to get right. Left uncorrected it is
self-reinforcing: a stockout depresses recorded sales → the forecast falls →
the order falls → another stockout.

We flag days where sales hit a suspicious ceiling. We **cannot verify** the
correction, because this dataset has no on-hand-stock column. It is named in
[MODEL_CARD.md](MODEL_CARD.md) and it is the first thing a real deployment
fixes, by joining the pharmacy's own inventory ledger.

---

## 10. Where every screen's data comes from

| Screen | Endpoints | Backing code |
|---|---|---|
| Decisions | `/api/risk`, `/api/positions` | `decision/risk.py`, `api/deps.py::live_stock` |
| Order | `/api/recommend`, `/api/orders`, `/api/ledger` | `decision/newsvendor.py`, `decision/ledger.py` |
| Forecast | `/api/forecast`, `/api/series` | `core/forecast_store.py`, `core/combine.py` |
| Why | `/api/explain` | `core/explain.py` |
| Replay | `/api/replay/*`, `/api/replay/business-case` | `decision/replay.py` |
| Evidence | `/api/metrics` | `artifacts/benchmarks.json` ← `scripts/day1_benchmark.py` |
| Data | `/api/datasets/*` | `api/routers/datasets.py`, `pipelines/run_nightly.py` |
| Settings | `/api/settings` | `api/deps.py::series_settings` |
