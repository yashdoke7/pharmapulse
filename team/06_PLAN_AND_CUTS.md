# PLAN REVIEW, CUT LINE & 4-DAY SCHEDULE

> Lead's document. Read it once, then run the schedule and defend the cut line.

---

## Part 1 — What the design gets right

The two documents in `docs/` are unusually strong, and the strength is specific rather than general:

1. **The thesis is correct and it is the differentiator.** Stopping at a chart leaves the valuable
   half of the problem with the user. The newsvendor step is a hundred years old, exact, closed-form,
   and almost nobody in this market ships it. That single decision separates this from every other
   "sales forecasting dashboard" a judge will see that day.
2. **The data profiling drives the architecture.** Corrupt monthly file → one source of truth. 26
   closure days → a closure calendar. N05C at 67.9% zeros → a demand-class router. Opposite weekday
   effects → per-series coefficients. Each design decision traces to a measured property of the file.
   This is what "engineering" looks like to a judge, and it is very hard to fake in Q&A.
3. **Combination-over-selection is a real result, not a citation.** *"We implemented the obvious
   approach and measured it losing"* (1.091 vs 0.906, oracle 0.883) is the strongest slide available.
   It also pre-empts the "a median of five models is not machine learning" objection.
4. **Calibration as a product surface.** Measuring that a nominal 80% interval covered 75% and
   showing the before/after reliability curve is genuinely rare, and it directly funds the decision
   layer: an over-confident interval makes the newsvendor under-order while the screen claims 95%.
5. **The three-lane provenance rule converts the project's biggest vulnerability into its most
   credible feature.** It costs almost nothing to implement and it defuses the "you invented those
   columns" attack before it is made.
6. **The self-critique section.** Reporting where the ensemble loses (M01AE), naming censored demand
   as the deepest limitation, and disclosing the stress-test metric artifact — that reads as
   scientists, and experienced judges discount teams that only report wins.

**Verdict: do not redesign anything. The plan is sound. The risk is entirely in execution and scope.**

---

## Part 2 — The five things I would change

### 1 ⚠ The numbers in the architecture document are not backed by anything in this repository

`docs/PHARMAPULSE_ARCHITECTURE.md` cites `day1_benchmark.py`, `artifacts/benchmarks.json`,
`mkdiagram.py` and `pharmapulse_architecture.svg`. **None of them exist here.** The repository
contained only the two markdown files and two PNGs when this structure was created.

Every headline claim — MASE 0.906, seasonal naive 1.118, selection 1.091, coverage 0.750, the stress
test table — currently rests on an analysis nobody in the team can re-run.

The document itself already flags a wobble: *"the ensemble prints 0.902 when weekly is regenerated
from the daily file (the correct approach) and 0.906 when scored against the supplied weekly file."*
Those are two different numbers from two different protocols, and only one of them is consistent
with the project's own "one source of truth" rule.

> **Action, and it is the highest-priority item in the sprint:** Pod B rebuilds
> `scripts/day1_benchmark.py` on **Day 1 morning**, before any modelling work. If the regenerated
> numbers differ, **the new numbers are the truth and the deck changes.** Pick one protocol —
> weekly derived from daily — and quote it consistently everywhere. Pin `random_state`. Nothing goes
> on a slide until `make benchmark` has written it.

### 2 The plan is written for 7 days. You have 4.

The phase table in the architecture document assumes seven days plus a Phase 0 evening. Compressing
it by 43% without deciding what to drop means dropping things at 3 a.m. on the last night, which is
how demos die. **Part 3 of this file is the explicit cut.**

### 3 Cross-sectional reconciliation contradicts the provenance rule — drop it

The design proposes MinT over two hierarchies. The cross-sectional one is product → group → **store
→ region**, but there is one store in this dataset. The store network would be lane-3 synthetic, and
lane 3 may not back an accuracy claim — so reconciling across it produces a coherence result that
cannot be reported. **Build temporal reconciliation only** (day → week → month). That one is real,
uses the same mechanism, and carries the strong "three clocks, one system" story with a measured
number behind it (direct monthly 0.912 vs summed-from-weekly 0.954).

### 4 Seven endpoints is under-specified for the six screens

