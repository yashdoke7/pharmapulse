# CONTRACTS — frozen interfaces

> **Read this before you write a line of code. Every pod codes against this file, not against
> another pod's implementation.**
>
> **Frozen at the end of Day 0.** After that, a change needs the lead's approval and a line added to
> the *Change log* at the bottom. Nobody may change a shape silently — that is the one thing that
> loses a 4-day sprint.

There are **five** contracts. Each has exactly one producer and one or more consumers.

| # | Contract | Producer | Consumers | Where it lives |
|---|---|---|---|---|
| **C1** | Gold table schema | Pod A | Pod B | `contracts/schemas/gold.sql` |
| **C2** | Forecast store schema | Pod B | Pod C | `contracts/schemas/forecast.sql` |
| **C3** | HTTP API + JSON shapes | Pod C | Pod D | this file + `contracts/openapi.json` (generated) |
| **C4** | `benchmarks.json` shape | Pod B | Pod C, Pod D | this file + `artifacts/benchmarks.json` |
| **C5** | Fixtures | Pod A (day 0), then Pod C | Pod D | `contracts/fixtures/*.json` |

---

## C0 — Vocabulary (use these exact words everywhere: code, JSON, UI labels)

| Term | Meaning |
|---|---|
| `series_id` | ATC-2 code. One of: `M01AB M01AE N02BA N02BE N05B N05C R03 R06` |
| `grain` | `day` or `week` or `month` |
| `ds` | period **start** date, ISO `YYYY-MM-DD`, store-local calendar |
| `cutoff` | last observed date used to produce a forecast |
| `horizon` / `h` | steps ahead, 1-indexed |
| `quantile` | float in `[0,1]`, serialised as a **string key** in JSON (`"0.05"`) |
| `origin` | `observed`, `user_setting`, or `synthetic` — the provenance lane |
| `model_version` | `"<iso-timestamp>/<ensemble-tag>"`, e.g. `2026-08-27T02:14Z/ens-v3` |
| `snapshot_id` | `sha256:<first 12 hex>` of the source CSV |

**Quantile levels stored (21):** `0.01 0.025 0.05 0.10 0.15 0.20 0.25 0.30 0.35 0.40 0.50 0.60 0.65
0.70 0.75 0.80 0.85 0.90 0.95 0.975 0.99`

**Quantile levels the UI draws (7):** `0.05 0.10 0.25 0.50 0.75 0.90 0.95`

---

## C1 — Gold table  (Pod A produces, Pod B consumes)

Parquet, partitioned `grain=<g>/year=<yyyy>/`, at `data/warehouse/gold/`.
Readable with `duckdb.sql("SELECT * FROM 'data/warehouse/gold/**/*.parquet'")`.

```sql
CREATE TABLE gold_demand (
  series_id     TEXT     NOT NULL,   -- ATC-2 code
  ds            DATE     NOT NULL,   -- period start, store-local
  grain         TEXT     NOT NULL,   -- 'day' | 'week' | 'month'
  y             DOUBLE,              -- units dispensed
  origin        TEXT     NOT NULL,   -- 'observed' | 'user_setting' | 'synthetic'
  is_closed     BOOLEAN  NOT NULL,   -- pharmacy shut; mask from training loss
  is_outlier    BOOLEAN  NOT NULL,   -- flagged, NEVER removed or winsorised
  completeness  DOUBLE   NOT NULL,   -- 1.0 = full period; <1.0 = partial
  snapshot_id   TEXT     NOT NULL,
  PRIMARY KEY (series_id, ds, grain)
);
```

**Guarantees Pod A owes Pod B (each has a test):**

1. Weekly and monthly rows are **derived from daily**, never ingested. A rollup of daily equals the
   weekly and monthly rows exactly.
2. `(series_id, ds, grain)` is unique. Re-running ingest on the same file changes nothing.
3. `is_closed = true` on the 26 all-zero days. Those rows keep `y = 0.0` and are excluded by the
   *consumer* via the flag — Pod A does not delete them.
4. Any period with `completeness < 1.0` is present and flagged, never silently dropped.
5. `origin = 'observed'` on every row derived from `salesdaily.csv`.

