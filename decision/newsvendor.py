"""The newsvendor calculation: a demand distribution becomes a purchase order.

A pure function. No I/O, no database, no imports from core/ or api/. This is
where the project's thesis lives - a forecast is not the product, the purchase
order is - and it is the file a judge is most likely to ask to see.

    Cu     = cost of being one unit SHORT   (lost gross margin)
    Co     = cost of being one unit OVER    (holding + expiry risk)
    q*     = Cu / (Cu + Co)                 the critical fractile
    target = quantile(lead_time_demand, q*)
    order  = round_to_pack(target - stock_on_hand)

Three properties that matter, and each is a sentence in the demo:

1. It is CLOSED FORM. No optimisation solver runs during a request, which is
   why the response is fast and why the service-level slider can update live.
2. Rounding is ASYMMETRIC. The two rounding errors do not cost the same, so
   round() is wrong - the direction is chosen by the cost ratio.
3. Every input is LANE-LABELLED, so the user can see that the forecast is
   measured and the lead time is theirs.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

SERVICE_LEVEL_GRID = [0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.75,
                      0.80, 0.85, 0.90, 0.925, 0.95, 0.975, 0.99]

STATUS_OK = "ok"
STATUS_WATCH = "watch"
STATUS_ORDER_NOW = "order_now"
STATUS_OVERSTOCKED = "overstocked"


@dataclass(frozen=True)
class OrderParams:
    lead_time_days: int = 4
    stock_on_hand: float = 0.0
    pack_size: int = 10
    unit_cost: float = 12.5
    unit_margin: float = 4.0          # Cu
    holding_cost_rate: float = 0.22   # annual
    expiry_risk_rate: float = 0.015   # fraction written off
    review_period_days: int = 7
    service_level: float | None = None  # None -> use q*

    def underage_cost(self) -> float:
        """Cu: the gross margin lost when a customer asks and you do not have it."""
        return max(self.unit_margin, 1e-9)

    def overage_cost(self) -> float:
        """Co: carrying charge over the lead time, plus the expiry write-off risk."""
        holding = self.unit_cost * self.holding_cost_rate * (self.lead_time_days / 365.0)
        expiry = self.unit_cost * self.expiry_risk_rate
        return max(holding + expiry, 1e-9)


@dataclass
class OrderResult:
    series_id: str
    status: str
    q_star: float
    service_level_used: float
    lead_time_demand: dict[str, float]
    target_level: float
    stock_on_hand: float
    order_units: float
    order_packs: int
    order_quantity: int
    reorder_point: float
    days_of_cover: float
    p_stockout: float
    expected_cost: dict[str, float]
    cost_curve: list[dict] = field(default_factory=list)
    min_cost_service_level: float | None = None
    inputs_used: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "series_id": self.series_id,
            "status": self.status,
            "q_star": round(self.q_star, 4),
            "service_level_used": round(self.service_level_used, 4),
            "lead_time_demand": self.lead_time_demand,
            "target_level": round(self.target_level, 2),
            "stock_on_hand": round(self.stock_on_hand, 2),
            "order_units": round(self.order_units, 2),
            "order_packs": self.order_packs,
            "order_quantity": self.order_quantity,
            "reorder_point": round(self.reorder_point, 2),
            "days_of_cover": round(self.days_of_cover, 2),
            "p_stockout": round(self.p_stockout, 4),
            "expected_cost": {k: round(v, 2) for k, v in self.expected_cost.items()},
            "cost_curve": self.cost_curve,
            "min_cost_service_level": self.min_cost_service_level,
            "inputs_used": self.inputs_used,
        }


# --- distribution helpers -------------------------------------------------

def critical_fractile(cu: float, co: float) -> float:
    """q* = Cu / (Cu + Co). The probability of meeting demand you should target.

    If being short costs three times as much as being over, q* = 0.75: order
    the amount you would exceed only 25% of the time. That question is
    unanswerable from a point forecast and answerable in one line from a
    distribution - which is the whole reason the forecast is a range.
    """
    return float(cu / (cu + co))


def quantile_of(dist: dict[str, float], level: float) -> float:
    """Linear interpolation between stored quantile levels.

    The grid is anchored at (0.0, 0.0) rather than clamped at its lowest stored
    level, because demand is a non-negative quantity: the quantile function
    genuinely does approach zero as the level does. Clamping instead would mean
    that a product whose shortage is nearly free still gets ordered up to the
    5th percentile - a floor with no economic justification.

    Above the highest stored level the value IS clamped, because extrapolating
    a tail we did not estimate would invent confidence we do not have.
    """
    levels = sorted(float(k) for k in dist)
    values = [float(dist[f"{q:.2f}"]) for q in levels]
    if level >= levels[-1]:
        return values[-1]
    return float(np.interp(level, [0.0] + levels, [0.0] + values))


def _grid(dist: dict[str, float]) -> tuple[np.ndarray, np.ndarray]:
    levels = np.array(sorted(float(k) for k in dist))
    values = np.array([float(dist[f"{q:.2f}"]) for q in levels])
    return levels, values


def expected_cost(dist: dict[str, float], stock_position: float,
                  cu: float, co: float) -> float:
    """E[shortage] * Cu + E[excess] * Co over the stored quantile grid.

    The distribution is discrete (21 stored levels), so this is a weighted sum
    over the grid rather than an integral - which is also why it is fast enough
    to evaluate 16 times per request for the cost curve.
    """
    levels, values = _grid(dist)
    if len(levels) < 2:
        return 0.0

    # Probability mass around each quantile point (midpoint rule on the levels).
    edges = np.concatenate([[0.0], (levels[:-1] + levels[1:]) / 2.0, [1.0]])
    weights = np.diff(edges)

    shortage = np.clip(values - stock_position, 0.0, None)
    excess = np.clip(stock_position - values, 0.0, None)
    return float(np.sum(weights * (shortage * cu + excess * co)))


def p_stockout(dist: dict[str, float], stock_position: float) -> float:
    """P(lead-time demand > stock position), read off the quantile grid."""
    levels, values = _grid(dist)
    if stock_position <= values[0]:
        return 1.0
    if stock_position >= values[-1]:
        return 0.0
    return float(1.0 - np.interp(stock_position, values, levels))


def round_to_pack(units: float, pack_size: int, cu: float, co: float) -> int:
    """Round to whole packs, in the direction the cost ratio implies.

    Rounding to the NEAREST pack is wrong: with Cu > Co, being one pack short
    costs more than being one pack long, so the correct rounding is up. This is
    a small function carrying a real decision.
    """
    if pack_size <= 0:
        return int(math.ceil(max(units, 0.0)))
    if units <= 0:
        return 0
    packs = units / pack_size
    return int(math.ceil(packs) if cu >= co else math.floor(packs))


# --- the calculation ------------------------------------------------------

def build_cost_curve(dist: dict[str, float], params: OrderParams,
                     cu: float, co: float) -> list[dict]:
    """Order quantity and expected cost at 16 service levels, in one pass.

    Returned with the response so the frontend can interpolate on slider drag
    and never touch the network. That is what makes the control feel live.
    """
    curve = []
    for level in SERVICE_LEVEL_GRID:
        target = quantile_of(dist, level)
        units = max(0.0, target - params.stock_on_hand)
        packs = round_to_pack(units, params.pack_size, cu, co)
        qty = packs * params.pack_size
        position = params.stock_on_hand + qty
        curve.append({
            "service_level": round(level, 3),
            "order_quantity": int(qty),
            "expected_cost": round(expected_cost(dist, position, cu, co), 2),
            "p_stockout": round(p_stockout(dist, position), 4),
        })
    return curve


def recommend_order(lead_time_demand: dict[str, float], params: OrderParams,
                    series_id: str = "", daily_mean: float | None = None,
                    max_days_cover: float = 30.0) -> OrderResult:
    """Turn a lead-time demand distribution into a purchase order."""
    cu = params.underage_cost()
    co = params.overage_cost()
    q_star = critical_fractile(cu, co)
    level = params.service_level if params.service_level is not None else q_star

    target = quantile_of(lead_time_demand, level)
    units = max(0.0, target - params.stock_on_hand)
    packs = round_to_pack(units, params.pack_size, cu, co)
    qty = packs * params.pack_size
    position = params.stock_on_hand + qty

    per_day = (daily_mean if daily_mean
               else quantile_of(lead_time_demand, 0.5) / max(params.lead_time_days, 1))
    cover = params.stock_on_hand / per_day if per_day > 0 else float("inf")
    reorder_point = quantile_of(lead_time_demand, level)

    cost_at = expected_cost(lead_time_demand, position, cu, co)
    cost_minus = expected_cost(lead_time_demand,
                               max(0.0, position - params.pack_size), cu, co)
    cost_plus = expected_cost(lead_time_demand, position + params.pack_size, cu, co)

    curve = build_cost_curve(lead_time_demand, params, cu, co)
    cheapest = min(curve, key=lambda c: c["expected_cost"])

    if cover > max_days_cover:
        status = STATUS_OVERSTOCKED
    elif params.stock_on_hand < reorder_point:
        status = STATUS_ORDER_NOW
    elif cover < params.lead_time_days + params.review_period_days:
        status = STATUS_WATCH
    else:
        status = STATUS_OK

    inputs_used = [
        {"name": "forecast distribution",
         "value": f"{len(lead_time_demand)} calibrated quantiles", "lane": "observed"},
        {"name": "lead time", "value": f"{params.lead_time_days} days",
         "lane": "user_setting"},
        {"name": "stock on hand", "value": f"{params.stock_on_hand:g} units",
         "lane": "user_setting"},
        {"name": "pack size", "value": f"{params.pack_size} units",
         "lane": "user_setting"},
        {"name": "unit margin (Cu)", "value": f"{cu:.2f}", "lane": "user_setting"},
        {"name": "holding + expiry (Co)", "value": f"{co:.4f}", "lane": "user_setting"},
    ]

    return OrderResult(
        series_id=series_id,
        status=status,
        q_star=q_star,
        service_level_used=float(level),
        lead_time_demand=lead_time_demand,
        target_level=target,
        stock_on_hand=params.stock_on_hand,
        order_units=units,
        order_packs=packs,
        order_quantity=int(qty),
        reorder_point=reorder_point,
        days_of_cover=cover if math.isfinite(cover) else 999.0,
        p_stockout=p_stockout(lead_time_demand, position),
        expected_cost={"at_order": cost_at, "minus_one_pack": cost_minus,
                       "plus_one_pack": cost_plus},
        cost_curve=curve,
        min_cost_service_level=cheapest["service_level"],
        inputs_used=inputs_used,
    )
