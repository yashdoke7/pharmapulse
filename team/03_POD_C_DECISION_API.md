# POD C — Decision Engine & API

> Paste `team/00_PROJECT_BRIEF.md` first, then this file. Then read `CONTRACTS.md` sections C2, C3, C5.

**Two people. C1 and C2.**

| | Owns files | One-line job |
|---|---|---|
| **C1** | `decision/newsvendor.py` `ledger.py` `risk.py` `recommend.py` | The arithmetic that turns a distribution into a purchase order — pure functions, no I/O |
| **C2** | `api/main.py` `api/routers/*` `api/schemas.py` `api/deps.py` `scripts/dump_openapi.py` `scripts/make_fixtures.py` | Twelve endpoints, one envelope, a contract the frontend can generate types from |

**Your mission:** *convert a demand distribution plus this pharmacy's own costs into an integer order
quantity with the cost of being wrong attached — and serve it in under 250 ms.*

**You own:** `decision/` `api/` `scripts/dump_openapi.py` `scripts/make_fixtures.py`
`tests/unit/test_newsvendor*.py` `tests/contract/`
**You never edit:** `pipelines/` `core/` `web/` `docs/`

---

## Day plan

| Day | C1 | C2 | Evening gate |
|---|---|---|---|
| **1** | `newsvendor.py` complete + property tests. **Zero dependencies on Pod B** — take quantiles as an argument. | FastAPI skeleton; all P0 endpoints **serving `contracts/fixtures/*.json` verbatim**; `openapi.json` generated | Pod D is fetching from a real HTTP server by lunchtime |
| **2** | `ledger.py` (SQLite), `recommend.py` wiring Pod B's `lead_time_demand()`, the full cost curve | `/forecast` `/history` `/series` `/recommend` on real data; in-process LRU cache | **The vertical slice: real series → real model → real API → real chart on the deployed URL.** *The most important gate of the week.* |
| **3** | `risk.py` ranked by exposure; recommendation builder | `/risk` `/explain` `/metrics` `/settings`; replay endpoints; contract tests green | Three differentiators live in the deployed app |
| **4** | freeze; support the demo | freeze; warm-up; verify every endpoint from the public URL | — |

---

## 1 · `decision/newsvendor.py` (C1) — **build this first, it needs nobody**

A pure function. No I/O, no database, no imports from `core/`. Unit-tested against closed-form
cases and property-tested with `hypothesis`. **This is the file a judge is most likely to ask to
see, because it is where the claim lives.**

```python
@dataclass(frozen=True)
class OrderParams:
    lead_time_days: int
    stock_on_hand: float
    pack_size: int
    unit_cost: float
    unit_margin: float          # Cu - the gross margin lost on a missed sale
    holding_cost_rate: float    # annual, e.g. 0.22
    expiry_risk_rate: float     # fraction written off, e.g. 0.015
    review_period_days: int = 7
    service_level: float | None = None   # None -> compute q* from costs

def critical_fractile(cu: float, co: float) -> float:
    return cu / (cu + co)

def recommend_order(lead_time_demand: dict[str, float],
                    params: OrderParams) -> OrderResult:
    ...
```

The arithmetic, exactly:

```
Cu     = unit_margin
Co     = unit_cost * holding_cost_rate * (lead_time_days / 365) + unit_cost * expiry_risk_rate
q*     = Cu / (Cu + Co)
level  = params.service_level if given else q*
target = quantile(lead_time_demand, level)          # interpolate between stored quantiles
units  = max(0, target - stock_on_hand)
packs  = ceil_or_floor_to_pack(units)               # direction chosen by the cost ratio
order  = packs * pack_size
```

**Three properties that matter, and each is a sentence in the demo:**

1. **It is closed form.** No optimisation solver runs during a request. That is why the response is
   fast and why the service-level slider can update live as it moves.
2. **Rounding is asymmetric.** Rounding to the nearest pack is wrong — the two rounding errors cost
   different amounts. With `Cu > Co` round **up**. Do not use `round()`.
3. **Every input is labelled by lane.** `inputs_used[]` in the response carries `observed` for the
   forecast and `user_setting` for everything the pharmacy typed. The UI renders a badge from it.

**Also return the whole cost curve.** `build_cost_curve()` evaluates the order quantity, expected
cost and `p_stockout` at **19 service levels from 0.05 to 0.99** and ships them in the same
response. The frontend interpolates that array on drag — **zero network calls while the slider
moves.** This one decision is what makes the demo feel like a product.

