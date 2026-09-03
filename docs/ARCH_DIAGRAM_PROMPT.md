# Architecture diagrams — generation prompts

Four diagrams, one shared visual style. Each one answers a different question, so
they can be shown together without repeating each other:

| # | Diagram | Answers |
|---|---|---|
| **A** | **The whole system** | What are the parts, and in what order do they run? |
| **B** | **Data flow and trust** | Where does each kind of data go — and what is blocked? |
| **C** | **Inside the forecast engine** | How do five models become one calibrated distribution? |
| **D** | **Settings → order quantity** | How do the numbers a pharmacist types turn into boxes? |

---

## ⚠ Read this before generating anything

**1. Image models garble small text.** That is what happened to
`docs/Arch Diagram1.png`, whose labels came out as `aalesdally.sev`,
`Ldompotent`, `newsvender formula`, `eapiry exposure`, `DuskDB` and
`confluence range`. Two defences are built into every prompt below: **short
labels** and a **capped component count**. Even so, **check every word against
the checklist under each prompt before using the image.** If one label is wrong,
regenerate — a diagram with a typo is worse than no diagram, because it is the
one thing a panel reads closely.

**2. The old prompt described components that do not exist.** Any prompt or slide
mentioning the following is describing the *original design*, not the build:

> **Reconciler · Scenario Engine · AI Assistant · Alerts · Recommendation Builder
> · Update Modes · Promotion Gate · Drift Monitors · Stress-Test Harness ·
> Layer 4 "Intelligence" · Redis · PostgreSQL · MLflow · Prometheus**

None of those were built. Attribution moved **into** the forecast engine and
replay moved **into** the decision engine, which is why there is no Layer 4. See
`ARCHITECTURE_DELTA.md`.

**3. A guaranteed-correct fallback exists.** Deck slide 8 draws the same content
in native PowerPoint shapes, where the text cannot be mangled.

---

## The shared style block

**Paste this at the top of every prompt below.** It is what makes the four
diagrams look like one set.

> Draw a flat, clean architecture diagram in a modern corporate documentation
> style. 16:9 landscape, white background.
>
> **Structure:** every section is a **rounded container with a thin coloured
> border** and a **bold coloured label in its top-left corner**. Inside each
> section, content sits in **white rounded cards**: a small line icon, a bold
> title, then bullet points.
>
> **Text rules, and they matter more than anything else:**
> - **Maximum 4 bullets per card. Maximum 6 words per bullet.** Trim words rather
>   than shrinking the text.
> - Every label must be rendered **exactly as written and spelled correctly**.
> - All text horizontal. No rotated labels.
>
> **Layout rules:** cards within a band are **equal width and equal height**.
> Generous white space — do not fill empty areas with decoration. No gradients,
> no drop shadows, no 3D, no isometric perspective, no photographs, no people, no
> medical imagery, no logos.
>
> **Colour meaning, used consistently:**
> `green = data` · `blue = forecasting` · `teal = decisions` ·
> `purple = service and API` · `orange = product screens` · `grey = robustness` ·
> `red dashed = a blocked path`
>
> Add no text that is not listed in the content below.

---

# Diagram A — the whole system

*The one to lead with. Everything, in the order it runs.*

## Prompt

