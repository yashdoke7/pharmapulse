"""Demand classification: ADI / CV^2, Syntetos-Boylan quadrants.

This is a computed rule, not configuration. Nothing is hardcoded to a series
name - when a product's behaviour changes, its route changes on its own.

Why it exists: at least one series here (N05C) sells nothing on 68% of days.
Averaging-based methods applied to such a series return the mean rate - a flat,
fractional, non-actionable line - because they model a quantity whose most
common value is zero. The methods designed for that case model two separate
processes, the size of a sale and the gap between sales.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict

import numpy as np
import pandas as pd

# Syntetos-Boylan decision boundaries.
ADI_CUTOFF = 1.32
CV2_CUTOFF = 0.49

SMOOTH = "smooth"
INTERMITTENT = "intermittent"
ERRATIC = "erratic"
LUMPY = "lumpy"

ROUTES = {
    SMOOTH: ["Prophet", "AutoARIMA", "MSTL", "SeasonalNaive", "LightGBM"],
    INTERMITTENT: ["CrostonOptimized", "SeasonalNaive", "LightGBM"],
    ERRATIC: ["LightGBM", "MSTL", "SeasonalNaive", "AutoARIMA"],
    LUMPY: ["CrostonOptimized", "LightGBM", "SeasonalNaive"],
}


@dataclass(frozen=True)
class DemandClass:
    series_id: str
    adi: float
    cv2: float
    demand_class: str
    zero_rate: float

    def as_dict(self) -> dict:
        return asdict(self)


def adi_cv2(y: pd.Series | np.ndarray) -> tuple[float, float, float]:
    """Average demand interval, squared coefficient of variation, zero rate.

    ADI  - mean number of periods between non-zero sales.
    CV^2 - squared coefficient of variation of the NON-ZERO quantities, which is
           what separates "erratic sizes" from "irregular timing".
    """
    y = np.asarray(pd.Series(y).astype(float).values)
    n = len(y)
    if n == 0:
        return float("nan"), float("nan"), float("nan")

    nonzero = y[y > 0]
    n_nonzero = len(nonzero)
    zero_rate = 1.0 - (n_nonzero / n)

    if n_nonzero == 0:
        return float("inf"), 0.0, 1.0
    if n_nonzero == 1:
        return float(n), 0.0, zero_rate

    adi = n / n_nonzero
    mean = nonzero.mean()
    cv2 = float((nonzero.std(ddof=1) / mean) ** 2) if mean > 0 else 0.0
    return float(adi), cv2, float(zero_rate)


def classify_one(series_id: str, y: pd.Series) -> DemandClass:
    adi, cv2, zero_rate = adi_cv2(y)

    if adi < ADI_CUTOFF and cv2 < CV2_CUTOFF:
        label = SMOOTH
    elif adi >= ADI_CUTOFF and cv2 < CV2_CUTOFF:
        label = INTERMITTENT
    elif adi < ADI_CUTOFF and cv2 >= CV2_CUTOFF:
        label = ERRATIC
    else:
        label = LUMPY

    return DemandClass(series_id=series_id, adi=round(adi, 4),
                       cv2=round(cv2, 4), demand_class=label,
                       zero_rate=round(zero_rate, 4))


def classify(df: pd.DataFrame) -> pd.DataFrame:
    """Classify every series in a long frame. Recomputed nightly."""
    rows = [classify_one(sid, grp.sort_values("ds")["y"]).as_dict()
            for sid, grp in df.groupby("series_id", observed=True)]
    out = pd.DataFrame(rows).sort_values("series_id").reset_index(drop=True)
    out["models"] = out["demand_class"].map(lambda c: ROUTES[c])
    return out


def eligible_models(demand_class: str) -> list[str]:
    return list(ROUTES.get(demand_class, ROUTES[SMOOTH]))
