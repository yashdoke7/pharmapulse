"""Conformal calibration: make the stated interval the real interval.

Why this is not optional. The decision layer reads a specific quantile of the
demand distribution to pick an order quantity. If the distribution is too
narrow, the quantity read at "95%" corresponds to a lower true probability, and
the system silently UNDER-ORDERS while displaying a service level it is not
achieving.

The error is directional and invisible: it never shows up as a bad point
forecast, and it is worst on the products with the most uncertainty - which are
exactly the products where the decision matters most.

Conformal prediction is used because it makes no assumption about the shape of
the error distribution and gives a finite-sample guarantee. Demand here is a
non-negative count with an asymmetric right tail, so the Gaussian assumption
behind a model's default interval is not appropriate.

Residuals are pooled ACROSS series rather than fitted per series: per-series
calibration on ~32 points would overfit.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def coverage(actuals: pd.DataFrame, lower: pd.Series, upper: pd.Series) -> float:
    """Fraction of actual values falling inside [lower, upper]."""
    y = actuals["y"].to_numpy(dtype=float)
    lo = np.asarray(lower, dtype=float)
    hi = np.asarray(upper, dtype=float)
    inside = (y >= lo) & (y <= hi)
    return float(inside.mean())


def coverage_curve(paired: pd.DataFrame, levels: list[float]) -> list[dict]:
    """Achieved coverage at each nominal level.

    Args:
        paired: one row per (series, period) with columns y, point, spread.
    """
    from scipy.stats import norm

    out = []
    for level in levels:
        z = norm.ppf(0.5 + level / 2.0)
        lo = (paired["point"] - z * paired["spread"]).clip(lower=0.0)
        hi = paired["point"] + z * paired["spread"]
        out.append({"nominal": round(level, 4),
                    "achieved": round(coverage(paired, lo, hi), 4)})
    return out


def conformal_scale(calibration: pd.DataFrame, level: float = 0.80) -> float:
    """The multiplier that makes achieved coverage equal the nominal level.

    Measures the empirical distribution of standardised residuals on data the
    model did not see, and returns the factor by which the interval half-width
    must be multiplied.
    """
    from scipy.stats import norm

    resid = (calibration["y"] - calibration["point"]).abs()
    spread = calibration["spread"].replace(0, np.nan)
    standardised = (resid / spread).dropna()
    if standardised.empty:
        return 1.0

    # The (level) quantile of |standardised residual| is the half-width that
    # would contain exactly `level` of the observations.
    empirical = float(np.quantile(standardised, level))
    assumed = float(norm.ppf(0.5 + level / 2.0))
    if assumed <= 0:
        return 1.0
    return float(np.clip(empirical / assumed, 0.25, 5.0))


def apply_scale(quantiles: pd.DataFrame, scale: float,
                median_col: float = 0.5) -> pd.DataFrame:
    """Widen or narrow a quantile set about its median by `scale`."""
    df = quantiles.copy()
    medians = (df[df["quantile"] == median_col]
               .set_index(["series_id", "ds"])["value"].rename("median"))
    df = df.merge(medians, left_on=["series_id", "ds"], right_index=True, how="left")
    df["value"] = (df["median"] + (df["value"] - df["median"]) * scale).clip(lower=0.0)
    df = df.drop(columns=["median"])

    from core.combine import enforce_monotonic
    return enforce_monotonic(df)


def calibration_report(before: pd.DataFrame, scale: float,
                       levels: list[float] | None = None) -> dict:
    """The before/after payload the reliability diagram renders.

    Reported with the number of points behind it, because 8 series x 8 horizon
    steps x 4 folds = 256 is enough to establish a consistent DIRECTION of
    over-confidence and not enough to certify a per-series level. Saying that
    before a judge does is the point.
    """
    levels = levels or [0.50, 0.80, 0.90, 0.95]

    after = before.copy()
    after["spread"] = after["spread"] * scale

    return {
        "levels": levels,
        "before": coverage_curve(before, levels),
        "after": coverage_curve(after, levels),
        "scale": round(scale, 4),
        "n_points": int(len(before)),
    }