> [paste the shared style block, then:]
>
> **TITLE**, centred at the top: **`PHARMAPULSE`**
> subtitle: `Demand forecast to purchase order — the system as built`
>
> ### LEFT COLUMN — section label `DATA SOURCES` — three stacked cards
>
> **Card 1**, GREEN SOLID border, icon: spreadsheet
> `Observed Sales`
> · salesdaily.csv, one source
> · 2,106 days, 8 drug groups
> · 2014 to 2019
> · TRAINS THE MODELS
>
> **Card 2**, AMBER DASHED border, icon: sliders
> `Pharmacy Settings`
> · lead time, review period
> · holding cost, margin, expiry
> · stock on hand, pack size
> · never trains a model
>
> **Card 3**, RED DASHED border, icon: warning triangle
> `Synthetic Data`
> · demonstration only
> · labelled on every screen
> · blocked from training
>
> ### BAND 1 — section label `LAYER 1 · DATA FOUNDATION` (green) — five cards
>
> `1.1 Ingester` icon: download
> · daily file only
> · append-only, idempotent
> · re-runs change nothing
>
> `1.2 Validator` icon: shield-check
> · seven quality gates
> · one provenance lane
> · failed batch quarantined
>
> `1.3 Cleaner` icon: broom
> · closures masked, not filled
> · outliers flagged, not deleted
> · partial periods labelled
>
> `1.4 Feature Builder` icon: layers
> · lags and rolling averages
> · calendar and Fourier terms
> · cutoff first, no leakage
>
> `1.5 Gold Store` icon: database
> · Parquet, three grains
> · origin lane per row
> · snapshot id per row
>
> ### BAND 2 — section label `LAYER 2 · FORECAST ENGINE` (blue) — five cards
>
> `2.1 Classifier` icon: branching arrows
> · ADI and CV squared
> · smooth, intermittent, lumpy
> · recomputed every run
>
> `2.2 Portfolio` icon: brain
> Show FIVE small chips stacked inside this card, reading exactly:
> `Prophet` `AutoARIMA` `MSTL` `SeasonalNaive` `LightGBM`
> and one chip branching off to the side: `Croston — sparse route`
> Do NOT put any accuracy scores in this card.
>
> `2.3 Combiner` icon: merge arrows
> · median across five models
> · quantiles kept in order
> · one blended distribution
>
> `2.4 Calibrator` icon: target
> · conformal adjustment
> · stated equals achieved
> · 92 percent to 82 percent
>
> `2.5 Forecast Store` icon: box
> · 21 quantiles per period
> · day, week and month
> · published by pointer swap
>
> ### DIVIDER — a bold horizontal line across the full width, between Band 2 and Band 3, with centred text on it reading exactly:
>
> `ABOVE — runs overnight, once, about 1 minute      BELOW — runs per request, under a second`
>
> ### BAND 3 — section label `LAYER 3 · DECISION ENGINE` (teal) — four cards
>
> `3.1 Stock Ledger` icon: shelf
> · opening plus received minus sold
> · days of cover
> · SQLite, event sourced
>
> `3.2 Order Calculator` icon: calculator
> · newsvendor, closed form
> · service level from costs
> · rounded to whole packs
>
> `3.3 Risk Detector` icon: alert
> · stockout and overstock
> · expiry exposure
> · ranked by money
>
> `3.4 Replay Simulator` icon: play button
> · real 2018 to 2019 days
> · four ordering policies
> · measures the cost gap
>
> ### RIGHT COLUMN — section label `EXPLAINABILITY` (purple) — two stacked cards, drawn beside Bands 2 and 3
>
> `Attribution` icon: bar chart
> · Prophet parts, in units
> · trend, season, holidays
> · parts add to the whole
>
> `Provenance Envelope` icon: tag
> · origin lane
> · model version
> · data snapshot id
>
> ### BAND 4 — section label `LAYER 4 · SERVICE` (light purple) — one thin full-width strip
>
> Text inside, exactly:
> `FastAPI — 16 endpoints — every response carries origin, model version and snapshot id`
>
> ### BAND 5 — section label `LAYER 5 · PRODUCT` (orange) — eight small equal cards in a row, name only
>
> `Decisions` `Order` `Forecast` `Why` `Replay` `Evidence` `Data` `Settings`
>
> ### ARROWS
>
> · Solid green arrow from Data Sources card 1 into Band 1, labelled
>   `trains the models`
> · Dashed amber arrow from Data Sources card 2, curving **past** Band 2, into
>   Band 3 only, labelled `settings, not training data`
> · RED DASHED arrow from Data Sources card 3 into Band 2 with a large red X
>   crossing it, labelled `blocked in code`
> · Solid arrows straight down the centre: Band 1 → Band 2 → Band 3 → Band 4 →
>   Band 5
> · Thin arrows from Band 2 and Band 3 across to the Explainability column
>
> Prioritise legibility over density. If something does not fit, shorten the
> words.

