"""Series catalogue, history, forecast and explanation."""

from __future__ import annotations

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from api import deps
from core import explain as explain_engine
from core import forecast_store as fs
from pipelines.gold import read_gold

router = APIRouter(prefix="/api", tags=["forecast"])

UI_LEVELS = [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95]


@router.get("/series")
def series() -> dict:
    """Catalogue with the measured demand class, which drives a UI chip."""
    if deps.use_fixtures():
        return deps.envelope(deps.fixture("series")["data"])

    classes = fs.series_catalogue()
    weekly = classes[classes.get("grain", "week") == "week"] if "grain" in classes else classes
    by_id = {r["series_id"]: r for _, r in weekly.iterrows()} if not weekly.empty else {}

    daily = classes[classes.get("grain") == "day"] if "grain" in classes else classes
    daily_by_id = {r["series_id"]: r for _, r in daily.iterrows()} if not daily.empty else {}

    out = []
    for sid in deps.SERIES_IDS:
        name, short, peak = deps.SERIES_META[sid]
        # A pandas Series is not usable in `or` - it raises on truthiness.
        # Prefer the DAILY classification: that is the grain where the
        # intermittency actually shows (N05C is intermittent daily, smooth
        # weekly), and it is what the UI chip should say.
        row = daily_by_id.get(sid)
        if row is None:
            row = by_id.get(sid)
        out.append({
            "series_id": sid, "name": name, "short_name": short,
            "demand_class": str(row["demand_class"]) if row is not None else "smooth",
            "adi": round(float(row["adi"]), 3) if row is not None else None,
            "cv2": round(float(row["cv2"]), 3) if row is not None else None,
            "daily_mean": deps.DAILY_MEAN[sid],
            "zero_day_pct": round(float(row["zero_rate"]) * 100, 1) if row is not None else None,
            "peak_month": peak,
            "unit": "units",
        })
    return deps.envelope({"series": out})


@router.get("/history")
def history(series_id: str = Query("N02BE"),
            grain: str = Query("week"),
            limit: int = Query(120, ge=1, le=2500)) -> dict:
    deps.require_series(series_id)
    if deps.use_fixtures():
        return deps.envelope(deps.fixture("history")["data"])

    gold = read_gold(grain)
    one = gold[gold["series_id"] == series_id].sort_values("ds").tail(limit)
    points = [{
        "ds": pd.Timestamp(r.ds).strftime("%Y-%m-%d"),
        "y": round(float(r.y), 2),
        "is_closed": bool(r.is_closed),
        "is_outlier": bool(r.is_outlier),
        "completeness": round(float(r.completeness), 4),
    } for r in one.itertuples()]
    return deps.envelope({"series_id": series_id, "grain": grain, "points": points})


@router.get("/forecast")
def forecast(series_id: str = Query("N02BE"),
             grain: str = Query("week"),
             horizon: int = Query(8, ge=1),
             with_members: bool = Query(True)) -> dict:
    deps.require_series(series_id)
    if deps.use_fixtures():
        return deps.envelope(deps.fixture("forecast")["data"])

    gold = read_gold(grain)
    one = gold[gold["series_id"] == series_id]
    max_horizon = max(1, len(one) // 4)
    if horizon > max_horizon:
        raise HTTPException(status_code=422, detail=deps.error(
            "HORIZON_TOO_LONG",
            f"max horizon for {series_id} at {grain} grain is {max_horizon}; "
            "beyond that the model is extrapolating past what the history supports"))

    try:
        quantiles = deps.cached_quantiles(series_id, grain, horizon)
    except (KeyError, FileNotFoundError) as exc:
        raise HTTPException(status_code=503, detail=deps.error(
            "NO_FORECAST_YET", str(exc))) from exc

    points = [{"ds": ds, "h": i + 1, "q": qs}
              for i, (ds, qs) in enumerate(sorted(quantiles.items()))]

    hist = one.sort_values("ds").tail(52)
    history_points = [{"ds": pd.Timestamp(r.ds).strftime("%Y-%m-%d"),
                       "y": round(float(r.y), 2),
                       "completeness": round(float(r.completeness), 4)}
                      for r in hist.itertuples()]

    members = fs.read_members(series_id, grain)[:6] if with_members else []
    for m in members:
        m["p50"] = m["p50"][:horizon]

    cutoff = fs.read_forecast(series_id, grain, horizon)
    cutoff_str = (pd.Timestamp(hist["ds"].max()).strftime("%Y-%m-%d")
                  if not hist.empty else None)

    return deps.envelope({
        "series_id": series_id, "grain": grain, "cutoff": cutoff_str,
        "horizon": horizon, "calibrated": True, "max_horizon": max_horizon,
        "points": points, "history": history_points, "members": members,
    })


@router.get("/explain")
def explain(series_id: str = Query("R06"),
            grain: str = Query("month"),
            horizon: int = Query(1, ge=1, le=6)) -> dict:
    deps.require_series(series_id)
    if deps.use_fixtures():
        return deps.envelope(deps.fixture("explain")["data"])

    gold = read_gold(grain)
    gold = gold[gold["completeness"] >= 1.0]

    try:
        attribution = explain_engine.attribute(series_id, gold, grain=grain,
                                               horizon=horizon)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=deps.error(
            "NO_FORECAST_YET", f"attribution unavailable: {exc}")) from exc

    bench = deps.benchmarks()
    calib = bench.get("calibration", {})

    payload = attribution.as_dict()
    payload["calibration"] = {
        "before": calib.get("curve_before", []),
        "after": calib.get("curve_after", []),
        "n_points": calib.get("n_points"),
        "conformal_scale": calib.get("conformal_scale"),
        "nominal": calib.get("nominal", 0.80),
        "achieved_before": calib.get("achieved_before"),
        "achieved_after": calib.get("achieved_after"),
    }
    return deps.envelope(payload)
