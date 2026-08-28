"""Reproduce every accuracy figure in the deck, from a clean clone.

    python scripts/day1_benchmark.py            # 4 folds, full portfolio
    python scripts/day1_benchmark.py --fast     # 2 folds, cheap models (CI)

Writes artifacts/benchmarks.json. NEVER hand-edit that file: "no number on the
Ops Console is typed by a human" is said out loud in the demo, so it has to be
literally true.

Protocol, printed on the slide:
    weekly grain, horizon 8, rolling-origin CV, 4 non-overlapping folds,
    MASE with a naive (m=1) in-sample denominator, averaged over 8 series,
    seed 42.
"""

from __future__ import annotations

import argparse
import json
import platform
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from core import calibrate
from core.backtest import (
    SEED,
    aggregate_scores,
    leaderboard,
    make_folds,
    oracle_score,
    score_fold,
    selection_score,
)
from core.classify import classify
from core.combine import ENSEMBLE_MEMBERS, combine_point
from core.portfolio import lgbm_global, prophet_model
from core.portfolio import statistical
from pipelines.gold import fitting_frame
from pipelines.ingest import snapshot_id

OUT = Path("artifacts/benchmarks.json")
RAW = Path("data/observed/salesdaily.csv")

CHEAP = ["Naive", "WindowAverage", "SeasonalNaive", "CrostonOptimized"]
EXPENSIVE = ["AutoETS", "DynamicOptimizedTheta", "AutoARIMA", "MSTL"]
NOT_A_MODEL = ("Ensemble", "Oracle")


def series_spread(train: pd.DataFrame, season: int = 52) -> pd.Series:
    """Per-series scale for interval construction: sd of seasonal differences."""
    out = {}
    for sid, grp in train.groupby("series_id", observed=True):
        y = grp.sort_values("ds")["y"].to_numpy(dtype=float)
        diffs = y[season:] - y[:-season] if len(y) > season else np.diff(y)
        out[sid] = float(np.std(diffs)) if len(diffs) > 1 else 1.0
    return pd.Series(out)


def run(folds_n: int, horizon: int, fast: bool, verbose: bool = True) -> dict:
    t_start = time.perf_counter()
    np.random.seed(SEED)

    gold = fitting_frame("week")
    folds = make_folds(gold, h=horizon, n_folds=folds_n)

    stat_models = CHEAP if fast else CHEAP + EXPENSIVE
    use_prophet = (not fast) and prophet_model.PROPHET_AVAILABLE
    use_lgbm = True

    if verbose:
        print(f"protocol      weekly, h={horizon}, {folds_n} folds, MASE(m=1), seed {SEED}")
        print(f"series        {gold['series_id'].nunique()}   "
              f"periods {gold['ds'].nunique()}")
        print(f"statistical   {', '.join(stat_models)}")
        print(f"prophet       {'yes' if use_prophet else 'NO (unavailable or --fast)'}")
        print(f"lightgbm      {'yes' if use_lgbm else 'no'}\n")

    fold_scores: list[pd.DataFrame] = []
    calib_rows: list[pd.DataFrame] = []
    members_used: set[str] = set()
    n_fits = 0

    for fold in folds:
        t0 = time.perf_counter()
        preds = [statistical.fit_predict(fold.train, h=horizon, grain="week",
                                         models=stat_models)]
        n_fits += len(stat_models) * fold.train["series_id"].nunique()

        if use_prophet:
            p = prophet_model.fit_predict(fold.train, h=horizon, grain="week")
            if not p.empty:
                preds.append(p)
                n_fits += fold.train["series_id"].nunique()

        if use_lgbm:
            g = lgbm_global.fit_predict(fold.train, h=horizon, grain="week",
                                        quantiles=[0.5])
            if not g.empty:
                preds.append(g[["series_id", "ds", "model", "value"]])
                n_fits += 1

        allp = pd.concat(preds, ignore_index=True)

        ens_members = [m for m in ENSEMBLE_MEMBERS
                       if m in set(allp["model"].unique())]
        members_used.update(ens_members)
        ens = combine_point(allp, members=ens_members)
        allp = pd.concat([allp, ens], ignore_index=True)

        scored = score_fold(fold, allp)
        fold_scores.append(scored)

        # Calibration pairs: ensemble point vs actual, with the model's own spread.
        spread = series_spread(fold.train)
        pair = (ens.merge(fold.test[["series_id", "ds", "y"]],
                          on=["series_id", "ds"], how="inner")
                .rename(columns={"value": "point"}))
        pair["spread"] = pair["series_id"].map(spread)
        pair["fold"] = fold.k
        calib_rows.append(pair)

        if verbose:
            e = scored[scored["model"] == "Ensemble"]["mase"].mean()
            print(f"fold {fold.k}  cutoff {fold.cutoff.date()}  "
                  f"{time.perf_counter() - t0:5.1f}s   ensemble MASE {e:.3f}")

    per_series = aggregate_scores(fold_scores)
    board = leaderboard(per_series)

    calibration_df = pd.concat(calib_rows, ignore_index=True)
    holdback = calibration_df[calibration_df["fold"] < calibration_df["fold"].max()]
    scale = calibrate.conformal_scale(holdback if len(holdback) > 20 else calibration_df,
                                      level=0.80)
    calib_report = calibrate.calibration_report(calibration_df, scale)

    sel = selection_score(fold_scores, exclude=NOT_A_MODEL)
    ens_mase = float(board.loc[board["model"] == "Ensemble", "mase"].iloc[0])
    oracle = oracle_score(per_series, exclude=NOT_A_MODEL)

    classes = classify(gold)

    snap = snapshot_id(RAW) if RAW.exists() else "unknown"
    elapsed = time.perf_counter() - t_start

    bench = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "snapshot_id": snap,
        "protocol": {
            "grain": "week", "horizon": horizon, "folds": folds_n,
            "metric": "MASE", "mase_denominator": "in-sample naive (m=1)",
            "cv": "rolling-origin, non-overlapping", "seed": SEED,
            "n_series": int(gold["series_id"].nunique()),
            "n_periods": int(gold["ds"].nunique()),
            "fast_mode": bool(fast),
        },
        "ensemble_members": sorted(members_used),
        "leaderboard": _leaderboard_payload(board, ens_mase, oracle),
        "per_series": _per_series_payload(per_series),
        "demand_classes": classes.drop(columns=["models"]).to_dict("records"),
        "ablations": {
            "selection_vs_combination": {
                "selection": round(sel, 4),
                "combination": round(ens_mase, 4),
                "oracle": round(oracle, 4),
                "verdict": ("combination wins" if sel > ens_mase else "selection wins"),
            },
        },
        "calibration": {
            "nominal": 0.80,
            "achieved_before": _at(calib_report["before"], 0.80),
            "achieved_after": _at(calib_report["after"], 0.80),
            "conformal_scale": calib_report["scale"],
            "n_points": calib_report["n_points"],
            "curve_before": calib_report["before"],
            "curve_after": calib_report["after"],
        },
        "runtime": {
            "total_seconds": round(elapsed, 2),
            "series_model_folds": int(n_fits),
            "cpu": platform.processor() or platform.machine(),
            "python": platform.python_version(),
        },
    }
    return bench