## Checklist — every label that must appear, spelled exactly

| Section | Cards |
|---|---|
| DATA SOURCES | Observed Sales · Pharmacy Settings · Synthetic Data |
| 1 · DATA FOUNDATION | Ingester · Validator · Cleaner · Feature Builder · Gold Store |
| 2 · FORECAST ENGINE | Classifier · Portfolio · Combiner · Calibrator · Forecast Store |
| Portfolio chips | Prophet · AutoARIMA · MSTL · SeasonalNaive · LightGBM · Croston |
| 3 · DECISION ENGINE | Stock Ledger · Order Calculator · Risk Detector · Replay Simulator |
| EXPLAINABILITY | Attribution · Provenance Envelope |
| 4 · SERVICE | FastAPI — 16 endpoints — … |
| 5 · PRODUCT | Decisions · Order · Forecast · Why · Replay · Evidence · Data · Settings |

**Commonly garbled — check character by character:** `salesdaily.csv`,
`idempotent`, `newsvendor`, `expiry`, `Parquet`, `SeasonalNaive`, `conformal`,
`quantiles`, `provenance`.

---

# Diagram B — data flow and trust

*The one that wins the "how do we know this number is real" question. It is not
about components; it is about **what is allowed to touch what**.*

## Prompt

> [paste the shared style block, then:]
>
> **TITLE**, centred at the top: **`WHERE EVERY NUMBER COMES FROM`**
> subtitle: `Three lanes of data, and what each one is allowed to do`
>
> ### TOP BAND — section label `THE THREE LANES` (grey container) — three cards in a row
>
> **Card 1**, GREEN border, icon: spreadsheet
> `LANE 1 — OBSERVED`
> · real recorded sales
> · trains models
> · backs accuracy claims
>
> **Card 2**, AMBER border, icon: sliders
> `LANE 2 — USER SETTING`
> · lead time, costs, stock
> · explains as an input
> · never trains a model
>
> **Card 3**, RED DASHED border, icon: warning triangle
> `LANE 3 — SYNTHETIC`
> · demonstrates the pipeline
> · labelled on every screen
> · never backs a claim
>
> ### MIDDLE — a wide horizontal flow of six rounded cards, left to right, connected by solid arrows. Section label `THE PATH EVERY ROW TAKES` (green container)
>
> 1. `CSV file` icon: document
>    · one daily file
>    · hashed on arrival
> 2. `Bronze` icon: download
>    · long form rows
>    · append only, idempotent
> 3. `Validation` icon: shield-check
>    · seven gates
>    · one lane per batch
> 4. `Gold` icon: database
>    · day, week, month
>    · derived, never ingested
> 5. `Forecast Store` icon: box
>    · 21 quantiles
>    · immutable versions
> 6. `Screen` icon: monitor
>    · number plus its lane
>    · badge turns amber
>
> Under this row, one small grey caption:
> `origin and snapshot id travel on every row, from file to screen`
>
> ### THREE ARROWS FROM THE LANES INTO THE FLOW
>
> · Solid GREEN arrow: Lane 1 → card 1 `CSV file`, labelled `trains everything`
> · Dashed AMBER arrow: Lane 2 → skips the whole flow and enters the DECISION
>   box below, labelled `enters at decision time only`
> · RED DASHED arrow: Lane 3 → card 3 `Validation`, with a large red X across it
>   and the label `refused unless declared`
>
> ### LOWER LEFT — section label `WHAT VALIDATION REFUSES` (grey) — one card, four bullets
>
> `Seven Gates`
> · missing or renamed columns
> · duplicate day and product
> · negative or null sales
> · two lanes in one batch
>
> ### LOWER RIGHT — section label `DECISION TIME` (teal) — one card
>
> `Order Calculator`
> · forecast distribution in
> · pharmacy settings in
> · one order quantity out
>
> ### BOTTOM STRIP — section label `WHEN THINGS BREAK` (grey) — four small boxes in a row, connected by right-pointing arrows, forming a ladder
>
> `Full system` → `Cached forecast` → `Captured fixtures` → `Badge on screen`
>
> Caption under the strip, exactly:
> `The app always runs. It just tells you what it is running on.`
>
> ### A CURVED FEEDBACK ARROW
>
> From the `Screen` card, curving back to `CSV file`, labelled
> `orders placed and actual sales`