`/forecast /explain /risk /recommend /simulate /assistant /metrics` cannot render the described UI.
There is no way to list products, no way to fetch history for a chart, no way to read or write the
lane-2 settings the decision engine depends on, and no health check. `CONTRACTS.md` C3 adds
`/series`, `/history`, `/settings`, `/health` and `/replay`. Twelve endpoints, priority-ordered, two
of them below the cut line.

### 5 Make "mock servers and fixtures" a Day-0 deliverable, not an intention

The design says components are *"developed against fixtures and mock servers until the real
implementation lands"* but assigns that to nobody. With four pods this is the difference between
parallel work and a queue.

> **Done already:** `contracts/fixtures/` now holds nine shape-correct fixtures, and
> `scripts/make_fixtures.py` regenerates them. Pod D can build every screen today; Pod C serves
> those files verbatim from hour one and swaps in real reads endpoint by endpoint.

### Smaller notes

- **Prophet is the install risk.** It is the best single model *and* the source of the explainability
  decomposition, so it is worth keeping — but guard the import and verify it on all 8 machines on
  Day 0, not Day 3.
- **`numpy` is pinned to 1.26.4** because `numba` inside `statsforecast` rejects numpy 2.x. Do not
  let anyone bump it.
- **The ₹1.8 lakh business case must stay labelled an assumption** while the accuracy figures are
  labelled measurements. Presenting them as the same kind of claim undermines both.
- **Report coverage with a confidence interval**, not as a point. 256 points establishes a consistent
  direction of over-confidence; it does not certify a per-series level.

---

## Part 3 — The cut line

**Above the line — this is the product. Nothing else starts until all of it is merged and deployed.**

| Area | In |
|---|---|
| Data | ingest → validate → clean → gold at 3 grains · closure calendar · completeness · cutoff-aware features · the no-leakage test |
| Models | ADI/CV² router · Prophet + ARIMA + MSTL + SeasonalNaive + LightGBM + Croston/TSB · median combination · conformal calibration · forecast store · **`day1_benchmark.py` + both ablations** |
| Decision | newsvendor + pack rounding · cost curve · stock ledger · four risk rules ranked by exposure |
| Service | 10 endpoints (P0 + P1) · envelope with provenance and staleness · in-process LRU cache |
| Product | Screens 1, 2, 3, 4, 6 · fan chart · reliability diagram · service-level slider · provenance badges |
| Ops | docker compose · CI (lint, tests, benchmark) · one deployed URL · degradation rungs 3, 5, 6 |

**Below the line — start only when everything above is merged AND deployed.**

| Item | Why it is below | If cut, say |
|---|---|---|
| **Screen 5 / replay mode** | Best demo moment, moderate cost. Highest-value item below the line — pull it up if Day 2 finishes early. | — (build it if you can) |
| Temporal MinT reconciliation | Strong story, half a day, no screen depends on it | *"coherence across grains is specified; we shipped the three grains independently"* |
| Stress-test harness | Genuinely impressive, reuses `backtest.py`, but nothing breaks without it | *"the scenario catalogue is in the architecture document; we measured four of ten"* |
| SHAP on the LightGBM member | Attribution in units already answers "why". SHAP is the deeper layer. | *"available one level down; buyers want units, not coefficients"* |
| `/simulate` what-if screen | Depends on nothing else being late | *"the same code path with an override object — specified, not shipped"* |
| `/assistant` (LLM) | External API that can rate-limit mid-pitch | *"below our cut line precisely because a live external dependency in a demo is a risk we chose not to take"* |
| Synthetic 40-store network + map | Presentation value only, proves nothing about accuracy | *"lane 3 cannot back a claim, so it would be decoration"* |
| Cross-sectional reconciliation | Needs the store network above | see item 3 in Part 2 |
| OIDC auth · Postgres RLS · multi-tenancy · Redis · MLflow · Prefect · OpenTelemetry · k6 · chaos tests | Real engineering, zero demo surface in 4 days | see `team/05` section 10 for the exact lines |

**The rule that protects the project:** at the **Day-3 20:00 demo**, somebody reads this table aloud
and marks each item done or not done. **Unfinished work is deleted on the spot.** Deleting a
half-built feature is free; debugging one at 3 a.m. costs the demo. The lead may cut unilaterally;
cuts are logged, not debated.

