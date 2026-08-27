# POD D — Product & Frontend

> Paste `team/00_PROJECT_BRIEF.md` first, then this file. Then read `CONTRACTS.md` section C3.

**Two people. D1 and D2.**

| | Owns | One-line job |
|---|---|---|
| **D1** | app shell, design system, **Dashboard (1)**, **Orders & Risk (4)**, settings, routing, responsive | The product narrative. **Demo driver.** |
| **D2** | chart primitives, **Forecast Center (2)**, **Explainability (3)**, **Ops Console (6)**, replay UI | The two charts nobody else has, and the numbers screen |

**Your mission:** *make a buyer able to answer "what do I order?" in one screen, and "why should I
believe it?" in one click — and never make them look at a chart to find a problem.*

**You own:** `web/` only. **You never edit** anything else — including `contracts/fixtures/`.

---

## The two interaction rules that decide whether this reads as a product

1. **The dashboard opens on exceptions, not a chart.** A screen that opens on a time series makes
   the user do the work of finding the problem. A screen that opens on *"3 things need your decision
   today, worth ₹18,400"* has already done it. **Everything else is one click from an exception card.**
2. **Every number is one click from *why*, and every *why* is one click from *how confident*.** If
   somebody points at any figure on any screen and asks where it came from, the answer is a click,
   not a sentence.

---

## Day plan

| Day | D1 | D2 | Evening gate |
|---|---|---|---|
| **1** | Vite + React + TS + Tailwind scaffold, app shell, routing, TanStack Query client, **fixture mode**, Dashboard v1 | `<FanChart>` and `<ReliabilityDiagram>` primitives in raw SVG, Forecast Center v1 | **The whole app renders from `contracts/fixtures/`, deployed to a public URL, before the API is real** |
| **2** | Orders & Risk with the **service-level slider driven by `cost_curve`** | grain switch (day/week/month), horizon control, history overlay, partial-bucket hatching | The slider moves the order quantity and the cost with zero network calls, on real data |
| **3** | settings screen, provenance badges, staleness badge, accept/override with mandatory reason | Explainability (attribution bars, decomposition, **reliability diagram**), Ops Console, replay UI | Three differentiators visible in the deployed app |
| **4** | polish the demo path only; record the video | polish; second device fallback | frozen |

---

## Stack — do not deviate

React 18 + TypeScript + **Vite** · **Tailwind** + shadcn/ui · **TanStack Query** for server state ·
**Recharts** for standard marks. The fan chart and the reliability diagram are **not standard** —
build those two directly in SVG. Do not add a second chart library for them.

```bash
cd web
npm create vite@latest . -- --template react-ts
npm i @tanstack/react-query recharts clsx
npm i -D tailwindcss postcss autoprefixer && npx tailwindcss init -p
```

`web/.env.development`:
```
VITE_USE_FIXTURES=1
VITE_API_BASE=http://localhost:8000/api
```

**Fixture mode is the rule for Day 1 and the fallback all week.** One module:

```ts
// web/src/api/client.ts
const USE_FIXTURES = import.meta.env.VITE_USE_FIXTURES === "1";
export async function get<T>(path: string, fixture: string): Promise<Envelope<T>> {
  if (USE_FIXTURES) return (await import(`../../../contracts/fixtures/${fixture}.json`)).default;
  return (await fetch(`${import.meta.env.VITE_API_BASE}${path}`)).json();
}
```

Every screen goes through this. **You are never blocked by Pod C.** Generate your types from
`contracts/openapi.json` once it exists (`npx openapi-typescript`), and hand-write them from
`CONTRACTS.md` until then.

---

## The six screens

| # | Screen | The job it does | Must contain |
|---|---|---|---|
| **1** | **Dashboard** | *"What needs my decision today?"* | Exception cards **ranked by rupee exposure** · total exposure headline · KPI row · sales trend · top movers. **Never opens on a chart.** |
| **2** | **Forecast Center** | *"Do I believe this number?"* | Fan chart with 50/80/95 bands · horizon control · history/forecast overlay · **per-model comparison from `members[]`** · grain switch |
| **3** | **Explainability** | *"Why?"* | Attribution **in units** summing to the total · trend/seasonality/holiday decomposition · SHAP top-5 · **the reliability diagram** |
| **4** | **Orders & Risk** | *"What do I order?"* | The order table · **service-level slider with a live cost curve** · pack rounding shown · P(stockout) · Accept / Override with a **mandatory reason** |
| **5** | **Live Ops (replay)** | *"Is this thing alive?"* | Replay controls · positions table with status chips flipping · alert feed · `REPLAY · Jan–Mar 2019` watermark |
| **6** | **Ops Console** | *"Is this thing efficient?"* | Latency, memory, cache hit rate, cost per 1,000 forecasts · **model leaderboard from `benchmarks.json`, losses included** · drift gauges |