## Checklist

Lanes: `LANE 1 — OBSERVED` · `LANE 2 — USER SETTING` · `LANE 3 — SYNTHETIC`
Flow: `CSV file` · `Bronze` · `Validation` · `Gold` · `Forecast Store` · `Screen`
Others: `Seven Gates` · `Order Calculator` · degradation ladder of four boxes.

**Must NOT appear:** any model name (this diagram is about data, not models), any
accuracy figure, Redis, PostgreSQL, Kafka.

---

# Diagram C — inside the forecast engine

*The zoom-in. One product, one week, from history to a calibrated range.*

## Prompt

> [paste the shared style block, then:]
>
> **TITLE**, centred at the top: **`HOW ONE FORECAST IS MADE`**
> subtitle: `One product, one week — history to a calibrated range`
>
> A **left-to-right pipeline** across the middle of the canvas, with five stages
> in blue rounded containers connected by solid arrows.
>
> ### STAGE 1 — container label `HISTORY`
> One card, `Gold Rows` icon: database
> · complete periods only
> · closures and outliers flagged
> · nothing after the cutoff
>
> ### STAGE 2 — container label `ROUTE`
> One card, `Demand Classifier` icon: branching arrows
> · gaps between sales, ADI
> · variation in size, CV squared
> · picks the model list
>
> Beside this card, a small 2 by 2 grid box, four cells labelled exactly:
> `smooth` `erratic` `intermittent` `lumpy`
> with the axis captions `sales far apart →` under it and `sizes vary →` beside
> it.
>
> ### STAGE 3 — container label `FIT` — the widest container, holding FIVE small stacked cards, each with a one-line description
>
> `Prophet` — trend, season, holidays
> `AutoARIMA` — short run memory
> `MSTL` — season of any shape
> `SeasonalNaive` — last year, unchanged
> `LightGBM` — learns across products
>
> Small grey text under the five: `each fitted independently`
>
> ### STAGE 4 — container label `COMBINE`
> One card, `Median` icon: merge arrows
> · median at each quantile
> · one bad fit cannot dominate
> · quantiles sorted back in order
>
> Small grey text beneath: `combining beat choosing — 0.907 against 0.968`
>
> ### STAGE 5 — container label `CALIBRATE`
> One card, `Conformal` icon: target
> · compares stated to achieved
> · shrinks or widens the range
> · 92 percent became 82 percent
>
> ### OUTPUT — to the far right, one larger card in a teal container labelled `WHAT SHIPS`
>
> `Demand Distribution`
> · 21 quantiles per period
> · day, week and month
> · ready for the order maths
>
> ### BOTTOM STRIP — section label `HOW WE KNOW IT WORKS` (grey), four small boxes in a row
>
> `Rolling origin` · four folds, never sees ahead
> `MASE` · 1.0 means no better than naive
> `Ensemble 0.907` · beats naive 1.118
> `Oracle 0.843` · a bound, not a model
>
> ### ONE EXTRA ARROW
>
> A thin dashed arrow from the `Prophet` card downward to a small separate purple
> card labelled `Attribution — trend, season, holidays in units`, showing that the
> explanation comes out of the same fit.

## Checklist

Stages: `HISTORY` · `ROUTE` · `FIT` · `COMBINE` · `CALIBRATE` · `WHAT SHIPS`
Models: `Prophet` · `AutoARIMA` · `MSTL` · `SeasonalNaive` · `LightGBM`
Quadrants: `smooth` · `erratic` · `intermittent` · `lumpy`
Numbers, and these must be exact: `0.907` · `0.968` · `1.118` · `0.843` ·
`92 percent` · `82 percent` · `21 quantiles`

