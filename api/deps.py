"""Shared API plumbing: the response envelope, settings, and the cache.

The envelope is built here rather than per route, so every 200 response carries
its provenance whether or not the route author remembered.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from core import forecast_store as fs
from decision import ledger

FIXTURE_DIR = Path(os.getenv("PHARMAPULSE_FIXTURE_DIR", "contracts/fixtures"))
BENCHMARKS = Path("artifacts/benchmarks.json")

SERIES_IDS = ["M01AB", "M01AE", "N02BA", "N02BE", "N05B", "N05C", "R03", "R06"]

SERIES_META = {
    "M01AB": ("Anti-inflammatory, acetic acid derivatives", "Diclofenac", "October"),
    "M01AE": ("Anti-inflammatory, propionic acid derivatives", "Ibuprofen", "December"),
    "N02BA": ("Salicylic acid derivatives", "Aspirin", "January"),
    "N02BE": ("Anilides", "Paracetamol", "January"),
    "N05B": ("Anxiolytics", "Anxiolytics", "March"),
    "N05C": ("Hypnotics and sedatives", "Sedatives", "January"),
    "R03": ("Obstructive airway drugs", "Asthma / COPD", "December"),
    "R06": ("Antihistamines for systemic use", "Antihistamines", "May"),
}

DAILY_MEAN = {"M01AB": 5.03, "M01AE": 3.90, "N02BA": 3.88, "N02BE": 29.92,
              "N05B": 8.85, "N05C": 0.59, "R03": 5.51, "R06": 2.90}

DEFAULT_SETTINGS: dict[str, Any] = {
    "lead_time_days": 4,
    "holding_cost_rate": 0.22,
    "expiry_risk_rate": 0.015,
    "review_period_days": 7,
    "currency": "INR",
    "service_level_default": 0.95,
    "per_series": {
        # Seeded so the demo opens on a realistic mix of states rather than
        # everything red: some healthy, one overstocked, several needing a
        # decision. All lane 2 - editable, and never seen by the trainer.
        "M01AB": {"pack_size": 10, "unit_cost": 9.0, "unit_margin": 3.0, "stock_on_hand": 60},
        "M01AE": {"pack_size": 10, "unit_cost": 8.5, "unit_margin": 2.8, "stock_on_hand": 18},
        "N02BA": {"pack_size": 10, "unit_cost": 6.0, "unit_margin": 2.0, "stock_on_hand": 44},
        "N02BE": {"pack_size": 10, "unit_cost": 12.5, "unit_margin": 4.0, "stock_on_hand": 95},
        "N05B": {"pack_size": 10, "unit_cost": 15.0, "unit_margin": 5.5, "stock_on_hand": 30},
        "N05C": {"pack_size": 5, "unit_cost": 22.0, "unit_margin": 7.0, "stock_on_hand": 9},
        "R03": {"pack_size": 10, "unit_cost": 45.0, "unit_margin": 14.0, "stock_on_hand": 22},
        "R06": {"pack_size": 10, "unit_cost": 11.0, "unit_margin": 3.5, "stock_on_hand": 320},
    },
}

_START = time.time()
_REQUESTS = {"total": 0, "cache_hits": 0}


# --- mode -----------------------------------------------------------------

def use_fixtures() -> bool:
    """Explicit override wins; otherwise fall back to fixtures only if the
    forecast store is genuinely missing. This is rung 5 of the degradation
    ladder and the switch we flip if the model layer dies on stage."""
    env = os.getenv("PHARMAPULSE_FIXTURES")
    if env is not None:
        return env == "1"
    return not fs.store_available()


def fixture(name: str) -> dict:
    path = FIXTURE_DIR / f"{name}.json"
    if not path.exists():
        raise HTTPException(status_code=503, detail=error(
            "NO_FORECAST_YET", f"fixture {name} missing; run make fixtures"))
    return json.loads(path.read_text(encoding="utf-8"))


# --- envelope -------------------------------------------------------------

def correlation_id() -> str:
    return "c-" + uuid.uuid4().hex[:8]


def error(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message,
                      "correlation_id": correlation_id()}}


def meta(degraded: str | None = None, origin: str = "observed") -> dict:
    if use_fixtures():
        return {
            "origin": "synthetic", "model_version": "fixtures/day0",
            "snapshot_id": "sha256:0000fixture0",
            "generated_at": None, "stale": True, "degraded": "fixtures",
            "correlation_id": correlation_id(),
        }
    m = fs.model_meta()
    return {
        "origin": origin,
        "model_version": m.get("model_version", "unknown"),
        "snapshot_id": m.get("snapshot_id", "unknown"),
        "generated_at": m.get("generated_at"),
        "stale": bool(m.get("stale", False)),
        "degraded": degraded,
        "correlation_id": correlation_id(),
    }


def envelope(data: Any, degraded: str | None = None,
             origin: str = "observed") -> dict:
    return {"data": data, "meta": meta(degraded, origin)}


def require_series(series_id: str) -> None:
    if series_id not in SERIES_IDS:
        raise HTTPException(status_code=404, detail=error(
            "SERIES_NOT_FOUND", f"unknown series {series_id}"))


# --- settings (lane 2) ----------------------------------------------------

def load_settings() -> dict:
    """Read lane-2 parameters. These never reach the trainer."""
    with ledger.connect() as conn:
        row = conn.execute(
            "SELECT value FROM settings WHERE key = 'main'").fetchone()
    if row:
        try:
            stored = json.loads(row["value"])
            merged = {**DEFAULT_SETTINGS, **stored}
            merged["per_series"] = {**DEFAULT_SETTINGS["per_series"],
                                    **stored.get("per_series", {})}
            return merged
        except Exception:
            pass
    return json.loads(json.dumps(DEFAULT_SETTINGS))


def save_settings(patch: dict) -> dict:
    current = load_settings()
    per_series = {**current.get("per_series", {})}
    for sid, vals in (patch.get("per_series") or {}).items():
        per_series[sid] = {**per_series.get(sid, {}), **vals}
    merged = {**current, **{k: v for k, v in patch.items() if k != "per_series"},
              "per_series": per_series}
    with ledger.connect() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('main', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (json.dumps(merged),))
    return merged


def series_settings(series_id: str, settings: dict | None = None) -> dict:
    s = settings or load_settings()
    per = s.get("per_series", {}).get(series_id, {})
    return {
        "lead_time_days": s.get("lead_time_days", 4),
        "holding_cost_rate": s.get("holding_cost_rate", 0.22),
        "expiry_risk_rate": s.get("expiry_risk_rate", 0.015),
        "review_period_days": s.get("review_period_days", 7),
        "pack_size": per.get("pack_size", 10),
        "unit_cost": per.get("unit_cost", 12.5),
        "unit_margin": per.get("unit_margin", 4.0),
        "stock_on_hand": per.get("stock_on_hand", 0.0),
    }


# --- cache ----------------------------------------------------------------

@lru_cache(maxsize=512)
def _cached_quantiles(series_id: str, grain: str, horizon: int,
                      model_version: str) -> str:
    """model_version is in the key, so publishing a model self-invalidates the
    cache with no manual flush step that somebody could forget."""
    return json.dumps(fs.read_quantiles(series_id, grain, horizon))


def cached_quantiles(series_id: str, grain: str, horizon: int) -> dict:
    version = fs.current_version() or "none"
    before = _cached_quantiles.cache_info().hits
    payload = _cached_quantiles(series_id, grain, horizon, version)
    _REQUESTS["total"] += 1
    if _cached_quantiles.cache_info().hits > before:
        _REQUESTS["cache_hits"] += 1
    return json.loads(payload)


def cache_stats() -> dict:
    total = max(_REQUESTS["total"], 1)
    return {"cache_hit_rate": round(_REQUESTS["cache_hits"] / total, 3),
            "requests": _REQUESTS["total"]}


def uptime_seconds() -> float:
    return round(time.time() - _START, 1)


def benchmarks() -> dict:
    if not BENCHMARKS.exists():
        return {}
    try:
        return json.loads(BENCHMARKS.read_text(encoding="utf-8"))
    except Exception:
        return {}
