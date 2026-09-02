# POD D — Product & Frontend · RESULTS

> What was built, what it measured, what broke, and where the code is.
> Original brief: `../04_POD_D_PRODUCT_FRONTEND.md`

**Owns:** `web/`
**Delivers:** eight screens, four bespoke charts, and the design system.

---

## 1. Scorecard

| Deliverable | Status | Evidence |
|---|---|---|
| Eight screens on live data | **done** | all verified rendering, no console errors |
| Fan chart, raw SVG | **done** | 3 bands, cutoff rule; partial bucket drawn but not load-bearing (§11.1) |
| Reliability diagram, raw SVG | **done** | before/after curves + identity line — **moved to Evidence**, §11.3 |
| Seasonal profile, raw SVG | **done** | per-medicine monthly index; replaced the diagram on *Why*, §11.4 |
| Cover-runway chart, raw SVG | **done** | days of cover against the protection interval, §11.2 |
| Dataset screen | **done** | as-of rebuild, CSV upload, version activation, §11.6 |
| Service-level slider | **done** | **zero** network calls on drag, verified |
| Provenance badges | **done** | measured vs your-setting on every input |
| Staleness / degradation badges | **done** | wired to `meta.stale` / `meta.degraded` |
| Losses shown in a different colour | **done** | `ensemble_wins === false` |
| Distinctive visual identity | **done** | full re-theme, see §5 |
| Build | **green** | `tsc -b && vite build`, 83 kB gzipped |

---

## 2. The two rules the screens are built on

**1. The dashboard opens on exceptions, never on a chart.**

A screen that opens on a time series makes the user do the work of finding the problem. A screen that
opens on *"Four products need a decision, ₹1,099 at risk"* has already done it.

```tsx
// web/src/screens/Dashboard.tsx
<h1 className="display mt-3 text-[42px] sm:text-[52px]">
  {word(needsDecision)} product{needsDecision === 1 ? "" : "s"} need a decision,
  <span className="text-signal-red">{inr(exposure)}</span> at risk.
</h1>
```

**2. Every number is one click from *why*, and every *why* is one click from *how confident*.**

Every exception row navigates to the order that fixes it; the order screen links its inputs to their
provenance lane; the *Why* screen carries the reliability diagram underneath the attribution.

---

## 3. ★ The slider — the demo, and the one performance rule

`/api/recommend` ships the whole cost curve. Dragging **interpolates locally and makes zero network
calls.**

```tsx
// web/src/components/ServiceLevelSlider.tsx
function interpolate(curve: CostPoint[], level: number): CostPoint {
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i], b = curve[i + 1];
    if (level >= a.service_level && level <= b.service_level) {
      const t = (level - a.service_level) / (b.service_level - a.service_level || 1);
      return {
        service_level: level,
        // Quantity is a whole number of packs, so it steps rather than glides.
        order_quantity: t < 0.5 ? a.order_quantity : b.order_quantity,
        expected_cost: a.expected_cost + t * (b.expected_cost - a.expected_cost),
        p_stockout: a.p_stockout + t * (b.p_stockout - a.p_stockout),
      };
    }
  }
}
```

**Why it matters beyond feel:** if this fetched on drag, the control would stutter *and* it would
throw away the reason the maths is closed form. **Verified in the browser with the network tab open:
no requests while dragging.**

**The quantity steps rather than glides** — deliberately. An order is a whole number of packs, and
pretending otherwise would be a lie the interface tells about the decision.

---

## 4. The two charts nobody else ships

### 4.1 Fan chart — `components/FanChart.tsx`, raw SVG

No chart library draws a stacked-quantile fan with a history join and a cutoff rule the way this
needs it, so it is built directly.

```tsx
const BANDS: [string, string, number][] = [
  ["0.05", "0.95", 0.1],
  ["0.10", "0.90", 0.16],
  ["0.25", "0.75", 0.26],
];
```

