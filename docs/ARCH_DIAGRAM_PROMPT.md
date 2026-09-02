# Architecture diagram — generation prompt

The prompt below describes **the system as built**, not the original design. The
old `docs/Arch Diagram1.png` cannot be used: its labels are garbled
(`aalesdally.sev`, `Ldompotent`, `newsvender formula`, `eapiry exposure`,
`DuskDB`, `confluence range`) and it draws Layer 4, the Scenario Engine, the AI
Assistant and the Stress-Test Harness — none of which exist in the build.

**Read this first.** Image models garble small text. That is what happened to the
first diagram, and it will happen again. Two defences are built into the prompt:
every label is short, and the component count is capped. Even so, **check every
word in the output against the component list at the bottom of this file before
using it.** If a single label is wrong, regenerate rather than ship it — a
diagram with a typo in it is worse than no diagram, because it is the one thing
a panel will read closely.

A guaranteed-correct alternative exists: deck slide 8 draws the same content in
native PowerPoint shapes, where the text cannot be mangled.

---

## The prompt

> A professional software architecture diagram, landscape 16:9, for a demand
> forecasting system called **PharmaPulse**.
>
> **Style:** clean corporate technical documentation. Flat vector. Warm off-white
> background (#F7F4EE). Rounded rectangles with thin 1px borders and soft tinted
> fills. Generous white space. No gradients, no drop shadows, no 3D, no glow, no
> isometric perspective, no photographic elements. Sans-serif labels, high
> contrast, large enough to read on a projector. Every text label must be
> rendered exactly as written, spelled correctly.
>
> **Layout:** five horizontal bands stacked top to bottom, each band a rounded
> container holding its component boxes in a row. A slim vertical label column on
> the far left names each band. A single downward arrow connects each band to the
> one below it, on the centre line. Data flows one way only, top to bottom.
>
> **Band 1 — DATA FOUNDATION.** Colour: warm grey (#6B6459). Five boxes left to
> right, each with a small numbered chip:
> `1.1 Ingester`, `1.2 Validator`, `1.3 Cleaner`, `1.4 Feature Builder`,
> `1.5 Gold Store`.
>
> **Band 2 — FORECAST ENGINE.** Colour: deep green (#1F5D42). Six boxes:
> `2.1 Classifier`, `2.2 Portfolio`, `2.3 Combiner`, `2.4 Calibrator`,
> `2.5 Forecast Store`, `2.6 Attribution`.
>
> **Between band 2 and band 3:** a horizontal dashed rule spanning the full
> width, with centred small caps text on it reading exactly:
> `ABOVE — runs offline, once, about 4 minutes    BELOW — runs per request, under a second`
>
> **Band 3 — DECISION ENGINE.** Colour: deep blue (#1C4E7A). Four boxes:
> `3.1 Order Calculator`, `3.2 Risk Detector`, `3.3 Stock Ledger`,
> `3.4 Replay Simulator`.
>
> **Band 4 — SERVICE.** Colour: dark amber (#8A6410). One wide box spanning the
> band, reading exactly:
> `FastAPI — 16 endpoints — one provenance envelope on every response`
>
> **Band 5 — PRODUCT.** Colour: deep red (#A32E22). Seven small equal boxes:
> `Decisions`, `Order`, `Forecast`, `Why`, `Replay`, `Evidence`, `Settings`.
>
> **Left sidebar,** a narrow vertical column beside bands 1 and 2, three small
> stacked boxes titled `DATA LANES`:
> green box `1 OBSERVED — trains models`,
> grey box `2 USER SETTING — never trains`,
> red box with a dashed border `3 SYNTHETIC — blocked in code`.
> A red X marks the arrow from the synthetic box into band 1.
>
> **Title,** centred at the top: `PHARMAPULSE` in large bold letters, with the
> subtitle `Demand forecast to purchase order — the system as built` beneath it.
>
> **Footnote,** small text along the bottom edge, exactly:
> `Layer 4 (Intelligence) does not exist: attribution moved into the forecast engine, replay into the decision engine.`
>
> Do not add any icons, logos, people, medical imagery, or decorative elements.
> Do not add any text that is not listed above.

---

## Checklist — verify the generated image against this

Every label below must appear, spelled exactly. Anything else is a
hallucination and means regenerate.

| Band | Boxes |
|---|---|
| 1 · DATA FOUNDATION | Ingester · Validator · Cleaner · Feature Builder · Gold Store |
| 2 · FORECAST ENGINE | Classifier · Portfolio · Combiner · Calibrator · Forecast Store · Attribution |
| 3 · DECISION ENGINE | Order Calculator · Risk Detector · Stock Ledger · Replay Simulator |
| 4 · SERVICE | FastAPI — 16 endpoints — one provenance envelope on every response |
| 5 · PRODUCT | Decisions · Order · Forecast · Why · Replay · Evidence · Settings |
| Sidebar | OBSERVED · USER SETTING · SYNTHETIC |

**Must NOT appear** — these were in the original design and were never built:
Reconciler, Scenario Engine, AI Assistant, Alerts, Stress-Test Harness,
Promotion Gate, Drift Monitors, Update Modes, Layer 4, Intelligence,
Recommendation Builder, Redis, PostgreSQL, MLflow, Prometheus.

**Commonly garbled — check these characters individually:** `salesdaily.csv`,
`idempotent`, `newsvendor`, `expiry`, `DuckDB`, `confidence`, `rupee`.
