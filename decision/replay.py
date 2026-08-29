"""Replay mode: the real history, arriving in the order it originally did.

The demo problem is that a live system is hard to show when the data ends in
2019. The solution uses only real data - replay it.

A chosen window of the actual daily history is stepped one day at a time. Sales
post to the ledger, stock depletes, days-of-cover counts down, status chips flip
from ok to watch to order_now, orders are placed, deliveries land after the lead
time, and alerts fire.

Two things make this worth building rather than faking:

1. It is HONEST. Nothing is invented. The screen is watermarked with the window
   being replayed.
2. It doubles as the INTEGRATION TEST and as the business case. The same policy
   code the API serves is driven here against real outcomes, and a naive
   min/max policy is run over the identical days - so the cost difference is a
   MEASUREMENT rather than an assumption.
"""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field

import pandas as pd

from core import forecast_store as fs
from decision.newsvendor import (
    OrderParams,
    protection_interval_days,
    quantile_of,
    recommend_order,
)

POLICY_PHARMAPULSE = "pharmapulse"
POLICY_MINMAX = "minmax"


@dataclass
class PendingDelivery:
    arrives_on: pd.Timestamp
    quantity: float


@dataclass
class SeriesState:
    series_id: str
    stock: float
    pending: list[PendingDelivery] = field(default_factory=list)
    units_short: float = 0.0
    units_ordered: float = 0.0
    holding_unit_days: float = 0.0
    stockout_days: int = 0
    orders_placed: int = 0


@dataclass
class Scorecard:
    """Total cost of the policy over the replayed window.

    holding = unit_cost * annual_rate * (unit-days / 365)
    shortage = unit_margin * units that could not be supplied
    """
    units_short: float = 0.0
    units_ordered: float = 0.0
    holding_cost: float = 0.0
    shortage_cost: float = 0.0
    stockout_days: int = 0
    orders_placed: int = 0

    @property
    def total_cost(self) -> float:
        return self.holding_cost + self.shortage_cost

    def as_dict(self) -> dict:
        return {
            "units_short": round(self.units_short, 1),
            "units_ordered": round(self.units_ordered, 1),
            "holding_cost": round(self.holding_cost, 2),
            "shortage_cost": round(self.shortage_cost, 2),
            "total_cost": round(self.total_cost, 2),
            "stockout_days": self.stockout_days,
            "orders_placed": self.orders_placed,
        }


