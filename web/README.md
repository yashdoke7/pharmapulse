# `web/` — Product Surface

**Owner:** Pod D (D1 shell + screens 1 & 4, D2 charts + screens 2, 3, 5, 6)
**Full brief:** `team/04_POD_D_PRODUCT_FRONTEND.md`
**Contract consumed:** C3 (`CONTRACTS.md`) and C5 (`contracts/fixtures/`)

---

## Target

> Let a buyer answer **"what do I order?"** in one screen and **"why should I believe it?"** in one
> click — and never make them read a chart to find out that something is wrong.

## Inputs

| Input | Notes |
|---|---|
| `contracts/fixtures/*.json` | **Day 1 source of truth.** Nine files, already present, shape-correct. |
| `http://localhost:8000/api/*` | from Day 2, same shapes |
| `contracts/openapi.json` | generate types: `npx openapi-typescript contracts/openapi.json -o src/api/types.ts` |

`VITE_USE_FIXTURES=1` selects fixtures; `0` selects the live API. **One switch, one client module,
every screen goes through it.** You are never blocked by Pod C.

## Outputs

A deployed React app on a public HTTPS URL, and the recorded demo video.

## Structure

```
web/src/
  api/client.ts        the fixture/live switch - every request goes through here
  api/types.ts         generated from openapi.json
  components/
    charts/FanChart.tsx              D2 - raw SVG
    charts/ReliabilityDiagram.tsx    D2 - raw SVG
    charts/CostCurve.tsx             D2
    ServiceLevelSlider.tsx           D1 - THE demo component
    ExceptionCard.tsx                D1
    ProvenanceBadge.tsx              D1 - observed vs your-setting
    StalenessBadge.tsx               D1
  screens/
    Dashboard.tsx        (1) D1      Forecast.tsx      (2) D2
    Explain.tsx          (3) D2      Orders.tsx        (4) D1
    LiveOps.tsx          (5) D2      OpsConsole.tsx    (6) D2
    Settings.tsx             D1
```

## The two rules that decide whether this reads as a product

1. **The dashboard opens on exceptions, never on a chart.** *"3 things need your decision today,
   worth ₹18,400"* has already done the work a time series makes the user do. If the home screen
   opens on a line chart, the pitch becomes "a notebook with a UI".
2. **Every number is one click from *why*, and every *why* is one click from *how confident*.**

## The three components that carry the demo

| Component | Rule |
|---|---|
| **`ServiceLevelSlider`** | Labelled ***"how often am I willing to run out?"***, not "service level". **Interpolate `cost_curve` locally on drag — never fetch.** Mark the minimum-cost point. Show cost at ±1 pack. |
| **`FanChart`** | Raw SVG. History line → cutoff rule → three stacked quantile bands (5–95, 10–90, 25–75) + median. **Bars with `completeness < 1.0` render hatched and labelled "partial".** |
| **`ReliabilityDiagram`** | Raw SVG. Stated vs achieved coverage, 45° identity line, **before and after curves**, `n_points` printed. Nobody in this market ships this. |

## Cheap details that read as senior

Provenance badge from `inputs_used[].lane` · staleness badge from `meta.stale` · degradation chip
from `meta.degraded` · demand-class chip from `series.demand_class` · **losses rendered in a
different colour** from `benchmarks.per_series[].ensemble_wins === false` · real empty and error
states for `NO_FORECAST_YET` and `HORIZON_TOO_LONG` · skeletons rather than spinners.

Currency `₹18,400`. Pick one word for units and use it on screen and in the deck.

## Screen priority if the clock runs out

**1 and 4 first**, then 2, then 3, then 6, then 5. Screen 5 (replay) is the best demo moment and the
first thing to cut.

## Run it

```bash
cd web && npm install && npm run dev      # :5173
npm run build                             # must pass in CI
```

## Definition of done

- [ ] Every screen renders with `VITE_USE_FIXTURES=1` **and** against the live API
- [ ] Slider drag produces **zero network requests** — verified with the network tab open
- [ ] Fan chart: 3 bands, median, history, cutoff rule, hatched partial buckets
- [ ] Reliability diagram: both curves plus the identity line
- [ ] Staleness badge tested by editing a fixture
- [ ] Deployed, warm, under 3 s on the presenter's actual laptop and phone