**Reading the width of the fan IS the product** — the decision layer consumes that spread — so it is
the most visible thing on the screen.

**Partial buckets are shown, never hidden:**

```tsx
{history.map((h, i) =>
  h.completeness < 1 ? (
    <rect x={x(i) - 4} fill="url(#partial)" opacity="0.25" ... />
  ) : null,
)}
```

That hatch is the truncated final week. **A missing bar looks like the data ends for an unknown
reason; a hatched bar labelled "partial" is honest.**

### 4.2 Reliability diagram — `components/ReliabilityDiagram.tsx`

Stated confidence against achieved coverage, with the 45° identity line and **both curves**, before
and after conformal correction, with `n = 256` printed on the chart.

> *"We measured whether our own confidence intervals are true. Our nominal 80% band actually covered
> 92% of outcomes — too wide, which means over-ordering and capital stuck on the shelf. Red is
> before, green is after."*

**Almost nobody in this market ships this.** A confidence band the user cannot verify is not a
confidence claim, and the honesty *is* the feature.

---

## 5. ★ The redesign — away from the AI default

**The first version was competent and generic:** dark navy, mint accent, rounded gradient cards,
Inter, an equal-weight four-up KPI row. That is the single most recognisable LLM-generated aesthetic
there is, and every other team's dashboard looks like it.

**Replaced with a light editorial system** that suits what the product actually is: *a document a
pharmacist commits money from.*

| | Before | After |
|---|---|---|
| Ground | `#0b1020` navy + gradient wash | `#F7F4EE` warm paper |
| Ink | slate greys | `#14110D` warm near-black |
| Structure | rounded cards, borders, shadows | **hairlines and whitespace**, sharp corners |
| Display type | Inter 600 | **Instrument Serif** |
| Figures | Inter tabular | **IBM Plex Mono**, every figure |
| Accent | mint on everything | one per meaning: red money leaving, blue capital stuck, green fine, amber watch |
| Texture | radial gradient glows | a near-invisible ruled grid, masked at the top |

**The design rules, stated in the stylesheet so they survive contact with new screens:**

```css
/* PharmaPulse — an instrument, not a dashboard.
 *   1. Hairlines, never card borders or shadows. Structure comes from rules
 *      and whitespace, the way a well-set report does.
 *   2. Every figure is tabular mono. Numbers are the product; they line up.
 *   3. One accent per meaning. Red is money leaving, blue is capital stuck,
 *      green is fine. Nothing is decorative.
 *   4. Warm paper and warm near-black. The warmth is what stops it reading as
 *      a generic dark SaaS dashboard.
 */
```

**The slider became an instrument control** — a hairline with a 2px ink thumb that turns red while
dragging, rather than a rounded pill:

```css
input[type="range"].pp-slider::-webkit-slider-thumb {
  width: 2px; height: 30px; border-radius: 0;
  background: #14110d;
  box-shadow: 0 0 0 5px rgba(247, 244, 238, 0.95);
}
input[type="range"].pp-slider:active::-webkit-slider-thumb { background: #a32e22; }
```

### A real Tailwind trap found during the re-theme

Numeric colour keys **collide with the opacity modifier inside `@apply`**:

```
[plugin:vite:css] The `border-ink/10` class does not exist.
```

`ink: { DEFAULT, 10, 20, 40, 60, 80 }` makes `border-ink/10` ambiguous. Renamed to named steps and
promoted rules to first-class tokens, since the whole system depends on them:

```js
ink:  { DEFAULT: "#14110D", soft: "#3B362F", mute: "#6B6459",
        faint: "#9A9287", pale: "#C9C2B6" },
line: { DEFAULT: "rgba(20,17,13,0.13)", soft: "rgba(20,17,13,0.07)", hard: "#14110D" },
```

**A second trap:** the Vite dev server caches `tailwind.config.js`. The production build succeeded
while the dev server still showed the error — it needs a restart after a config change, not just an
HMR tick.

---

## 6. The details that read as considered

