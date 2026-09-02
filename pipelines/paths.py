"""Where the warehouse lives, resolved per call.

Every layer used to hardcode `data/warehouse/...` in a default argument.
Python evaluates those once at import, so the location could not be changed
afterwards - which is why `PHARMAPULSE_DATA_ROOT` sat in docker-compose.yml
being read by nothing at all.

That mattered more than it looked. It is the reason a second dataset could not
exist: running the batch on another file would overwrite the demo warehouse in
place, because there was only ever one path. Making the root resolve per call
turns "which dataset" into an environment variable:

    # the real file, into the default warehouse
    python -m pipelines.run_nightly --stage all

    # a lane-3 file, into its own warehouse, leaving the demo untouched
    PHARMAPULSE_DATA_ROOT=data/warehouse-synthetic \\
        python -m pipelines.run_nightly --stage all \\
            --raw data/synthetic/salesdaily_synthetic_2019_2026.csv \\
            --origin synthetic

    # serve that one instead
    PHARMAPULSE_DATA_ROOT=data/warehouse-synthetic uvicorn api.main:app

The ledger keeps its own variable (PHARMAPULSE_DB) because it is operational
state, not analytical: you may well want a fresh shelf against the same
forecasts, or the same shelf while you rebuild them.
"""

from __future__ import annotations

import os
from pathlib import Path

DEFAULT_ROOT = Path("data/warehouse")


def data_root() -> Path:
    """The warehouse root. Read fresh every call - never captured in a default."""
    return Path(os.getenv("PHARMAPULSE_DATA_ROOT") or DEFAULT_ROOT)


def bronze_root() -> Path:
    return data_root() / "bronze"


def gold_root() -> Path:
    return data_root() / "gold"


def features_root() -> Path:
    return data_root() / "features"


def forecast_root() -> Path:
    return data_root() / "forecast"


def resolve(explicit: str | Path | None, default: Path) -> Path:
    """An explicit argument wins; otherwise the environment-resolved default.

    Tests pass tmp_path explicitly and must not be affected by the environment;
    everything else follows PHARMAPULSE_DATA_ROOT.
    """
    return Path(explicit) if explicit is not None else default
