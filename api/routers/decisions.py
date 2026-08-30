"""Order recommendation, risk list and lane-2 settings."""

from __future__ import annotations

import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from api import deps
from core import forecast_store as fs
from decision import ledger, risk as risk_engine
from decision.newsvendor import (
    OrderParams,
    protection_interval_days,
    recommend_order,
)
from pipelines.gold import read_gold

router = APIRouter(prefix="/api", tags=["decision"])


class RecommendRequest(BaseModel):
    series_id: str = "N02BE"
    service_level: float | None = Field(default=None, ge=0.01, le=0.999)
    lead_time_days: int | None = Field(default=None, ge=1, le=90)
    stock_on_hand: float | None = Field(default=None, ge=0)
    pack_size: int | None = Field(default=None, ge=1, le=1000)
    unit_cost: float | None = Field(default=None, gt=0)
    unit_margin: float | None = Field(default=None, gt=0)
    holding_cost_rate: float | None = Field(default=None, ge=0, le=5)
    expiry_risk_rate: float | None = Field(default=None, ge=0, le=1)
    review_period_days: int | None = Field(default=None, ge=1, le=90)


class OrderCommit(BaseModel):
    series_id: str
    recommended: int
    accepted: int
    service_level: float | None = None
    reason: str = ""
    actor: str = "demo"


def _params_for(series_id: str, body: RecommendRequest | None = None) -> OrderParams:
    base = deps.series_settings(series_id)
    overrides = body.model_dump(exclude_none=True) if body else {}
    merged = {**base, **{k: v for k, v in overrides.items() if k != "series_id"}}
    merged.pop("opening_stock", None)
    return OrderParams(
        lead_time_days=int(merged["lead_time_days"]),
        stock_on_hand=float(merged["stock_on_hand"]),
        pack_size=int(merged["pack_size"]),
        unit_cost=float(merged["unit_cost"]),
        unit_margin=float(merged["unit_margin"]),
        holding_cost_rate=float(merged["holding_cost_rate"]),
        expiry_risk_rate=float(merged["expiry_risk_rate"]),
        review_period_days=int(merged["review_period_days"]),
        service_level=merged.get("service_level"),
    )


def _order_for(series_id: str, params: OrderParams):
    # Size against the protection interval, not the lead time alone: with a
    # weekly review and a 4-day lead time the order must last 11 days, not 4.
    horizon = protection_interval_days(params.lead_time_days,
                                       params.review_period_days)
    dist = fs.lead_time_demand(series_id, horizon)
    return recommend_order(dist, params, series_id=series_id,
                           daily_mean=deps.DAILY_MEAN.get(series_id))


@router.post("/recommend")
def recommend(body: RecommendRequest) -> dict:
    deps.require_series(body.series_id)
    if deps.use_fixtures():
        return deps.envelope(deps.fixture("recommend")["data"])

    params = _params_for(body.series_id, body)
    try:
        result = _order_for(body.series_id, params)
    except (KeyError, FileNotFoundError) as exc:
        raise HTTPException(status_code=503, detail=deps.error(
            "NO_FORECAST_YET", str(exc))) from exc

    payload = result.as_dict()
    payload["projected_stockout_date"] = _projected_stockout(
        body.series_id, params.stock_on_hand)
    return deps.envelope(payload)


def _projected_stockout(series_id: str, stock_on_hand: float) -> str | None:
    try:
        daily = fs.read_forecast(series_id, "day", horizon=28)
    except Exception:
        return None
    median = daily[daily["quantile"] == 0.50].sort_values("horizon")
    pairs = [(pd.Timestamp(r.ds).strftime("%Y-%m-%d"), float(r.value))
             for r in median.itertuples()]
    return ledger.projected_stockout(stock_on_hand, pairs)


