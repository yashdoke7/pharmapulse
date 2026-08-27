# `decision/` — Decision Engine

**Owner:** Pod C1
**Full brief:** `team/03_POD_C_DECISION_API.md`

---

## Target

> Convert a demand **distribution** plus this pharmacy's own costs into an **integer order quantity**,
> with the cost of being wrong attached.

This is where the project's thesis lives: *a forecast is not the product; the purchase order is.*
It is also the most likely file a judge asks to see.

## Inputs

| Input | Lane | From |
|---|---|---|
| `lead_time_demand: dict[str, float]` — distribution of total demand over the lead time | `observed` | Pod B, `core.forecast_store.lead_time_demand()` |
| lead time, stock on hand, pack size, unit cost, unit margin, holding-cost rate, expiry-risk rate | `user_setting` | `data/warehouse/ops.db` via `/api/settings` |

**Lane 2 enters the system here and only here.** Settings never reach anything that fits a model —
that is enforced by the shape of the pipeline, not by discipline. Keep it that way.

## Outputs

| Output | Consumed by |
|---|---|
| `OrderResult` — quantity, packs, `q*`, `p_stockout`, expected cost at ±1 pack, **the 16-point cost curve**, `inputs_used[]` with lane labels | `api/routers/recommend.py` |
| Ledger position — `stock_on_hand`, days of cover, reorder point, status, projected stockout date | `/api/risk`, `/api/replay` |
| Ranked risk list, sorted by **monetary exposure** | `/api/risk` |

## Files

| File | Responsibility |
|---|---|
| `newsvendor.py` | **Pure function. No I/O, no imports from `core/`.** Critical fractile, quantile interpolation, asymmetric pack rounding, expected-cost curve. |
| `ledger.py` | SQLite event table + current-balance view. `opening + received − sold − wastage ± adjustment`. |
| `risk.py` | four rules, each with a probability and a rupee exposure |
| `recommend.py` | risks → actions: `order_now`, `order_early`, `do_not_order`, `slow_mover` |

## The arithmetic

```
Cu     = unit_margin                                     # cost of being one unit short
Co     = unit_cost * holding_rate * (lead_days/365)      # cost of being one unit over
         + unit_cost * expiry_risk_rate
q*     = Cu / (Cu + Co)
level  = service_level if supplied else q*               # the slider overrides q*
target = quantile(lead_time_demand, level)
order  = ceil_to_pack(max(0, target - stock_on_hand))    # direction from the cost ratio
```

**Three properties, each a sentence in the demo:**

1. **Closed form** — no solver runs during a request, which is why the slider updates live.
2. **Rounding is asymmetric** — the two rounding errors cost different amounts, so `round()` is
   wrong. With `Cu > Co`, round up.
3. **Every input is lane-labelled on screen** — the user can see that the forecast is measured and
   the lead time is theirs.

**Return the whole cost curve in one response** (16 service levels, 0.05 → 0.99). The frontend
interpolates on drag and never touches the network. That single decision is what makes the demo feel
like a product rather than a form.

## Rules

- Rank risks by **exposure, not probability**. A 30% chance on the highest-volume product matters
  more than a 90% chance on something that sells twice a month.
- **Do not build batch-level expiry.** This dataset has no batches. The rule is a stub; the feature
  is named as requiring real ERP data.
- Thresholds are configuration, not code.

## Tests

`tests/unit/test_newsvendor_closed_form.py` · `tests/property/test_newsvendor_monotonic.py` ·
`tests/unit/test_pack_rounding.py` · `tests/unit/test_ledger_balance.py`

Property tests worth having (`hypothesis`): quantity is monotone in `service_level`, monotone
(decreasing) in `stock_on_hand`, always a non-negative multiple of `pack_size`, `Cu → 0` gives order
0, and expected cost at the optimum is never worse than at ±1 pack.

## Definition of done

- [ ] `newsvendor.py` has zero imports from `core/`, `api/`, or `pipelines/`
- [ ] All property tests green
- [ ] `/recommend` returns a 16-point cost curve and Pod D interpolates it locally
- [ ] Every `OrderResult` carries `inputs_used[]` with a lane on each entry