| Detail | Source | Why it earns its place |
|---|---|---|
| **Provenance badge** on every input | `inputs_used[].lane` | `measured` vs `your setting` — a judge sees at a glance what trains the model and what was typed in. **The project's credibility feature.** |
| **Staleness badge** | `meta.stale` | *"stale · 2026-08-28"* — honest degradation beats silent freshness |
| **Degradation chip** | `meta.degraded` | *"demo data · model layer offline"* |
| **Demand-class chip** | `series.demand_class` | `intermittent` on N05C explains why its chart looks different before anyone asks |
| **Losses in red** | `ensemble_wins === false` | showing where we lose is a scoring point, not a bug |
| **Ledger trail** | `/api/ledger` | opening stock + every movement = the number on screen |
| **Real error states** | `error.code` | `NO_FORECAST_YET` prints the command that fixes it |

**Currency is `₹1,099`, figures are tabular mono, and the same word is used for units everywhere** —
on screen and in the deck.

---

## 7. The client: no separate mock layer

The backend has its own fixture mode, so the frontend just talks to the API and the API decides how
degraded it is.

```ts
// web/src/api/client.ts
// The backend itself has a fixture mode (PHARMAPULSE_FIXTURES=1) that serves
// contracts/fixtures/*.json with the identical shape, so the frontend needs no
// separate mock layer - it just talks to the API and the API decides how
// degraded it is. meta.degraded tells us, and the UI renders a badge.
```

**One less thing to keep in sync**, and it means the fallback path is exercised by the real client
rather than by a parallel code path that could rot.

---

## 8. Bugs found by looking at the rendered app

| Bug | How it showed | Fix |
|---|---|---|
| **Currency rounding erased the panel's whole point** | ₹15.75 / ₹15.97 / ₹16.57 all rendered as "₹16" | amounts under ₹100 keep two decimals |
| **Prophet attributed +34 units to holidays** | visible on the *Why* screen | drop holidays at monthly grain |
| **Risk copy read as reassuring** | *"10.4 days of cover against a 4-day lead time"* | name the 11-day protection interval |
| **All eight products went red** | after the protection-interval fix raised every reorder point | re-seed the demo board to a realistic mix |
| **Concurrent replay ticks** | clicking "skip a week" while polling | pause the poller; lock the session server-side |

The last one is worth noting: **the UI is where the concurrency bug became visible.** A server-side
test would not have produced the interleaving.

---

## 9. Screens, and the question each answers

| Screen | Question | Route |
|---|---|---|
| **Decisions** | *What needs my decision today?* | `/` |
| **Order** | *What do I order, and what does being wrong cost?* | `/orders` |
| **Forecast** | *Do I believe this number?* | `/forecast` |
| **Why** | *Where did it come from, and is your confidence real?* | `/explain` |
| **Replay** | *Is this alive, and is it actually better?* | `/live` |
| **Evidence** | *Are your numbers honest?* | `/ops` |
| **Settings** | *What if my lead time or margin were different?* | `/settings` |

**Settings closes the loop the whole thesis rests on.** Change the lead time from 4 to 9 days:

| | Before | After |
|---|---|---|
| Protection interval | 11 days | **16 days** |
| Paracetamol order | 100 units | **660 units** |
| Lane badge | `4 days` | `9 days` |

That is the argument made **interactive** rather than asserted.

---

## 10. Honest gaps

- **No component tests.** The CI gate is `npm run build`; correctness is covered by the 33 API
  contract tests plus manual verification of every screen. Below the cut line, stated.
- **No accessibility audit.** Colour contrast is high by construction (near-black on paper) and
  semantic elements are used throughout, but it has not been tested with a screen reader.
- **Replay state is client-polled**, not websocket. Deliberate — polling cannot break on stage.
- **The fan chart is fixed-viewBox**, scaled by CSS. It reads correctly from mobile to desktop, but
  it is not a true responsive redraw.

---

## 11. Second pass — what changed after the first review

