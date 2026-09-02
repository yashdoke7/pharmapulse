"""The nightly batch, end to end. Idempotent - a failed run re-executes cleanly.

    python -m pipelines.run_nightly --stage gold      # raw csv -> gold parquet
    python -m pipelines.run_nightly --stage forecast  # gold -> forecast store
    python -m pipelines.run_nightly --stage all
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from pipelines.clean import clean, summarise
from pipelines.features import build_features, write_features
from pipelines.gold import build_gold, fitting_frame
from pipelines.holidays import write_calendar
from pipelines.ingest import LANES, ingest, read_bronze
from pipelines.validate import assert_reconciles, validate

RAW = Path("data/observed/salesdaily.csv")


def run_gold(raw: Path = RAW, verbose: bool = True,
             origin: str = "observed") -> dict:
    t0 = time.perf_counter()

    calendar_path = write_calendar()
    if verbose:
        print(f"holiday calendar   {calendar_path}")

    result = ingest(raw, origin=origin)
    if verbose:
        print(f"ingest             {result.rows_written} rows  "
              f"{result.first_ds} -> {result.last_ds}")
        print(f"snapshot_id        {result.snapshot_id}")
        print(f"origin             {origin}  -  {LANES[origin]}")
        if origin != "observed":
            print("                   ^ every number downstream inherits this lane")

    bronze = read_bronze()

    validation = validate(bronze, strict=True)
    if verbose:
        print("validate")
        print(validation.report())

    cleaned = clean(bronze)
    stats = summarise(cleaned)
    if verbose:
        print(f"clean              {stats['closed_days']} closure days, "
              f"{stats['outlier_rows']} outlier rows, "
              f"{stats['holiday_days']} holiday days")

    frames = build_gold(cleaned)
    for grain in ("week", "month"):
        assert_reconciles(cleaned, frames[grain], grain)
    if verbose:
        for grain, frame in frames.items():
            partial = int((frame["completeness"] < 1.0).sum())
            print(f"gold[{grain:5}]       {len(frame):5} rows, {partial} partial periods")
        print("reconcile          week and month totals match the daily rollup")

    for grain in ("week", "month"):
        fit = fitting_frame(grain)
        cutoff = fit["ds"].max()
        feats = build_features(fit, cutoff=cutoff, grain=grain)
        write_features(feats, grain=grain)
        if verbose:
            print(f"features[{grain:5}]   {len(feats)} rows, cutoff {cutoff.date()}")

    elapsed = time.perf_counter() - t0
    if verbose:
        print(f"\ngold stage complete in {elapsed:.1f}s")

    return {"snapshot_id": result.snapshot_id, "stats": stats, "elapsed_s": elapsed}


def run_forecast(verbose: bool = True, as_of: str | None = None) -> dict:
    try:
        from core.pipeline import build_forecast_store
    except ImportError:
        print("forecast stage not available yet (core/pipeline.py missing)")
        return {}
    return build_forecast_store(verbose=verbose, as_of=as_of)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="PharmaPulse nightly batch")
    parser.add_argument("--stage", default="all",
                        choices=["gold", "forecast", "all"])
    parser.add_argument("--raw", default=str(RAW))
    parser.add_argument(
        "--as-of", dest="as_of", default=None,
        help="run as if today were this date (YYYY-MM-DD). Gold is truncated "
             "before anything is fitted, so the demand class, the routing, the "
             "models and the calibration are all computed on what was knowable "
             "then. Omit to use the whole file.")
    parser.add_argument(
        "--origin", default="observed", choices=sorted(LANES),
        help="the lane this file belongs to. 'synthetic' is how you load lane 3 "
             "knowingly: it is allowed, it is labelled on every row and on every "
             "screen, and it may never back an accuracy claim.")
    args = parser.parse_args(argv)

    raw = Path(args.raw)
    if not raw.exists():
        print(f"missing {raw}. Run `python scripts/check_data.py` for instructions.",
              file=sys.stderr)
        return 1

    if args.stage in ("gold", "all"):
        run_gold(raw, origin=args.origin)
    if args.stage in ("forecast", "all"):
        print()
        run_forecast(as_of=args.as_of)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
