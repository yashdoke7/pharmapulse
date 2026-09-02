"""Validation gates. A failing batch is quarantined, never passed through.

A five-percent drift in a training input is indistinguishable from a genuine
change in the business once it reaches a model, so it must be stopped at the
boundary where it is still attributable to a file.

Written as explicit checks rather than a pandera schema: same assertions, one
fewer dependency, and the failure messages are readable on stage.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from pipelines.ingest import SERIES_IDS


@dataclass
class ValidationResult:
    passed: bool
    checks: list[dict] = field(default_factory=list)
    quarantine: pd.DataFrame | None = None

    def report(self) -> str:
        lines = []
        for c in self.checks:
            mark = "PASS" if c["ok"] else "FAIL"
            lines.append(f"  [{mark}] {c['name']}: {c['detail']}")
        return "\n".join(lines)


def _check(name: str, ok: bool, detail: str) -> dict:
    return {"name": name, "ok": bool(ok), "detail": detail}


def validate(long: pd.DataFrame, strict: bool = True) -> ValidationResult:
    """Seven gates over the long-form daily frame."""
    checks: list[dict] = []
    quarantine_masks: list[pd.Series] = []

    # 1. Column set and dtypes - catches a renamed, added or removed drug group.
    required = {"series_id", "ds", "y", "origin", "snapshot_id"}
    missing = required - set(long.columns)
    checks.append(_check("schema", not missing,
                         f"missing={sorted(missing)}" if missing else "all required columns present"))

    found_series = set(long["series_id"].unique())
    expected_series = set(SERIES_IDS)
    checks.append(_check(
        "series set",
        found_series == expected_series,
        f"unexpected={sorted(found_series - expected_series)} "
        f"absent={sorted(expected_series - found_series)}"
        if found_series != expected_series else f"{len(found_series)} expected series",
    ))

    # 2. Duplicate key detection - catches a double-posted batch.
    dupes = long.duplicated(subset=["series_id", "ds"])
    checks.append(_check("unique key", not dupes.any(),
                         f"{int(dupes.sum())} duplicate (series_id, ds) rows"))
    if dupes.any():
        quarantine_masks.append(dupes)

    # 3. Range and sign checks - negative or implausible unit counts.
    negative = long["y"] < 0
    checks.append(_check("non-negative", not negative.any(),
                         f"{int(negative.sum())} negative values"))
    if negative.any():
        quarantine_masks.append(negative)

    nulls = long["y"].isna()
    checks.append(_check("no nulls", not nulls.any(), f"{int(nulls.sum())} null y values"))
    if nulls.any():
        quarantine_masks.append(nulls)

    # 4. Date ordering and gaps - out-of-sequence or missing days.
    days = pd.DatetimeIndex(sorted(long["ds"].unique()))
    expected_days = pd.date_range(days.min(), days.max(), freq="D")
    gaps = expected_days.difference(days)
    checks.append(_check("no date gaps", len(gaps) == 0,
                         f"{len(gaps)} missing days" if len(gaps)
                         else f"{len(days)} contiguous days"))

    # 5. Row count per day - incomplete ingestion.
    per_day = long.groupby("ds")["series_id"].nunique()
    short_days = per_day[per_day != len(expected_series)]
    checks.append(_check("rows per day", short_days.empty,
                         f"{len(short_days)} days with != {len(expected_series)} series"))

    # 6. Single snapshot per run - provenance is traceable to one file.
    snaps = long["snapshot_id"].nunique()
    checks.append(_check("single snapshot", snaps == 1,
                         f"{snaps} distinct snapshot_id values"))

    # 7. Provenance lane - one lane per batch, never a mixture.
    #
    # This gate used to require exactly {"observed"}, which meant a lane-3
    # dataset could not be validated at all and demonstrating the pipeline on
    # a second file meant switching the gate off. A rule you switch off to get
    # work done is not a rule.
    #
    # The thing worth enforcing is that a single batch is COHERENT. A frame
    # that is mostly real with some invented rows produces a number nobody can
    # characterise. A frame that is entirely one lane is fine - what may be
    # claimed about it is decided from its origin, which travels to the browser
    # and switches the accuracy figures off when it is not "observed".
    lanes = set(long["origin"].unique())
    checks.append(_check("single provenance lane", len(lanes) == 1,
                         f"origins present: {sorted(lanes)}"))

    quarantine = None
    if quarantine_masks:
        mask = quarantine_masks[0]
        for m in quarantine_masks[1:]:
            mask = mask | m
        quarantine = long[mask].copy()

    passed = all(c["ok"] for c in checks)
    if strict and not passed:
        failed = [c["name"] for c in checks if not c["ok"]]
        raise ValueError(
            "validation failed, batch quarantined: " + ", ".join(failed)
            + "\n" + ValidationResult(False, checks).report()
        )

    return ValidationResult(passed=passed, checks=checks, quarantine=quarantine)


def assert_reconciles(daily: pd.DataFrame, derived: pd.DataFrame,
                      grain: str, tolerance: float = 1e-6) -> None:
    """Derived weekly/monthly totals must equal a rollup of the daily rows.

    This is the check that would have caught the corrupt salesmonthly.csv, and
    it fails loudly rather than warning quietly.
    """
    freq = {"week": "W-SUN", "month": "MS"}[grain]
    if freq == "W-SUN":
        key = daily["ds"].dt.to_period("W").dt.start_time
    else:
        key = daily["ds"].dt.to_period("M").dt.start_time

    rollup = (daily.assign(_k=key)
              .groupby(["series_id", "_k"])["y"].sum()
              .rename("expected"))
    got = derived.set_index(["series_id", "ds"])["y"].rename("got")

    joined = pd.concat([rollup, got], axis=1, join="inner")
    diff = (joined["expected"] - joined["got"]).abs()
    bad = joined[diff > tolerance]
    if not bad.empty:
        raise AssertionError(
            f"{grain} grain does not reconcile with the daily rollup: "
            f"{len(bad)} mismatched buckets, worst delta {diff.max():.6f}"
        )
