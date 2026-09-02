# POD C — Decision Engine & API · RESULTS

> What was built, what it measured, what broke, and where the code is.
> Original brief: `../03_POD_C_DECISION_API.md`

**Owns:** `decision/` · `api/` · `scripts/dump_openapi.py` · `scripts/make_fixtures.py`
**Delivers:** contract **C3** (the HTTP API) to Pod D.
**This is where the project's thesis lives: a forecast is not the product, the purchase order is.**

---

## 1. Scorecard

| Deliverable | Status | Evidence |
|---|---|---|
| Newsvendor, pure function | **done** | zero imports from `core/`, `api/`, `pipelines/` |
| 16-point cost curve in one response | **done** | slider makes **zero** fetches on drag |
| Stock ledger, event-sourced | **done, wired** | accepting an order moves the shelf |
| Hash-chained audit log | **done** | tamper detection tested |
| 4 risk rules ranked by rupees | **done** | ₹1,099 across 3 exceptions |
| 16 endpoints | **done** | 33 contract tests |
| Replay simulation | **done** | day-by-day over real history |
| Measured business case | **done** | ~70% lower cost, 3 quarters |
| Auth / multi-tenancy / Redis | **not built** | deliberate, with the line to say |

---

## 2. The core: `decision/newsvendor.py`

**A pure function.** No I/O, no database, no imports from `core/` or `api/`. It takes a quantile
dict and returns an order. That is what let it be built and fully tested before the forecast store
existed.

```
Cu     = unit_margin                                   cost of being one unit SHORT
Co     = unit_cost·holding_rate·(L/365) + unit_cost·expiry_rate    one unit OVER
q*     = Cu / (Cu + Co)                                the critical fractile
level  = service_level if supplied else q*             the slider overrides q*
target = quantile(lead_time_demand, level)
order  = round_to_pack(target − stock_on_hand)         direction from the cost ratio
```

**Worked example, N02BE**, straight from the running API:

```
q*             0.948
target         523 units      (over an 11-day protection interval)
stock on hand  310
ORDER          220 units (22 packs)
P(stockout)    4.8%
cost/cycle     ₹38.56    (₹39.40 one pack fewer · ₹39.02 one pack more)
```

---

## 3. ★ Three decisions, and one of them was a real bug

### 3.1 The protection interval — the largest correctness fix in the project

**The obvious choice** is to size the order against demand over the **lead time**. It is what
"lead-time demand" suggests, and it is what we did first.

**It is wrong.** In a periodic-review system you cannot reorder until the next review. With a 7-day
review and a 4-day lead time, **today's order must survive 11 days** — until the order *after* next
arrives.

**How it was found:** building replay. The simulation produced persistent stockouts under **both**
policies, which is the signature of a systemic under-order rather than a policy difference.

```python
# decision/newsvendor.py
def protection_interval_days(lead_time_days: int, review_period_days: int) -> int:
    """The window the order has to survive.

    A periodic-review system is exposed for the lead time PLUS the review
    period: after placing an order you cannot place another until the next
    review, so today's order must cover demand until the order AFTER next
    arrives. Sizing against the lead time alone systematically under-orders,
    which the replay simulation surfaced as persistent stockouts under both
    policies.
    """
    return max(int(lead_time_days), 1) + max(int(review_period_days), 0)
```

```python
# api/routers/decisions.py::_order_for
    # Size against the protection interval, not the lead time alone: with a
    # weekly review and a 4-day lead time the order must last 11 days, not 4.
    horizon = protection_interval_days(params.lead_time_days, params.review_period_days)
    dist = fs.lead_time_demand(series_id, horizon)
```

**Impact, Jan–Mar 2019:**

| Sizing against | Units unsupplied |
|---|---|
| Lead time (4 days) | **2,207** |
| Protection interval (11 days) | **121** |

Asserted by `tests/unit/test_replay.py::test_protection_interval_covers_lead_time_plus_review`.

### 3.2 Rounding is asymmetric, not nearest

The two rounding errors do not cost the same. With `Cu > Co` the correct direction is **up**.

```python
def round_to_pack(units, pack_size, cu, co) -> int:
    """Rounding to the NEAREST pack is wrong: with Cu > Co, being one pack short
    costs more than being one pack long, so the correct rounding is up."""
    packs = units / pack_size
    return int(math.ceil(packs) if cu >= co else math.floor(packs))
```