---

## Part 4 — The 4-day schedule

Every phase has a gate checked at the 20:00 demo. **If a gate fails, the next day starts by fixing
it and nothing new begins.**

### Day 0 — evening before (3 hours, everyone)

| | |
|---|---|
| **Deliverable** | Repo cloned, environment working for all 8, dataset in place and checksummed, `docker compose up` green, CI skeleton green, contracts read, fixtures in place |
| **Gate** | **All 8 have merged a one-line PR.** A placeholder page is live at a public URL. `python scripts/check_data.py` prints the same `snapshot_id` on every machine. |

Pin the `snapshot_id` in the team channel. Verify Prophet imports on all 8 machines.

### Day 1 — foundations, in parallel, blocking nobody

| Pod | Deliverable |
|---|---|
| **A** | ingest → validate → clean → **gold at 3 grains**; cutoff-aware features; **`test_no_leakage.py` green** |
| **B** | **`day1_benchmark.py` reproducing the baseline table**; ADI/CV² classifier; **`lead_time_demand()` stub by 12:00** |
| **C** | **`newsvendor.py` complete with property tests** (needs nobody); FastAPI serving all P0 endpoints from fixtures **by 13:00** |
| **D** | app shell; **the whole app rendering from fixtures, deployed to a public URL** |

> **Gate: a fixture-driven app is live on a public URL, and `make benchmark` prints a leaderboard
> whose seasonal-naive figure the team has confirmed or corrected.**

### Day 2 — the vertical slice. *The most important gate of the week.*

| Pod | Deliverable |
|---|---|
| **A** | closure calendar + all seven quality gates; `run_nightly.py` end to end; deploy pipeline |
| **B** | portfolio fitted and routed by class; LightGBM global quantile; median combination; **real forecast store written** |
| **C** | `/forecast /history /series /recommend` on real data; stock ledger; the full cost curve |
| **D** | Orders & Risk with the slider driven by `cost_curve`; grain switch; partial-bucket hatching |

> **Gate: real series → real model → real API → real chart, on the deployed URL. A buyer can move the
> service-level slider and watch the order quantity and the expected cost change.**

If this gate fails, **Day 3 is spent making it pass and nothing else.** A working vertical slice on
Day 2 is worth more than every stretch item combined.

### Day 3 — the three differentiators. Feature freeze 20:00.

| Pod | Deliverable |
|---|---|
| **A** | CI running tests + benchmark on every push; deploy is one click; keep-alive ping; replay feed |
| **B** | conformal calibration + reliability curve; **selection-vs-combination ablation**; attribution in units; **final `benchmarks.json`** |
| **C** | `/risk /explain /metrics /settings`; contract tests green; replay endpoints if time |
| **D** | Explainability screen (attribution + **reliability diagram**); Ops Console; replay UI if time |

> **Gate: the three differentiators are demonstrable in the deployed app — the order slider with live
> cost, the selection-vs-combination result, and the calibration before/after curve. At 20:00 the cut
> table is read aloud and anything unmerged is deleted.**

### Day 4 — evaluate once, then rehearse. Code freeze at midday.

| | |
|---|---|
| **Morning** | **The 2019 holdout is evaluated exactly once.** That number is final. Model card written. Inventory-cost simulation against a min/max policy for the ROI slide. |
| **Midday** | **Code freeze.** Nothing merges after this except a demo-path bug fix approved by the lead. |
| **Afternoon** | Deck, README, demo video recorded on two devices, three timed rehearsals, Q&A drill. |
| **Evening** | **Submit early.** Warm the services 30 minutes before the slot. |

---

## Part 5 — Team assignment

Every person owns something that appears on screen during the demo. That is what stops a team of
eight becoming a team of three.

