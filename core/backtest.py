"""Rolling-origin backtest and MASE. Build this before any model.

Without a scored baseline you cannot tell whether anything you built helps.

Protocol, fixed and printed on the slide:
    weekly grain, horizon 8, 4 non-overlapping rolling origins, MASE,
    averaged over the 8 series, seed 42.

Why MASE and not MAPE: MAPE divides by the actual value, so on N05C (zero on
68% of days) it is undefined or explosive, and on a category averaging 23 units
a week a five-unit miss reads as a 22% error even though five units is an
excellent forecast. MASE is defined on zeros and comparable across categories
of very different volume.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

SEED = 42
DEFAULT_H = 8
DEFAULT_FOLDS = 4


@dataclass(frozen=True)
class Fold:
    k: int
    cutoff: pd.Timestamp
    train: pd.DataFrame
    test: pd.DataFrame

    def __repr__(self) -> str:
        return (f"Fold(k={self.k}, cutoff={self.cutoff.date()}, "
                f"train={len(self.train)}, test={len(self.test)})")


def make_folds(df: pd.DataFrame, h: int = DEFAULT_H,
               n_folds: int = DEFAULT_FOLDS) -> list[Fold]:
    """Non-overlapping rolling origins ending at the last observation.

    Fold k trains on everything up to its cutoff and is scored on the next h
    periods. No fold ever sees data after its own cutoff.
    """
    df = df.sort_values(["series_id", "ds"]).copy()
    df["ds"] = pd.to_datetime(df["ds"])
    periods = np.array(sorted(df["ds"].unique()))

    needed = h * n_folds
    if len(periods) <= needed + h:
        raise ValueError(
            f"need more than {needed + h} periods for {n_folds} folds at h={h}, "
            f"got {len(periods)}"
        )

    folds: list[Fold] = []
    for k in range(n_folds, 0, -1):
        cutoff_idx = len(periods) - h * k - 1
        cutoff = pd.Timestamp(periods[cutoff_idx])
        test_periods = periods[cutoff_idx + 1: cutoff_idx + 1 + h]
        folds.append(Fold(
            k=n_folds - k + 1,
            cutoff=cutoff,
            train=df[df["ds"] <= cutoff].reset_index(drop=True),
            test=df[df["ds"].isin(test_periods)].reset_index(drop=True),
        ))
    return folds


def mase_denominator(train: pd.DataFrame, m: int = 1) -> pd.Series:
    """In-sample mean absolute m-step difference, per series.

    m=1 is the naive denominator: MASE = 1.0 means "no better than assuming
    next week equals this week". Reported explicitly so the number is
    interpretable rather than merely comparable.
    """
    out = {}
    for sid, grp in train.groupby("series_id", observed=True):
        y = grp.sort_values("ds")["y"].to_numpy(dtype=float)
        if len(y) <= m:
            out[sid] = np.nan
            continue
        d = np.abs(y[m:] - y[:-m])
        out[sid] = float(np.mean(d)) if len(d) else np.nan
    return pd.Series(out, name="denominator")


def score_fold(fold: Fold, predictions: pd.DataFrame, m: int = 1) -> pd.DataFrame:
    """MASE per (series_id, model) for one fold.

    Args:
        predictions: long frame with columns series_id, ds, model, value.
    """
    denom = mase_denominator(fold.train, m=m)
    actual = fold.test[["series_id", "ds", "y"]]

    merged = predictions.merge(actual, on=["series_id", "ds"], how="inner")
    if merged.empty:
        raise ValueError("predictions do not overlap the test window")

    merged["abs_error"] = (merged["value"] - merged["y"]).abs()
    scored = (merged.groupby(["series_id", "model"], observed=True)["abs_error"]
              .mean().reset_index())
    scored["denominator"] = scored["series_id"].map(denom)
    scored["mase"] = scored["abs_error"] / scored["denominator"]
    scored["fold"] = fold.k
    return scored[["fold", "series_id", "model", "abs_error", "denominator", "mase"]]


def aggregate_scores(fold_scores: list[pd.DataFrame]) -> pd.DataFrame:
    """Mean MASE per (series_id, model) across folds."""
    allf = pd.concat(fold_scores, ignore_index=True)
    return (allf.groupby(["series_id", "model"], observed=True)["mase"]
            .mean().reset_index())


def leaderboard(per_series: pd.DataFrame) -> pd.DataFrame:
    """Mean MASE per model across series - the headline table."""
    return (per_series.groupby("model", observed=True)["mase"]
            .mean().reset_index()
            .sort_values("mase")
            .reset_index(drop=True))


def oracle_score(per_series: pd.DataFrame, exclude: tuple[str, ...] = ()) -> float:
    """Best achievable by perfect per-series hindsight. A bound, not a model.

    It exists to show exactly how much headroom model selection could ever buy,
    which is what makes the selection-vs-combination result meaningful.
    """
    pool = per_series[~per_series["model"].isin(exclude)]
    return float(pool.groupby("series_id", observed=True)["mase"].min().mean())


def selection_score(fold_scores: list[pd.DataFrame],
                    exclude: tuple[str, ...] = ()) -> float:
    """Pick each series' best model from PREVIOUS folds, score it on the next.

    This is the obvious strategy, implemented honestly: the choice for fold k
    uses only folds 1..k-1, so it never sees the answer it is scored on.
    """
    allf = pd.concat(fold_scores, ignore_index=True)
    allf = allf[~allf["model"].isin(exclude)]
    folds = sorted(allf["fold"].unique())

    picked: list[float] = []
    for i, f in enumerate(folds):
        if i == 0:
            continue  # no history to choose from yet
        history = allf[allf["fold"].isin(folds[:i])]
        best = (history.groupby(["series_id", "model"], observed=True)["mase"]
                .mean().reset_index()
                .sort_values("mase")
                .groupby("series_id", observed=True).first()["model"])
        current = allf[allf["fold"] == f]
        for sid, model in best.items():
            row = current[(current["series_id"] == sid) & (current["model"] == model)]
            if not row.empty:
                picked.append(float(row["mase"].iloc[0]))
    return float(np.mean(picked)) if picked else float("nan")