```
expected_cost(order) = E[holding on leftover] + E[margin lost on shortfall]
                     = Co * E[(S+order - D)+]  +  Cu * E[(D - S-order)+]
```
Compute both expectations by summing over the stored quantile grid — it is a discrete distribution,
so this is a loop over 21 values, not an integral.

**Property tests (`hypothesis`) — these are cheap and they are exactly what gets probed:**
- order quantity is monotone non-decreasing in `service_level`
- order quantity is monotone non-increasing in `stock_on_hand`
- order quantity is always a non-negative multiple of `pack_size`
- `Cu → 0` gives `q* → 0` gives order 0
- expected cost at the computed optimum is ≤ expected cost at ±1 pack

---

## 2 · `decision/ledger.py` (C1)

SQLite at `data/warehouse/ops.db`. An event table plus a current-balance view. This is a
transactional workload — a running balance under concurrent writes — not an analytical one, so it
does **not** go in Parquet.

```
opening stock + goods received − sales − wastage ± stock-take adjustment = stock_on_hand
```

Four derived indicators, and they are the whole product surface:

| Indicator | Definition |
|---|---|
| **Days of cover** | `stock_on_hand / forecast mean daily demand` → *"you have 3.2 days left"* |
| **Reorder point** | quantile of demand over the lead time at service level `q*` |
| **Status** | `ok` · `watch` · `order_now` · `overstocked`, from position vs reorder point and max |
| **Projected stockout date** | first date cumulative forecast demand exceeds `stock_on_hand` |

> **The status chip is the whole product in one glyph.** The home screen is the list of products that
> are not `ok`, sorted by money.

**Where the numbers come from — say this plainly, it is a credibility feature not a weakness:**

| Field | In production | In our build |
|---|---|---|
| Sales | live POS feed | the real daily CSV, replayed |
| Goods received | supplier delivery note | a receipts screen, plus simulated deliveries during replay |
| Opening stock | stock take | seeded, editable in settings |
| Wastage, expiry batches | ERP batch records | **not modelled — named as requiring real data** |

**Do not build an expiry-batch feature.** Claiming batch-level expiry on a dataset with no batches is
exactly what the provenance rule exists to prevent. Describe it as the next integration.

---

## 3 · `decision/risk.py` (C1)

Four rules, each attaching a probability **and a monetary exposure**:

| Risk | Rule |
|---|---|
| **stockout** | `P(lead-time demand > stock_on_hand)` exceeds a threshold |
| **overstock** | days of cover exceeds a configured maximum |
| **expiry** | projected sell-through is later than the nearest batch expiry — *stub only, we have no batches* |
| **anomaly** | the most recent observation falls outside the forecast's own interval |

**Rank by monetary exposure, not by probability.** A 30% chance of running out of the highest-volume
product matters more to a buyer than a 90% chance on something that sells twice a month. Thresholds
live in config, not in code.

`recommend.py` turns risks into actions: `order_now` · `order_early` (a known seasonal build-up
begins inside the lead time — pollen and flu are both known months ahead) · `do_not_order` ·
`slow_mover`. Each carries the inputs that produced it so the UI can show its basis rather than
presenting an unexplained instruction.

---

## 4 · `api/` (C2) — **CONTRACT C3**

FastAPI + Pydantic v2 + Uvicorn. The OpenAPI document is generated from the same type annotations
that validate requests at runtime, so the contract **cannot** drift from the implementation — which
is the entire reason this stack was chosen while a frontend is built in parallel.

**Day 1, before lunch: every P0 endpoint returns the matching fixture file, unmodified.**

```python
# api/deps.py
USE_FIXTURES = os.getenv("PHARMAPULSE_FIXTURES", "1") == "1"

def fixture(name: str) -> dict:
    return json.loads(Path(f"contracts/fixtures/{name}.json").read_text())
```

Then replace one endpoint at a time with a real read. `PHARMAPULSE_FIXTURES=1` stays available all
week as the demo fallback — **if the model layer dies on stage, flip that env var and the app still
runs.** That is rung 6 of the degradation ladder and it costs you nothing to keep.

**Every 200 response carries the envelope in C3**: `origin`, `model_version`, `snapshot_id`,
`generated_at`, `stale`, `degraded`, `correlation_id`. Build it once in a dependency, not per route.