**Feature table** (same root, `data/warehouse/features/`) — one row per `(series_id, ds, grain)`:

| Group | Columns |
|---|---|
| Autoregressive | `lag_1 lag_2 lag_3 lag_4 lag_8 lag_52` |
| Rolling | `roll_mean_4 roll_std_4 roll_mean_13 roll_std_13 roll_mean_52 roll_std_52 expanding_mean` |
| Calendar | `woy month quarter dow` |
| Seasonal basis | `fourier_sin_1..3 fourier_cos_1..3` |
| Event | `is_holiday days_to_holiday is_closed is_outlier` |
| Identity | `series_id` (categorical) |

> **The one non-negotiable feature rule:** every feature is computed as of an explicit `cutoff`
> argument. `tests/unit/test_no_leakage.py` asserts a feature value at time *t* is identical
> whether or not rows after *t* exist in the frame. If that test is red, nothing downstream means
> anything, including every number in the deck.

---

## C2 — Forecast store  (Pod B produces, Pod C consumes)

Parquet at `data/warehouse/forecast/version=<slug>/`, plus a pointer file
`data/warehouse/forecast/CURRENT` containing the live version slug.

```sql
CREATE TABLE forecast (
  series_id      TEXT    NOT NULL,
  grain          TEXT    NOT NULL,
  cutoff         DATE    NOT NULL,
  ds             DATE    NOT NULL,
  horizon        INT     NOT NULL,
  quantile       DOUBLE  NOT NULL,
  value          DOUBLE  NOT NULL,   -- >= 0, monotone non-decreasing in quantile
  model_version  TEXT    NOT NULL,
  snapshot_id    TEXT    NOT NULL,
  calibrated     BOOLEAN NOT NULL,
  PRIMARY KEY (series_id, grain, cutoff, ds, quantile)
);
```

**Publication is a pointer swap.** Pod B writes a new `version=` directory, then rewrites `CURRENT`
as the last step. Pod C only ever reads the version named in `CURRENT`. A half-written run is
therefore never readable.

**Python interface Pod C is allowed to call** — `core/forecast_store.py`:

```python
def current_version() -> str: ...

def read_forecast(series_id: str, grain: str, horizon: int = 8,
                  cutoff: str | None = None) -> pd.DataFrame: ...
    # columns: ds, horizon, quantile, value   (cutoff defaults to the latest)

def read_quantiles(series_id: str, grain: str, horizon: int) -> dict[str, dict[str, float]]: ...
    # {"2019-10-06": {"0.05": 142.1, "0.50": 187.4, ...}, ...}

def lead_time_demand(series_id: str, lead_time_days: int) -> dict[str, float]: ...
    # distribution of TOTAL demand over the next `lead_time_days` days
    # {"0.05": 88.0, "0.50": 121.0, "0.95": 168.0}
    # THIS is what the newsvendor consumes.

def model_meta() -> dict: ...
    # {"model_version": ..., "snapshot_id": ..., "generated_at": ..., "stale": false}
```

> `lead_time_demand` is the **only** function Pod C needs to produce an order. Pod B: build it
> first, and stub it on Day 1 returning a scaled daily median, so Pod C is never blocked.

---

## C3 — HTTP API  (Pod C produces, Pod D consumes)

Base path `/api`. FastAPI generates `contracts/openapi.json`; regenerate on every shape change with
`python scripts/dump_openapi.py`.

### Response envelope — on every 200

```json
{
  "data": { "...": "endpoint specific" },
  "meta": {
    "origin": "observed",
    "model_version": "2026-08-27T02:14Z/ens-v3",
    "snapshot_id": "sha256:9f2c1a4b7e03",
    "generated_at": "2026-08-27T02:14:11Z",
    "stale": false,
    "degraded": null,
    "correlation_id": "c-9f2c1a4b"
  }
}
```

`stale: true` means the nightly job failed and yesterday's forecasts are being served — **Pod D must
render an amber staleness badge when this is true.** `degraded` is `null` or a rung name
(`"fallback_model"`, `"cache_down"`, `"covariates_down"`).

### Error envelope — every non-2xx

```json
{ "error": { "code": "SERIES_NOT_FOUND", "message": "human readable", "correlation_id": "c-9f2c" } }
```