```python
def test_rounding_is_asymmetric_not_nearest():
    assert round_to_pack(11.0, 10, cu=4.0, co=0.1) == 2      # UP, not to 1
    assert round_to_pack(19.0, 10, cu=0.1, co=4.0) == 1      # DOWN
```

### 3.3 The quantile grid is anchored at (0, 0)

**The bug**, found by a property test: clamping at the lowest stored quantile meant a product whose
shortage is nearly free **still got ordered up to the 5th percentile** — an order floor with no
economic justification.

```python
def quantile_of(dist, level) -> float:
    """The grid is anchored at (0.0, 0.0) rather than clamped at its lowest
    stored level, because demand is a non-negative quantity...

    Above the highest stored level the value IS clamped, because extrapolating
    a tail we did not estimate would invent confidence we do not have."""
    if level >= levels[-1]:
        return values[-1]
    return float(np.interp(level, [0.0] + levels, [0.0] + values))
```

The test that found it:

```python
def test_free_shortage_means_order_nothing():
    r = recommend_order(DIST, OrderParams(unit_margin=1e-9, unit_cost=100.0, stock_on_hand=0.0))
    assert r.q_star < 0.01
    assert r.order_quantity == 0      # was 80 before the fix
```

---

## 4. ★ The cost curve — why the slider feels instant

`/api/recommend` returns the order quantity, expected cost and stockout probability at **16 service
levels** in the same response.

```python
# decision/newsvendor.py
SERVICE_LEVEL_GRID = [0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.75,
                      0.80, 0.85, 0.90, 0.925, 0.95, 0.975, 0.99]

def build_cost_curve(dist, params, cu, co) -> list[dict]:
    """Returned with the response so the frontend can interpolate on slider drag
    and never touch the network. That is what makes the control feel live."""
```

**Expected cost is a weighted sum over the 21-point quantile grid**, not an integral — which is why
16 evaluations are affordable in one request:

```python
def expected_cost(dist, stock_position, cu, co) -> float:
    edges = np.concatenate([[0.0], (levels[:-1] + levels[1:]) / 2.0, [1.0]])
    weights = np.diff(edges)                       # midpoint rule on the levels
    shortage = np.clip(values - stock_position, 0.0, None)
    excess = np.clip(stock_position - values, 0.0, None)
    return float(np.sum(weights * (shortage * cu + excess * co)))
```

**Verified in the browser with the network tab open: zero requests while dragging.**

---

## 5. ★ The ledger — wired, after being found unused

The ledger was complete and tested but **nothing called it**. The API read `stock_on_hand` straight
from settings, so the audit log and the position were two halves that could disagree.

```python
# api/deps.py
def live_stock(series_id: str, opening: float) -> float:
    """Opening position plus every movement the ledger has recorded.

    Settings hold the OPENING stock - the number a pharmacist types after a
    stock take. The ledger holds what has happened since. The live position is
    the sum, so accepting an order actually moves the shelf instead of the two
    halves disagreeing.
    """
    moved = ledger.balance(series_id).get(series_id, 0.0)
    return max(0.0, float(opening) + float(moved))
```

**Accepting an order posts a goods receipt:**

```python
# api/routers/decisions.py::commit_order
    if body.accepted > 0:
        ledger.post(body.series_id, today, "received", body.accepted,
                    note=f"order accepted (recommended {body.recommended})")
```

**Measured effect:**

| | Stock | Status | Suggests |
|---|---|---|---|
| Before accepting | 310 | `order_now` | 220 |
| After accepting 220 | **530** | **`ok`** | **0** |

### The audit chain

Each entry stores the previous entry's hash, so an edit or deletion is detectable — and an override
without a reason is refused.

```python
def log_order(series_id, ds, recommended, accepted, reason="", ...):
    if accepted != recommended and not reason.strip():
        raise ValueError("an override must carry a reason")
    prev_hash = prev["hash"] if prev else "genesis"
    digest = hashlib.sha256(json.dumps({..., "prev": prev_hash}, sort_keys=True).encode()).hexdigest()
```

```python
def test_the_audit_chain_detects_tampering(db):
    ledger.log_order("N02BE", "2019-10-08", 130, 130, db_path=db)
    assert ledger.verify_chain(db_path=db)
    with ledger.connect(db) as conn:
        conn.execute("UPDATE order_log SET accepted = 999 WHERE id = 1")
    assert not ledger.verify_chain(db_path=db)
```

