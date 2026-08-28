"""Cutoff-aware feature construction.

The one non-negotiable rule in this file: every feature is computed using ONLY
rows at or before an explicit `cutoff`. The frame is truncated as the first
operation, which makes the guarantee structural rather than a review convention.

Look-ahead leakage is the most common defect in forecasting pipelines and the
hardest to notice afterwards, because it produces results that look excellent.
tests/unit/test_no_leakage.py asserts that a feature value at time t is identical
whether or not rows after t exist in the input.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

LAGS = [1, 2, 3, 4, 8, 52]
ROLLING_WINDOWS = [4, 13, 52]
FOURIER_K = 3

SEASONAL_PERIOD = {"day": 365.25, "week": 52.1775, "month": 12.0}


def _fourier_terms(ds: pd.Series, grain: str, k: int = FOURIER_K) -> pd.DataFrame:
    """Annual seasonality as a smooth basis of arbitrary phase.

    Per-series coefficients are fitted downstream; the basis itself is shared.
    Fourier terms are used because the annual peak lands in a different month
    for every drug group (R06 in May, N02BE in January, R03 in December), and a
    basis of arbitrary phase can fit all of them.
    """
    period = SEASONAL_PERIOD[grain]
    if grain == "day":
        t = ds.dt.dayofyear.to_numpy(dtype=float)
    elif grain == "week":
        t = ds.dt.isocalendar().week.to_numpy(dtype=float)
    else:
        t = ds.dt.month.to_numpy(dtype=float)

    out = {}
    for i in range(1, k + 1):
        angle = 2.0 * np.pi * i * t / period
        out[f"fourier_sin_{i}"] = np.sin(angle)
        out[f"fourier_cos_{i}"] = np.cos(angle)
    return pd.DataFrame(out, index=ds.index)


def build_features(gold: pd.DataFrame,
                   cutoff: str | pd.Timestamp,
                   grain: str = "week") -> pd.DataFrame:
    """One row per (series_id, ds) with every feature computed as of `cutoff`.

    Args:
        gold: gold rows for a single grain. Extra rows after `cutoff` are
              discarded before anything is computed - this is the guarantee.
        cutoff: last observation the features are allowed to see.
        grain: 'day' | 'week' | 'month'.
    """
    cutoff = pd.Timestamp(cutoff)
    df = gold.copy()
    df["ds"] = pd.to_datetime(df["ds"])

    # THE guarantee. Truncate first, compute second. Everything below this line
    # is arithmetic on a frame that cannot contain the future.
    df = df[df["ds"] <= cutoff].sort_values(["series_id", "ds"]).reset_index(drop=True)
    if df.empty:
        raise ValueError(f"no rows at or before cutoff {cutoff.date()}")

    grouped = df.groupby("series_id", sort=False)["y"]

    for lag in LAGS:
        df[f"lag_{lag}"] = grouped.shift(lag)

    for window in ROLLING_WINDOWS:
        shifted = grouped.shift(1)                      # never include today
        roll = shifted.groupby(df["series_id"], sort=False).rolling(window, min_periods=2)
        df[f"roll_mean_{window}"] = roll.mean().reset_index(level=0, drop=True)
        df[f"roll_std_{window}"] = roll.std().reset_index(level=0, drop=True)

    df["expanding_mean"] = (grouped.shift(1)
                            .groupby(df["series_id"], sort=False)
                            .expanding(min_periods=2).mean()
                            .reset_index(level=0, drop=True))

    df["woy"] = df["ds"].dt.isocalendar().week.astype(int)
    df["month"] = df["ds"].dt.month
    df["quarter"] = df["ds"].dt.quarter
    df["dow"] = df["ds"].dt.dayofweek

    df = pd.concat([df, _fourier_terms(df["ds"], grain)], axis=1)

    for col in ("is_closed", "is_outlier"):
        if col not in df.columns:
            df[col] = False
        df[col] = df[col].astype(bool)

    df["cutoff"] = cutoff
    df["series_id"] = df["series_id"].astype("category")

    return df.reset_index(drop=True)


def feature_columns(df: pd.DataFrame) -> list[str]:
    """The columns a model is allowed to consume.

    Deliberately excludes `price` and `promotion` by construction: no such
    column exists in this dataset, so a fitted coefficient on a generated one
    would describe noise - and the explainability screen would then present
    that noise to a buyer as a commercial driver.
    """
    exclude = {"y", "ds", "grain", "origin", "snapshot_id", "completeness",
               "cutoff", "days_present"}
    banned = {"price", "promotion"}
    return [c for c in df.columns if c not in exclude and c not in banned]


def write_features(features: pd.DataFrame,
                   out_root: str = "data/warehouse/features",
                   grain: str = "week") -> None:
    from pathlib import Path
    target = Path(out_root) / f"grain={grain}"
    target.mkdir(parents=True, exist_ok=True)
    out = features.copy()
    out["series_id"] = out["series_id"].astype(str)
    out.to_parquet(target / "part.parquet", index=False, compression="zstd")
