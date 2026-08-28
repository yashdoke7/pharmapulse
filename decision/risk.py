"""Risk detection and recommendations, ranked by money.

Four rules, each attaching a probability AND a monetary exposure.

Ranking is by MONETARY EXPOSURE, not by probability: a 30% chance of running
out of the highest-volume product matters more to a buyer than a 90% chance on
something that sells twice a month. The home screen is the list of products
that are not `ok`, sorted by rupees.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

from decision.newsvendor import (
    STATUS_ORDER_NOW,
    STATUS_OVERSTOCKED,
    STATUS_WATCH,
    OrderParams,
    OrderResult,
    p_stockout,
)

STOCKOUT = "stockout"
OVERSTOCK = "overstock"
EXPIRY = "expiry"
ANOMALY = "anomaly"

ACTION_ORDER_NOW = "order_now"
ACTION_ORDER_EARLY = "order_early"
ACTION_DO_NOT_ORDER = "do_not_order"
ACTION_SLOW_MOVER = "slow_mover"
ACTION_WATCH = "watch"

STOCKOUT_THRESHOLD = 0.20
OVERSTOCK_DAYS = 30.0
SLOW_MOVER_DAYS = 45.0

SERIES_NAMES = {
    "M01AB": "Diclofenac", "M01AE": "Ibuprofen", "N02BA": "Aspirin",
    "N02BE": "Paracetamol", "N05B": "Anxiolytics", "N05C": "Sedatives",
    "R03": "Asthma / COPD", "R06": "Antihistamines",
}

# Months in which a known seasonal build-up begins, from the measured peaks.
SEASONAL_BUILDUP = {"R06": (4, "the May pollen season"),
                    "N02BE": (12, "the January flu wave"),
                    "R03": (11, "the December cold-air peak")}


@dataclass
class Risk:
    series_id: str
    type: str
    severity: str
    probability: float
    exposure: float
    headline: str
    detail: str
    recommended_action: str
    recommended_quantity: int = 0

    def as_dict(self) -> dict:
        d = asdict(self)
        d["probability"] = round(self.probability, 4)
        d["exposure"] = round(self.exposure, 2)
        return d


def _name(series_id: str) -> str:
    return SERIES_NAMES.get(series_id, series_id)


def _severity(probability: float) -> str:
    if probability >= 0.60:
        return "high"
    if probability >= 0.30:
        return "medium"
    return "low"


def detect(series_id: str, order: OrderResult, params: OrderParams,
           month: int | None = None, last_observation: float | None = None,
           forecast_band: tuple[float, float] | None = None) -> list[Risk]:
    """Evaluate the four rules for one product."""
    risks: list[Risk] = []
    name = _name(series_id)
    margin = params.unit_margin
    unit_cost = params.unit_cost

    # 1. Stockout - evaluated at the CURRENT shelf position, before the
    #    proposed order is added. order.p_stockout is the risk that REMAINS
    #    after ordering; the buyer needs to know the risk they have now, which
    #    is what makes this an exception worth surfacing.
    exposed = p_stockout(order.lead_time_demand, order.stock_on_hand)
    if exposed >= STOCKOUT_THRESHOLD:
        shortfall = max(0.0, order.target_level - order.stock_on_hand)
        exposure = shortfall * margin * exposed
        cover = order.days_of_cover
        risks.append(Risk(
            series_id=series_id, type=STOCKOUT,
            severity=_severity(exposed),
            probability=exposed, exposure=exposure,
            headline=f"{name} runs out before the next delivery",
            detail=(f"{cover:.1f} days of cover against a "
                    f"{params.lead_time_days}-day lead time."),
            recommended_action=ACTION_ORDER_NOW,
            recommended_quantity=order.order_quantity,
        ))

    # 2. Overstock - exposure is the capital tied up plus the expiry risk on it.
    if order.days_of_cover > OVERSTOCK_DAYS:
        excess_days = order.days_of_cover - OVERSTOCK_DAYS
        per_day = (order.stock_on_hand / order.days_of_cover
                   if order.days_of_cover > 0 else 0.0)
        excess_units = excess_days * per_day
        holding = unit_cost * params.holding_cost_rate * (excess_days / 365.0)
        exposure = excess_units * (holding + unit_cost * params.expiry_risk_rate)
        action = (ACTION_SLOW_MOVER if order.days_of_cover > SLOW_MOVER_DAYS
                  else ACTION_DO_NOT_ORDER)
        risks.append(Risk(
            series_id=series_id, type=OVERSTOCK, severity="medium",
            probability=min(0.99, order.days_of_cover / (OVERSTOCK_DAYS * 2)),
            exposure=exposure,
            headline=f"{name} has {order.days_of_cover:.0f} days of cover",
            detail=(f"Capital tied up against a "
                    f"{params.review_period_days}-day review period."),
            recommended_action=action, recommended_quantity=0,
        ))

    # 3. Demand anomaly - the last observation fell outside the forecast band.
    if last_observation is not None and forecast_band is not None:
        lo, hi = forecast_band
        if last_observation < lo or last_observation > hi:
            direction = "above" if last_observation > hi else "below"
            risks.append(Risk(
                series_id=series_id, type=ANOMALY, severity="low",
                probability=0.30,
                exposure=abs(last_observation - (hi if direction == "above" else lo))
                * margin,
                headline=f"{name}: last period fell {direction} the 95% interval",
                detail=("One observation outside the band is expected about "
                        "1 period in 20; two in a row is a signal."),
                recommended_action=ACTION_WATCH, recommended_quantity=0,
            ))

    # 4. Seasonal build-up starting inside the lead time - order early.
    if month is not None and series_id in SEASONAL_BUILDUP:
        trigger_month, label = SEASONAL_BUILDUP[series_id]
        if month == trigger_month and order.status != STATUS_OVERSTOCKED:
            risks.append(Risk(
                series_id=series_id, type=STOCKOUT, severity="medium",
                probability=0.40,
                exposure=order.target_level * margin * 0.4,
                headline=f"{name}: {label} starts inside the lead time",
                detail=("The peak is known months ahead from six years of "
                        "history, so it can be ordered against rather than "
                        "reacted to."),
                recommended_action=ACTION_ORDER_EARLY,
                recommended_quantity=order.order_quantity,
            ))

    return risks


def rank(risks: list[Risk], limit: int = 20) -> list[Risk]:
    """Sort by monetary exposure, descending. This ordering is a design claim."""
    return sorted(risks, key=lambda r: r.exposure, reverse=True)[:limit]


def total_exposure(risks: list[Risk]) -> float:
    return round(sum(r.exposure for r in risks), 2)


@dataclass
class Recommendation:
    series_id: str
    action: str
    quantity: int
    rationale: str
    basis: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return asdict(self)


def build_recommendation(series_id: str, order: OrderResult,
                         risks: list[Risk]) -> Recommendation:
    """Turn the order plus its risks into a single proposed action.

    Each recommendation carries the inputs that produced it, so the interface
    can show its basis rather than presenting an unexplained instruction.
    """
    by_type = {r.type: r for r in risks}
    early = next((r for r in risks
                  if r.recommended_action == ACTION_ORDER_EARLY), None)

    if early:
        action, qty = ACTION_ORDER_EARLY, order.order_quantity
        rationale = early.headline
    elif order.status == STATUS_ORDER_NOW or STOCKOUT in by_type:
        action, qty = ACTION_ORDER_NOW, order.order_quantity
        rationale = (f"Stock is below the reorder point of "
                     f"{order.reorder_point:.0f} units at a "
                     f"{order.service_level_used:.0%} service level.")
    elif order.status == STATUS_OVERSTOCKED:
        action, qty = ACTION_SLOW_MOVER, 0
        rationale = (f"{order.days_of_cover:.0f} days of cover; capital is "
                     "stuck. Consider a markdown before ordering more.")
    elif order.status == STATUS_WATCH:
        action, qty = ACTION_WATCH, order.order_quantity
        rationale = "Cover is close to the lead time. Review at the next window."
    else:
        action, qty = ACTION_DO_NOT_ORDER, 0
        rationale = ("Stock already exceeds forecast demand for the whole "
                     "review period.")

    return Recommendation(
        series_id=series_id, action=action, quantity=qty, rationale=rationale,
        basis=order.inputs_used,
    )
