"""THE test. If this is red, every number the project reports is meaningless.

Look-ahead leakage produces results that look excellent, which is exactly why it
needs a structural guarantee rather than a review convention.
"""

from __future__ import annotations

import pandas as pd
import pytest

from pipelines.features import build_features, feature_columns


@pytest.mark.parametrize("cutoff", ["2017-06-25", "2018-06-24", "2019-03-31"])
def test_features_depend_only_on_the_past(gold_week: pd.DataFrame, cutoff: str):
    """A feature at time t is identical whether or not rows after t exist."""
    full = build_features(gold_week, cutoff=cutoff, grain="week")

    truncated_input = gold_week[gold_week["ds"] <= pd.Timestamp(cutoff)]
    truncated = build_features(truncated_input, cutoff=cutoff, grain="week")

    pd.testing.assert_frame_equal(full, truncated)


def test_no_feature_row_exists_after_the_cutoff(gold_week: pd.DataFrame):
    cutoff = pd.Timestamp("2018-01-01")
    feats = build_features(gold_week, cutoff=cutoff, grain="week")
    assert feats["ds"].max() <= cutoff


def test_lag_1_equals_the_previous_observation(gold_week: pd.DataFrame):
    """Sanity check that the lag is a real lag and not an off-by-one."""
    feats = build_features(gold_week, cutoff="2019-06-30", grain="week")
    one = feats[feats["series_id"] == "N02BE"].sort_values("ds").reset_index(drop=True)
    expected = one["y"].shift(1)
    pd.testing.assert_series_equal(one["lag_1"], expected, check_names=False)


def test_rolling_mean_excludes_the_current_period(gold_week: pd.DataFrame):
    """roll_mean_4 at time t must not contain y(t) - that would be leakage."""
    feats = build_features(gold_week, cutoff="2019-06-30", grain="week")
    one = feats[feats["series_id"] == "N02BE"].sort_values("ds").reset_index(drop=True)
    expected = one["y"].shift(1).rolling(4, min_periods=2).mean()
    pd.testing.assert_series_equal(one["roll_mean_4"], expected, check_names=False)


def test_price_and_promotion_are_never_offered_as_features(gold_week: pd.DataFrame):
    """No such column exists in this data, so a coefficient on one is noise."""
    feats = build_features(gold_week, cutoff="2019-06-30", grain="week")
    cols = {c.lower() for c in feature_columns(feats)}
    assert "price" not in cols
    assert "promotion" not in cols