Codes: `SERIES_NOT_FOUND` `HORIZON_TOO_LONG` `INVALID_PARAMS` `NO_FORECAST_YET` `UPSTREAM_DEGRADED`.

### Endpoint list

| # | Method | Path | Purpose | Priority |
|---|---|---|---|---|
| 1 | GET | `/api/health` | liveness + degradation rung | P0 |
| 2 | GET | `/api/series` | catalogue: id, name, class, stats | P0 |
| 3 | GET | `/api/history` | actuals for a chart | P0 |
| 4 | GET | `/api/forecast` | calibrated quantiles | P0 |
| 5 | POST | `/api/recommend` | order quantity + cost curve | P0 |
| 6 | GET | `/api/risk` | ranked exception list | P1 |
| 7 | GET | `/api/explain` | attribution + calibration curve | P1 |
| 8 | GET | `/api/metrics` | benchmarks + runtime | P1 |
| 9 | GET/PUT | `/api/settings` | lane-2 parameters | P1 |
| 10 | POST | `/api/replay/start`, `/tick`, `/stop` | replay mode | P2 |
| 11 | POST | `/api/simulate` | what-if | P3 — below the cut line |
| 12 | POST | `/api/assistant` | prose over computed results | P3 — below the cut line |

**P0 answers from fixtures by the end of Day 0 and from real data by the end of Day 2.**

---

### 2 · `GET /api/series`

```json
{"data":{"series":[
  {"series_id":"N02BE","name":"Anilides (paracetamol)","short_name":"Paracetamol",
   "demand_class":"smooth","adi":1.01,"cv2":0.21,"daily_mean":29.92,"zero_day_pct":1.2,
   "peak_month":"January","unit":"units"}
]}}
```

`demand_class` is one of `smooth`, `intermittent`, `erratic`, `lumpy` — it drives a chip in the UI.

### 3 · `GET /api/history?series_id=N02BE&grain=week&from=2019-01-01&to=2019-10-08`

```json
{"data":{"series_id":"N02BE","grain":"week","points":[
  {"ds":"2019-09-30","y":183.4,"is_closed":false,"is_outlier":false,"completeness":1.0}
]}}
```

`completeness < 1.0` → Pod D renders that bar **hatched and labelled "partial"**. Never hide it —
the truncated final bucket being visible is one of the design claims.

### 4 · `GET /api/forecast?series_id=N02BE&grain=week&horizon=8`

```json
{"data":{
  "series_id":"N02BE","grain":"week","cutoff":"2019-09-29","horizon":8,
  "calibrated":true,"max_horizon":75,
  "points":[
    {"ds":"2019-10-06","h":1,
     "q":{"0.05":142.1,"0.10":151.0,"0.25":168.2,"0.50":187.4,
          "0.75":209.9,"0.90":231.4,"0.95":249.8}}
  ],
  "history":[{"ds":"2019-09-22","y":181.0},{"ds":"2019-09-29","y":176.0}],
  "members":[{"model":"Prophet","p50":[189.1,191.0]},
             {"model":"SeasonalNaive","p50":[180.0,178.0]}]
}}
```

- `history` is the trailing 52 periods, included so the fan chart needs one request, not two.
- `members` is optional and may be `[]` until Day 3 — it powers the per-model overlay on screen 2.
- `horizon > max_horizon` returns `422 HORIZON_TOO_LONG`, where `max_horizon = len(series) // 4`.

### 5 · `POST /api/recommend`

Request:

```json
{"series_id":"N02BE","service_level":0.95,"lead_time_days":4,"stock_on_hand":40,
 "pack_size":10,"unit_cost":12.5,"unit_margin":4.0,"holding_cost_rate":0.22,
 "review_period_days":7,"expiry_risk_rate":0.015}
```

`service_level` is optional. If omitted, the server computes `q* = Cu/(Cu+Co)` from the costs and
returns it. If supplied it **overrides** `q*` — that is the slider.

Response:

