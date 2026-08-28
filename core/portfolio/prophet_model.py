"""Prophet: decomposition with explicit, named calendar effects.

The only member that treats a holiday as a FIRST-CLASS OBJECT with its own
fitted coefficient and an asymmetric window, rather than as an anonymous dummy.
That matches the observed behaviour of stock-up before a closure and suppressed
demand after it.

It is also the only member that exposes trend, annual seasonality and each
holiday as separate additive quantities IN THE UNITS OF THE SERIES. That
decomposition is the direct input to the explainability screen - choosing
Prophet means the explanation is derived from the model rather than
approximated after the fact.

The import is guarded. Prophet pulls cmdstanpy and can fail to install; if it
is unavailable the ensemble runs on four members and benchmarks.json records
which members were present. We never silently ship a different ensemble than
the one on the slide.
"""

from __future__ import annotations

import logging
import pathlib
import warnings

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
logging.getLogger("prophet").setLevel(logging.ERROR)
logging.getLogger("cmdstanpy").setLevel(logging.ERROR)

def _repair_cmdstan() -> None:
    """Work around a prophet 1.1.6 / cmdstanpy 1.3 packaging mismatch.

    The wheel ships a PRECOMPILED prophet_model.bin, so nothing needs to be
    built - but cmdstanpy's validate_cmdstan_path() refuses a cmdstan
    directory with no `makefile` in it, and the wheel does not include one.
    The result is an import that succeeds and a fit that dies with
    "'Prophet' object has no attribute 'stan_backend'".

    Creating the placeholder makes the install self-healing, so a fresh
    `pip install -r requirements.txt` or a Docker build works with no manual
    step. Safe to run repeatedly.
    """
    try:
        import prophet as _p
        root = pathlib.Path(_p.__file__).parent / "stan_model"
        for cmdstan_dir in root.glob("cmdstan-*"):
            makefile = cmdstan_dir / "makefile"
            if cmdstan_dir.is_dir() and not makefile.exists():
                note = (
                    "# Placeholder. prophet ships a precompiled "
                    "prophet_model.bin, so no compilation happens here; "
                    "cmdstanpy only validates that this file exists."
                    + chr(10)
                    + "# Created by core/portfolio/prophet_model.py"
                    + chr(10)
                )
                makefile.write_text(note, encoding="utf-8")
    except Exception:
        pass


try:
    _repair_cmdstan()
    from prophet import Prophet
    from prophet.models import CmdStanPyBackend

    CmdStanPyBackend()          # fail here rather than mid-backtest
    PROPHET_AVAILABLE = True
except Exception:  # pragma: no cover - environment dependent
    Prophet = None
    PROPHET_AVAILABLE = False

FREQ = {"day": "D", "week": "W-MON", "month": "MS"}


def _holiday_frame(grain: str) -> pd.DataFrame:
    """Named holidays with asymmetric windows.

    lower_window=-2 / upper_window=1 encodes the stock-up before a closure and
    the suppressed demand after it. At weekly and monthly grain the window is
    collapsed, because a holiday lands inside a single bucket.
    """
    from pipelines.holidays import load_calendar

    cal = load_calendar()
    out = cal.rename(columns={"ds": "ds", "holiday": "holiday"})[["holiday", "ds"]].copy()
    if grain == "day":
        out["lower_window"] = -2
        out["upper_window"] = 1
    else:
        out["ds"] = (out["ds"].dt.to_period("W").dt.start_time if grain == "week"
                     else out["ds"].dt.to_period("M").dt.start_time)
        out["lower_window"] = 0
        out["upper_window"] = 0
        out = out.drop_duplicates(subset=["holiday", "ds"])
    return out


def fit_predict(train: pd.DataFrame, h: int, grain: str = "week",
                with_components: bool = False):
    """Fit Prophet per series and forecast h steps.

    Returns a long frame (series_id, ds, model, value); when with_components is
    set, also returns a components frame carrying trend / yearly / holidays in
    units, which is what the attribution engine consumes.
    """
    empty = pd.DataFrame(columns=["series_id", "ds", "model", "value"])
    if not PROPHET_AVAILABLE:
        return (empty, pd.DataFrame()) if with_components else empty

    # Holidays are fitted at daily and weekly grain, where a named event lands
    # in its own bucket and a per-holiday coefficient is identifiable.
    #
    # At MONTHLY grain they are dropped: every holiday falls in the same month
    # every year, so its effect is collinear with the annual seasonal term, and
    # fitting ~14 holiday coefficients on 70 monthly observations attributes
    # large swings to the calendar that belong to the season. That showed up
    # directly on the explainability screen as a +34-unit holiday effect on a
    # 104-unit baseline.
    holidays = _holiday_frame(grain) if grain != "month" else None
    yearly = 10 if grain in ("day", "week") else 4

    preds, comps = [], []
    for sid, grp in train.groupby("series_id", observed=True):
        hist = (grp[["ds", "y"]].sort_values("ds")
                .rename(columns={"ds": "ds", "y": "y"}).copy())
        hist["ds"] = pd.to_datetime(hist["ds"])
        if len(hist) < 30:
            continue

        m = Prophet(
            growth="linear",
            yearly_seasonality=yearly,
            weekly_seasonality=(grain == "day"),
            daily_seasonality=False,
            holidays=holidays,
            seasonality_mode="additive",
            changepoint_prior_scale=0.05,
            interval_width=0.8,
        )
        try:
            m.fit(hist)
        except Exception:
            continue

        future = m.make_future_dataframe(periods=h, freq=FREQ[grain])
        fc = m.predict(future)

        tail = fc.tail(h)
        for ds, yhat in zip(tail["ds"], tail["yhat"]):
            preds.append({"series_id": sid, "ds": ds, "model": "Prophet",
                          "value": max(0.0, float(yhat))})

        if with_components:
            keep = ["ds", "trend", "yhat"]
            for c in ("yearly", "holidays", "weekly"):
                if c in fc.columns:
                    keep.append(c)
            piece = fc[keep].copy()
            piece["series_id"] = sid
            comps.append(piece)

    out = pd.DataFrame(preds) if preds else empty
    if with_components:
        return out, (pd.concat(comps, ignore_index=True) if comps else pd.DataFrame())
    return out


def components_for(series_id: str, history: pd.DataFrame, h: int,
                   grain: str = "month") -> pd.DataFrame:
    """Trend / yearly / holiday decomposition for one series, in units."""
    one = history[history["series_id"] == series_id]
    _, comps = fit_predict(one, h=h, grain=grain, with_components=True)
    return comps
