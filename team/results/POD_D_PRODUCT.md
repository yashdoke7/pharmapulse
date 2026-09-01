# POD D — Product & Frontend · RESULTS

> What was built, what it measured, what broke, and where the code is.
> Original brief: `../04_POD_D_PRODUCT_FRONTEND.md`

**Owns:** `web/`
**Delivers:** seven screens, two bespoke charts, and the design system.

---

## 1. Scorecard

| Deliverable | Status | Evidence |
|---|---|---|
| Seven screens on live data | **done** | all verified rendering, no console errors |
| Fan chart, raw SVG | **done** | 3 bands, cutoff rule, hatched partial buckets |
| Reliability diagram, raw SVG | **done** | before/after curves + identity line |
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