```json
{"data":{
 "series_id":"N02BE","status":"order_now",
 "q_star":0.75,"service_level_used":0.95,
 "lead_time_demand":{"0.05":88.0,"0.50":121.0,"0.95":168.0},
 "target_level":168.0,"stock_on_hand":40.0,
 "order_units":128.0,"order_packs":13,"order_quantity":130,
 "reorder_point":152.0,"days_of_cover":1.3,"projected_stockout_date":"2019-10-03",
 "p_stockout":0.05,
 "expected_cost":{"at_order":1240.5,"minus_one_pack":1291.0,"plus_one_pack":1265.2},
 "cost_curve":[
   {"service_level":0.50,"order_quantity":90,"expected_cost":1502.0,"p_stockout":0.50},
   {"service_level":0.95,"order_quantity":130,"expected_cost":1240.5,"p_stockout":0.05}],
 "inputs_used":[
   {"name":"forecast distribution","value":"21 calibrated quantiles","lane":"observed"},
   {"name":"lead time","value":"4 days","lane":"user_setting"},
   {"name":"stock on hand","value":"40 units","lane":"user_setting"}]
}}
```

- `cost_curve` is **precomputed for 19 service levels from 0.05 to 0.99** and returned in one
  response. That is what makes the slider move at 60 fps with zero network calls.
  **Pod D: do not call the API on slider drag — interpolate this array.**
- `status` is one of `ok`, `watch`, `order_now`, `overstocked`.
- `inputs_used[].lane` drives the provenance badge shown next to each input.

### 6 · `GET /api/risk?limit=20`

```json
{"data":{"total_exposure":18400.0,"currency":"INR","items":[
  {"series_id":"N02BE","type":"stockout","severity":"high","probability":0.62,
   "exposure":9800.0,
   "headline":"Paracetamol runs out Thursday, delivery lands Friday",
   "detail":"Cover 1.3 days against a 4-day lead time.",
   "recommended_action":"order_now","recommended_quantity":130}
]}}
```

`type` is one of `stockout`, `overstock`, `expiry`, `anomaly`. **Sorted by `exposure` descending,
not by probability** — that ordering is a stated design claim, so keep it.

### 7 · `GET /api/explain?series_id=R06&grain=month&horizon=1`

```json
{"data":{
 "series_id":"R06","headline":"R06 is up 41 units next month",
 "total_change_units":41.0,"baseline_units":58.0,
 "components":[
   {"name":"seasonality","units":28.0,"detail":"May pollen season, 1.73x annual mean"},
   {"name":"trend","units":9.0,"detail":"underlying level"},
   {"name":"holiday","units":4.0,"detail":"calendar effects"}],
 "decomposition":{"ds":["2019-05-01"],"trend":[60.1],"yearly":[28.0],"holidays":[4.0]},
 "shap_top":[{"feature":"lag_52","contribution":12.4}],
 "calibration":{
   "before":[{"nominal":0.50,"achieved":0.44},{"nominal":0.80,"achieved":0.75},
             {"nominal":0.95,"achieved":0.88}],
   "after":[{"nominal":0.50,"achieved":0.51},{"nominal":0.80,"achieved":0.79},
            {"nominal":0.95,"achieved":0.94}],
   "n_points":256}
}}
```

`components[].units` must sum to `total_change_units` within ±0.5. A test asserts it, because an
explanation that does not add up to the number it explains is worse than no explanation.

### 8 · `GET /api/metrics`

Returns `artifacts/benchmarks.json` (see C4) merged with live runtime numbers:

```json
{"data":{
  "benchmarks":{"...": "the C4 object, verbatim"},
  "runtime":{"p50_ms":41,"p95_ms":180,"cache_hit_rate":0.82,"rss_mb":312,
             "cost_per_1k_forecasts_inr":0.7,"uptime_s":8100,"ladder_rung":1}}}
```

### 9 · `GET / PUT /api/settings`

```json
{"data":{"lead_time_days":4,"holding_cost_rate":0.22,"expiry_risk_rate":0.015,
 "review_period_days":7,"currency":"INR","service_level_default":0.95,
 "per_series":{"N02BE":{"pack_size":10,"unit_cost":12.5,"unit_margin":4.0,
                        "stock_on_hand":40}}}}
```

All of it is lane `user_setting`. **It never reaches the trainer.** Stored in SQLite at
`data/warehouse/ops.db`.

### 10 · `POST /api/replay/start` · `/tick` · `/stop`

