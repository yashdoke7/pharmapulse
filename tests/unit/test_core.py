"""Forecast-engine gates: routing, combination validity, calibration, store."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from core.backtest import make_folds, mase_denominator, score_fold
from core.calibrate import conformal_scale, coverage, coverage_curve
from core.classify import ERRATIC, INTERMITTENT, SMOOTH, adi_cv2, classify, classify_one
from core.combine import combine_point, combine_quantiles, enforce_monotonic
from core.forecast_store import quantile_at


# --- demand classification ------------------------------------------------

def test_adi_cv2_on_a_dense_stable_series():
    y = pd.Series([10, 11, 9, 10, 12, 10, 11, 9])
    adi, cv2, zero_rate = adi_cv2(y)
    assert adi == pytest.approx(1.0)
    assert cv2 < 0.49
    assert zero_rate == 0.0


def test_adi_detects_a_sporadic_series():
    y = pd.Series([0, 0, 5, 0, 0, 6, 0, 0, 4])
    adi, _, zero_rate = adi_cv2(y)
    assert adi == pytest.approx(3.0)
    assert zero_rate == pytest.approx(2 / 3)


def test_n05c_routes_to_the_intermittent_family_at_daily_grain(gold_day):
    """N05C sells nothing on 68% of days. Averaging models return a flat,
    fractional, non-actionable line on it, so it must route to Croston/TSB."""
    row = classify(gold_day).set_index("series_id").loc["N05C"]
    assert row["zero_rate"] > 0.6
    assert row["adi"] > 1.32
    assert row["demand_class"] == INTERMITTENT
    assert "CrostonOptimized" in row["models"]


def test_demand_class_depends_on_the_grain(gold_day, gold_week):
    """MEASURED: aggregation removes sparsity. N05C is intermittent daily and
    smooth weekly, so routing MUST be recomputed per grain - classifying once
    on weekly data would send the daily forecast to the wrong model family."""
    daily = classify(gold_day).set_index("series_id")
    weekly = classify(gold_week).set_index("series_id")
    assert daily.loc["N05C", "demand_class"] == INTERMITTENT
    assert weekly.loc["N05C", "demand_class"] == SMOOTH
    assert daily.loc["N05C", "adi"] > weekly.loc["N05C", "adi"]


def test_classification_is_a_rule_not_a_lookup():
    """Nothing is hardcoded to a series name - a changed pattern reroutes."""
    dense = classify_one("X", pd.Series([10, 11, 9, 10, 12] * 20))
    sparse = classify_one("X", pd.Series([0, 0, 7] * 30))
    assert dense.demand_class == SMOOTH
    assert sparse.demand_class == INTERMITTENT


def test_erratic_needs_variable_sizes_not_gaps():
    rng = np.random.default_rng(0)
    y = pd.Series(rng.lognormal(mean=2.0, sigma=1.0, size=300).round() + 1)
    result = classify_one("X", y)
    assert result.adi < 1.32, "sells most periods"
    assert result.cv2 >= 0.49, "but the sizes are wildly variable"
    assert result.demand_class == ERRATIC


# --- combination ----------------------------------------------------------

def _preds(**model_values) -> pd.DataFrame:
    rows = []
    for model, vals in model_values.items():
        for i, v in enumerate(vals):
            rows.append({"series_id": "A", "ds": pd.Timestamp("2019-01-01")
                         + pd.Timedelta(weeks=i), "model": model, "value": v})
    return pd.DataFrame(rows)


def test_median_ignores_one_member_blowing_up():
    """The failure we protect against: a mean carries the error, a median does not."""
    preds = _preds(Prophet=[100.0], AutoARIMA=[102.0], MSTL=[98.0],
                   SeasonalNaive=[101.0], LightGBM=[9000.0])
    out = combine_point(preds)
    assert out["value"].iloc[0] == pytest.approx(101.0)

    mean = preds["value"].mean()
    assert mean > 1000, "sanity: the mean really is wrecked by the outlier"


def test_combination_never_returns_a_negative_quantity():
    preds = _preds(Prophet=[-5.0], AutoARIMA=[-3.0], MSTL=[-4.0])
    out = combine_point(preds, members=["Prophet", "AutoARIMA", "MSTL"])
    assert (out["value"] >= 0).all()


def test_combined_quantiles_are_monotone():
    """Taking medians independently at each level does not preserve ordering,
    so an explicit sort is what makes the output a valid distribution."""
    rows = []
    for model, offset in [("Prophet", 0), ("AutoARIMA", 3), ("MSTL", -2)]:
        for q, base in [(0.1, 50), (0.5, 40), (0.9, 60)]:   # deliberately unordered
            rows.append({"series_id": "A", "ds": pd.Timestamp("2019-01-07"),
                         "model": model, "quantile": q, "value": base + offset})
    out = combine_quantiles(pd.DataFrame(rows),
                            members=["Prophet", "AutoARIMA", "MSTL"])
    values = out.sort_values("quantile")["value"].to_numpy()
    assert (np.diff(values) >= 0).all()


def test_enforce_monotonic_is_idempotent():
    df = pd.DataFrame({"series_id": ["A"] * 3, "ds": [pd.Timestamp("2019-01-07")] * 3,
                       "quantile": [0.1, 0.5, 0.9], "value": [10.0, 5.0, 20.0]})
    once = enforce_monotonic(df)
    twice = enforce_monotonic(once)
    pd.testing.assert_frame_equal(once, twice)


# --- backtest -------------------------------------------------------------

def test_folds_never_see_their_own_test_window(gold_week):
    for fold in make_folds(gold_week, h=8, n_folds=4):
        assert fold.train["ds"].max() <= fold.cutoff
        assert fold.test["ds"].min() > fold.cutoff


def test_folds_are_non_overlapping_and_ordered(gold_week):
    folds = make_folds(gold_week, h=8, n_folds=4)
    cutoffs = [f.cutoff for f in folds]
    assert cutoffs == sorted(cutoffs)
    assert len(set(cutoffs)) == 4


def test_mase_denominator_is_positive_per_series(gold_week):
    folds = make_folds(gold_week, h=8, n_folds=4)
    denom = mase_denominator(folds[0].train)
    assert (denom > 0).all()
    assert len(denom) == 8


def test_a_perfect_forecast_scores_zero(gold_week):
    fold = make_folds(gold_week, h=8, n_folds=4)[0]
    perfect = fold.test[["series_id", "ds", "y"]].rename(columns={"y": "value"})
    perfect["model"] = "Oracle"
    scored = score_fold(fold, perfect)
    assert scored["mase"].max() == pytest.approx(0.0)


# --- calibration ----------------------------------------------------------

def test_coverage_counts_actuals_inside_the_band():
    actuals = pd.DataFrame({"y": [10.0, 20.0, 30.0, 40.0]})
    lo = pd.Series([0.0, 0.0, 0.0, 100.0])
    hi = pd.Series([15.0, 25.0, 25.0, 200.0])
    assert coverage(actuals, lo, hi) == pytest.approx(0.5)


def test_conformal_scale_widens_an_overconfident_interval():
    """Residuals much larger than the assumed spread must push the scale above 1."""
    rng = np.random.default_rng(1)
    paired = pd.DataFrame({
        "y": 100 + rng.normal(0, 30, 400),
        "point": 100.0,
        "spread": 5.0,        # far too narrow
    })
    assert conformal_scale(paired, level=0.80) > 1.5


def test_conformal_scale_narrows_an_underconfident_interval():
    rng = np.random.default_rng(2)
    paired = pd.DataFrame({
        "y": 100 + rng.normal(0, 2, 400),
        "point": 100.0,
        "spread": 40.0,       # far too wide
    })
    assert conformal_scale(paired, level=0.80) < 0.5


def test_coverage_curve_is_non_decreasing_in_the_nominal_level():
    rng = np.random.default_rng(3)
    paired = pd.DataFrame({"y": 50 + rng.normal(0, 10, 500),
                           "point": 50.0, "spread": 10.0})
    curve = coverage_curve(paired, [0.5, 0.8, 0.9, 0.95])
    achieved = [c["achieved"] for c in curve]
    assert achieved == sorted(achieved)


# --- store helpers --------------------------------------------------------

def test_quantile_at_interpolates_between_stored_levels():
    dist = {"0.05": 80.0, "0.50": 100.0, "0.95": 140.0}
    assert quantile_at(dist, 0.50) == pytest.approx(100.0)
    assert quantile_at(dist, 0.05) == pytest.approx(80.0)
    mid = quantile_at(dist, 0.725)
    assert 100.0 < mid < 140.0


def test_quantile_at_clamps_outside_the_stored_range():
    dist = {"0.05": 80.0, "0.95": 140.0}
    assert quantile_at(dist, 0.001) == pytest.approx(80.0)
    assert quantile_at(dist, 0.999) == pytest.approx(140.0)
