"""LightGBM, global, quantile objective.

The only member that learns structure SHARED ACROSS PRODUCTS. A winter illness
period lifts several drug groups together; a per-series model cannot observe
that because it never sees the other series. With series_id as a categorical
feature the model still expresses per-product behaviour - including the
opposite-signed weekday effects - while pooling everything else.

It is also the only member whose cost does not grow with product count. Fitting
one model per series is O(series) and dies at scale; one global model is not.
That is an architecture decision, not a modelling preference.

Trained under the pinball (quantile) loss, so it estimates each quantile from
the data rather than deriving an interval from an assumed error distribution -
which matters because demand is a non-negative count with an asymmetric right
tail, not a Gaussian.
"""

from __future__ import annotations

import warnings

import numpy as np
import pandas as pd

from pipelines.features import build_features, feature_columns

warnings.filterwarnings("ignore", category=UserWarning)

SEED = 42

LGBM_PARAMS = dict(
    objective="quantile",
    n_estimators=300,
    learning_rate=0.05,
    num_leaves=15,
    min_child_samples=15,
    subsample=0.9,
    subsample_freq=1,
    colsample_bytree=0.9,
    verbose=-1,
    random_state=SEED,
    n_jobs=1,
)


def _future_frame(train: pd.DataFrame, h: int, grain: str) -> pd.DataFrame:
    """Empty rows for the h future periods, one per series."""
    freq = {"day": "D", "week": "W-MON", "month": "MS"}[grain]
    last = pd.Timestamp(train["ds"].max())
    future_ds = pd.date_range(last, periods=h + 1, freq=freq)[1:]

    rows = []
    for sid in sorted(train["series_id"].unique()):
        for i, ds in enumerate(future_ds, start=1):
            rows.append({"series_id": sid, "ds": ds, "y": np.nan, "horizon": i})
    return pd.DataFrame(rows)


def fit_predict(train: pd.DataFrame, h: int, grain: str = "week",
                quantiles: list[float] | None = None) -> pd.DataFrame:
    """Fit one global model per quantile and forecast h steps.

    Returns a long frame: series_id, ds, model, value, quantile.
    Recursive multi-step: each predicted period is appended to the history so
    the next step's lags are available. Features are always rebuilt with an
    explicit cutoff, so no future value can enter.
    """
    from lightgbm import LGBMRegressor

    quantiles = quantiles or [0.5]
    history = train[["series_id", "ds", "y", "is_closed", "is_outlier"]].copy()
    history["ds"] = pd.to_datetime(history["ds"])

    cutoff = history["ds"].max()
    feats = build_features(history, cutoff=cutoff, grain=grain)
    cols = [c for c in feature_columns(feats) if c not in ("is_closed", "is_outlier")]

    fitted = feats.dropna(subset=["lag_1", "roll_mean_4"])
    if len(fitted) < 50:
        return pd.DataFrame(columns=["series_id", "ds", "model", "value", "quantile"])

    X = fitted[cols].copy()
    X["series_id"] = X["series_id"].astype("category")
    y = fitted["y"].astype(float)

    models = {}
    for q in quantiles:
        m = LGBMRegressor(alpha=q, **LGBM_PARAMS)
        m.fit(X, y, categorical_feature=["series_id"])
        models[q] = m

    out = []
    for q, model in models.items():
        rolling = history.copy()
        for step in range(1, h + 1):
            fut = _future_frame(rolling, 1, grain)
            combined = pd.concat(
                [rolling[["series_id", "ds", "y", "is_closed", "is_outlier"]],
                 fut.assign(is_closed=False, is_outlier=False)[
                     ["series_id", "ds", "y", "is_closed", "is_outlier"]]],
                ignore_index=True)

            step_cutoff = combined["ds"].max()
            f = build_features(combined, cutoff=step_cutoff, grain=grain)
            target = f[f["ds"] == step_cutoff]

            Xp = target[cols].copy()
            Xp["series_id"] = pd.Categorical(Xp["series_id"], categories=X["series_id"].cat.categories)
            pred = np.clip(model.predict(Xp), 0.0, None)

            for sid, ds, v in zip(target["series_id"].astype(str), target["ds"], pred):
                out.append({"series_id": sid, "ds": ds, "model": "LightGBM",
                            "value": float(v), "quantile": q, "horizon": step})

            appended = target[["series_id", "ds"]].copy()
            appended["series_id"] = appended["series_id"].astype(str)
            appended["y"] = pred
            appended["is_closed"] = False
            appended["is_outlier"] = False
            rolling = pd.concat([rolling, appended], ignore_index=True)

    return pd.DataFrame(out)