**Priority if the clock runs out: 1 and 4 first, then 2, then 3, then 6, then 5.** Screen 5 is the
best demo moment and the most cuttable.

---

## The three components that carry the whole demo

### 1 · `<ServiceLevelSlider>` — screen 4. **This is the demo.**

`/api/recommend` returns `cost_curve`: 16 points of `{service_level, order_quantity, expected_cost,
p_stockout}`.

```
ON DRAG: interpolate the array locally. DO NOT fetch.
```

The slider is labelled ***"how often am I willing to run out?"*** — not "service level". As it
moves: the order quantity changes, the expected cost curve highlights the current point, `p_stockout`
updates, and the pack count updates. Mark the **minimum-cost point** on the curve. Show the cost at
±1 pack next to the quantity.

If you fetch on drag, the demo stutters and the whole "closed form, O(1)" claim dies on stage.

### 2 · `<FanChart>` — screen 2. Raw SVG.

History as a line to `cutoff`, then stacked quantile bands: 5–95 lightest, 10–90, 25–75 darkest,
median as a solid line. A vertical rule at `cutoff` labelled *"forecast starts"*. Hover gives a
tooltip with all seven quantiles at that period.

**Bars with `completeness < 1.0` render hatched and labelled "partial".** Never hide them — that
truncated final week is one of the project's design claims, and a missing bar looks like the data
simply ends.

### 3 · `<ReliabilityDiagram>` — screen 3. Raw SVG. **Nobody in this market ships this.**

Stated confidence on x, achieved coverage on y, a 45° identity line, and **two curves — before and
after calibration** — from `explain.calibration`. Annotate the point that matters:

> *"A nominal 80% interval covered the actual value only 75% of the time. We measured it, corrected
> it, and show you both."*

Print `n_points` on the chart. The honesty is the feature.

---

## Details that are cheap and read as senior

| Thing | Where it comes from | Why it matters |
|---|---|---|
| **Provenance badge** on every input | `inputs_used[].lane` | `observed` in one colour, `your setting` in another. The judge sees at a glance what is measured and what was typed. This is the project's credibility feature. |
| **Staleness badge** | `meta.stale === true` | Amber chip: *"forecasts from 26 Aug — last night's run failed"*. Honest degradation beats silent freshness. |
| **Degradation chip** | `meta.degraded` | *"fallback model"* / *"using seasonal averages"*. |
| **Demand-class chip** | `series.demand_class` | `intermittent` on N05C explains why its chart looks different before anyone asks. |
| **Losses in a different colour** | `benchmarks.per_series[].ensemble_wins === false` | Showing M01AE where we lose is a scoring point, not a bug. Do not hide it. |
| **Empty and error states** | `error.code` | `NO_FORECAST_YET`, `HORIZON_TOO_LONG` are real states. A blank screen in the demo looks like a crash. |
| **Skeletons, not spinners** | — | The cold path is < 1.5 s and shows a determinate progress state rather than pretending. |

**Currency is INR, formatted `₹18,400`.** Units are "units" or "boxes" — pick one word and use it
everywhere, on screen and in the deck.

---

## Definition of done

- [ ] Every screen renders correctly with `VITE_USE_FIXTURES=1` **and** against the live API
- [ ] The slider interpolates locally — verified with the network tab open, zero requests on drag
- [ ] Fan chart shows 3 bands + median + history + the cutoff rule + hatched partial buckets
- [ ] Reliability diagram shows both curves and the identity line
- [ ] Provenance badges appear on every lane-2 input on screen 4
- [ ] Staleness badge renders when `meta.stale` is true — test it by editing a fixture
- [ ] Deployed, warm, and loading in under 3 s on the presenter's actual laptop and phone
- [ ] The demo path works with the backend switched to fixture mode (the stage fallback)

## Your handoffs

| To | What | When |
|---|---|---|
| **Everyone** | a deployed URL showing a real-looking app | **end of Day 1** — this is the morale and momentum deliverable |
| **Lead** | screenshots for the deck | Day 3 |
| **Lead** | the recorded demo video, on two devices offline | Day 4 |

## Traps

1. **Waiting for the API.** You have nine fixtures right now in `contracts/fixtures/`. Start there.
2. **Fetching on slider drag.** The single most damaging performance mistake available to you.
3. **Designing a beautiful chart-first dashboard.** It is the wrong product. Exceptions first, ranked
   by money. If the home screen opens on a line chart, the pitch becomes "a notebook with a UI".
4. **Hiding partial buckets or losses** because they look untidy. Both are deliberate claims.
5. **Adding a component library mid-sprint.** Tailwind + shadcn, then stop.
6. **Building screen 5 before screens 1 and 4 are finished.** It is the best moment and the first cut.
7. **Two people editing the same chart component.** D2 owns every chart primitive; D1 consumes them.
