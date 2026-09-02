"""Data-foundation gates: idempotency, reconciliation, closures, completeness, lanes."""

from __future__ import annotations

import pandas as pd
import pytest

from pipelines.clean import detect_closures, summarise
from pipelines.gold import aggregate
from pipelines.ingest import ingest
from pipelines.validate import assert_reconciles, validate

# --- ingest ---------------------------------------------------------------

def _one_row_csv(path):
    """A minimal file that passes the column check, so a lane test tests lanes."""
    from pipelines.ingest import SERIES_IDS
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("datum," + ",".join(SERIES_IDS) + "\n"
                    + "1/2/2014," + ",".join("1" for _ in SERIES_IDS) + "\n")


def test_ingest_is_idempotent(tmp_path):
    """Re-ingesting the same file changes nothing. The nightly job must be
    safely re-runnable, and a real POS feed resends after an outage."""
    raw = "data/observed/salesdaily.csv"
    if not pd.io.common.file_exists(raw):
        pytest.skip("dataset not present")

    out = tmp_path / "bronze"
    first = ingest(raw, out_root=out)
    second = ingest(raw, out_root=out)

    assert first.rows_written == second.rows_written
    assert first.snapshot_id == second.snapshot_id


def test_ingest_refuses_a_synthetic_path(tmp_path):
    """Lane 3 may not train a model. Enforced in code, not by convention."""
    fake = tmp_path / "data" / "synthetic" / "salesdaily.csv"
    _one_row_csv(fake)

    with pytest.raises(ValueError, match="synthetic"):
        ingest(fake, out_root=tmp_path / "bronze")


def test_ingest_accepts_synthetic_only_when_told_so(tmp_path):
    """The guard's job is that lane 3 cannot enter DISGUISED, not that it
    cannot enter at all.

    Refusing outright made the lane unusable, so demonstrating the pipeline on
    a second dataset would have meant deleting the guard - which is how a
    safety rail becomes a formality. Loading it is allowed; loading it silently
    is not, and every row carries the label onward.
    """
    fake = tmp_path / "data" / "synthetic" / "salesdaily.csv"
    _one_row_csv(fake)

    result = ingest(fake, out_root=tmp_path / "bronze", origin="synthetic")
    assert result.rows_written > 0

    written = pd.read_parquet(tmp_path / "bronze")
    assert set(written["origin"]) == {"synthetic"}, (
        "a synthetic row reached bronze without its lane attached")


def test_ingest_rejects_an_unknown_lane(tmp_path):
    fake = tmp_path / "salesdaily.csv"
    _one_row_csv(fake)
    with pytest.raises(ValueError, match="unknown origin"):
        ingest(fake, out_root=tmp_path / "bronze", origin="probably_fine")


# --- validation -----------------------------------------------------------

def test_validation_passes_on_the_real_data(raw_long):
    result = validate(raw_long, strict=False)
    assert result.passed, result.report()


def test_validation_quarantines_negative_values(raw_long):
    corrupted = raw_long.copy()
    corrupted.loc[0, "y"] = -5.0

    with pytest.raises(ValueError, match="validation failed"):
        validate(corrupted, strict=True)

    result = validate(corrupted, strict=False)
    assert not result.passed
    assert result.quarantine is not None and len(result.quarantine) == 1


def test_validation_catches_a_renamed_drug_group(raw_long):
    renamed = raw_long.copy()
    renamed["series_id"] = renamed["series_id"].replace({"R06": "R06_NEW"})
    result = validate(renamed, strict=False)
    assert not result.passed


# --- closures -------------------------------------------------------------

def test_exactly_26_closure_days(cleaned):
    """All eight groups read exactly zero. The shop was shut, not slow."""
    assert summarise(cleaned)["closed_days"] == 26


def test_closures_are_flagged_not_deleted(cleaned, raw_long):
    """Marking the state keeps the row; deleting it would leave a gap a
    seasonal model reads as a missing period."""
    assert len(cleaned) == len(raw_long)
    assert cleaned["is_closed"].sum() == 26 * 8