---

## 6. Risk: ranked by money, and one bug that silenced it

**Four rules**, each carrying a probability *and* a rupee exposure. Ranked by **exposure, not
probability** — a 30% chance on the highest-volume product matters more than a 90% chance on
something that sells twice a month.

### ★ The bug: stockout risk never fired

Risk was being evaluated **after** the proposed order was added, so `p_stockout` was always tiny and
no exception ever appeared on the dashboard.

```python
# decision/risk.py
    # 1. Stockout - evaluated at the CURRENT shelf position, before the
    #    proposed order is added. order.p_stockout is the risk that REMAINS
    #    after ordering; the buyer needs to know the risk they have now.
    exposed = p_stockout(order.lead_time_demand, order.stock_on_hand)
    if exposed >= STOCKOUT_THRESHOLD:
```

```python
def test_stockout_risk_is_measured_before_the_order_not_after():
    order, params = _order(5.0)
    risks = [r for r in detect("N02BE", order, params) if r.type == STOCKOUT]
    assert risks, "an almost-empty shelf must raise a stockout risk"
    assert risks[0].probability > order.p_stockout
```

**Live output after the fix:**

```
total exposure INR 1,099, 3 exceptions
  stockout   INR  662  Paracetamol runs below its reorder point
  stockout   INR  275  Asthma / COPD runs below its reorder point
  overstock  INR  163  Antihistamines has 110 days of cover
```

**Copy fix too.** The detail said *"10.4 days of cover against a 4-day lead time"*, which reads as
reassuring rather than as a warning. It now names the protection interval:

> "10.4 days of cover. The order has to survive 11 days — a 4-day lead time plus a 7-day gap until
> the next review."

---

## 7. ★ Replay and the business case

**The demo problem:** the data ends in 2019, so a live system is hard to show. **The solution uses
only real data — replay it.**

`decision/replay.py` steps a chosen window one day at a time: sales post, stock depletes, orders go
out, deliveries land after the lead time, status chips flip, alerts fire.

**It also doubles as the business case.** The same policy code the API serves is run against real
outcomes, and a min/max policy is run over the identical days.

| Window | Min/max | PharmaPulse | Lower by | Units unsupplied |
|---|---|---|---|---|
| Jan–Mar 2019 | ₹4,608 | **₹1,479** | **67.9%** | 349 → **121** |
| Apr–Jun 2019 | ₹3,362 | **₹1,200** | **64.3%** | 325 → **76** |
| Oct–Dec 2018 | ₹4,942 | **₹1,211** | **75.5%** | 343 → **48** |

> **⚠ SUPERSEDED — the table above is the old measurement.** The replay served
> ONE forecast, anchored months *after* the window it was replaying, to every
> policy. On R03 that predicted 41 units per protection interval against 119
> actually sold in December: every policy under-ordered all winter, and the
> headline saving really meant "safety stock on a stale forecast beats no
> safety stock on the same stale forecast".
>
> Every policy now sizes off the same trailing window of real sales, and two
> harder baselines were added. Current figures (positive = we are cheaper):
>
> | Baseline | Jan–Mar 19 | Apr–Jun 19 | Oct–Dec 18 |
> |---|---|---|---|
> | Min/max on the mean | +6.0% | +48.8% | +61.1% |
> | (s, S) safety stock — what an ERP does | −2.9% | +23.1% | −1.8% |
> | **Our forecast, sized with a normal approximation** | **+17.9%** | **+8.1%** | **+0.4%** |
>
> The third row is the one that carries the claim: same forecast, same service
> level, differing only in normal-approximation versus the empirical quantile.
> We win all three. Against a real ERP policy we are level. See README.md.


### ★ The first version of this comparison was rigged

After fixing our own protection interval, the baseline was left on the old one — which handed us an
**88% saving**. That number was implausibly good, so it got checked.

```python
# decision/replay.py
        if self.policy == POLICY_MINMAX:
            # It gets the SAME protection interval we do - anything less would
            # be a rigged comparison, and a first measurement that handed us an
            # 88% saving turned out to be exactly that. The only thing that
            # differs is that min/max sizes against the MEAN while we size
            # against the quantile the pharmacy's own cost ratio implies.
            mean_daily = quantile_of(dist, 0.5) / max(horizon, 1)
            minimum = mean_daily * horizon
            maximum = minimum + mean_daily * params.review_period_days
```

