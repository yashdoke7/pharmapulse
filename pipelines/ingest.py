"""Ingest: salesdaily.csv -> long-form append-only bronze.

Only salesdaily.csv is ever read. The supplied weekly and monthly files are not
ingested - salesmonthly.csv is corrupt (January 2017 reads ~zero against ~2,700
real units in the daily file). Weekly and monthly grains are derived by
resampling in gold.py, which makes them agree with the daily records by
construction rather than by trust.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

SERIES_IDS = ["M01AB", "M01AE", "N02BA", "N02BE", "N05B", "N05C", "R03", "R06"]
DATE_COL = "datum"
DATE_FORMAT = "%m/%d/%Y"


@dataclass(frozen=True)
class IngestResult:
    snapshot_id: str
    batch_id: str
    rows_in: int
    rows_written: int
    first_ds: str
    last_ds: str


def snapshot_id(path: Path) -> str:
    """Content hash of the source file. Every downstream number is tied to it."""
    h = hashlib.sha256()
    with Path(path).open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return "sha256:" + h.hexdigest()[:12]


def ingest(raw_path: str | Path,
           out_root: str | Path = "data/warehouse/bronze") -> IngestResult:
    """Parse the daily CSV into long form and upsert into append-only bronze.

    The upsert is keyed on the natural key (series_id, ds), so re-ingesting the
    same file is a no-op. The nightly job must be safely re-runnable after a
    failure, and a real POS feed resends records after a network interruption.
    """
    raw_path = Path(raw_path)

    # Lane enforcement, in code rather than by convention (data/README.md).
    if "synthetic" in str(raw_path).replace("\\", "/").lower():
        raise ValueError(
            f"refusing to ingest from a synthetic path: {raw_path}. "
            "Lane 3 data may not train a model or back an accuracy claim."
        )

    wide = pd.read_csv(raw_path)
    missing = [c for c in [DATE_COL, *SERIES_IDS] if c not in wide.columns]
    if missing:
        raise ValueError(f"{raw_path} is missing required columns: {missing}")

    sid = snapshot_id(raw_path)
    batch_id = uuid.uuid4().hex[:12]

    wide[DATE_COL] = pd.to_datetime(wide[DATE_COL], format=DATE_FORMAT)

    long = wide.melt(
        id_vars=[DATE_COL],
        value_vars=SERIES_IDS,
        var_name="series_id",
        value_name="y",
    ).rename(columns={DATE_COL: "ds"})

    long["y"] = pd.to_numeric(long["y"], errors="coerce").astype("float64")
    long["origin"] = "observed"
    long["snapshot_id"] = sid
    long["ingest_batch_id"] = batch_id
    long = long.sort_values(["series_id", "ds"]).reset_index(drop=True)

    out_root = Path(out_root)
    out_root.mkdir(parents=True, exist_ok=True)
    target = out_root / "bronze.parquet"

    if target.exists():
        existing = pd.read_parquet(target)
        combined = pd.concat([existing, long], ignore_index=True)
        # Idempotent upsert on the natural key: last write for a key wins.
        combined = combined.drop_duplicates(subset=["series_id", "ds"], keep="last")
        combined = combined.sort_values(["series_id", "ds"]).reset_index(drop=True)
    else:
        combined = long

    combined.to_parquet(target, index=False, compression="zstd")

    return IngestResult(
        snapshot_id=sid,
        batch_id=batch_id,
        rows_in=len(wide),
        rows_written=len(combined),
        first_ds=str(long["ds"].min().date()),
        last_ds=str(long["ds"].max().date()),
    )


def read_bronze(root: str | Path = "data/warehouse/bronze") -> pd.DataFrame:
    return pd.read_parquet(Path(root) / "bronze.parquet")
