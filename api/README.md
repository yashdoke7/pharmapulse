# `api/` — Service Layer

**Owner:** Pod C2
**Full brief:** `team/03_POD_C_DECISION_API.md`
**Contract produced:** C3 (`CONTRACTS.md` + `contracts/openapi.json`)

---

## Target

> Expose the system over HTTP, quickly and safely, behind a contract that **cannot drift** from the
> implementation — because a frontend is being built against it in parallel by two other people.

**No model is fitted or evaluated during a request.** Batch pays O(n) once a night so every request
is O(1). That is why the response is fast, why two users see the same number on the same day, and
why the service-level slider is possible at all.

## Inputs

| Input | From |
|---|---|
| `core.forecast_store.read_quantiles()`, `lead_time_demand()`, `model_meta()` | Pod B |
| `decision.newsvendor.recommend_order()`, `ledger`, `risk` | Pod C1 |
| `artifacts/benchmarks.json` | Pod B |
| `data/warehouse/ops.db` — settings, ledger, orders, audit | Pod C1 |
| `contracts/fixtures/*.json` — while `PHARMAPULSE_FIXTURES=1` | Pod A / C2 |

## Outputs

`http://<host>/api/*` — 12 endpoints, priority-ordered in `CONTRACTS.md` C3, plus a regenerated
`contracts/openapi.json` that Pod D turns into TypeScript types.

## Files

| File | Responsibility |
|---|---|
| `main.py` | app, CORS, the envelope middleware, correlation ids |
| `deps.py` | settings loader, fixture switch, cache, `meta` builder |
| `schemas.py` | Pydantic v2 models — **the single source of both validation and the OpenAPI doc** |
| `routers/forecast.py` `recommend.py` `risk.py` `explain.py` `metrics.py` `settings.py` `replay.py` `health.py` | one router per concern |

## The envelope — on every 200, built once in a dependency

```json
{"data": {}, "meta": {"origin","model_version","snapshot_id","generated_at",
                      "stale","degraded","correlation_id"}}
```

`stale: true` → Pod D renders an amber badge. `degraded` names the rung of the degradation ladder.
Together these cost about ten lines and they are the most convincing thing in the Q&A: *the worst
outcome of a bad night is forecasts that are one day old and visibly labelled as such, never fresh
forecasts that are wrong.*

## Rules

1. **Fixtures first.** Day 1, every P0 endpoint returns its fixture file verbatim. Swap to real reads
   one endpoint at a time. **Keep `PHARMAPULSE_FIXTURES=1` working all week** — it is the stage
   fallback if the model layer dies.
2. **Cache key includes `model_version`**, so a deploy self-invalidates with no manual flush step
   that somebody could forget.
3. **In-process LRU only.** No Redis. See `team/05` section 3.
4. **`horizon > len(series)//4` → `422 HORIZON_TOO_LONG`.** Otherwise a slider dragged to 104 weeks
   on 302 weeks of history returns confident-looking nonsense.
5. **Pydantic on every body, parameterised queries only, CSV export cells starting `= + - @` are
   quote-prefixed** so an order export cannot run a macro.
6. **A shape change is its own PR**: `CONTRACTS.md` edit + change-log line + regenerated fixture,
   announced before merge.

## Deliberately not built

OIDC auth · Postgres row-level security · multi-tenancy · rate limiting · OpenTelemetry. All real
engineering, all zero demo surface in four days. The lines to say instead are in `team/05` section 10.

## Run it

```bash
make api                                  # uvicorn on :8000
python scripts/dump_openapi.py            # regenerate contracts/openapi.json
pytest tests/contract -v
```

## Definition of done

- [ ] All P0 endpoints answer from real data; P1 from real data or a labelled fixture
- [ ] `tests/contract/test_matches_fixtures.py` green — live responses match fixture keys and types
- [ ] p95 under 250 ms on the deployed URL for a cached `/forecast`
- [ ] `contracts/openapi.json` committed and current
- [ ] `PHARMAPULSE_FIXTURES=1` still brings up a fully working app, and it has been rehearsed
