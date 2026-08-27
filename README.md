# PharmaPulse

> **Every pharmacy guesses how much to order. We calculate it — with the odds, the cost of being
> wrong, and the reason behind the number.**

PharmaPulse turns six years of pharmacy sales history into one number a buyer can act on: **how many
boxes of each medicine to order this week.** It forecasts demand as a distribution, says how
confident it is *and proves that confidence is calibrated*, converts the distribution into a purchase
quantity using the pharmacy's own costs, explains where the number came from in units, and reports
honestly on its own accuracy and cost.

```
history  →  forecast  →  uncertainty  →  order quantity  →  cost of being wrong
```

Cognizant campus drive · Healthcare · Pharma Sales Analysis & Forecasting · 4 days · 8 people.

---

## Start here

| You are | Read, in this order |
|---|---|
| **Anyone on the team** | `team/00_PROJECT_BRIEF.md` → your pod's file → `CONTRACTS.md` |
| **Pod A — Data & Platform** | `team/01_POD_A_DATA_PLATFORM.md` · `pipelines/README.md` · `infra/README.md` |
| **Pod B — Forecast Engine** | `team/02_POD_B_FORECAST_ENGINE.md` · `core/README.md` · `artifacts/README.md` |
| **Pod C — Decision & API** | `team/03_POD_C_DECISION_API.md` · `decision/README.md` · `api/README.md` |
| **Pod D — Product** | `team/04_POD_D_PRODUCT_FRONTEND.md` · `web/README.md` |
| **Lead** | `team/06_PLAN_AND_CUTS.md` · `team/05_INTEGRATION_DOCKER_OPS.md` · `CONTRACTS.md` |
| **A judge** | `docs/PHARMAPULSE_CONCEPT.md` (the design) · `docs/PHARMAPULSE_ARCHITECTURE.md` (the engineering) |

**Paste `team/00_PROJECT_BRIEF.md` plus your pod's file into your coding agent. That is all the
context it needs.**

---

## Set up (15 minutes)

```bash
python -m venv .venv && source .venv/Scripts/activate
pip install -r requirements.txt
python scripts/check_data.py          # place salesdaily.csv in data/observed/ first
python scripts/make_fixtures.py
pytest -q
cd web && npm install && npm run dev
```

Or the whole thing in containers:

```bash
docker compose up --build
```

**Dataset:** Kaggle *Pharma Sales Data* (milanzdravkovic) — put **`salesdaily.csv` only** into
`data/observed/`. The supplied monthly file is corrupt; weekly and monthly grains are derived.

---

## Commands

```bash
make setup       # install python deps
make data        # verify the dataset and print the snapshot_id
make pipeline    # raw csv -> gold parquet
make forecast    # gold -> fit -> combine -> calibrate -> forecast store
make benchmark   # reproduce every accuracy number -> artifacts/benchmarks.json
make fixtures    # regenerate contracts/fixtures/*.json
make api         # uvicorn on :8000
make web         # vite on :5173
make test        # pytest
make up          # docker compose up
```

---

## Layout

```
CONTRACTS.md      the frozen interfaces. Read before coding. Lead owns.
docs/             the submitted design documents. Lead owns. DO NOT EDIT.
team/             one brief per pod, plus the plan and the integration doc
contracts/        schemas, fixtures, generated openapi.json
data/             observed/ (lane 1) · synthetic/ (lane 3) · warehouse/ (derived, gitignored)
pipelines/        POD A   ingest · validate · clean · features · nightly runner
core/             POD B   classify · portfolio · combine · calibrate · store · explain
decision/         POD C   ledger · newsvendor · risk · recommendations
api/              POD C   FastAPI app, routers, schemas
web/              POD D   React application
scripts/          check_data · day1_benchmark · make_fixtures · dump_openapi
tests/            unit · property · contract
infra/            Dockerfiles, CI
artifacts/        benchmarks.json — machine-generated, never hand-edited
```

Each folder has its own `README.md` stating its **target, inputs, outputs and definition of done.**

---

## The three claims this project rests on

1. **The purchase order is the product, not the forecast.** The newsvendor step — `q* = Cu/(Cu+Co)`,
   closed form, exact — is what turns a chart into a decision. Almost nobody in this market ships it.
2. **We combine, we do not select.** Per-series model selection was implemented and measured
   *losing* to a plain median combination. "We tested the obvious approach and it lost" is a result.
3. **We measure whether our own confidence intervals are true, and show the answer.** A nominal 80%
   interval that actually covers 75% makes the order calculation silently under-order while the
   screen claims 95%. We correct it and put the before/after curve in the product.

**And the limitation we say out loud before anyone asks:** we forecast *sales*, not *demand*. A
stockout records zero sales, so observations are right-censored — worst on exactly the products that
matter most. It is in the model card, and it is the first thing a real deployment fixes.

---

## Status

| | |
|---|---|
| Design documents | complete (`docs/`) |
| Repository structure, contracts, fixtures, Docker, CI | scaffolded |
| Implementation | **not started** — Day 0 is next |
| `artifacts/benchmarks.json` | **placeholder** — Pod B regenerates it on Day 1, top priority |
