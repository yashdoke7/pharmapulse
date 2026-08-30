"""Shared fixtures. Built once per session from the real dataset."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from pipelines.clean import clean
from pipelines.gold import aggregate
from pipelines.ingest import DATE_COL, DATE_FORMAT, SERIES_IDS

RAW = Path("data/observed/salesdaily.csv")

requires_data = pytest.mark.skipif(
    not RAW.exists(),
    reason="data/observed/salesdaily.csv not present - run scripts/check_data.py",
)


@pytest.fixture(scope="session")
def raw_long() -> pd.DataFrame:
    """Long-form daily rows straight from the CSV, without touching the warehouse."""
    if not RAW.exists():
        pytest.skip("dataset not present")
    wide = pd.read_csv(RAW)
    wide[DATE_COL] = pd.to_datetime(wide[DATE_COL], format=DATE_FORMAT)
    long = wide.melt(id_vars=[DATE_COL], value_vars=SERIES_IDS,
                     var_name="series_id", value_name="y").rename(columns={DATE_COL: "ds"})
    long["y"] = long["y"].astype(float)
    long["origin"] = "observed"
    long["snapshot_id"] = "sha256:test"
    return long.sort_values(["series_id", "ds"]).reset_index(drop=True)


@pytest.fixture(scope="session")
def cleaned(raw_long: pd.DataFrame) -> pd.DataFrame:
    return clean(raw_long)


@pytest.fixture(scope="session")
def gold_week(cleaned: pd.DataFrame) -> pd.DataFrame:
    return aggregate(cleaned, "week")


@pytest.fixture(scope="session")
def gold_month(cleaned: pd.DataFrame) -> pd.DataFrame:
    return aggregate(cleaned, "month")


@pytest.fixture(scope="session")
def gold_day(cleaned: pd.DataFrame) -> pd.DataFrame:
    return aggregate(cleaned, "day")
