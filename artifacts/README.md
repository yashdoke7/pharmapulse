# `artifacts/` — machine-generated numbers only

**Owner:** Pod B1. **Contract:** C4.

---

## Target

> **No number on the Ops Console or in the deck is typed by a human.**

That sentence is said out loud during the demo, so it has to be literally true.

## The rule

`benchmarks.json` is written **only** by `scripts/day1_benchmark.py`. It is **never hand-edited**,
not to fix a typo, not to round a figure, not the night before. If a number is wrong, the script is
wrong, and fixing the script is the work.

## Inputs

`data/warehouse/gold/**` (lane `observed` only — the benchmark script filters on `origin` itself,
rather than relying on anyone remembering).

## Outputs

| File | Consumed by |
|---|---|
| `benchmarks.json` | `GET /api/metrics` → the Ops Console and the leaderboard screen |
| `runs/` | scratch, gitignored |

## Shape

Full specification in `CONTRACTS.md` C4. Five blocks:

| Block | Contains |
|---|---|
| `protocol` | grain, horizon, folds, metric, cv, **seed**, n_series — printed on the slide |
| `leaderboard` | every model scored, with `is_benchmark` / `is_shipped` / `is_bound` flags |
| `per_series` | including `ensemble_wins: false` where we lose |
| `ablations` | selection vs combination, direct-monthly vs summed-from-weekly |
| `calibration` | achieved coverage before and after, plus `n_points` |

## ⚠ Current state

**The file committed here is a placeholder.** Its values are copied from
`docs/PHARMAPULSE_ARCHITECTURE.md` and are **not reproduced in this repository** — the analysis that
produced them ran elsewhere, and the script that produced them is not here.

It carries a `PLACEHOLDER` key for exactly that reason.

> **Pod B's first task on Day 1 is to regenerate this file for real and delete that key.** If the
> regenerated numbers differ from the document, **the new numbers are the truth and the deck
> changes.** Nothing goes on a slide until `make benchmark` has written it.

## Regenerate

```bash
make benchmark            # full: 4 folds
python scripts/day1_benchmark.py --fast    # 2 folds, for CI
```

Two consecutive clean runs must produce identical values. If they do not, a seed is unpinned — find
it before building anything on the output.

## Reporting rules

- **Losses go on the slide next to wins.** The ensemble is expected to lose to seasonal naive on
  M01AE; R06 is the hardest series. A team that reports only wins gets discounted, and experienced
  judges do it fast.
- **Report coverage with a confidence interval, not as a point.** 256 points establishes a consistent
  *direction* of over-confidence; it does not certify a per-series level.
- **Keep measurements and assumptions visibly different.** The MASE figures are measurements. The
  ₹1.8 lakh business case is an argument built on stated assumptions. Presenting them as the same
  kind of claim undermines both.
- **The 2019 holdout is evaluated exactly once, on Day 4.** That number is final.
