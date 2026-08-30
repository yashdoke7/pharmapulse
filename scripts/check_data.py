"""Day 0 gate: is the dataset present, and is it the file we think it is?

Run: python scripts/check_data.py
Everyone runs this before writing code. It prints the snapshot_id that every
downstream number is tied to.

Dataset: Kaggle "Pharma Sales Data" (milanzdravkovic).
Place salesdaily.csv in data/observed/. Do NOT place salesweekly.csv or
salesmonthly.csv there - the monthly file is corrupt (53 series-months disagree
with a daily rollup) and we derive every other grain ourselves. See
docs/PHARMAPULSE_ARCHITECTURE.md section 3.1.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

RAW = Path("data/observed/salesdaily.csv")
EXPECTED_SERIES = ["M01AB", "M01AE", "N02BA", "N02BE", "N05B", "N05C", "R03", "R06"]
EXPECTED_ROWS = 2106
EXPECTED_FIRST = "1/2/2014"
BANNED = ["salesmonthly.csv", "saleshourly.csv"]


def snapshot_id(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return "sha256:" + h.hexdigest()[:12]


def main() -> int:
    problems: list[str] = []

    if not RAW.exists():
        print(f"MISSING: {RAW}")
        print("  Download from https://www.kaggle.com/datasets/milanzdravkovic/pharma-sales-data")
        print("  and copy salesdaily.csv into data/observed/")
        return 1

    for banned in BANNED:
        if (RAW.parent / banned).exists():
            problems.append(
                f"{banned} is in data/observed/. Remove it - we ingest salesdaily.csv only "
                "(architecture 3.1). Keeping it there invites someone to read it by accident."
            )

    import pandas as pd

    df = pd.read_csv(RAW)
    sid = snapshot_id(RAW)

    print(f"file          {RAW}")
    print(f"snapshot_id   {sid}")
    print(f"rows          {len(df)}   (expected {EXPECTED_ROWS})")
    print(f"columns       {list(df.columns)}")

    if len(df) != EXPECTED_ROWS:
        problems.append(f"row count {len(df)} != {EXPECTED_ROWS}")

    missing = [s for s in EXPECTED_SERIES if s not in df.columns]
    if missing:
        problems.append(f"missing series columns: {missing}")

    extra = [c for c in df.columns if c in EXPECTED_SERIES]
    if len(extra) == 8:
        vals = df[EXPECTED_SERIES]
        all_zero_days = int((vals.sum(axis=1) == 0).sum())
        print(f"all-zero days {all_zero_days}   (expected 26 closures)")
        if all_zero_days != 26:
            problems.append(
                f"all-zero day count {all_zero_days} != 26. The closure calendar "
                "assumption in the architecture doc is built on 26."
            )
        print("daily means   " + ", ".join(f"{s}={vals[s].mean():.2f}" for s in EXPECTED_SERIES))

    if problems:
        print("\nFAILED:")
        for p in problems:
            print(f"  - {p}")
        return 1

    print("\nOK. Put this snapshot_id in the pinned team channel message. "
          "Every reported number is tied to it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