def _at(curve: list[dict], nominal: float) -> float:
    for row in curve:
        if abs(row["nominal"] - nominal) < 1e-9:
            return row["achieved"]
    return float("nan")


def _leaderboard_payload(board: pd.DataFrame, ens: float, oracle: float) -> list[dict]:
    rows = []
    for _, r in board.iterrows():
        entry = {"model": r["model"], "mase": round(float(r["mase"]), 4)}
        if r["model"] == "SeasonalNaive":
            entry["is_benchmark"] = True
        if r["model"] == "Ensemble":
            entry["is_shipped"] = True
        rows.append(entry)
    rows.append({"model": "Oracle", "mase": round(oracle, 4), "is_bound": True})
    return sorted(rows, key=lambda r: r["mase"])


def _per_series_payload(per_series: pd.DataFrame) -> list[dict]:
    wide = per_series.pivot(index="series_id", columns="model", values="mase")
    rows = []
    for sid, r in wide.iterrows():
        pool = r.drop(labels=[c for c in NOT_A_MODEL if c in r.index], errors="ignore")
        best = pool.idxmin()
        sn = float(r.get("SeasonalNaive", float("nan")))
        en = float(r.get("Ensemble", float("nan")))
        rows.append({
            "series_id": sid,
            "seasonal_naive": round(sn, 4),
            "ensemble": round(en, 4),
            "best_model": str(best),
            "best_mase": round(float(pool.min()), 4),
            "ensemble_wins": bool(en < sn),
        })
    return rows


def print_report(b: dict) -> None:
    print("\n" + "=" * 62)
    print("LEADERBOARD   mean MASE across 8 series, lower is better")
    print("=" * 62)
    for r in b["leaderboard"]:
        tag = ""
        if r.get("is_benchmark"):
            tag = "  <- benchmark to beat"
        if r.get("is_shipped"):
            tag = "  <- what we ship"
        if r.get("is_bound"):
            tag = "  <- bound, not a model"
        print(f"  {r['model']:24} {r['mase']:.3f}{tag}")

    a = b["ablations"]["selection_vs_combination"]
    print("\n" + "=" * 62)
    print("ABLATION   picking the best model per series vs combining them")
    print("=" * 62)
    print(f"  selection (best-so-far per series)  {a['selection']:.3f}")
    print(f"  combination (median of members)     {a['combination']:.3f}")
    print(f"  oracle (perfect hindsight)          {a['oracle']:.3f}")
    print(f"  -> {a['verdict']}")

    c = b["calibration"]
    print("\n" + "=" * 62)
    print(f"CALIBRATION   nominal 80% interval, n={c['n_points']} points")
    print("=" * 62)
    print(f"  achieved before conformal correction  {c['achieved_before']:.3f}")
    print(f"  achieved after                        {c['achieved_after']:.3f}")
    print(f"  scale factor applied                  {c['conformal_scale']:.3f}")

    print("\n" + "=" * 62)
    print("PER SERIES   ensemble vs the seasonal-naive benchmark")
    print("=" * 62)
    print(f"  {'series':8} {'snaive':>8} {'ensemble':>9} {'best':>22}  wins")
    for r in b["per_series"]:
        mark = "yes" if r["ensemble_wins"] else "NO"
        print(f"  {r['series_id']:8} {r['seasonal_naive']:8.3f} "
              f"{r['ensemble']:9.3f} {r['best_model']:>22}  {mark}")

    print(f"\n  runtime {b['runtime']['total_seconds']}s, "
          f"{b['runtime']['series_model_folds']} series-model-folds")
    print(f"  members {', '.join(b['ensemble_members'])}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="PharmaPulse accuracy benchmark")
    ap.add_argument("--folds", type=int, default=4)
    ap.add_argument("--horizon", type=int, default=8)
    ap.add_argument("--fast", action="store_true",
                    help="2 folds, cheap models only - for CI")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args(argv)

    folds_n = 2 if args.fast else args.folds
    bench = run(folds_n=folds_n, horizon=args.horizon, fast=args.fast)
    print_report(bench)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(bench, indent=2), encoding="utf-8")
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
