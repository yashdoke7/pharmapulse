"""Combination: median across members, then enforce monotonicity.

We combine, we do not select.

The failure mode we protect against is one member misfitting badly on one
period - an extrapolating trend, a mis-detected changepoint. A mean carries
that error into the result in proportion to its size; a median does not.

Independent models make independent mistakes, and the median cancels them.
Where weights are used they are BOUNDED to [0.05, 0.40], because unbounded
weighting converges toward selecting one method - which is the strategy the
ablation exists to rule out.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

WEIGHT_FLOOR = 0.05
WEIGHT_CEILING = 0.40

ENSEMBLE_MEMBERS = ["Prophet", "AutoARIMA", "MSTL", "SeasonalNaive", "LightGBM"]
ENSEMBLE_NAME = "Ensemble"


def combine_point(predictions: pd.DataFrame,
                  members: list[str] | None = None,
                  name: str = ENSEMBLE_NAME) -> pd.DataFrame:
    """Median across members at each (series_id, ds).

    Args:
        predictions: long frame with series_id, ds, model, value.
        members: which models to combine. Missing ones are skipped, and the
                 set actually used is recorded on the result.
    """
    members = members or ENSEMBLE_MEMBERS
    present = [m for m in members if m in set(predictions["model"].unique())]
    if not present:
        raise ValueError(f"none of {members} present in predictions")

    subset = predictions[predictions["model"].isin(present)]
    combined = (subset.groupby(["series_id", "ds"], observed=True)["value"]
                .median().reset_index())
    combined["model"] = name
    combined["value"] = combined["value"].clip(lower=0.0)
    combined.attrs["members_used"] = present
    return combined


def combine_quantiles(predictions: pd.DataFrame,
                      members: list[str] | None = None) -> pd.DataFrame:
    """Median across members AT EACH QUANTILE LEVEL, then sort.

    Taking medians independently at each level does not by itself preserve
    ordering, and an unordered quantile set is not a distribution - so the sort
    is not cosmetic, it is what makes the output valid.
    """
    members = members or ENSEMBLE_MEMBERS
    present = [m for m in members if m in set(predictions["model"].unique())]
    subset = predictions[predictions["model"].isin(present)]

    combined = (subset.groupby(["series_id", "ds", "quantile"], observed=True)["value"]
                .median().reset_index())
    combined = enforce_monotonic(combined)
    combined["model"] = ENSEMBLE_NAME
    combined.attrs["members_used"] = present
    return combined


def enforce_monotonic(quantiles: pd.DataFrame) -> pd.DataFrame:
    """Quantile values must be non-decreasing in the quantile level, and >= 0."""
    df = quantiles.sort_values(["series_id", "ds", "quantile"]).copy()
    df["value"] = (df.groupby(["series_id", "ds"], observed=True)["value"]
                   .cummax())
    df["value"] = df["value"].clip(lower=0.0)
    return df.reset_index(drop=True)


def bounded_weights(per_series_mase: pd.DataFrame) -> pd.DataFrame:
    """Inverse-MASE weights, clipped to [0.05, 0.40] and renormalised.

    Not used by default - members are weighted equally. Kept because the bound
    is the point: it is what stops weighting from collapsing into selection.
    """
    df = per_series_mase.copy()
    df["raw"] = 1.0 / df["mase"].clip(lower=1e-6)
    df["w"] = df.groupby("series_id", observed=True)["raw"].transform(lambda s: s / s.sum())
    df["w"] = df["w"].clip(WEIGHT_FLOOR, WEIGHT_CEILING)
    df["w"] = df.groupby("series_id", observed=True)["w"].transform(lambda s: s / s.sum())
    return df[["series_id", "model", "w"]]


def quantiles_from_point(point: pd.DataFrame, spread: pd.Series,
                         quantile_levels: list[float]) -> pd.DataFrame:
    """Expand a point forecast into quantiles with a per-series spread."""
    from scipy.stats import norm

    rows = []
    for _, r in point.iterrows():
        sd = float(spread.get(r["series_id"], 1.0))
        h = float(r.get("horizon", 1) or 1)
        scale = sd * np.sqrt(max(h, 1.0))
        for q in quantile_levels:
            rows.append({
                "series_id": r["series_id"], "ds": r["ds"], "quantile": q,
                "value": max(0.0, float(r["value"]) + norm.ppf(q) * scale),
                "horizon": r.get("horizon", 1),
            })
    return enforce_monotonic(pd.DataFrame(rows))
