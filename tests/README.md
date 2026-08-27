# `tests/` — everyone writes tests for their own folder

**Owner:** shared. **Each pod owns the tests for the paths it owns.**

---

## Target

> Protect the handful of claims the project actually rests on. Not coverage — **load-bearing
> correctness**, in the places where a defect is silent.

Four days does not buy comprehensive testing. It buys these tests, and they are chosen because each
one guards a claim that appears on a slide.

## Layout

```
tests/
  unit/       fast, pure, no I/O
  property/   hypothesis - the decision arithmetic
  contract/   live API vs contracts/fixtures
```

## The six tests that matter most

| Test | Owner | Guards |
|---|---|---|
| **`unit/test_no_leakage.py`** | A2 | *Every* reported number. A feature at time *t* must be identical whether or not rows after *t* exist. **If this is red, nothing else means anything — say so loudly rather than working around it.** |
| `unit/test_reconciliation.py` | A1 | "one source of truth" — weekly and monthly rollups equal the daily sum |
| `unit/test_closures.py` | A1 | 26 days flagged `is_closed`, none deleted, none imputed |
| `property/test_newsvendor_monotonic.py` | C1 | the order arithmetic — the claim the whole product rests on |
| `unit/test_attribution_sums.py` | B2 | an explanation that does not add up to the number it explains is worse than no explanation |
| **`contract/test_matches_fixtures.py`** | C2 | Pod D's build. A shape change goes red here before it breaks their app. |

## Full list by pod

**Pod A** — `test_no_leakage` `test_ingest_idempotent` `test_reconciliation` `test_closures`
`test_completeness` `test_lane_enforcement`

**Pod B** — `test_classify` (N05C intermittent, R03 erratic) `test_combine_monotone` (quantiles
non-decreasing and non-negative) `test_store_roundtrip` (write → pointer swap → read)
`test_lead_time_demand` (longer lead time is wider and higher) `test_attribution_sums`
`test_synthetic_blocked`

**Pod C** — `test_newsvendor_closed_form` `test_newsvendor_monotonic` `test_pack_rounding` (rounds up
when `Cu > Co`, never uses `round()`) `test_ledger_balance` `test_matches_fixtures` `test_envelope`

**Pod D** — the CI `npm run build` is the gate. Component tests are below the cut line.

## The property tests worth writing (`hypothesis`, Pod C)

- order quantity is monotone non-decreasing in `service_level`
- order quantity is monotone non-increasing in `stock_on_hand`
- order quantity is always a non-negative multiple of `pack_size`
- `Cu → 0` implies `q* → 0` implies order 0
- expected cost at the computed optimum is never worse than at ±1 pack

Property-based testing earns its place here because the decision arithmetic is where correctness is
load-bearing and where a plausible-looking wrong answer is indistinguishable from a right one.

## Run

```bash
pytest -q                              # all
pytest tests/unit/test_no_leakage.py -v
pytest tests/contract -v               # needs the API running, or PHARMAPULSE_FIXTURES=1
```

CI runs `ruff check .` then `pytest -q` then the web build, on every push, and blocks merge on red.
