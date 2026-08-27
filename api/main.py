"""PharmaPulse API — DAY 0 SCAFFOLD.

Pod C owns this file. It currently serves contracts/fixtures/*.json verbatim so that
Pod D can build against a real HTTP server from hour one and `docker compose up`
produces a working system on Day 0.

Replace one endpoint at a time with a real read. Keep the PHARMAPULSE_FIXTURES switch
working all week: it is rung 5 of the degradation ladder and the fallback you flip if
the model layer dies during the demo.

Contract: CONTRACTS.md section C3. Change a shape there first, with a change-log line.
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

FIXTURE_DIR = Path(os.getenv("PHARMAPULSE_FIXTURE_DIR", "contracts/fixtures"))
USE_FIXTURES = os.getenv("PHARMAPULSE_FIXTURES", "1") == "1"

SERIES_IDS = ["M01AB", "M01AE", "N02BA", "N02BE", "N05B", "N05C", "R03", "R06"]

app = FastAPI(
    title="PharmaPulse API",
    version="0.1.0",
    description="Demand distribution to purchase order. See CONTRACTS.md section C3.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def load_fixture(name: str) -> dict[str, Any]:
    path = FIXTURE_DIR / f"{name}.json"
    if not path.exists():
        raise HTTPException(
            status_code=503,
            detail={"error": {"code": "NO_FORECAST_YET",
                              "message": f"fixture {name} missing; run make fixtures",
                              "correlation_id": correlation_id()}},
        )
    return json.loads(path.read_text(encoding="utf-8"))


def correlation_id() -> str:
    return "c-" + uuid.uuid4().hex[:8]


def envelope(data: dict[str, Any], meta_overrides: dict[str, Any] | None = None) -> dict:
    """Every 200 response carries this. Build it here, never per route."""
    meta = {
        "origin": "observed",
        "model_version": "day0-scaffold/fixtures",
        "snapshot_id": "sha256:0000fixture0",
        "generated_at": "2026-08-27T00:00:00Z",
        "stale": False,
        "degraded": "fixtures" if USE_FIXTURES else None,
        "correlation_id": correlation_id(),
    }
    meta.update(meta_overrides or {})
    return {"data": data, "meta": meta}


def serve(name: str) -> dict:
    """Fixture passthrough with a fresh correlation id."""
    obj = load_fixture(name)
    return envelope(obj["data"], obj.get("meta"))


# --- P0 -------------------------------------------------------------------

@app.get("/api/health")
def health() -> dict:
    return envelope({
        "status": "ok",
        "ladder_rung": 5 if USE_FIXTURES else 1,
        "forecast_store": "fixtures" if USE_FIXTURES else "present",
        "stale": False,
    })


@app.get("/api/series")
def series() -> dict:
    return serve("series")


@app.get("/api/history")
def history(series_id: str = Query("N02BE"), grain: str = Query("week")) -> dict:
    require_series(series_id)
    return serve("history")


@app.get("/api/forecast")
def forecast(series_id: str = Query("N02BE"), grain: str = Query("week"),
             horizon: int = Query(8, ge=1)) -> dict:
    require_series(series_id)
    obj = load_fixture("forecast")
    max_horizon = obj["data"].get("max_horizon", 75)
    if horizon > max_horizon:
        raise HTTPException(
            status_code=422,
            detail={"error": {"code": "HORIZON_TOO_LONG",
                              "message": f"max horizon for this series is {max_horizon}",
                              "correlation_id": correlation_id()}},
        )
    data = dict(obj["data"])
    data["points"] = data["points"][:horizon]
    return envelope(data, obj.get("meta"))


@app.post("/api/recommend")
def recommend(body: dict[str, Any]) -> dict:
    require_series(body.get("series_id", "N02BE"))
    return serve("recommend")


# --- P1 -------------------------------------------------------------------

@app.get("/api/risk")
def risk(limit: int = Query(20, ge=1, le=100)) -> dict:
    obj = load_fixture("risk")
    data = dict(obj["data"])
    data["items"] = data["items"][:limit]
    return envelope(data, obj.get("meta"))


@app.get("/api/explain")
def explain(series_id: str = Query("R06"), grain: str = Query("month"),
            horizon: int = Query(1, ge=1)) -> dict:
    require_series(series_id)
    return serve("explain")


@app.get("/api/metrics")
def metrics() -> dict:
    return serve("metrics")


@app.get("/api/settings")
def get_settings() -> dict:
    return serve("settings")


@app.put("/api/settings")
def put_settings(body: dict[str, Any]) -> dict:
    # Pod C1: persist to data/warehouse/ops.db. Lane 2 - never reaches the trainer.
    obj = load_fixture("settings")
    data = {**obj["data"], **body}
    return envelope(data, obj.get("meta"))


# --- helpers --------------------------------------------------------------

def require_series(series_id: str) -> None:
    if series_id not in SERIES_IDS:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "SERIES_NOT_FOUND",
                              "message": f"unknown series {series_id}",
                              "correlation_id": correlation_id()}},
        )