Everything above was true when it was written. A review pass found four screens
that were misreading, misreadable or empty, and the product grew an eighth
screen. This section is the delta, and it is where the interesting bugs are.

### 11.1 The fan chart was anchored to a lie

**Symptom.** At weekly and monthly grain the actual line dived just before the
forecast and the fan jumped back up. It read as the model ignoring its own last
observation, and that is exactly what a reviewer said.

**Cause.** The last bucket is TRUNCATED. The file ends 8 October 2019, so the
week beginning 7 October holds two days of sales and October holds eight:

```
2019-09-30   249.45   completeness 1.00
2019-10-07    95.10   completeness 0.29   <- two days, not seven
```

The fan and the median both anchored at `history[history.length - 1]`, so they
started from 95.1 and climbed to the real weekly level of ~250. The
`completeness` field had been on the API response the whole time. Nothing read
it.

```tsx
// web/src/components/FanChart.tsx
let anchorIndex = history.length - 1;
while (anchorIndex > 0 && history[anchorIndex].completeness < 1) anchorIndex--;
```

The partial tail is still drawn — hiding it would be worse — but as a dashed
stub with a hollow marker and a "part period" label, so it is visible and not
load-bearing.

**Why it matters beyond cosmetics.** Three separate documents claimed "partial
periods stay visible as hatched bars". They were describing an intent the chart
did not implement.

### 11.2 The Decisions screen had no chart, and the right one is not a trend line

The brief said "opens on exceptions, never on a chart", and that rule is still
right. But the screen was three text rows and a table, and it read as empty.

The chart that belongs there is not a time series — **a buyer cannot act on a
trend line**. It is every product's *runway*: days of cover as a horizontal bar,
with the protection interval drawn through every track as a dashed rule. Who
falls short, and by how much, in one glance.

```tsx
// The marker lives INSIDE each track, not absolutely positioned over the row.
// The first version used left: calc(9.5rem + pct% * 0.72) against the whole
// row, which is a fudge factor pretending to be a layout, and it put the
// 11-day line in a different place on every bar.
<div className="absolute inset-y-0 border-l border-dashed border-ink/45"
     style={{ left: markerPct + "%" }} />
```

It also states the thing that looks like a bug and is not: a slow mover can
clear the 11-day line and still say *order now*, because its reorder point
carries safety stock for how erratic it is. Sedatives sit at 23.7 days of cover
and still need ordering.

### 11.3 A panel that does not change when you change the subject is not about the subject

The right-hand panel on *Why* was the reliability diagram. It is a **global**
calibration result, so it was byte-identical on all eight products. A reviewer
noticed before a judge did.

It moved to *Evidence*, where a global result belongs, and *Why* now shows that
medicine's own **month-by-month demand index** — which was needed anyway,
because of the next item.

### 11.4 The one claim on any screen the code could not defend

The attribution sentence read *"coming off the pollen season"*. The
**magnitude** was always measured — Prophet's fitted yearly component. The
**noun** was a lookup table somebody typed:

```python
SEASON_HINTS = {"R06": "pollen season", "N02BE": "flu wave", ...}   # deleted
```

It would have been silently wrong on anyone else's data, and it was the only
thing on any screen asserted rather than computed. The label is now derived
from the measured peak month, and the panel beside it draws the shape it was
read from:

```
R06    peaks May        1.74x its own average
N02BE  peaks January    1.49x
R03    peaks December   1.46x
```

The old labels were roughly right. They are now *checkable*, and they survive a
different dataset — on the synthetic extension R06's peak walks to March and
the sentence follows it.

### 11.5 Three screens that were unreadable, and why each was