| | Pod | Owns | Their moment in the demo |
|---|---|---|---|
| **A1** | Data & Platform | ingest, validation, cleaning, gold, closure calendar | *"here is the gate catching the corrupted month"* |
| **A2** | Data & Platform | features, no-leakage test, Docker, CI, deployment | *"every feature is computed as of a cutoff, and a test proves it"* |
| **B1** | Forecast Engine | benchmark harness, baselines, classifier, statistical portfolio. **Owns every reported number — the only person who may approve one.** | the per-series table and the selection-vs-combination result |
| **B2** | Forecast Engine | LightGBM, combination, conformal calibration, forecast store, attribution | the reliability diagram: 0.750 → nominal |
| **C1** | Decision & API | newsvendor, pack rounding, ledger, risk rules, recommendations | the order quantity and the cost of being wrong |
| **C2** | Decision & API | FastAPI, all endpoints, cache, replay backend, contract tests | *"no model runs during a request"* |
| **D1** | Product | design system, app shell, Dashboard, Orders & Risk. **Demo driver.** | the whole product narrative and the slider |
| **D2** | Product | chart primitives, Forecast Center, Explainability, Ops Console | the fan chart and the live Ops Console |
| **Lead** | — | contracts, integration, cut decisions, deck, the 20:00 checklist | opening and closing |

**Named backup per area: A1↔A2, B1↔B2, C1↔C2, D1↔D2, and the lead backs up D1 as demo driver.**
Nobody is the only person who can start the demo.

---

## Part 6 — Risk register

| Risk | Response |
|---|---|
| **The benchmark numbers do not reproduce** | Day-1 morning task, before anything is built on them. If they differ, the new number is the truth and the deck changes. **This is the top risk.** |
| **Free-tier cold start kills the live demo** | Keep-alive ping · warm 30 min before · local compose on the presenter's laptop as hot standby · recorded video on two devices. **Rehearse the switch itself.** |
| **Integration collapses on the last day** | Contracts frozen Day 0 · fixtures from hour one · vertical slice Day 2 · daily merges to `main` · the 20:00 checklist. If you are integrating on Day 3 you have already failed. |
| **Prophet will not install for somebody** | Guarded import, four-member fallback ensemble, container as the escape hatch. Verify on Day 0. |
| **Scope sprawl** | The Part 3 cut table, read aloud at the Day-3 freeze. The lead cuts unilaterally. |
| **"This is a notebook with a UI"** | Open on the order screen, not a chart. Lead with rupees, then the selection-vs-combination result, then the Ops Console. |
| **Accuracy challenged in Q&A** | `make benchmark` reproduces every figure from a clean clone · protocol on the slide · losses reported · holdout evaluated once |
| **"Your data is too small"** | The failure-mode argument (intermittency, censoring, level shifts, multi-phase seasonality and calibration failure are all present here and all appear at scale) plus the scale arithmetic. **Do not inflate the dataset to compensate.** |
| **A teammate goes dark** | Named backup per area · everything in git · nothing on one laptop |
| **Environment problems eat Day 1** | That is what Day 0 is for. Anyone still broken at the Day-1 standup pairs until fixed. |

---

## Part 7 — The demo, in the order it should run

1. **Open on the Dashboard.** *"Three things need your decision today, worth ₹18,400."* Not a chart.
2. **Click the top exception → Orders & Risk.** *"Order 130 boxes. Here is what it costs if we are
   wrong in either direction."*
3. **Move the slider.** *"How often are you willing to run out?" — quantity and cost move live,
   because the maths is closed form and the distribution was computed last night.*
4. **Click "why" → Explainability.** *"Up 41 units: +28 pollen season, +9 trend, +4 calendar."* In
   units, summing to the total.
5. **Scroll to the reliability diagram.** *"Our 80% interval actually covered 75%. We measured it,
   corrected it, and we show you both. Nobody in this market publishes this."*
6. **Ops Console.** *"Every number on this screen was written by CI. None of it is typed by a human."*
   Show the leaderboard **including the series where we lose.**
7. **The result slide.** *"We implemented the obvious approach — pick each product's best model — and
   measured it losing: 1.091 against 0.906 for combination, with the perfect-hindsight bound at
   0.883."*
8. **The limitation, said out loud before anyone asks.** *"We forecast sales, not demand. A stockout
   records zero sales. Our observations are right-censored, worst on exactly the products that matter
   most. It is in the model card and it is the first thing a real deployment fixes."*
9. **Close.** *"Every pharmacy guesses how much to order. We calculate it — with the odds, the cost
   of being wrong, and the reason behind the number."*
