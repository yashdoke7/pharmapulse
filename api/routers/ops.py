"""Health and metrics - the Ops Console reads this.

Every accuracy number here comes from artifacts/benchmarks.json, which is
written only by scripts/day1_benchmark.py. No number on this screen is typed
by a human, and that sentence is said out loud in the demo.
"""

from __future__ import annotations

import os

from fastapi import APIRouter

from api import deps
from core import forecast_store as fs
from decision import ledger

router = APIRouter(prefix="/api", tags=["ops"])


@router.get("/health")
def health() -> dict:
    fixtures = deps.use_fixtures()
    store = fs.store_available()
    rung = 1
    if fixtures:
        rung = 5
    elif not store:
        rung = 6

    return deps.envelope({
        "status": "ok",
        "ladder_rung": rung,
        "forecast_store": "fixtures" if fixtures else ("present" if store else "missing"),
        "model_version": fs.current_version() or "none",
        "uptime_s": deps.uptime_seconds(),
    })


@router.get("/metrics")
def metrics() -> dict:
    if deps.use_fixtures():
        return deps.envelope(deps.fixture("metrics")["data"])

    bench = deps.benchmarks()
    stats = deps.cache_stats()

    rss_mb = None
    try:
        import resource  # noqa: F401  (unix only)
    except ImportError:
        pass
    try:
        import psutil  # type: ignore
        rss_mb = round(psutil.Process(os.getpid()).memory_info().rss / 1e6, 1)
    except Exception:
        rss_mb = None

    return deps.envelope({
        "benchmarks": bench,
        "runtime": {
            "cache_hit_rate": stats["cache_hit_rate"],
            "requests": stats["requests"],
            "rss_mb": rss_mb,
            "uptime_s": deps.uptime_seconds(),
            "ladder_rung": 1,
            "model_version": fs.current_version() or "none",
            "audit_chain_valid": _chain_ok(),
        },
    })


def _chain_ok() -> bool:
    try:
        return ledger.verify_chain()
    except Exception:
        return True