| Screen | What was wrong | What it needed |
|---|---|---|
| **Order** | The quantity sat in the top-right corner and the slider in the middle, with nothing joining them. You could drag and watch a number change *somewhere else* and never connect the two — and that connection is the entire product. | A live sentence under the track: *"Accept a 4.8% chance of running out and you order 240 units (24 packs) at Rs 38.61."* Off the recommendation it names the recommendation and what the difference costs per cycle. |
| **Replay** | Ticked every **320 ms**. A quarter went past in half a minute; nobody could see a delivery land. | 1.5 s/day default, a speed picker, and a *Step 1 day* button. |
| **Replay** | Used four inventory terms with no definition anywhere on screen — *min/max*, *lost margin*, *holding*, *units unsupplied*. A business case nobody can read is not a business case. | Six definitions under the cards, including why the saving is credible. |
| **Evidence** | Opened on four MASE figures and a leaderboard. If you had not built it there was no way in, and it read as a developer console that had wandered into a product. | The answer first, in words, then a line saying everything below is the working. |

The Evidence pass also caught a real inconsistency: the chips treated
`MASE >= 1` as a loss, so **M01AE at exactly 1.000 was flagged "above naive"**
and counted among the failures. The screen said *3 of 8* while the deck said
two. A tie is not a loss — ties now read `ties naive` in neutral grey and both
surfaces agree.

### 11.6 The eighth screen: Data

Two questions kept being asked of a product frozen against one file at one
cutoff, and neither had an answer on a screen:

- *"What would this have said in June 2017?"*
- *"Does it work on my data?"*

They are the same feature. `web/src/screens/Data.tsx` carries the live dataset
with its lane badge, an **as-of** date control, a CSV upload, and every version
ever built with an *Activate* button.

Two front-end details worth keeping:

**Polling, not a spinner.** A rebuild takes about twenty seconds — too long to
hold a request open, far too short to justify a queue. The server runs it on a
thread; the screen polls `/api/datasets/jobs/{id}` every 1.2 s and invalidates
every query when it finishes.

**Multipart cannot go through the shared client.** `request()` sets a JSON
`Content-Type`, and setting one by hand on a `FormData` body strips the boundary
the server needs to parse it. `uploadDataset` therefore calls `fetch` directly —
the only place in the client that does, with a comment saying why.

The lane badge is deliberately loud and turns amber when the live dataset is not
`observed`. A synthetic dataset may demonstrate the pipeline and may never back
an accuracy claim; the moment that is not obvious on screen, the guarantee is
worth nothing.

### 11.7 One clock, and it belongs to the data

The Dashboard printed `new Date()` — the *viewer's* wall-clock date — above
forecasts anchored to the last day in the file. It read "Today · 2 September"
over numbers computed for October 2019.

A buyer decides for the next period, not for whenever the page happened to be
opened. `meta.as_of` now rides on every response and the label reads
**"Deciding for · 9 October 2019"**. It moves on its own when a different
dataset is published — 2026-10-01 on the synthetic extension, nothing
configured.

### 11.8 Deployment: the API serves the built interface

`docker-compose` runs two services because that is right for development — Vite
gives hot reload, a static bundle cannot. A deployment wants the opposite: one
URL, no CORS, no second free-tier service to keep awake. `api/main.py` mounts
`web/dist` when it exists, with a catch-all returning `index.html` so a refresh
on `/orders` does not 404.

That catch-all had a bug worth recording: it **swallowed unmatched `/api` paths
and returned HTML with a 200**, so a caller got a page where it expected JSON.
It 404s properly now.

```python
if full_path.startswith(("api/", "docs", "openapi.json", "redoc")):
    raise HTTPException(status_code=404, ...)
```

### 11.9 Honest gaps, updated

- **No tests on the Data screen or its router.** `api/routers/datasets.py` is
  ~250 lines with zero coverage. It is the largest untested surface in the
  project and it is the newest.
- **Nothing below `lg:` has been looked at.** The Decisions table and the
  runway chart both overflow on a phone, and a judge will open it on a phone.
- **No accessibility pass.** Icon-only buttons have no `aria-label`, the slider
  has no accessible name, and the status chips carry meaning in colour alone.
- **No error boundary.** One bad API response white-screens the whole app.