@router.get("/risk")
def risk(limit: int = Query(20, ge=1, le=100)) -> dict:
    if deps.use_fixtures():
        return deps.envelope(deps.fixture("risk")["data"])

    settings = deps.load_settings()
    try:
        gold = read_gold("week")
        last_month = int(pd.Timestamp(gold["ds"].max()).month)
    except Exception:
        last_month = None

    collected: list = []
    for sid in deps.SERIES_IDS:
        params = _params_for(sid)
        try:
            order = _order_for(sid, params)
        except Exception:
            continue
        collected.extend(risk_engine.detect(sid, order, params, month=last_month))

    ranked = risk_engine.rank(collected, limit=limit)
    return deps.envelope({
        "total_exposure": risk_engine.total_exposure(ranked),
        "currency": settings.get("currency", "INR"),
        "items": [r.as_dict() for r in ranked],
    })


@router.get("/positions")
def positions() -> dict:
    """Live shelf position per product - what the dashboard opens on."""
    if deps.use_fixtures():
        return deps.envelope(deps.fixture("positions")["data"])

    out = []
    for sid in deps.SERIES_IDS:
        params = _params_for(sid)
        try:
            order = _order_for(sid, params)
        except Exception:
            continue
        name = risk_engine.SERIES_NAMES.get(sid, sid)
        out.append({
            "series_id": sid, "name": name,
            "stock_on_hand": round(params.stock_on_hand, 1),
            "days_of_cover": round(order.days_of_cover, 1),
            "status": order.status,
            "order_quantity": order.order_quantity,
            "p_stockout": round(order.p_stockout, 4),
            "reorder_point": round(order.reorder_point, 1),
            "projected_stockout_date": _projected_stockout(sid, params.stock_on_hand),
            "daily_mean": deps.DAILY_MEAN.get(sid),
        })
    return deps.envelope({"positions": out})


@router.get("/settings")
def get_settings() -> dict:
    if deps.use_fixtures():
        return deps.envelope(deps.fixture("settings")["data"])
    return deps.envelope(deps.load_settings(), origin="user_setting")


@router.put("/settings")
def put_settings(patch: dict) -> dict:
    """Lane 2. Editable, and never seen by the trainer."""
    return deps.envelope(deps.save_settings(patch), origin="user_setting")


@router.post("/orders")
def commit_order(body: OrderCommit) -> dict:
    """Accept or override a recommendation. Overrides need a reason.

    Appends to a hash-chained log: each entry stores the previous entry's hash,
    so an edit or deletion is detectable. The system recommends; a person commits.
    """
    deps.require_series(body.series_id)
    try:
        digest = ledger.log_order(
            body.series_id, pd.Timestamp.now().strftime("%Y-%m-%d"),
            recommended=body.recommended, accepted=body.accepted,
            service_level=body.service_level, reason=body.reason, actor=body.actor)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=deps.error(
            "INVALID_PARAMS", str(exc))) from exc

    # The order is a real movement, not just a log line: post it as a goods
    # receipt so the position on the next screen reflects the decision. In
    # production this would land when the delivery does; here it lands now,
    # which is the honest simplification for a single-machine demo.
    if body.accepted > 0:
        ledger.post(body.series_id, pd.Timestamp.now().strftime("%Y-%m-%d"),
                    "received", body.accepted,
                    note=f"order accepted (recommended {body.recommended})")

    settings = deps.series_settings(body.series_id)
    return deps.envelope({"logged": True, "hash": digest[:16],
                          "chain_valid": ledger.verify_chain(),
                          "stock_on_hand": round(settings["stock_on_hand"], 1),
                          "received": body.accepted},
                         origin="user_setting")


@router.get("/ledger")
def stock_ledger(series_id: str = Query("N02BE")) -> dict:
    """The movement trail behind the position - what the number is made of."""
    deps.require_series(series_id)
    frame = ledger.ledger_frame(series_id)
    settings = deps.series_settings(series_id)

    events = [{"ds": r.ds, "kind": r.kind, "quantity": round(float(r.quantity), 2)}
              for r in frame.itertuples()]
    return deps.envelope({
        "series_id": series_id,
        "opening_stock": settings["opening_stock"],
        "movements": events,
        "stock_on_hand": round(settings["stock_on_hand"], 1),
    }, origin="user_setting")
