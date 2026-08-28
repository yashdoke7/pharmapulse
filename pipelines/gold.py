"""Gold: the single interface between the data layer and everything above it.

Contract C1 (contracts/schemas/gold.sql). Weekly and monthly grains are DERIVED
from the daily rows by resampling, never ingested, which makes them agree with
the daily records by construction.

`completeness` is a column rather than a filter, so the truncated final week and
month stay visible in the UI as hatched "partial" bars. A missing bar looks like
the data ends early for an unknown reason; a labelled partial bar is honest.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

GRAINS = ("day", "week", "month")
GOLD_COLUMNS = [
    "series_id", "ds", "grain", "y", "origin",
    "is_closed", "is_outlier", "completeness", "snapshot_id",
]


def _period_start(ds: pd.Series, grain: str) -> pd.Series:
    if grain == "day":
        return ds
    if grain == "week":
        return ds.dt.to_period("W").dt.start_time      # Monday
    if grain == "month":
        return ds.dt.to_period("M").dt.start_time
    raise ValueError(f"unknown grain: {grain}")


def _expected_days(period_start: pd.Series, grain: str) -> pd.Series:
    if grain == "day":
        return pd.Series(1, index=period_start.index)
    if grain == "week":
        return pd.Series(7, index=period_start.index)
    return period_start.dt.days_in_month


def aggregate(clean_daily: pd.DataFrame, grain: str) -> pd.DataFrame:
    """Roll the daily frame up to `grain`, carrying flags and completeness."""
    df = clean_daily.copy()
    df["ds"] = pd.to_datetime(df["ds"])
    df["_period"] = _period_start(df["ds"], grain)

    agg = (df.groupby(["series_id", "_period"])
             .agg(y=("y", "sum"),
                  is_closed=("is_closed", "any"),
                  is_outlier=("is_outlier", "any"),
                  days_present=("ds", "nunique"),
                  snapshot_id=("snapshot_id", "first"),
                  origin=("origin", "first"))
             .reset_index()
             .rename(columns={"_period": "ds"}))

    expected = _expected_days(agg["ds"], grain)
    agg["completeness"] = (agg["days_present"] / expected).clip(upper=1.0).round(6)
    agg["grain"] = grain

    return agg[GOLD_COLUMNS].sort_values(["series_id", "ds"]).reset_index(drop=True)


def build_gold(clean_daily: pd.DataFrame,
               out_root: str | Path = "data/warehouse/gold") -> dict[str, pd.DataFrame]:
    """Write all three grains as partitioned parquet. Returns them keyed by grain."""
    out_root = Path(out_root)
    frames: dict[str, pd.DataFrame] = {}

    for grain in GRAINS:
        frame = aggregate(clean_daily, grain)
        frames[grain] = frame

        target = out_root / f"grain={grain}"
        target.mkdir(parents=True, exist_ok=True)
        for year, chunk in frame.groupby(frame["ds"].dt.year):
            year_dir = target / f"year={year}"
            year_dir.mkdir(parents=True, exist_ok=True)
            chunk.to_parquet(year_dir / "part.parquet", index=False, compression="zstd")

    return frames


def read_gold(grain: str = "week",
              root: str | Path = "data/warehouse/gold",
              observed_only: bool = True) -> pd.DataFrame:
    """Read one grain back. Every consumer above this layer uses this function."""
    root = Path(root) / f"grain={grain}"
    if not root.exists():
        raise FileNotFoundError(
            f"{root} not found - run `make pipeline` (python -m pipelines.run_nightly --stage gold)"
        )
    parts = sorted(root.glob("year=*/part.parquet"))
    if not parts:
        raise FileNotFoundError(f"no parquet parts under {root}")

    df = pd.concat([pd.read_parquet(p) for p in parts], ignore_index=True)
    df["ds"] = pd.to_datetime(df["ds"])
    if observed_only:
        df = df[df["origin"] == "observed"]
    return df.sort_values(["series_id", "ds"]).reset_index(drop=True)


def fitting_frame(grain: str = "week", root: str | Path = "data/warehouse/gold") -> pd.DataFrame:
    """Gold, filtered to what a model is allowed to fit on.

    Excludes partial periods (completeness < 1.0). Closure rows are KEPT and
    carry their flag - masking them from the loss is the model layer's job, and
    deleting them here would leave a gap a seasonal model reads as missing data.
    """
    df = read_gold(grain, root)
    return df[df["completeness"] >= 1.0].reset_index(drop=True)