```json
// start request
{"from":"2019-01-01","to":"2019-03-31","speed_days_per_sec":1}

// tick response
{"data":{"current_date":"2019-01-14","day_index":13,
  "positions":[{"series_id":"N02BE","stock_on_hand":22.0,"days_of_cover":0.8,
                "status":"order_now"}],
  "events":[{"type":"alert","series_id":"N02BE","message":"Stockout risk 71%"}]}}
```

---

## C4 — `benchmarks.json`  (Pod B produces, Pods C and D consume)

Written **only** by `scripts/day1_benchmark.py`. **Never hand-edited.** That sentence is said out
loud during the demo, so it has to be true.

```json
{
 "generated_at":"2026-08-27T02:14:11Z",
 "snapshot_id":"sha256:9f2c1a4b7e03",
 "protocol":{"grain":"week","horizon":8,"folds":4,"metric":"MASE",
             "cv":"rolling-origin","seed":42,"n_series":8},
 "leaderboard":[
   {"model":"Naive","mase":1.330},
   {"model":"SeasonalNaive","mase":1.118,"is_benchmark":true},
   {"model":"AutoARIMA","mase":1.039},
   {"model":"MSTL","mase":1.011},
   {"model":"LightGBM","mase":0.973},
   {"model":"Prophet","mase":0.950},
   {"model":"Ensemble(median-5)","mase":0.906,"is_shipped":true},
   {"model":"Oracle","mase":0.883,"is_bound":true}],
 "per_series":[
   {"series_id":"M01AE","seasonal_naive":1.015,"ensemble":1.061,
    "best_model":"SeasonalNaive","ensemble_wins":false}],
 "ablations":{
   "selection_vs_combination":{"selection":1.091,"combination":0.906,"oracle":0.883},
   "direct_monthly_vs_aggregated":{"direct":0.912,"summed_from_weekly":0.954}},
 "calibration":{"nominal":0.80,"achieved_before":0.750,"achieved_after":0.79,
                "n_points":256},
 "runtime":{"portfolio_fit_seconds":25.0,"series_model_folds":288,"cpu":"1 core"}
}
```

**Pod D reads only this file's shape, never the values.** Every number on the Ops Console and the
leaderboard comes from here. `is_benchmark`, `is_shipped`, `is_bound` and `ensemble_wins: false`
exist so the UI can render the losses in a different colour — **showing where the system loses is a
scoring point, not a bug.**

> The example values above are copied from `docs/PHARMAPULSE_ARCHITECTURE.md`. They are **not yet
> reproduced in this repository.** Pod B's first job on Day 1 is to regenerate them. Until
> `make benchmark` has run and written this file for real, treat every number in it as a placeholder
> and do not put it on a slide.

---

## C5 — Fixtures  (Pod A on Day 0, then Pod C)

`contracts/fixtures/` holds one JSON file per P0/P1 endpoint, in the exact envelope above.

- **Pod D builds every screen against these first**, via `VITE_USE_FIXTURES=1`. The frontend must
  render a complete app on Day 1 with the API not yet existing.
- **Pod C's contract test** (`tests/contract/test_matches_fixtures.py`) asserts the live API returns
  the same **keys and types** as the fixture. If Pod C changes a shape, that test goes red before
  Pod D's build does.
- When real data lands, `make fixtures` regenerates them from the live store. Shapes never change,
  only values.

---

## Rules that keep 8 people from colliding

1. **You edit only the paths your pod owns.** Need a change elsewhere? Ping the owner. Do not
   "just fix it" in someone else's folder — that is how a 4-day sprint dies at merge time.
2. **Branch `pod-a/short-name`. PR under ~400 lines. One approval. CI green to merge.**
   `main` is always deployable.
3. **Nothing is "done" until it is merged and visible in the deployed app.** Local-only work does
   not count at the evening demo.
4. **Never commit into `docs/`.** Those two files are the submitted design documents; the lead owns
   them.
5. **Never touch the 2019 holdout** (`ds >= 2019-07-01`) for anything except the single final
   evaluation on Day 4.

## Change log

| When | Contract | Change | Approved by |
|---|---|---|---|
| Day 0 | — | Initial freeze | lead |
