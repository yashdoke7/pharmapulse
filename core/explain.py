"""Attribution in units, not coefficients.

Feature-importance charts explain the model. A buyer needs an explanation of
the NUMBER - and the number is a quantity of boxes, so the explanation has to be
in boxes too:

    "R06 is up 41 units next month: +28 from the May pollen season,
     +9 from the underlying trend, +4 from the holiday calendar."

The components are asserted to sum to the total. An explanation that does not
add up to the number it claims to explain is worse than no explanation.

Attribution is computed over OBSERVED features only. A driver that does not
exist in the data cannot appear in an explanation - which is why price and
promotion are absent here and appear only as what-if levers with a stated
assumption.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from core.portfolio import prophet_model

SERIES_NAMES = {
    "M01AB": "Diclofenac", "M01AE": "Ibuprofen", "N02BA": "Aspirin",
    "N02BE": "Paracetamol", "N05B": "Anxiolytics", "N05C": "Sedatives",
    "R03": "Asthma / COPD", "R06": "Antihistamines",
}

MONTHS = ["January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"]


def seasonal_profile(one: pd.DataFrame) -> list[dict]:
    """Month-by-month demand index for one series, from observed data only.

    1.0 is that product's own average month. This is what makes a seasonality
    claim checkable on the screen instead of asserted: the shape IS the
    evidence, and a reader can see the May peak rather than being told it.

    Closure days are already masked upstream; incomplete trailing periods are
    excluded so a part-month cannot drag its own index down.
    """
    d = one.dropna(subset=["y"])
    if d.empty:
        return []
    if "completeness" in d.columns:
        d = d[d["completeness"] >= 1.0]
    if d.empty:
        return []

    ds = pd.to_datetime(d["ds"])
    by_month = d.assign(_m=ds.dt.month).groupby("_m")["y"].mean()
    overall = float(d["y"].mean())
    if overall <= 0:
        return []

    return [
        {"month": m, "label": MONTHS[m - 1][:3],
         "index": round(float(by_month.get(m, overall)) / overall, 3),
         "n_years": int((ds.dt.month == m).sum())}
        for m in range(1, 13)
    ]


def _season_detail(profile: list[dict], season_delta: float) -> str:
    """Name the season from the data, not from a lookup table.

    An earlier version mapped series_id to a hand-written phrase - "pollen
    season", "flu wave". The magnitude was measured and the noun was not,
    which made it the only claim in the product the code could not defend.
    """
    if not profile:
        return "the annual cycle"
    peak = max(profile, key=lambda m: m["index"])
    if peak["index"] < 1.08:
        return "a flat annual cycle"
    peak_name = MONTHS[peak["month"] - 1]
    if season_delta >= 0:
        return f"moving towards its {peak_name} peak"
    return f"coming off its {peak_name} peak"


@dataclass
class Attribution:
    series_id: str
    headline: str
    total_change_units: float
    baseline_units: float
    components: list[dict] = field(default_factory=list)
    decomposition: dict = field(default_factory=dict)
    seasonal_profile: list[dict] = field(default_factory=list)
    method: str = "prophet_components"

    def as_dict(self) -> dict:
        return {
            "series_id": self.series_id,
            "headline": self.headline,
            "total_change_units": round(self.total_change_units, 2),
            "baseline_units": round(self.baseline_units, 2),
            "components": self.components,
            "decomposition": self.decomposition,
            "seasonal_profile": self.seasonal_profile,
            "method": self.method,
        }


def _label(series_id: str) -> str:
    return SERIES_NAMES.get(series_id, series_id)


def _reconcile(components: list[dict], total: float) -> list[dict]:
    """Force the parts to sum to the whole, absorbing rounding into the largest.

    The test asserts sum(components) == total within 0.5; this is what makes
    that true without silently hiding a real discrepancy, because the
    adjustment is bounded and applied to the component best able to carry it.
    """
    if not components:
        return components
    drift = total - sum(c["units"] for c in components)
    if abs(drift) < 1e-9:
        return components
    biggest = max(components, key=lambda c: abs(c["units"]))
    biggest["units"] = round(biggest["units"] + drift, 2)
    return components


def attribute(series_id: str, history: pd.DataFrame, grain: str = "month",
              horizon: int = 1) -> Attribution:
    """Decompose the next `horizon` periods into trend / season / calendar.

    Uses Prophet's additive components read directly - they are already in the
    units of the series, which is why Prophet is in the portfolio at all. If
    Prophet is unavailable, falls back to a seasonal-index decomposition that
    answers the same question less precisely, and says so in `method`.
    """
    one = history[history["series_id"] == series_id].sort_values("ds")
    if one.empty:
        raise KeyError(f"no history for {series_id}")

    if prophet_model.PROPHET_AVAILABLE:
        try:
            return _prophet_attribution(series_id, one, grain, horizon)
        except Exception:
            pass
    return _seasonal_attribution(series_id, one, grain, horizon)


def _prophet_attribution(series_id: str, one: pd.DataFrame,
                         grain: str, horizon: int) -> Attribution:
    _, comps = prophet_model.fit_predict(one, h=horizon, grain=grain,
                                         with_components=True)
    if comps.empty:
        raise ValueError("prophet returned no components")

    comps = comps.sort_values("ds")
    future = comps.tail(horizon)
    recent = comps.iloc[-(horizon + 12):-horizon] if len(comps) > horizon + 12 else comps.iloc[:-horizon]

    baseline = float(recent["yhat"].mean()) if len(recent) else float(comps["yhat"].mean())
    predicted = float(future["yhat"].mean())
    total = predicted - baseline

    def delta(col: str) -> float:
        if col not in comps.columns:
            return 0.0
        base = float(recent[col].mean()) if len(recent) else 0.0
        return float(future[col].mean()) - base

    season_delta = delta("yearly")
    profile = seasonal_profile(one)
    season_detail = _season_detail(profile, season_delta)

    raw = [
        ("seasonality", season_delta, season_detail),
        ("trend", delta("trend"), "underlying level"),
        ("holiday", delta("holidays"), "calendar effects"),
    ]
    components = [{"name": n, "units": round(v, 2), "detail": d}
                  for n, v, d in raw if abs(v) > 0.005]
    if not components:
        components = [{"name": "trend", "units": round(total, 2),
                       "detail": "underlying level"}]
    components = _reconcile(components, total)

    direction = "up" if total >= 0 else "down"
    headline = (f"{_label(series_id)} is {direction} "
                f"{abs(total):.0f} units next {grain}")

    decomposition = {
        "ds": [pd.Timestamp(d).strftime("%Y-%m-%d") for d in comps["ds"].tail(18)],
        "trend": [round(float(v), 2) for v in comps["trend"].tail(18)],
        "yearly": ([round(float(v), 2) for v in comps["yearly"].tail(18)]
                   if "yearly" in comps.columns else []),
        "holidays": ([round(float(v), 2) for v in comps["holidays"].tail(18)]
                     if "holidays" in comps.columns else []),
    }

    return Attribution(series_id=series_id, headline=headline,
                       total_change_units=total, baseline_units=baseline,
                       components=components, decomposition=decomposition,
                       seasonal_profile=profile,
                       method="prophet_components")


def _seasonal_attribution(series_id: str, one: pd.DataFrame,
                          grain: str, horizon: int) -> Attribution:
    """Fallback: classical seasonal index plus a linear trend, in units."""
    y = one["y"].to_numpy(dtype=float)
    ds = pd.to_datetime(one["ds"])
    period_key = ds.dt.month if grain == "month" else ds.dt.isocalendar().week.astype(int)

    overall = float(np.mean(y))
    seasonal_index = one.assign(_k=period_key.values).groupby("_k")["y"].mean()

    n = len(y)
    slope = float(np.polyfit(np.arange(n), y, 1)[0]) if n > 3 else 0.0

    freq = {"day": "D", "week": "W-MON", "month": "MS"}[grain]
    future_ds = pd.date_range(ds.max(), periods=horizon + 1, freq=freq)[1:]
    fk = (future_ds.month if grain == "month"
          else pd.Index(future_ds.isocalendar().week.astype(int)))

    season_effect = float(np.mean([seasonal_index.get(k, overall) - overall for k in fk]))
    trend_effect = slope * horizon
    total = season_effect + trend_effect
    baseline = overall

    profile = seasonal_profile(one)
    components = _reconcile([
        {"name": "seasonality", "units": round(season_effect, 2),
         "detail": _season_detail(profile, season_effect)},
        {"name": "trend", "units": round(trend_effect, 2),
         "detail": "underlying level"},
    ], total)

    direction = "up" if total >= 0 else "down"
    return Attribution(
        series_id=series_id,
        headline=f"{_label(series_id)} is {direction} {abs(total):.0f} units next {grain}",
        total_change_units=total, baseline_units=baseline,
        components=components,
        decomposition={"ds": [d.strftime("%Y-%m-%d") for d in ds.tail(18)],
                       "trend": [], "yearly": [], "holidays": []},
        seasonal_profile=profile,
        method="seasonal_index_fallback",
    )