**Giving the baseline the same interval brings it to a defensible ~70%.**

**And the saving comes from the right place** — asserted, not assumed:

```python
def test_the_saving_comes_from_fewer_lost_sales(daily):
    """Sized against a high quantile we hold MORE stock and pay more holding
    cost - the win has to come from shortage, or the story is wrong."""
    assert ours["units_short"] < theirs["units_short"]
    assert ours["holding_cost"] > theirs["holding_cost"]
```

### ★ Concurrency bug: two ticks corrupted a run

Clicking "skip a week" while the poller was running turned **121 units short into 547**. FastAPI runs
sync endpoints in a threadpool, so two requests interleaved inside the sell → deliver → order
sequence.

```python
    def tick(self) -> dict:
        """Serialised: a replay session is a state machine, and two concurrent
        callers must not interleave inside it."""
        with self._lock:
            return self._tick_locked()
```

**Verified:** sequential ticks, batched ticks and a direct session now agree **to the paisa**
(120.8 units short, 99 orders, ₹1,479.35), and the browser matched the reference exactly at day 48.

Regression test: `test_concurrent_ticks_do_not_corrupt_the_run` runs four threads against one session
and asserts the totals match a single-threaded reference.

---

## 8. The API

**16 endpoints.** The envelope is built **once** in `api/deps.py::meta()`, so every 200 carries
provenance whether or not the route author remembered.

```python
def meta(degraded=None, origin="observed") -> dict:
    m = fs.model_meta()
    return {"origin": origin, "model_version": m.get("model_version"),
            "snapshot_id": m.get("snapshot_id"), "generated_at": m.get("generated_at"),
            "stale": bool(m.get("stale", False)), "degraded": degraded,
            "correlation_id": correlation_id()}
```

**Guards worth the ten minutes each:**

```python
    max_horizon = max(1, len(one) // 4)
    if horizon > max_horizon:
        raise HTTPException(422, detail=deps.error("HORIZON_TOO_LONG",
            f"max horizon for {series_id} at {grain} grain is {max_horizon}; "
            "beyond that the model is extrapolating past what the history supports"))
```

**Cache keyed on `model_version`**, so publishing a model self-invalidates with no flush step anyone
could forget:

```python
@lru_cache(maxsize=512)
def _cached_quantiles(series_id, grain, horizon, model_version) -> str:
```

**Deliberately not built:** OIDC, multi-tenant RLS, rate limiting, Redis, OpenTelemetry. Real
engineering, zero demo surface in the time available. The lines to say are in
`../05_INTEGRATION_DOCKER_OPS.md` §10.

---

## 9. Tests owned — 76 in total

| Suite | Count | Protects |
|---|---|---|
| `tests/property/test_newsvendor.py` | 22 | the order arithmetic |
| `tests/unit/test_decision.py` | 21 | ledger, audit chain, risk ranking |
| `tests/unit/test_replay.py` | 17 | the simulation and the business case |
| `tests/contract/test_api.py` | 33 | the shapes Pod D codes against |

**The properties, because a plausible-looking wrong answer here is indistinguishable from a right
one:**

- order quantity is monotone non-decreasing in `service_level`
- order quantity is monotone non-increasing in `stock_on_hand`
- the order is always a non-negative whole multiple of `pack_size`
- `Cu → 0` implies `q* → 0` implies order 0
- expected cost at the optimum is never worse than at ±1 pack

**Plus a conservation invariant in replay** — the stronger form of "sales deplete the shelf", after a
first version wrongly asserted stock simply falls (false on a day a delivery lands):

```python
        assert st.stock + in_transit == pytest.approx(
            opening[sid] + st.units_ordered - supplied, abs=0.01), sid
```

---

## 10. Honest gaps

- **Expiry risk is a stub.** This dataset has no batches. Claiming a batch-expiry feature on data
  without batches is exactly what the provenance rule exists to prevent.
- **Replay state is in memory**, bounded to 8 sessions. A restart loses a run. Fine for a demo,
  stated.
- **`/simulate` and `/assistant` not built.** Below the cut line; the assistant is a live external
  dependency mid-pitch, which is a risk we chose not to take.
- **The receipt lands immediately**, not after the lead time. The honest simplification for a
  single-machine demo, noted in the code.