def test_orthodox_christmas_is_a_closure_in_five_of_six_years(cleaned):
    """MEASURED, and it corrects the architecture document.

    The doc claims 7 January is a closure "2014-2019, every year". It is not:
    on 7 January 2017 the pharmacy was OPEN and sold 59.9 units. The closure
    holds in 2014, 2015, 2016, 2018 and 2019.

    This matters because the holiday regressor must be fitted from the observed
    closure calendar, not from an assumed one - otherwise the model expects a
    shutdown that did not happen and under-forecasts that week.
    """
    closures = detect_closures(cleaned)
    closed_years = {y for y in range(2014, 2020)
                    if pd.Timestamp(f"{y}-01-07") in closures}
    assert closed_years == {2014, 2015, 2016, 2018, 2019}
    assert pd.Timestamp("2017-01-07") not in closures


def test_closure_calendar_matches_the_documented_breakdown(cleaned):
    """21 of the 26 closures map to the Serbian Orthodox calendar, 5 do not."""
    closures = set(detect_closures(cleaned))

    orthodox = {
        *(pd.Timestamp(f"{y}-01-07") for y in (2014, 2015, 2016, 2018, 2019)),
        *(pd.Timestamp(d) for d in ("2014-04-20", "2015-04-12", "2016-05-01",
                                    "2017-04-16", "2018-04-08", "2019-04-28")),
        *(pd.Timestamp(f"{y}-01-01") for y in (2015, 2016, 2018, 2019)),
        *(pd.Timestamp(f"{y}-12-19") for y in (2014, 2015, 2016, 2017, 2018)),
        pd.Timestamp("2014-05-01"),
    }
    mapped = closures & orthodox
    unexplained = closures - orthodox

    assert len(closures) == 26
    assert len(mapped) == 21, f"expected 21 calendar-mapped closures, got {len(mapped)}"
    assert len(unexplained) == 5, f"expected 5 one-offs, got {sorted(unexplained)}"


def test_all_six_orthodox_easters_are_closures(cleaned):
    easters = ["2014-04-20", "2015-04-12", "2016-05-01",
               "2017-04-16", "2018-04-08", "2019-04-28"]
    closures = detect_closures(cleaned)
    for e in easters:
        assert pd.Timestamp(e) in closures, f"Orthodox Easter {e} not flagged"


# --- outliers -------------------------------------------------------------

def test_outliers_are_flagged_but_y_is_untouched(cleaned, raw_long):
    """The extremes are real events. Removing them removes the signal."""
    assert cleaned["is_outlier"].sum() > 0
    merged = cleaned.merge(raw_long, on=["series_id", "ds"], suffixes=("", "_raw"))
    pd.testing.assert_series_equal(merged["y"], merged["y_raw"], check_names=False)


def test_the_january_2019_flu_peak_is_flagged(cleaned):
    jan19 = cleaned[(cleaned["series_id"] == "N02BE")
                    & (cleaned["ds"].between("2019-01-01", "2019-01-31"))]
    assert jan19["is_outlier"].any(), "the January 2019 N02BE flu peak should be flagged"


# --- reconciliation -------------------------------------------------------

@pytest.mark.parametrize("grain", ["week", "month"])
def test_derived_grains_reconcile_with_the_daily_rollup(cleaned, grain):
    """The check that would have caught the corrupt salesmonthly.csv."""
    derived = aggregate(cleaned, grain)
    assert_reconciles(cleaned, derived, grain)


def test_reconciliation_fails_loudly_when_a_bucket_is_wrong(cleaned):
    derived = aggregate(cleaned, "week")
    derived.loc[10, "y"] = derived.loc[10, "y"] + 100
    with pytest.raises(AssertionError, match="does not reconcile"):
        assert_reconciles(cleaned, derived, "week")


# --- completeness ---------------------------------------------------------

def test_the_truncated_final_bucket_is_visible_not_missing(gold_week, gold_month):
    """October 2019 reads as a 70% collapse and is not. A hatched partial bar
    is honest; a missing bar looks like the data ends for an unknown reason."""
    last_month = gold_month[gold_month["ds"] == gold_month["ds"].max()]
    assert not last_month.empty
    assert (last_month["completeness"] < 1.0).all()

    last_week = gold_week[gold_week["ds"] == gold_week["ds"].max()]
    assert (last_week["completeness"] < 1.0).all()


def test_full_periods_are_marked_complete(gold_week):
    mid = gold_week[gold_week["ds"] == pd.Timestamp("2018-06-04")]
    assert not mid.empty
    assert (mid["completeness"] == 1.0).all()


def test_expected_row_counts(gold_week, gold_month):
    """302 weekly and 70 monthly buckets across 8 series."""
    assert gold_week["ds"].nunique() == 302
    assert gold_month["ds"].nunique() == 70
    assert len(gold_week) == 302 * 8
