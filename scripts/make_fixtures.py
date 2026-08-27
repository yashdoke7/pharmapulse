"""Generate contracts/fixtures/*.json.

Day 0: run as-is. It emits plausible, shape-correct fixtures so Pod D can build every
screen before the API exists.

Day 2 onward: Pod C replaces the `_synthetic_*` builders with reads from the real
forecast store, so `make fixtures` regenerates the same shapes with real values.
The SHAPES must never change without a CONTRACTS.md change-log entry.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import os
import random

random.seed(42)

OUT = "contracts/fixtures"
ART = "artifacts"

META = {
    "origin": "observed",
    "model_version": "2026-08-27T02:14Z/ens-v3",
    "snapshot_id": "sha256:9f2c1a4b7e03",
    "generated_at": "2026-08-27T02:14:11Z",
    "stale": False,
    "degraded": None,
    "correlation_id": "c-fixture01",
}

QL = ["0.05", "0.10", "0.25", "0.50", "0.75", "0.90", "0.95"]
Z = {"0.05": -1.645, "0.10": -1.282, "0.25": -0.674, "0.50": 0.0,
     "0.75": 0.674, "0.90": 1.282, "0.95": 1.645}

SERIES = [
    ("M01AB", "Anti-inflammatory, acetic acid derivatives", "Diclofenac",
     "smooth", 1.02, 0.31, 5.03, 1.9, "October"),
    ("M01AE", "Anti-inflammatory, propionic acid derivatives", "Ibuprofen",
     "smooth", 1.02, 0.35, 3.90, 1.7, "December"),
    ("N02BA", "Salicylic acid derivatives", "Aspirin",
     "smooth", 1.04, 0.38, 3.88, 3.7, "January"),
    ("N02BE", "Anilides", "Paracetamol",
     "smooth", 1.01, 0.21, 29.92, 1.2, "January"),
    ("N05B", "Anxiolytics", "Anxiolytics",
     "smooth", 1.02, 0.28, 8.85, 2.0, "March"),
    ("N05C", "Hypnotics and sedatives", "Sedatives",
     "intermittent", 3.12, 0.44, 0.59, 67.9, "January"),
    ("R03", "Obstructive airway drugs", "Asthma / COPD",
     "erratic", 1.30, 0.82, 5.51, 23.0, "December"),
    ("R06", "Antihistamines for systemic use", "Antihistamines",
     "smooth", 1.14, 0.47, 2.90, 12.2, "May"),
]


def env(data: dict) -> dict:
    return {"data": data, "meta": META}


def dump(name: str, obj: dict) -> None:
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2)


def weekly_history(mean: float, amp: float, n: int = 52, end: str = "2019-09-29") -> list[dict]:
    end_d = dt.date.fromisoformat(end)
    points = []
    for i in range(n - 1, -1, -1):
        d = end_d - dt.timedelta(weeks=i)
        season = 1 + amp * math.cos(2 * math.pi * (d.timetuple().tm_yday - 15) / 365)
        y = max(0.0, round(mean * season * random.gauss(1, 0.13), 1))
        points.append({
            "ds": d.isoformat(), "y": y,
            "is_closed": False, "is_outlier": y > mean * 1.9, "completeness": 1.0,
        })
    return points


def weekly_forecast(base: float, sigma_frac: float, h: int = 8,
                    cutoff: str = "2019-09-29") -> list[dict]:
    c = dt.date.fromisoformat(cutoff)
    points = []
    for k in range(1, h + 1):
        d = c + dt.timedelta(weeks=k)
        season = 1 + 0.22 * math.cos(2 * math.pi * (d.timetuple().tm_yday - 15) / 365)
        mu = base * season
        sd = mu * sigma_frac * (1 + 0.06 * (k - 1))
        points.append({
            "ds": d.isoformat(), "h": k,
            "q": {q: round(max(0.0, mu + Z[q] * sd), 1) for q in QL},
        })
    return points


LEAD_TIME_Q = {"0.05": 88.0, "0.10": 94.0, "0.25": 106.0, "0.50": 121.0,
               "0.75": 139.0, "0.90": 156.0, "0.95": 168.0}


def q_at(p: float) -> float:
    ks = sorted(float(k) for k in LEAD_TIME_Q)
    lut = {float(k): v for k, v in LEAD_TIME_Q.items()}
    if p <= ks[0]:
        return lut[ks[0]]
    if p >= ks[-1]:
        return lut[ks[-1]]
    for a, b in zip(ks, ks[1:]):
        if a <= p <= b:
            return lut[a] + (lut[b] - lut[a]) * (p - a) / (b - a)
    return lut[ks[-1]]


def build_cost_curve(stock_on_hand: float, pack: int, cu: float, co: float) -> list[dict]:
    levels = [0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.75,
              0.80, 0.85, 0.90, 0.925, 0.95, 0.975, 0.99]
    curve = []
    for sl in levels:
        target = q_at(sl)
        units = max(0.0, target - stock_on_hand)
        packs = math.ceil(units / pack)
        qty = packs * pack
        expected_short = max(0.0, q_at(0.95) - (stock_on_hand + qty)) * cu
        expected_hold = max(0.0, (stock_on_hand + qty) - q_at(0.50)) * co
        curve.append({
            "service_level": round(sl, 3),
            "order_quantity": qty,
            "expected_cost": round(expected_short + expected_hold + qty * 0.02, 1),
            "p_stockout": round(1 - sl, 3),
        })
    return curve


BENCHMARKS = {
    "generated_at": "2026-08-27T02:14:11Z",
    "snapshot_id": "sha256:9f2c1a4b7e03",
    "protocol": {"grain": "week", "horizon": 8, "folds": 4, "metric": "MASE",
                 "cv": "rolling-origin", "seed": 42, "n_series": 8},
    "leaderboard": [
        {"model": "Naive", "mase": 1.330},
        {"model": "WindowAverage(8)", "mase": 1.164},
        {"model": "SeasonalNaive", "mase": 1.118, "is_benchmark": True},
        {"model": "AutoETS", "mase": 1.114},
        {"model": "DynamicOptimizedTheta", "mase": 1.104},
        {"model": "CrostonOptimized", "mase": 1.089},
        {"model": "AutoARIMA", "mase": 1.039},
        {"model": "MSTL", "mase": 1.011},
        {"model": "LightGBM", "mase": 0.973},
        {"model": "Prophet", "mase": 0.950},
        {"model": "Ensemble(median-5)", "mase": 0.906, "is_shipped": True},
        {"model": "Oracle", "mase": 0.883, "is_bound": True},
    ],
    "per_series": [
        {"series_id": "M01AB", "seasonal_naive": 0.978, "ensemble": 0.641,
         "best_model": "DOTheta", "ensemble_wins": True},
        {"series_id": "M01AE", "seasonal_naive": 1.015, "ensemble": 1.061,
         "best_model": "SeasonalNaive", "ensemble_wins": False},
        {"series_id": "N02BA", "seasonal_naive": 0.685, "ensemble": 0.662,
         "best_model": "LightGBM", "ensemble_wins": True},
        {"series_id": "N02BE", "seasonal_naive": 0.998, "ensemble": 0.901,
         "best_model": "MSTL", "ensemble_wins": True},
        {"series_id": "N05B", "seasonal_naive": 0.953, "ensemble": 0.612,
         "best_model": "DOTheta", "ensemble_wins": True},
        {"series_id": "N05C", "seasonal_naive": 1.162, "ensemble": 0.704,
         "best_model": "Croston", "ensemble_wins": True},
        {"series_id": "R03", "seasonal_naive": 1.305, "ensemble": 1.087,
         "best_model": "LightGBM", "ensemble_wins": True},
        {"series_id": "R06", "seasonal_naive": 1.847, "ensemble": 1.671,
         "best_model": "MSTL", "ensemble_wins": True},
    ],
    "ablations": {
        "selection_vs_combination": {"selection": 1.091, "combination": 0.906,
                                     "oracle": 0.883},
        "direct_monthly_vs_aggregated": {"direct": 0.912, "summed_from_weekly": 0.954},
    },
    "calibration": {"nominal": 0.80, "achieved_before": 0.750,
                    "achieved_after": 0.79, "n_points": 256},
    "runtime": {"portfolio_fit_seconds": 25.0, "series_model_folds": 288, "cpu": "1 core"},
    "PLACEHOLDER": (
        "Copied from docs/PHARMAPULSE_ARCHITECTURE.md. NOT yet reproduced in this "
        "repository. Pod B regenerates this file with scripts/day1_benchmark.py on "
        "Day 1 and removes this key. Do not put these numbers on a slide until then."
    ),
}


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(ART, exist_ok=True)

    dump("series.json", env({"series": [
        {"series_id": s, "name": n, "short_name": sn, "demand_class": c,
         "adi": adi, "cv2": cv2, "daily_mean": dm, "zero_day_pct": z,
         "peak_month": pm, "unit": "units"}
        for s, n, sn, c, adi, cv2, dm, z, pm in SERIES]}))

    history = weekly_history(187.0, 0.22)
    dump("history.json", env({"series_id": "N02BE", "grain": "week", "points": history}))

    forecast = weekly_forecast(187.0, 0.16)
    dump("forecast.json", env({
        "series_id": "N02BE", "grain": "week", "cutoff": "2019-09-29", "horizon": 8,
        "calibrated": True, "max_horizon": 75, "points": forecast,
        "history": [{"ds": p["ds"], "y": p["y"]} for p in history],
        "members": [
            {"model": "Prophet",
             "p50": [round(p["q"]["0.50"] * 1.01, 1) for p in forecast]},
            {"model": "AutoARIMA",
             "p50": [round(p["q"]["0.50"] * 0.97, 1) for p in forecast]},
            {"model": "MSTL",
             "p50": [round(p["q"]["0.50"] * 1.03, 1) for p in forecast]},
            {"model": "SeasonalNaive",
             "p50": [round(p["q"]["0.50"] * 0.94, 1) for p in forecast]},
            {"model": "LightGBM",
             "p50": [round(p["q"]["0.50"] * 1.05, 1) for p in forecast]},
        ],
    }))

    stock_on_hand, pack = 40.0, 10
    cu = 4.0
    co = 12.5 * 0.22 * (4 / 365) + 12.5 * 0.015
    curve = build_cost_curve(stock_on_hand, pack, cu, co)
    cheapest = min(curve, key=lambda c: c["expected_cost"])
    dump("recommend.json", env({
        "series_id": "N02BE", "status": "order_now",
        "q_star": round(cu / (cu + co), 3), "service_level_used": 0.95,
        "lead_time_demand": LEAD_TIME_Q,
        "target_level": 168.0, "stock_on_hand": stock_on_hand,
        "order_units": 128.0, "order_packs": 13, "order_quantity": 130,
        "reorder_point": 152.0, "days_of_cover": 1.3,
        "projected_stockout_date": "2019-10-03", "p_stockout": 0.05,
        "expected_cost": {"at_order": 1240.5, "minus_one_pack": 1291.0,
                          "plus_one_pack": 1265.2},
        "cost_curve": curve,
        "min_cost_service_level": cheapest["service_level"],
        "inputs_used": [
            {"name": "forecast distribution", "value": "21 calibrated quantiles",
             "lane": "observed"},
            {"name": "lead time", "value": "4 days", "lane": "user_setting"},
            {"name": "stock on hand", "value": "40 units", "lane": "user_setting"},
            {"name": "pack size", "value": "10 units", "lane": "user_setting"},
            {"name": "unit margin", "value": "INR 4.00", "lane": "user_setting"},
        ],
    }))

    dump("risk.json", env({
        "total_exposure": 18400.0, "currency": "INR", "items": [
            {"series_id": "N02BE", "type": "stockout", "severity": "high",
             "probability": 0.62, "exposure": 9800.0,
             "headline": "Paracetamol runs out Thursday, delivery lands Friday",
             "detail": "Cover 1.3 days against a 4-day lead time.",
             "recommended_action": "order_now", "recommended_quantity": 130},
            {"series_id": "R06", "type": "stockout", "severity": "medium",
             "probability": 0.41, "exposure": 4300.0,
             "headline": "Antihistamines: pollen season starts inside the lead time",
             "detail": "The May peak is 1.73x the annual mean. Order early.",
             "recommended_action": "order_early", "recommended_quantity": 60},
            {"series_id": "M01AB", "type": "overstock", "severity": "medium",
             "probability": 0.78, "exposure": 2600.0,
             "headline": "Diclofenac has 41 days of cover",
             "detail": "Capital tied up against a 7-day review period.",
             "recommended_action": "do_not_order", "recommended_quantity": 0},
            {"series_id": "N05C", "type": "anomaly", "severity": "low",
             "probability": 0.30, "exposure": 1700.0,
             "headline": "Sedatives: last week fell outside the 95% interval",
             "detail": "Intermittent series; one observation outside the band is "
                       "expected 1 week in 20.",
             "recommended_action": "watch", "recommended_quantity": 0},
        ],
    }))

    dump("explain.json", env({
        "series_id": "R06", "headline": "R06 is up 41 units next month",
        "total_change_units": 41.0, "baseline_units": 58.0,
        "components": [
            {"name": "seasonality", "units": 28.0,
             "detail": "May pollen season, 1.73x annual mean"},
            {"name": "trend", "units": 9.0,
             "detail": "underlying level, rising since 2018"},
            {"name": "holiday", "units": 4.0,
             "detail": "calendar effects including the 1 May closure"},
        ],
        "decomposition": {
            "ds": ["2019-01-01", "2019-02-01", "2019-03-01", "2019-04-01", "2019-05-01"],
            "trend": [54.0, 55.2, 56.6, 58.0, 60.1],
            "yearly": [-12.0, -8.0, 4.0, 16.0, 28.0],
            "holidays": [2.0, 0.0, 0.0, 1.0, 4.0],
        },
        "shap_top": [
            {"feature": "lag_52", "contribution": 12.4},
            {"feature": "fourier_sin_1", "contribution": 9.8},
            {"feature": "roll_mean_13", "contribution": 5.1},
            {"feature": "month", "contribution": 3.9},
            {"feature": "days_to_holiday", "contribution": 1.2},
        ],
        "calibration": {
            "before": [{"nominal": 0.50, "achieved": 0.44},
                       {"nominal": 0.80, "achieved": 0.75},
                       {"nominal": 0.90, "achieved": 0.83},
                       {"nominal": 0.95, "achieved": 0.88}],
            "after": [{"nominal": 0.50, "achieved": 0.51},
                      {"nominal": 0.80, "achieved": 0.79},
                      {"nominal": 0.90, "achieved": 0.90},
                      {"nominal": 0.95, "achieved": 0.94}],
            "n_points": 256,
        },
    }))

    with open(os.path.join(ART, "benchmarks.json"), "w", encoding="utf-8") as fh:
        json.dump(BENCHMARKS, fh, indent=2)

    dump("metrics.json", env({
        "benchmarks": BENCHMARKS,
        "runtime": {"p50_ms": 41, "p95_ms": 180, "cache_hit_rate": 0.82,
                    "rss_mb": 312, "cost_per_1k_forecasts_inr": 0.7,
                    "uptime_s": 8100, "ladder_rung": 1},
    }))

    dump("settings.json", env({
        "lead_time_days": 4, "holding_cost_rate": 0.22, "expiry_risk_rate": 0.015,
        "review_period_days": 7, "currency": "INR", "service_level_default": 0.95,
        "per_series": {
            s: {"pack_size": 10, "unit_cost": 12.5, "unit_margin": 4.0,
                "stock_on_hand": round(dm * 3, 1)}
            for s, _n, _sn, _c, _adi, _cv2, dm, _z, _pm in SERIES
        },
    }))

    dump("health.json", env({
        "status": "ok", "ladder_rung": 1, "forecast_store": "present",
        "model_version": META["model_version"], "stale": False,
    }))

    print("wrote", len(os.listdir(OUT)), "fixtures to", OUT)
    print("wrote", os.path.join(ART, "benchmarks.json"))


if __name__ == "__main__":
    main()