**Caching:** key `fc:{series}:{grain}:{cutoff}:{model_version}:{horizon}`, TTL to the next scheduled
run. Use an **in-process LRU** (`functools.lru_cache` or `cachetools`). **Do not add Redis** — it is
below the cut line and adds a service to operate for no scoring points at this scale.

**Guards worth the ten minutes each:**
- `horizon > len(series)//4` → `422 HORIZON_TOO_LONG`. Dragging a slider to 104 weeks on 302 weeks
  of history produces confident-looking nonsense otherwise.
- Pydantic models on every request body. Parameterised queries only.
- CSV export cells beginning `= + - @` are quote-prefixed, so an order export cannot run a macro.
- An append-only order/override log with a SHA-256 chain column — cheap, and it demos well as
  *"who approved that order"*.

**Cut from the design docs, deliberately:** OIDC/Auth.js, PostgreSQL row-level security,
multi-tenancy, `slowapi` rate limiting, OpenTelemetry. All of it is real engineering with zero demo
surface in four days. Say in the deck that tenancy is designed and not built, rather than half-building
it.

---

## 5 · Replay mode (C2, Day 3, P2) — the demo winner

```
POST /api/replay/start {"from":"2019-01-01","to":"2019-03-31","speed_days_per_sec":1}
POST /api/replay/tick   -> next day's positions and events
POST /api/replay/stop
```

Replay a chosen 90-day window of the **actual** history at one day per second. Sales post to the
ledger, stock depletes, days-of-cover counts down, status chips flip `ok → watch → order_now`,
alerts fire, suggested orders appear.

**It is honest** — nothing is invented, it is the real 2019 data arriving in its original order, and
the screen is watermarked `REPLAY · Jan–Mar 2019`. **It proves the system is live, not static.** It
makes the January 2019 flu wave visible in ninety seconds. And it exercises the same code path a
real POS feed would drive, so **it doubles as the integration test.**

Keep the state server-side in memory, keyed by a session id. Do not build websockets — polling
`/tick` on a timer is fine and cannot break on stage.

---

## Tests you own

| File | Asserts |
|---|---|
| `tests/unit/test_newsvendor_closed_form.py` | known `Cu/Co` pairs give the textbook `q*` and quantity |
| `tests/property/test_newsvendor_monotonic.py` | the five monotonicity properties above |
| `tests/unit/test_pack_rounding.py` | rounds up when `Cu > Co`, never uses `round()` |
| `tests/unit/test_ledger_balance.py` | receipts − sales − wastage ± adjustment reconciles |
| `tests/contract/test_matches_fixtures.py` | **every live endpoint returns the same keys and types as its fixture** |
| `tests/contract/test_envelope.py` | every 200 carries the full `meta` block |

`test_matches_fixtures.py` is the one that protects Pod D. If you change a shape, it goes red before
their build does.

## Definition of done

- [ ] All P0 endpoints answer from real data; P1 answer from real data or a labelled fixture
- [ ] `contracts/openapi.json` regenerated and committed after every shape change
- [ ] `/recommend` returns a 16-point cost curve and the slider never hits the network
- [ ] p95 under 250 ms on the deployed URL for a cached `/forecast`
- [ ] `PHARMAPULSE_FIXTURES=1` still brings up a fully working app — rehearse this fallback
- [ ] Contract tests green in CI

## Your handoffs

| To | What | When |
|---|---|---|
| **Pod D** | a running API serving fixtures at a stable base URL | **Day 1 by 13:00** |
| **Pod D** | `contracts/openapi.json` for type generation | Day 1, then after every change |
| **Pod D** | real `/forecast` `/recommend` `/risk` | end of Day 2 |
| **Lead** | the order/override audit log for the governance slide | Day 3 |

## Traps

1. **Waiting for Pod B.** You do not need them. `newsvendor.py` takes a quantile dict as an
   argument; their stub lands at noon on Day 1.
2. **Calling the API on slider drag.** Ship the cost curve once, interpolate on the client. Ask Pod
   D to confirm they are doing this.
3. **`round()` on pack quantity.** The two rounding errors are not equally expensive.
4. **Changing a JSON key without telling Pod D.** Change `CONTRACTS.md`, add a change-log line,
   regenerate the fixture, then change the code. In that order.
5. **Adding Redis/Postgres/auth because the design doc mentions them.** The design doc describes a
   production system. You are building four days of it. Cut them and say so.
6. **Letting lane-2 settings reach anything that fits a model.** They enter at the decision engine
   and nowhere else. That is enforced by the shape of the pipeline; keep it that way.
