# `data/` — the three provenance lanes, physically separated

**Owner:** Pod A. **Every pod must understand the lane rule.**

---

## Target

> Make it structurally impossible for invented data to train a model or back an accuracy claim.

The separation is physical — two roots, one of which the trainer refuses — because a rule enforced by
directory layout survives a deadline and a rule enforced by discipline does not.

## Layout

| Path | Lane | May train | May explain | May back a claim | Committed to git |
|---|---|---|---|---|---|
| `observed/` | **1 · observed** | **yes** | yes | **yes** | yes — `salesdaily.csv`, `holidays.csv` |
| `synthetic/` | **3 · synthetic** | **no — blocked in code** | no | no | yes, if it exists at all |
| `warehouse/` | derived | — | — | — | **no** (gitignored) |

Lane 2 (`user_setting` — lead time, holding cost, margin, stock on hand, pack size) is not a
directory. It lives in `warehouse/ops.db` and enters the system **only at the decision engine**.

## `observed/` — what goes here

| File | Notes |
|---|---|
| `salesdaily.csv` | Kaggle *Pharma Sales Data* (milanzdravkovic). 2,106 rows, 8 ATC-2 columns, 2014-01-02 → 2019-10-08 |
| `holidays.csv` | Serbian Orthodox calendar, versioned and committed by Pod A1 |

**Do not put `salesweekly.csv` or `salesmonthly.csv` here.** The monthly file is corrupt — 53
series-months disagree with a daily rollup by more than 5%, including January 2017 recorded as
near-zero against roughly 2,700 real units. Weekly and monthly grains are derived by resampling.
`scripts/check_data.py` **fails** if those files are present, because somebody will otherwise read
one "just to compare".

```bash
python scripts/check_data.py     # asserts 2,106 rows, 8 columns, 26 closure days; prints snapshot_id
```

**Pin that `snapshot_id` in the team channel.** Every reported number is tied to it.

## `warehouse/` — derived, disposable, never committed

```
warehouse/
  bronze/      long-form append-only ingest
  gold/        contract C1, partitioned grain=<g>/year=<yyyy>/
  features/    cutoff-aware feature matrix
  forecast/    contract C2, version=<slug>/ + the CURRENT pointer
  ops.db       SQLite: settings, stock ledger, orders, overrides, audit chain
```

Rebuild any of it with `make nightly`. If it is not reproducible from `observed/` plus code, it is a
bug.

## The lane rule, in one screen

```
LANE 1  observed       may train YES · may explain YES · may claim YES
LANE 2  user_setting   may train NO  · may explain YES (as a named input) · may claim NO
LANE 3  synthetic      may train NO  · may explain NO  · may claim NO
```

**Enforcement, not intention:**

- `pipelines/ingest.py` **raises** on a path containing `synthetic`. `tests/unit/test_lane_enforcement.py`
  asserts it.
- Every gold and forecast row carries an `origin` column; the API returns it; the UI renders a badge
  from it rather than inferring it.
- `benchmarks.json` filters on `origin = 'observed'` **in the benchmark script**, not by anyone
  remembering.
- **`price` and `promotion` are excluded by name** as model features. No such column exists here, so
  a fitted coefficient on a generated one would describe noise — and the explainability screen would
  then present that noise to a buyer as a commercial driver. They may appear only as what-if levers
  with the assumption displayed.

> The fastest way to lose a technical judge is for them to discover that an impressive feature-
> importance chart was computed over invented columns. Declaring the lanes turns the project's
> biggest vulnerability into its most credible feature.