**Must NOT appear:** Theta, AutoETS, WindowAverage or Naive as *shipped* models —
they are benchmarks only. No SHAP. No neural network of any kind.

---

# Diagram D — settings to order quantity

*The one that shows the actual product. Nobody else's diagram has this, because
most teams stop at the forecast.*

## Prompt

> [paste the shared style block, then:]
>
> **TITLE**, centred at the top: **`FROM A RANGE TO A NUMBER OF BOXES`**
> subtitle: `What the pharmacist types, and how it becomes an order`
>
> ### LEFT COLUMN — section label `WHAT THE PHARMACIST SETS` (amber container) — five small stacked cards, each just a label and a value
>
> `Lead time` — 4 days
> `Review period` — 7 days
> `Unit margin` — the profit per unit
> `Unit cost, holding, expiry` — what overstock costs
> `Stock on hand, pack size` — what is on the shelf
>
> Small amber caption under the column: `lane 2 — never trains a model`
>
> ### CENTRE — a vertical stack of five teal cards connected by downward arrows, section label `THE ORDER CALCULATION` (teal container)
>
> **Step 1** `Protection Interval` icon: calendar
> · lead time plus review period
> · 4 plus 7 equals 11 days
> · the order must last that long
>
> **Step 2** `Two Costs` icon: scales
> · short costs the lost margin
> · over costs holding plus expiry
> · expiry dominates, not holding
>
> **Step 3** `Critical Fractile` icon: pie slice
> Show the formula on its own line, exactly:
> `q* = Cu / (Cu + Co)`
> · balances the two mistakes
> · here it comes out 0.948
> · chosen by costs, not by policy
>
> **Step 4** `Read the Quantile` icon: line chart
> · take that point on the range
> · subtract what is on the shelf
> · this is the raw quantity
>
> **Step 5** `Round to Packs` icon: box
> · medicines come in packs
> · round up when short costs more
> · the direction is calculated
>
> ### RIGHT COLUMN — section label `WHAT THE BUYER SEES` (orange container) — three stacked cards
>
> `Order Quantity` icon: shopping cart
> · whole packs
> · with its status chip
> · OK, watch, or order now
>
> `Service Level Slider` icon: sliders
> · 16 levels ship with the answer
> · recomputes in the browser
> · never calls the network
>
> `The Reason` icon: list
> · every input listed
> · each tagged with its lane
> · the cost curve behind it
>
> ### ONE INPUT ARROW FROM ABOVE
>
> A wide blue arrow entering Step 4 from the top, labelled
> `demand distribution from the forecast engine`, so it is clear the forecast and
> the settings meet at exactly one place.
>
> ### BOTTOM STRIP — section label `WHY THIS BEATS A REORDER RULE` (grey), three small boxes in a row
>
> `Typical ERP` · one service level for everything
> `PharmaPulse` · service level per product, from its own costs
> `Measured` · beats the textbook sizing in all three windows

## Checklist

Steps: `Protection Interval` · `Two Costs` · `Critical Fractile` ·
`Read the Quantile` · `Round to Packs`
Formula, exactly: `q* = Cu / (Cu + Co)`
Numbers, exactly: `4` · `7` · `11 days` · `0.948` · `16 levels`
Right column: `Order Quantity` · `Service Level Slider` · `The Reason`

**Must NOT appear:** any model name, any MASE figure, the word "AI", the word
"prediction" on its own (it is a *distribution*).

---

## After generating: the three checks that catch 90% of problems

1. **Read every label out loud.** Garbled text is the failure mode, and it hides
   in the words you expect rather than the ones you read.
2. **Count the cards.** Image models add a sixth card to a five-card row to fill
   space. An extra card is an invented component.
3. **Search for the banned list** at the top of this file. If `Reconciler`,
   `AI Assistant`, `Scenario Engine` or `Drift Monitors` appears, the model has
   pulled it from a generic architecture template and the image is wrong.
