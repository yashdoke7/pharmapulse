"""Statistical members, all through one statsforecast API.

Each member represents a DIFFERENT structural assumption about how demand is
generated, and the eight products here do not share one:

  AutoARIMA    short-run dependence - momentum and mean reversion. A
               decomposition model has no mechanism for this.
  MSTL         two overlapping seasonal cycles, non-parametric, with Loess
               down-weighting the outliers we deliberately retained.
  SeasonalNaive the control ("the calendar alone") and a stabiliser that cannot
               extrapolate, diverge, or go negative.
  Croston/TSB  models sale SIZE and GAP separately - the only way to express
               "one unit every three days" for an intermittent series.

statsforecast is Numba-compiled, so the whole portfolio fits in seconds, which
is what makes a full backtest affordable on every commit.
"""

from __future__ import annotations

import warnings

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)

SEASON_LENGTH = {"day": 7, "week": 52, "month": 12}


def _build_models(grain: str, names: list[str] | None = None):
    from statsforecast.models import (
        MSTL,
        AutoARIMA,
        AutoETS,
        CrostonOptimized,
        DynamicOptimizedTheta,
        Naive,
        SeasonalNaive,
        WindowAverage,
    )

    m = SEASON_LENGTH[grain]
    catalogue = {
        "Naive": Naive(),
        "WindowAverage": WindowAverage(window_size=8),
        "SeasonalNaive": SeasonalNaive(season_length=m),
        "AutoETS": AutoETS(season_length=m),
        "DynamicOptimizedTheta": DynamicOptimizedTheta(season_length=m),
        "CrostonOptimized": CrostonOptimized(),
        # Seasonal ARIMA at m=52 is pathological: the order search explores
        # seasonal lags 52 apart on ~300 observations and takes minutes per
        # series without improving accuracy. Weekly annual seasonality is
        # better handled by MSTL and Prophet, which are in the portfolio for
        # exactly that. So ARIMA is fitted NON-seasonally and contributes what
        # only it can - short-run autocorrelation.
        "AutoARIMA": AutoARIMA(season_length=1 if m > 24 else m),
        "MSTL": MSTL(season_length=m),
    }
    if names is None:
        return list(catalogue.values()), list(catalogue.keys())
    chosen = [(n, catalogue[n]) for n in names if n in catalogue]
    return [c for _, c in chosen], [n for n, _ in chosen]


def fit_predict(train: pd.DataFrame, h: int, grain: str = "week",
                models: list[str] | None = None,
                levels: list[float] | None = None,
                n_jobs: int = 1) -> pd.DataFrame:
    """Fit every requested member on `train` and forecast h steps.

    Args:
        train: long frame with series_id, ds, y (training fold only).
        levels: prediction-interval levels as percentages, e.g. [80, 95].

    Returns:
        long frame: series_id, ds, model, value  (+ lo/hi columns when levels
        are requested).
    """
    from statsforecast import StatsForecast

    model_objs, model_names = _build_models(grain, models)
    if not model_objs:
        return pd.DataFrame(columns=["series_id", "ds", "model", "value"])

    freq = {"day": "D", "week": "W-MON", "month": "MS"}[grain]

    sf_input = (train[["series_id", "ds", "y"]]
                .rename(columns={"series_id": "unique_id"})
                .copy())
    sf_input["ds"] = pd.to_datetime(sf_input["ds"])
    sf_input["y"] = sf_input["y"].astype(float)

    sf = StatsForecast(models=model_objs, freq=freq, n_jobs=n_jobs)
    raw = sf.forecast(df=sf_input, h=h, level=levels)

    # statsforecast returns unique_id as the index, not a column.
    if raw.index.name == "unique_id":
        raw = raw.reset_index()
    raw = raw.rename(columns={"unique_id": "series_id"})
    point_cols = [c for c in raw.columns if c in model_names]

    long = raw.melt(id_vars=["series_id", "ds"], value_vars=point_cols,
                    var_name="model", value_name="value")
    long["value"] = long["value"].clip(lower=0.0)   # demand is non-negative

    if levels:
        for name in point_cols:
            for lvl in levels:
                for side in ("lo", "hi"):
                    col = f"{name}-{side}-{lvl}"
                    if col in raw.columns:
                        piece = raw[["series_id", "ds", col]].copy()
                        piece["model"] = name
                        piece = piece.rename(columns={col: f"{side}_{lvl}"})
                        long = long.merge(
                            piece, on=["series_id", "ds", "model"], how="left")
        for c in long.columns:
            if c.startswith(("lo_", "hi_")):
                long[c] = long[c].clip(lower=0.0)

    return long.reset_index(drop=True)


def empirical_quantiles(train: pd.DataFrame, point: pd.DataFrame,
                        quantile_levels: list[float],
                        grain: str = "week") -> pd.DataFrame:
    """Turn a point forecast into quantiles using the spread of in-sample
    seasonal differences.

    Used for members whose native interval is unavailable or unreliable. The
    spread is estimated per series and scaled by sqrt(horizon), because a
    multi-step-ahead error accumulates.
    """
    m = SEASON_LENGTH[grain]
    spreads = {}
    for sid, grp in train.groupby("series_id", observed=True):
        y = grp.sort_values("ds")["y"].to_numpy(dtype=float)
        diffs = y[m:] - y[:-m] if len(y) > m else np.diff(y)
        spreads[sid] = float(np.std(diffs)) if len(diffs) > 1 else 1.0

    from scipy.stats import norm

    out = []
    for (sid, ds), grp in point.groupby(["series_id", "ds"], observed=True):
        mu = float(grp["value"].mean())
        h = int(grp["horizon"].iloc[0]) if "horizon" in grp.columns else 1
        sd = spreads.get(sid, 1.0) * np.sqrt(max(h, 1))
        for q in quantile_levels:
            out.append({"series_id": sid, "ds": ds, "quantile": q,
                        "value": max(0.0, mu + norm.ppf(q) * sd)})
    return pd.DataFrame(out)
