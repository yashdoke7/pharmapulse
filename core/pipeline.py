"""Batch forecast stage: gold -> fit -> combine -> calibrate -> forecast store.

    python -m pipelines.run_nightly --stage forecast

Runs at all three grains, because a pharmacy makes three different decisions on
three different rhythms:
    day   "will I run out before the next delivery?"   - the stockout alarm
    week  "what do I order on Tuesday?"                - the ordering grain
    month "how much cash, and when do I pre-book?"     - the planning grain

Each grain is fitted on data of that grain. A model fitted on monthly
observations sees a cleaner seasonal signal than one fitted on weekly data whose
short-run noise has not been aggregated away.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from core import calibrate, forecast_store
from core.classify import classify, eligible_models
from core.combine import ENSEMBLE_MEMBERS, combine_point, enforce_monotonic
from core.portfolio import lgbm_global, prophet_model, statistical
from pipelines.gold import fitting_frame
from pipelines.ingest import snapshot_id

HORIZONS = {"day": 28, "week": 8, "month": 6}
SEASON = {"day": 7, "week": 52, "month": 12}
BENCHMARKS = Path("artifacts/benchmarks.json")
RAW = Path("data/observed/salesdaily.csv")


def _spread(train: pd.DataFrame, season: int) -> pd.Series:
    """Per-series scale for the interval: sd of in-sample seasonal differences."""
    out = {}
    for sid, grp in train.groupby("series_id", observed=True):
        y = grp.sort_values("ds")["y"].to_numpy(dtype=float)
        diffs = y[season:] - y[:-season] if len(y) > season else np.diff(y)
        out[sid] = float(np.std(diffs)) if len(diffs) > 1 else 1.0
    return pd.Series(out)


def _conformal_scale() -> float:
    """Reuse the scale measured by the benchmark, so the served intervals are
    the calibrated ones rather than the raw model output."""
    if not BENCHMARKS.exists():
        return 1.0
    try:
        b = json.loads(BENCHMARKS.read_text(encoding="utf-8"))
        return float(b.get("calibration", {}).get("conformal_scale", 1.0))
    except Exception:
        return 1.0


def forecast_grain(grain: str, scale: float,
                   verbose: bool = True) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Fit the routed portfolio at one grain.

    Routing is recomputed FOR THIS GRAIN. Aggregation removes sparsity, so a
    series can be intermittent daily and smooth weekly - N05C is exactly that.
    Classifying once on weekly data would send the daily forecast to the wrong
    model family. Asserted by tests/unit/test_core.py::test_demand_class_depends_on_the_grain.
    """
    from scipy.stats import norm

    h = HORIZONS[grain]
    season = SEASON[grain]
    gold = fitting_frame(grain)
    cutoff = pd.Timestamp(gold["ds"].max())

    classes = classify(gold)
    classes["grain"] = grain
    route = dict(zip(classes["series_id"], classes["demand_class"]))
    wanted: set[str] = set()
    for sid in gold["series_id"].unique():
        wanted.update(eligible_models(route.get(sid, "smooth")))

    stat_names = [m for m in wanted
                  if m in {"AutoARIMA", "MSTL", "SeasonalNaive",
                           "CrostonOptimized", "AutoETS", "DynamicOptimizedTheta"}]

    preds = [statistical.fit_predict(gold, h=h, grain=grain, models=stat_names)]

    if prophet_model.PROPHET_AVAILABLE and grain != "day":
        p = prophet_model.fit_predict(gold, h=h, grain=grain)
        if not p.empty:
            preds.append(p)

    g = lgbm_global.fit_predict(gold, h=h, grain=grain, quantiles=[0.5])
    if not g.empty:
        preds.append(g[["series_id", "ds", "model", "value"]])

    allp = pd.concat(preds, ignore_index=True)

    # Route: each series only combines the members its demand class allows.
    keep = []
    for sid, grp in allp.groupby("series_id", observed=True):
        allowed = set(eligible_models(route.get(sid, "smooth")))
        keep.append(grp[grp["model"].isin(allowed | {"SeasonalNaive"})])
    routed = pd.concat(keep, ignore_index=True)

    members_present = [m for m in ENSEMBLE_MEMBERS
                       if m in set(routed["model"].unique())]
    ens = combine_point(routed, members=members_present or None)

    order = {ds: i + 1 for i, ds in enumerate(sorted(ens["ds"].unique()))}
    ens["horizon"] = ens["ds"].map(order)

    spread = _spread(gold, season)
    rows = []
    for _, r in ens.iterrows():
        sd = float(spread.get(r["series_id"], 1.0)) * scale
        step = float(r["horizon"])
        sigma = sd * np.sqrt(max(step, 1.0))
        for q in forecast_store.QUANTILE_LEVELS:
            rows.append({
                "series_id": r["series_id"], "grain": grain, "cutoff": cutoff,
                "ds": r["ds"], "horizon": int(r["horizon"]), "quantile": q,
                "value": max(0.0, float(r["value"]) + norm.ppf(q) * sigma),
            })
    quantiles = enforce_monotonic(pd.DataFrame(rows))
    quantiles["grain"] = grain
    quantiles["cutoff"] = cutoff
    quantiles["horizon"] = quantiles.groupby(
        ["series_id", "quantile"], observed=True).cumcount() + 1
    quantiles["calibrated"] = True

    members = routed.copy()
    members["grain"] = grain
    members["cutoff"] = cutoff
    members = members[["series_id", "grain", "cutoff", "ds", "model", "value"]]

    if verbose:
        routes = ", ".join(f"{r.series_id}:{r.demand_class[:4]}"
                           for r in classes.itertuples())
        print(f"  {grain:6} cutoff {cutoff.date()}  h={h}")
        print(f"         members {', '.join(sorted(routed['model'].unique()))}")
        print(f"         routing {routes}")

    return quantiles, members, classes


def build_forecast_store(verbose: bool = True) -> dict:
    t0 = time.perf_counter()

    scale = _conformal_scale()

    if verbose:
        print("forecast stage")
        print(f"  conformal scale {scale:.3f} (from artifacts/benchmarks.json)")

    all_q, all_m, all_c = [], [], []
    for grain in ("day", "week", "month"):
        q, m, c = forecast_grain(grain, scale, verbose=verbose)
        all_q.append(q)
        all_m.append(m)
        all_c.append(c)

    quantiles = pd.concat(all_q, ignore_index=True)
    members = pd.concat(all_m, ignore_index=True)
    classes = pd.concat(all_c, ignore_index=True)

    snap = snapshot_id(RAW) if RAW.exists() else "unknown"
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%MZ")
    model_version = f"{stamp}/ens-v1"

    target = forecast_store.write_version(
        quantiles=quantiles,
        model_version=model_version,
        snapshot_id=snap,
        members=members,
        demand_classes=classes,
        meta={"grains": list(HORIZONS), "conformal_scale": scale,
              "n_rows": int(len(quantiles))},
    )

    elapsed = time.perf_counter() - t0
    if verbose:
        print(f"\n  wrote {target}")
        print(f"  {len(quantiles)} quantile rows, pointer -> "
              f"{forecast_store.current_version()}")
        print(f"forecast stage complete in {elapsed:.1f}s")

    return {"model_version": model_version, "rows": int(len(quantiles)),
            "elapsed_s": elapsed}


if __name__ == "__main__":
    build_forecast_store()
