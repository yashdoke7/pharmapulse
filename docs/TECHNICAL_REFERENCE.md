# PharmaPulse — Technical Reference

Assumes you already know the architecture and the concepts. This is the
**what's-used / how-it's-wired** document: stack versions, module dependency
graph, storage schemas, the full API surface, every config knob, and one
request traced end to end through the actual function calls.

For *why* each choice was made over the alternative, see
[PHARMAPULSE_SYSTEM.md §11](PHARMAPULSE_SYSTEM.md). For term definitions, see
[GLOSSARY.md](GLOSSARY.md). This file has neither — just the machinery.

---

## 1. Stack

| Layer | Tech | Version | Role |
|---|---|---|---|
| Array/table | numpy, pandas | 1.26.4, 2.2.3 | interchange format across every layer |
| Columnar storage | pyarrow → Parquet | 17.0.0 | gold, features, forecast store on disk |
| Analytical SQL | duckdb | 1.1.3 | documented ad-hoc query interface to Parquet; **not** the runtime read path (that's `pandas.read_parquet`) |
| Operational storage | sqlite3 (stdlib) | — | stock ledger, hash-chained order log, settings |
| Statistical models | statsforecast | 1.7.8 | AutoARIMA, MSTL, SeasonalNaive, AutoETS, Theta, Croston, Naive, WindowAverage — Numba-JIT |
| ML model | lightgbm | 4.5.0 | global quantile regressor |
| ML feature glue | mlforecast | 0.13.5 | pinned, not on the hot path |
| Decomposition model | prophet + cmdstanpy | 1.1.6 / 1.3.0 | trend/season/holiday, import-guarded |
| Calendar data | holidays | 0.60 | Indian holiday calendar generation |
| Numerics | scipy | 1.14.1 | `norm.ppf`/`norm.cdf` in calibration and combination |
| Validation/coercion | pandera (unused), scikit-learn | 0.20.4, 1.5.2 | pandera pinned but not imported; sklearn transitive |
| Service | fastapi, pydantic, uvicorn | 0.115.5, 2.9.2, 0.32.1 | HTTP layer, schema = validation = OpenAPI |
| Test | pytest, hypothesis, httpx | 8.3.3, 6.115.5, 0.27.2 | unit + property + API contract tests |
| Frontend framework | react, react-dom, react-router-dom | 18.3.1, 18.3.1, 6.27.0 | SPA, client-side routing |
| Frontend data | @tanstack/react-query | 5.59.0 | server-state cache, polling, dedup |
| Frontend build | vite, typescript | 5.4.10, 5.6.3 | dev server + Rollup production build |
| Frontend style | tailwindcss | 3.4.14 | utility CSS |
| Charts | none (hand-rolled SVG) | — | `recharts` is in `package.json`, **unused** |
| Container | Docker, multi-stage | — | Node build stage → Python runtime stage |

---

## 2. Repository map

```
pipelines/     data foundation — CSV in, gold Parquet out. No modelling imports.
core/          forecast engine — reads gold, writes the forecast store. No API imports.
decision/      decision engine — reads the forecast store, produces orders/risk/replay. No API imports.
api/           HTTP layer — imports core + decision + pipelines, never the reverse.
web/           React SPA — talks to api/ over HTTP only, via web/src/api/client.ts.
contracts/     OpenAPI dump + fixture JSON, generated FROM the running app, not hand-written.
artifacts/     benchmarks.json — the only source of any accuracy number shown anywhere.
scripts/       CLI entry points (benchmark, fixtures, reset, extension generator).
tests/         unit / contract / property, mirrors the four packages above.
```

**Dependency direction is strictly one-way:** `pipelines → core → decision → api → web`. Nothing downstream is imported by anything upstream. This is what makes the layered testing possible — each package's tests run without importing FastAPI or React.

### `pipelines/` (data foundation)

| File | Public functions | Reads | Writes |
|---|---|---|---|
| `ingest.py` | `ingest()`, `read_bronze()`, `snapshot_id()` | raw CSV | `bronze/bronze.parquet` |
| `validate.py` | `validate()`, `assert_reconciles()` | bronze frame | quarantine frame (in memory) |
| `clean.py` | `clean()`, `summarise()` | bronze frame | cleaned frame (in memory) |
| `gold.py` | `build_gold()`, `read_gold()`, `fitting_frame()` | cleaned frame | `gold/grain=*/year=*/part.parquet` |
| `features.py` | `build_features()`, `feature_columns()`, `write_features()` | gold frame | `features/grain=*/part.parquet` |
| `holidays.py` | `load_calendar()`, `write_calendar()`, `holiday_flags()` | — | `data/observed/holidays.csv` |
| `run_nightly.py` | `run_gold()`, `run_forecast()`, `main()` (CLI) | orchestrates the above | orchestrates `core.pipeline` |
| `paths.py` | `data_root()`, `bronze_root()`, `gold_root()`, `features_root()`, `forecast_root()`, `resolve()` | `PHARMAPULSE_DATA_ROOT` env | — |

### `core/` (forecast engine)

| File | Public functions | Depends on |
|---|---|---|
| `classify.py` | `classify()`, `classify_one()`, `adi_cv2()`, `eligible_models()` | numpy, pandas only |
| `portfolio/statistical.py` | `fit_predict()`, `empirical_quantiles()` | statsforecast |
| `portfolio/prophet_model.py` | `fit_predict()`, `components_for()`, `PROPHET_AVAILABLE` | prophet, cmdstanpy |
| `portfolio/lgbm_global.py` | `fit_predict()` | lightgbm, `pipelines.features` |
| `combine.py` | `combine_point()`, `combine_quantiles()`, `enforce_monotonic()`, `bounded_weights()` | numpy, pandas |
| `calibrate.py` | `conformal_scale()`, `apply_scale()`, `coverage_curve()`, `calibration_report()` | scipy.stats.norm |
| `backtest.py` | `make_folds()`, `mase_denominator()`, `score_fold()`, `oracle_score()`, `selection_score()` | numpy, pandas |
| `pipeline.py` | `forecast_grain()`, `build_forecast_store()` | classify, portfolio/*, combine, calibrate, `pipelines.gold` |
| `forecast_store.py` | `write_version()`, `read_gold` equivalents, `lead_time_demand()`, `read_quantiles()`, `read_members()`, `model_meta()`, `as_of()`, `current_version()` | pandas, `pipelines.paths` |
| `explain.py` | `attribute()`, `seasonal_profile()` | `portfolio.prophet_model`, `forecast_store` |

### `decision/` (decision engine)

| File | Public functions | Depends on |
|---|---|---|
| `newsvendor.py` | `OrderParams`, `OrderResult`, `recommend_order()`, `critical_fractile()`, `protection_interval_days()`, `quantile_of()`, `round_to_pack()`, `build_cost_curve()` | numpy only — **zero I/O, zero imports from core/api** |
| `risk.py` | `detect()`, `rank()`, `total_exposure()`, `Risk` | `newsvendor` |
| `ledger.py` | `connect()`, `post()`, `balance()`, `log_order()`, `verify_chain()`, `ledger_frame()`, `db_path_default()` | sqlite3 stdlib |
| `replay.py` | `ReplaySession`, `compare_policies()`, `_trailing_dist()`, `_trailing_stats()` | `core.forecast_store`, `newsvendor` |

### `api/` (service)

| File | Role |
|---|---|
| `main.py` | app assembly, CORS, SPA static mount, 500-handler |
| `deps.py` | envelope/meta builder, settings load/save, `series_settings()` merge, `lru_cache` quantile cache |
| `routers/forecasting.py` | `/series`, `/history`, `/forecast`, `/explain` |
| `routers/decisions.py` | `/recommend`, `/risk`, `/positions`, `/settings`, `/orders`, `/ledger` |
| `routers/replay.py` | `/replay/start`, `/replay/tick`, `/replay/stop`, `/replay/business-case` |
| `routers/datasets.py` | `/datasets`, `/datasets/rebuild`, `/datasets/upload`, `/datasets/jobs/*`, `/datasets/activate`, `/datasets/versions/{slug}` |
| `routers/ops.py` | `/health`, `/metrics` |

---

## 3. Data flow — the batch (offline, ~1 min)

```
CSV file (data/observed/salesdaily.csv or an upload)
   │  pipelines.ingest.ingest(raw_path, origin)
   │    - pd.read_csv, melt wide→long, hash file → snapshot_id
   │    - upsert into bronze on natural key (series_id, ds)
   ▼
bronze/bronze.parquet                                    (long form, all history, append-only)
   │  pipelines.validate.validate(strict=True)
   │    - 7 gates; raises ValueError on failure, batch quarantined
   ▼
   │  pipelines.clean.clean()
   │    - masks closures, flags outliers — never mutates y
   ▼
   │  pipelines.gold.build_gold()  → aggregate() per grain
   ▼
gold/grain={day,week,month}/year=*/part.parquet           (GOLD_COLUMNS, contract C1)
   │  pipelines.features.build_features(cutoff=gold.ds.max())
   ▼
features/grain=*/part.parquet                              (not read by the API; batch-internal)
   │  core.pipeline.forecast_grain(grain, scale, as_of=None)
   │    1. gold = fitting_frame(grain); truncate to as_of if given
   │    2. classes = classify(gold)                         → routes per series
   │    3. per class: statistical.fit_predict / prophet_model.fit_predict /
   │       lgbm_global.fit_predict, on the eligible model list
   │    4. combine.combine_quantiles(members)                → median + sort
   │    5. calibrate.apply_scale(quantiles, conformal_scale)  → widen/shrink
   ▼
   │  core.forecast_store.write_version(quantiles, model_version, snapshot_id, meta)
   │    - writes version=<slug>/ in full, THEN rewrites CURRENT (atomic)
   ▼
forecast/version=<slug>/{quantiles,members,demand_classes,meta}.parquet|json
forecast/CURRENT   (plain text file holding the live slug)
```

`run_nightly.py --stage all` runs ingest → gold → forecast in one process. `--stage gold` / `--stage forecast` run one half; `datasets.py::_run_build` calls the same two functions from a background thread.

## 4. Data flow — the request (online, O(1))

```
browser → web/src/api/client.ts → fetch(`${VITE_API_BASE}/api/...`)
   ▼
api/main.py routes to the matching router
   ▼
api/deps.py::envelope(data, origin) wraps every response:
   { "data": {...}, "meta": { origin, as_of, model_version, snapshot_id,
                               generated_at, stale, degraded, correlation_id } }
   ▼
router calls into core.forecast_store (READ ONLY — no model ever fits here)
   or decision.newsvendor / decision.risk / decision.replay
   ▼
JSON back to the browser
```

**No request ever imports `core.portfolio.*`, `core.classify`, or `core.combine`.** Everything a request touches was already computed and written to Parquet by the batch. This is enforced structurally — the API package's routers only import `core.forecast_store` and `core.explain`, never the fitting modules.

---

## 5. Storage schemas

### 5.1 Gold Parquet (contract C1) — `GOLD_COLUMNS`

```
series_id     str      ATC-2 code, one of 8
ds            date     period start (Monday for week, 1st for month)
grain         str      "day" | "week" | "month"
y             float64  units, non-negative
origin        str      "observed" | "user_setting" | "synthetic"
is_closed     bool     masked from training loss, not deleted
is_outlier    bool     flagged, never removed/altered
completeness  float64  fraction of expected sub-periods present, ≤1.0
snapshot_id   str      "sha256:<12 hex>" of the source file
```
Partitioned `grain=<g>/year=<yyyy>/part.parquet`, zstd. Weekly/monthly are **derived** from daily via `aggregate()`, never ingested separately.

### 5.2 Forecast store — `forecast/version=<slug>/`

```
quantiles.parquet   series_id, ds, grain, horizon, quantile ∈ 21 levels, value
members.parquet     series_id, ds, grain, model, value          (per-model, pre-combination)
demand_classes.parquet   series_id, grain, adi, cv2, demand_class, zero_rate
meta.json           { model_version, snapshot_id, origin, as_of, generated_at, n_rows }
```
`CURRENT` at `forecast/` root is a plain-text file holding the live `slug`. Publication = write the version dir in full, then rewrite `CURRENT` — the only mutable pointer in the whole warehouse.

**21 stored quantile levels:** `0.01 0.025 0.05 0.10 0.15 0.20 0.25 0.30 0.35 0.40 0.50 0.60 0.65 0.70 0.75 0.80 0.85 0.90 0.95 0.975 0.99`
**7 UI levels** (`UI_LEVELS`, duplicated in `deps.py`/`forecast_store.py`/frontend): `0.05 0.10 0.25 0.50 0.75 0.90 0.95`

### 5.3 SQLite — `decision/ledger.py::SCHEMA`

```sql
stock_event(id, series_id, ds, kind, quantity, note, created_at)
  -- kind ∈ opening | received | sold | wastage | adjustment; quantity signed
settings(key, value)   -- key='main', value=JSON blob of lane-2 settings
order_log(...)          -- hash-chained: each row stores prev row's hash
```
Path resolved per call via `PHARMAPULSE_DB` env (falls back to `data/warehouse/ops.db`). `ledger.balance(series_id)` sums `stock_event.quantity`; `deps.live_stock()` = settings' `opening_stock` + that sum.

### 5.4 Bronze — `bronze/bronze.parquet`

Long form, append-only, one row per `(series_id, ds)` per ingest, upserted (last write wins) on that natural key. Columns: `ds, series_id, y, origin, snapshot_id, ingest_batch_id`.

---

## 6. The full API surface

Base path `/api`. Every 200 response is `{data, meta}` from `deps.envelope()`. Every error is `{detail: {error: {code, message, correlation_id}}}`.

| Method | Path | Router | Backing call | Notes |
|---|---|---|---|---|
| GET | `/health` | ops | `fs.store_available()`, `fs.as_of()` | degradation `ladder_rung` |
| GET | `/metrics` | ops | `deps.benchmarks()`, `deps.cache_stats()` | reads `artifacts/benchmarks.json` verbatim |
| GET | `/series` | forecasting | `fs.series_catalogue()` | demand class per product, daily grain preferred |
| GET | `/history` | forecasting | `read_gold(grain)` filtered | raw observed points |
| GET | `/forecast` | forecasting | `deps.cached_quantiles()` (LRU) | `horizon` capped at `len(gold)//4` |
| GET | `/explain` | forecasting | `core.explain.attribute()` | + calibration curve from benchmarks |
| POST | `/recommend` | decisions | `_order_for()` → `newsvendor.recommend_order()` | body may override any `OrderParams` field |
| GET | `/risk` | decisions | loops `_order_for()` per series → `risk.detect()`/`rank()` | ranked by monetary exposure |
| GET | `/positions` | decisions | loops `_order_for()` per series | dashboard's opening data |
| GET | `/settings` | decisions | `deps.load_settings()` | lane 2 |
| PUT | `/settings` | decisions | `deps.save_settings(patch)` | merges into SQLite `settings` table |
| POST | `/orders` | decisions | `ledger.log_order()` then `ledger.post()` | hash-chained; also posts a `received` stock event |
| GET | `/ledger` | decisions | `ledger.ledger_frame()` | raw movement trail |
| POST | `/replay/start` | replay | `replay_engine.ReplaySession(...)` | in-memory session, capped at 8 concurrent |
| POST | `/replay/tick` | replay | `session.tick()` × `steps` | client polls this on a timer |
| POST | `/replay/stop` | replay | drop from `_SESSIONS` | |
| GET | `/replay/business-case` | replay | `replay_engine.compare_policies()` | the 4-policy ladder |
| GET | `/datasets` | datasets | `fs.model_meta()` + `_versions()` | what's live + every built version |
| POST | `/datasets/rebuild` | datasets | background thread → `run_gold()` + `run_forecast()` | 409 if a build is already running |
| POST | `/datasets/upload` | datasets | validates shape, saves to `data/uploads/` | does NOT trigger a build itself |
| GET | `/datasets/jobs/{id}` | datasets | `_JOBS[id]` | poll target for rebuild |
| GET | `/datasets/jobs` | datasets | `_JOBS.values()` | |
| POST | `/datasets/activate` | datasets | rewrites `CURRENT`, calls `deps.clear_caches()` | instant — no refit |
| DELETE | `/datasets/versions/{slug}` | datasets | `shutil.rmtree` the version dir | refuses to delete the active one |

**Fixture mode.** Every GET route checks `deps.use_fixtures()` first and, if true, returns `contracts/fixtures/<name>.json` verbatim instead of computing anything. Triggered by `PHARMAPULSE_FIXTURES=1` or automatically when `fs.store_available()` is false.

---

## 7. Config surface — every environment variable

| Variable | Read in | Default | Effect |
|---|---|---|---|
| `PHARMAPULSE_DATA_ROOT` | `pipelines/paths.py::data_root()` | `data/warehouse` | root for bronze/gold/features/forecast — swap to point the whole system at a different warehouse |
| `PHARMAPULSE_DB` | `decision/ledger.py::db_path_default()` | `data/warehouse/ops.db` | SQLite path — test isolation uses this |
| `PHARMAPULSE_FIXTURES` | `api/deps.py::use_fixtures()` | unset (auto) | `"1"` forces fixture mode; `"0"` forces live even if the store looks empty |
| `PHARMAPULSE_FIXTURE_DIR` | `api/deps.py` | `contracts/fixtures` | where fixture JSON is read from |
| `PHARMAPULSE_ALLOWED_ORIGINS` | `api/main.py` | empty | comma-separated extra CORS origins beyond localhost dev ports |
| `PHARMAPULSE_WEB_DIST` | `api/main.py` | `web/dist` | which built frontend to mount |
| `VITE_API_BASE` | `web/src/api/client.ts` | `/api` | frontend's API base path (proxy target in dev) |
| `VITE_PROXY_TARGET` | `vite.config.ts` (dev only) | — | where the Vite dev server proxies `/api` to |

---

## 8. Core algorithm reference — condensed

| Concept | Formula | Location |
|---|---|---|
| ADI | `n_periods / n_nonzero_periods` | `core/classify.py::adi_cv2` |
| CV² | `(std(nonzero) / mean(nonzero))²` | same |
| Routing | ADI/CV² vs `(1.32, 0.49)` → smooth/erratic/intermittent/lumpy | `core/classify.py::ROUTES` |
| MASE | `mean(|err|, test) / mean(|y_t − y_{t−1}|, train)` | `core/backtest.py::score_fold` |
| Combination | `median(members)` per `(series_id, ds[, quantile])`, then `cummax` for monotonicity | `core/combine.py` |
| Conformal scale | `clip(quantile(|resid|/spread, level) / norm.ppf(0.5+level/2), 0.25, 5.0)` | `core/calibrate.py::conformal_scale` |
| Protection interval | `lead_time_days + review_period_days` | `decision/newsvendor.py::protection_interval_days` |
| Underage cost | `Cu = unit_margin` | `OrderParams.underage_cost` |
| Overage cost | `Co = unit_cost·holding_rate·(lead_time/365) + unit_cost·expiry_rate` | `OrderParams.overage_cost` |
| Critical fractile | `q* = Cu / (Cu + Co)` | `critical_fractile` |
| Pack rounding | `ceil(units/pack) if Cu≥Co else floor(...)` | `round_to_pack` |
| LightGBM objective | pinball loss, `L_q = q·(y−ŷ)` if under, `(1−q)·(ŷ−y)` if over | `core/portfolio/lgbm_global.py::LGBM_PARAMS` |
| Trailing distribution (replay) | rolling `horizon`-sum via `np.convolve`, quantiled | `decision/replay.py::_trailing_dist` |
| Safety-stock baseline | `mu·L + z·σ·√L` | `decision/replay.py::_decide` (`POLICY_SAFETY_STOCK`) |
| Normal-approx baseline | `median + z·σ_h`, `σ_h = (p90−p50)/1.2816` | same (`POLICY_NORMAL`) |

---

## 9. One request traced end to end — `POST /api/recommend`

```
web/src/components/ServiceLevelSlider.tsx / Orders.tsx
   → client.ts::request("/recommend", {method:"POST", body: {...}})
      ▼ HTTP
api/routers/decisions.py::recommend(body: RecommendRequest)
   1. deps.require_series(body.series_id)                      — 404 if unknown
   2. deps.use_fixtures() check                                 — short-circuit if degraded
   3. params = _params_for(series_id, body)
        base = deps.series_settings(series_id)                  — merges global + per-series + live ledger balance
        merged = {**base, **body.model_dump(exclude_none=True)} — request overrides win
        → OrderParams(...)
   4. result = _order_for(series_id, params)
        horizon = protection_interval_days(lead_time, review_period)
        dist = fs.lead_time_demand(series_id, horizon)           — READS forecast/CURRENT/quantiles.parquet, no fit
        return recommend_order(dist, params, daily_mean=deps.DAILY_MEAN[sid])
   5. payload = result.as_dict()
   6. payload["projected_stockout_date"] = _projected_stockout(...)   — reads daily forecast, ledger.projected_stockout()
   7. return deps.envelope(payload)
        meta() reads fs.model_meta() for origin/model_version/snapshot_id/as_of
      ▼ HTTP
client.ts returns Envelope<Recommendation>
   → React Query cache → component re-render
```

No file is written, no model is fit, no request touches `core/portfolio/*`. The only I/O is two Parquet reads (`quantiles.parquet`, `meta.json`) and zero-to-one SQLite reads (ledger balance).

---

## 10. Running it

```bash
# environment
pip install -r requirements.txt
cd web && npm install && cd ..

# batch — writes gold + forecast store
python -m pipelines.run_nightly --stage all

# benchmark — writes artifacts/benchmarks.json (the only source of any accuracy figure)
python scripts/day1_benchmark.py

# service
uvicorn api.main:app --reload --port 8000     # http://localhost:8000/docs
cd web && npm run dev                          # http://localhost:5173, proxies /api

# tests
pytest -q                                       # unit + contract + property
pytest -q -k ingest                             # one module

# contract regeneration (frontend types depend on this)
python scripts/dump_openapi.py                  # writes contracts/openapi.json
python scripts/make_fixtures.py                  # writes contracts/fixtures/*.json (degradation rung 5)
```

Docker: `docker-compose up` runs two services (`api` on 8000, `web` on 5173, Vite proxying to `api`). The root `Dockerfile` is a single multi-stage image (Node build → Python runtime, `web/dist` copied in, one process, one port) intended for the hosted deploy — see [DEPLOY.md](DEPLOY.md).
