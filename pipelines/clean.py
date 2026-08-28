"""Clean: mark closures and outliers. Never alter y.

Two rules this module exists to enforce:

Closures are masked, not imputed and not deleted. Imputation would invent demand
that did not occur; deletion would leave a gap a seasonal model reads as a
missing period. Marking the state represents the fact accurately - demand is
unobserved, not zero.

Outliers are flagged, never winsorised. The extremes here are real events (the
30-31 December 2016 New Year stock-up, the January 2019 flu peak). Removing them
would remove the behaviour the system exists to anticipate. The flag plus a
calendar feature lets a model attribute the spike to a cause instead of raising
its baseline.
"""

from __future__ import annotations

import pandas as pd

from pipelines.holidays import holiday_flags

OUTLIER_SIGMA = 4.0


def detect_closures(long: pd.DataFrame) -> pd.DatetimeIndex:
    """Days where every series reads exactly zero: the shop was shut.

    Expect 26 such days in this dataset, 21 of which map to the Serbian
    Orthodox calendar.
    """
    per_day = long.groupby("ds")["y"].agg(["sum", "count"])
    n_series = long["series_id"].nunique()
    closed = per_day[(per_day["sum"] == 0) & (per_day["count"] == n_series)]
    return pd.DatetimeIndex(closed.index)


def flag_outliers(long: pd.DataFrame, sigma: float = OUTLIER_SIGMA) -> pd.Series:
    """Per-series |y - mean| > sigma * std, computed on non-closure days only."""
    open_rows = long[~long["is_closed"]]
    stats = open_rows.groupby("series_id")["y"].agg(["mean", "std"])
    merged = long.merge(stats, left_on="series_id", right_index=True, how="left")
    deviation = (merged["y"] - merged["mean"]).abs()
    threshold = sigma * merged["std"].fillna(0.0)
    flags = (deviation > threshold) & (~long["is_closed"].to_numpy())
    return pd.Series(flags.to_numpy(), index=long.index, name="is_outlier")


def clean(long: pd.DataFrame) -> pd.DataFrame:
    """Add is_closed, is_outlier, is_holiday, days_to_holiday. y is untouched."""
    df = long.copy()
    df["ds"] = pd.to_datetime(df["ds"])

    closures = detect_closures(df)
    df["is_closed"] = df["ds"].isin(closures)

    df["is_outlier"] = flag_outliers(df)

    flags = holiday_flags(pd.Series(sorted(df["ds"].unique())))
    df = df.merge(flags, on="ds", how="left")
    df["is_holiday"] = df["is_holiday"].fillna(False).astype(bool)
    df["days_to_holiday"] = df["days_to_holiday"].fillna(99).astype(int)

    return df.sort_values(["series_id", "ds"]).reset_index(drop=True)


def summarise(df: pd.DataFrame) -> dict:
    """Numbers worth printing at the end of a run, and asserting in tests."""
    closed_days = int(df.loc[df["is_closed"], "ds"].nunique())
    return {
        "rows": len(df),
        "series": int(df["series_id"].nunique()),
        "days": int(df["ds"].nunique()),
        "closed_days": closed_days,
        "outlier_rows": int(df["is_outlier"].sum()),
        "holiday_days": int(df.loc[df["is_holiday"], "ds"].nunique()),
        "first_ds": str(df["ds"].min().date()),
        "last_ds": str(df["ds"].max().date()),
    }