class ReplaySession:
    """One replay run. State lives in memory, keyed by session id."""

    def __init__(self, actuals: pd.DataFrame, settings: dict,
                 series_settings: dict[str, dict],
                 start: str, end: str, policy: str = POLICY_PHARMAPULSE,
                 opening_days_cover: float = 7.0):
        self.session_id = uuid.uuid4().hex[:10]
        self.policy = policy
        self.settings = settings
        self.series_settings = series_settings

        window = actuals[(actuals["ds"] >= pd.Timestamp(start))
                         & (actuals["ds"] <= pd.Timestamp(end))]
        if window.empty:
            raise ValueError(f"no history between {start} and {end}")

        self.dates = sorted(window["ds"].unique())
        self.sales = {
            (r.series_id, pd.Timestamp(r.ds)): float(r.y)
            for r in window.itertuples()
        }
        self.series_ids = sorted(window["series_id"].unique())
        self.index = -1
        self.events: list[dict] = []

        # Seed the shelf at a plausible level rather than at zero, so the run
        # starts from a realistic position instead of an artificial crisis.
        self.state: dict[str, SeriesState] = {}
        for sid in self.series_ids:
            daily = window[window["series_id"] == sid]["y"].mean()
            self.state[sid] = SeriesState(
                series_id=sid, stock=round(float(daily) * opening_days_cover, 1))

        self.score = Scorecard()
        self._lead_demand_cache: dict[str, dict[str, float]] = {}

        # FastAPI runs sync endpoints in a threadpool, so two requests can land
        # in tick() at once - which interleaves the sell/deliver/order sequence
        # and corrupts the run. Observed directly: clicking "skip a week" while
        # the poller was running turned 121 units short into 547.
        self._lock = threading.Lock()

    # -- helpers ----------------------------------------------------------

    def _params(self, sid: str) -> OrderParams:
        s = self.series_settings.get(sid, {})
        return OrderParams(
            lead_time_days=int(self.settings.get("lead_time_days", 4)),
            stock_on_hand=self.state[sid].stock,
            pack_size=int(s.get("pack_size", 10)),
            unit_cost=float(s.get("unit_cost", 12.5)),
            unit_margin=float(s.get("unit_margin", 4.0)),
            holding_cost_rate=float(self.settings.get("holding_cost_rate", 0.22)),
            expiry_risk_rate=float(self.settings.get("expiry_risk_rate", 0.015)),
            review_period_days=int(self.settings.get("review_period_days", 7)),
            service_level=float(self.settings.get("service_level_default", 0.95)),
        )

    def _lead_time_demand(self, sid: str, lead_days: int) -> dict[str, float]:
        key = f"{sid}:{lead_days}"
        if key not in self._lead_demand_cache:
            try:
                self._lead_demand_cache[key] = fs.lead_time_demand(sid, lead_days)
            except Exception:
                self._lead_demand_cache[key] = {}
        return self._lead_demand_cache[key]

    @property
    def finished(self) -> bool:
        return self.index >= len(self.dates) - 1

    @property
    def current_date(self) -> pd.Timestamp | None:
        if self.index < 0:
            return None
        return pd.Timestamp(self.dates[self.index])

    # -- the loop ---------------------------------------------------------

    def tick(self) -> dict:
        """Advance one day and return the new positions plus any events.

        Serialised: a replay session is a state machine, and two concurrent
        callers must not interleave inside it.
        """
        with self._lock:
            return self._tick_locked()

    def _tick_locked(self) -> dict:
        if self.finished:
            return self.snapshot(events=[])

        self.index += 1
        today = pd.Timestamp(self.dates[self.index])
        events: list[dict] = []

        for sid in self.series_ids:
            st = self.state[sid]
            params = self._params(sid)

            # 1. Deliveries that land today.
            arriving = [d for d in st.pending if d.arrives_on <= today]
            if arriving:
                delivered = sum(d.quantity for d in arriving)
                st.stock += delivered
                st.pending = [d for d in st.pending if d.arrives_on > today]
                events.append({
                    "type": "delivery", "series_id": sid, "date": str(today.date()),
                    "message": f"{delivered:.0f} units delivered",
                })

            # 2. Today's real sales. Anything we cannot supply is a lost sale -
            #    which is exactly the censoring the model cannot see.
            demand = self.sales.get((sid, today), 0.0)
            supplied = min(demand, st.stock)
            short = demand - supplied
            st.stock -= supplied

            if short > 0:
                st.units_short += short
                st.stockout_days += 1
                self.score.units_short += short
                self.score.shortage_cost += short * params.unit_margin
                events.append({
                    "type": "stockout", "series_id": sid, "date": str(today.date()),
                    "message": f"{short:.0f} units of demand could not be supplied",
                })

            # 3. Carrying cost on whatever is left on the shelf overnight.
            holding_per_unit_day = (params.unit_cost * params.holding_cost_rate) / 365.0
            st.holding_unit_days += st.stock
            self.score.holding_cost += st.stock * holding_per_unit_day

            # 4. Decide whether to order.
            qty = self._decide(sid, st, params, today)
            if qty > 0:
                st.pending.append(PendingDelivery(
                    arrives_on=today + pd.Timedelta(days=params.lead_time_days),
                    quantity=qty))
                st.units_ordered += qty
                st.orders_placed += 1
                self.score.units_ordered += qty
                self.score.orders_placed += 1
                events.append({
                    "type": "order", "series_id": sid, "date": str(today.date()),
                    "message": (f"ordered {qty:.0f} units, arriving "
                                f"{(today + pd.Timedelta(days=params.lead_time_days)).date()}"),
                })

        self.score.stockout_days = sum(s.stockout_days for s in self.state.values())
        self.events.extend(events)
        return self.snapshot(events=events)

    def _decide(self, sid: str, st: SeriesState, params: OrderParams,
                today: pd.Timestamp) -> float:
        """Order quantity for today under the active policy."""
        # Only review on the configured cadence, as a real buyer would.
        if self.index % max(int(self.settings.get("review_period_days", 7)), 1) != 0:
            return 0.0

        incoming = sum(d.quantity for d in st.pending)
        position = st.stock + incoming
        horizon = protection_interval_days(params.lead_time_days,
                                           params.review_period_days)
        dist = self._lead_time_demand(sid, horizon)
        if not dist:
            return 0.0

        if self.policy == POLICY_MINMAX:
            # The policy this replaces: a min/max on AVERAGE demand, which is
            # what a wholesaler portal or a spreadsheet does.
            #
            # It gets the SAME protection interval we do - anything less would
            # be a rigged comparison, and a first measurement that handed us an
            # 88% saving turned out to be exactly that. The only thing that
            # differs is that min/max sizes against the MEAN while we size
            # against the quantile the pharmacy's own cost ratio implies. That
            # difference is the thesis, so it is the only thing being measured.
            mean_daily = quantile_of(dist, 0.5) / max(horizon, 1)
            minimum = mean_daily * horizon
            maximum = minimum + mean_daily * params.review_period_days
            if position >= minimum:
                return 0.0
            need = maximum - position
            packs = -(-need // params.pack_size)      # ceil
            return max(0.0, packs * params.pack_size)

        # PharmaPulse: the newsvendor quantity read off the calibrated
        # distribution at the service level implied by this pharmacy's costs.
        adjusted = OrderParams(**{**params.__dict__, "stock_on_hand": position})
        result = recommend_order(dist, adjusted, series_id=sid)
        if position >= result.reorder_point:
            return 0.0
        return float(result.order_quantity)

    # -- output -----------------------------------------------------------

    def snapshot(self, events: list[dict] | None = None) -> dict:
        today = self.current_date
        positions = []
        for sid in self.series_ids:
            st = self.state[sid]
            params = self._params(sid)
            dist = self._lead_time_demand(sid, params.lead_time_days)
            mean_daily = (quantile_of(dist, 0.5) / max(params.lead_time_days, 1)
                          if dist else 0.0)
            cover = st.stock / mean_daily if mean_daily > 0 else 999.0
            reorder = quantile_of(dist, 0.95) if dist else 0.0

            if st.stock <= 0:
                status = "order_now"
            elif st.stock < reorder:
                status = "order_now"
            elif cover < params.lead_time_days + params.review_period_days:
                status = "watch"
            elif cover > 30:
                status = "overstocked"
            else:
                status = "ok"

            positions.append({
                "series_id": sid,
                "stock_on_hand": round(st.stock, 1),
                "days_of_cover": round(min(cover, 999.0), 1),
                "status": status,
                "incoming": round(sum(d.quantity for d in st.pending), 1),
                "units_short": round(st.units_short, 1),
            })

        return {
            "session_id": self.session_id,
            "policy": self.policy,
            "current_date": str(today.date()) if today is not None else None,
            "day_index": self.index + 1,
            "total_days": len(self.dates),
            "finished": self.finished,
            "window": {"from": str(pd.Timestamp(self.dates[0]).date()),
                       "to": str(pd.Timestamp(self.dates[-1]).date())},
            "positions": positions,
            "events": events if events is not None else [],
            "scorecard": self.score.as_dict(),
        }


def compare_policies(actuals: pd.DataFrame, settings: dict,
                     series_settings: dict[str, dict],
                     start: str, end: str) -> dict:
    """Run both policies over the identical days and report the difference.

    This is the business case as a MEASUREMENT rather than an assumption: same
    data, same costs, same lead time, same review cadence - the only thing that
    differs is how the order quantity is chosen.
    """
    results = {}
    for policy in (POLICY_PHARMAPULSE, POLICY_MINMAX):
        session = ReplaySession(actuals, settings, series_settings,
                                start, end, policy=policy)
        while not session.finished:
            session.tick()
        results[policy] = session.score.as_dict()

    ours = results[POLICY_PHARMAPULSE]
    theirs = results[POLICY_MINMAX]
    saving = theirs["total_cost"] - ours["total_cost"]
    pct = (saving / theirs["total_cost"] * 100) if theirs["total_cost"] else 0.0

    return {
        "window": {"from": start, "to": end},
        "pharmapulse": ours,
        "minmax": theirs,
        "saving": round(saving, 2),
        "saving_pct": round(pct, 1),
        "verdict": "pharmapulse cheaper" if saving > 0 else "min/max cheaper",
    }
