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
from statistics import NormalDist

import numpy as np
import pandas as pd

from core import forecast_store as fs
from decision.newsvendor import (
    OrderParams,
    critical_fractile,
    protection_interval_days,
    quantile_of,
    recommend_order,
)

POLICY_PHARMAPULSE = "pharmapulse"
POLICY_MINMAX = "minmax"
POLICY_SAFETY_STOCK = "safety_stock"
POLICY_NORMAL = "normal_approx"

# The comparison ladder, weakest first. Min/max on the mean alone is a fair
# floor but a soft one - it is the "no system at all" case, and anyone who
# works in inventory will say so, because every ERP on the market carries
# safety stock. Beating only that would be a strawman result.
#
# So there are two harder rungs. `safety_stock` is the (s, S) policy real
# software actually implements: order up to mu + z*sigma*sqrt(L) at the same
# service level we target. And `normal_approx` takes OUR forecast and sizes it
# the textbook way, with a normal approximation instead of the empirical
# quantile - which isolates what the calibrated DISTRIBUTION contributes,
# holding forecast quality constant. If we only beat min/max, the win is the
# forecast. If we also beat normal_approx, the win is the distribution, and
# that is the actual claim.
POLICIES = (POLICY_PHARMAPULSE, POLICY_NORMAL, POLICY_SAFETY_STOCK, POLICY_MINMAX)

def _service_level_of(params: OrderParams) -> float:
    """The service level this pharmacy's own costs imply - the same q* we use.

    The baselines are given OUR target rather than an arbitrary 95%. Handing
    them a different one would make the comparison about the target instead of
    about the method, which is not the question being asked.
    """
    if params.service_level is not None:
        return float(params.service_level)
    return critical_fractile(params.underage_cost(), params.overage_cost())


def _z_for(service_level: float) -> float:
    """The normal quantile for a service level.

    statistics.NormalDist is stdlib and exact. scipy would also do it, but it
    is not a direct dependency of this project and adding one for a single
    inverse CDF is not a trade worth making.
    """
    p = min(max(float(service_level), 0.5), 0.999)
    return float(NormalDist().inv_cdf(p))


POLICY_LABELS = {
    POLICY_PHARMAPULSE: "PharmaPulse - empirical quantile of a calibrated distribution",
    POLICY_NORMAL: "Our forecast, sized with a normal approximation (mu + z*sigma)",
    POLICY_SAFETY_STOCK: "(s, S) with safety stock - what an ERP does",
    POLICY_MINMAX: "Min/max on average demand - no system at all",
}


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

        # The ERP baseline gets NO forecast - it works off trailing history,
        # like the software it stands in for. Kept whole so it can look back
        # from each simulated day; it only ever reads strictly before "today",
        # which the assertion in _trailing_stats enforces.
        self._history = actuals[["series_id", "ds", "y"]].copy()
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

    def _trailing_dist(self, sid: str, today: pd.Timestamp,
                       horizon: int) -> dict[str, float]:
        """Empirical distribution of `horizon`-day demand, from history only.

        THIS EXISTS BECAUSE THE REPLAY WAS MEASURING THE WRONG THING.

        Every policy used to read the published forecast store, which is
        anchored at a single cutoff - the day after the last observation. The
        replay windows are months earlier, so one static forecast was applied
        to every simulated day regardless of the season it fell in. On R03 the
        store predicts 41 units per protection interval while December actually
        sells 119: we ordered a third of what was needed, all winter, and could
        not adapt because there was nothing to adapt with.

        Both baselines shared the same handicap, so the headline number was
        "safety stock on a stale forecast beats no safety stock on the same
        stale forecast" - true, and not the claim anyone wanted to make.

        Rolling sums of the trailing 180 days give every policy the same
        information a real buyer has on the day, and the comparison becomes
        about the DECISION RULE, which is the only thing the replay was ever
        supposed to isolate. Strictly before today, so nothing leaks.
        """
        h = self._history
        past = h[(h["series_id"] == sid) & (h["ds"] < today)].tail(180)
        y = past["y"].astype(float).to_numpy()
        if len(y) < horizon + 5:
            return {}

        # Every overlapping horizon-length window that has already happened.
        sums = np.convolve(y, np.ones(horizon), mode="valid")
        qs = [0.01, 0.03, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50,
              0.60, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 0.97, 0.99]
        return {f"{q:.2f}": float(np.quantile(sums, q)) for q in qs}

    def _trailing_stats(self, sid: str, today: pd.Timestamp) -> tuple[float, float]:
        """Daily mean and sd from the 90 days BEFORE today. No forecast, no leak.

        The strict inequality is the whole safeguard: a baseline that peeks at
        today's sale would beat us for the wrong reason and the comparison
        would be worthless.
        """
        h = self._history
        past = h[(h["series_id"] == sid) & (h["ds"] < today)].tail(90)
        if past.empty:
            return 0.0, 0.0
        y = past["y"].astype(float)
        return float(y.mean()), float(y.std(ddof=1) if len(y) > 1 else 0.0)

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
        # All four policies read the SAME information set: what this product
        # actually sold in the days before today. Anything else makes the
        # replay a comparison of forecast vintages rather than of decision
        # rules - see _trailing_dist.
        dist = self._trailing_dist(sid, today, horizon)
        if not dist:
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

        if self.policy == POLICY_SAFETY_STOCK:
            # (s, S) with safety stock - what commercial inventory software
            # actually does, and the reason min/max alone is too soft a
            # comparison to lead with.
            #
            # It has no forecast: mean and sd come from the trailing 90 days of
            # its own sales, and the protection-interval figures scale as mu*L
            # and sigma*sqrt(L) - sqrt because independent periods add in
            # VARIANCE, not in standard deviation. Getting that wrong is the
            # single most common error in the textbook version.
            mu_d, sd_d = self._trailing_stats(sid, today)
            if mu_d <= 0:
                return 0.0
            z = _z_for(_service_level_of(params))
            target = mu_d * horizon + z * sd_d * np.sqrt(max(horizon, 1))
            if position >= target:
                return 0.0
            packs = -(-(target - position) // params.pack_size)
            return max(0.0, packs * params.pack_size)

        if self.policy == POLICY_NORMAL:
            # THE RUNG THAT CARRIES THE CLAIM.
            #
            # It gets OUR forecast - the same distribution, the same service
            # level - and differs in exactly one thing: it sizes with a normal
            # approximation, mu + z*sigma, instead of reading the empirical
            # quantile off the calibrated distribution. Forecast quality is held
            # constant, so whatever separates this from PharmaPulse is
            # attributable to the DISTRIBUTION and nothing else.
            #
            # If we only beat min/max, the win is the forecast, and any team
            # with a decent model gets it. If we also beat this, the win is the
            # thing the project is actually about.
            #
            # sigma is recovered from the interval rather than assumed: for a
            # normal, p90 - p50 is 1.2816 sigma. Inverting it is what a
            # practitioner does with a published interval, and it does not
            # require the distribution to really BE normal to be computed -
            # which is the whole point, because ours is not.
            z = _z_for(_service_level_of(params))
            median = quantile_of(dist, 0.5)
            sigma_h = max((quantile_of(dist, 0.9) - median) / 1.2816, 1e-9)
            target = median + z * sigma_h
            if position >= target:
                return 0.0
            packs = -(-(target - position) // params.pack_size)
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
    for policy in POLICIES:
        session = ReplaySession(actuals, settings, series_settings,
                                start, end, policy=policy)
        while not session.finished:
            session.tick()
        results[policy] = session.score.as_dict()

    ours = results[POLICY_PHARMAPULSE]
    theirs = results[POLICY_MINMAX]
    saving = theirs["total_cost"] - ours["total_cost"]
    pct = (saving / theirs["total_cost"] * 100) if theirs["total_cost"] else 0.0

    def against(policy: str) -> dict:
        other = results[policy]
        # float()/bool() rather than leaving numpy scalars in place: pydantic
        # cannot serialise numpy.bool_ and the failure surfaces as an opaque
        # 500 at the edge, far from the arithmetic that produced it.
        diff = float(other["total_cost"]) - float(ours["total_cost"])
        base = float(other["total_cost"])
        return {
            "policy": policy,
            "label": POLICY_LABELS[policy],
            "total_cost": round(base, 2),
            "saving": round(diff, 2),
            "saving_pct": round((diff / base * 100) if base else 0.0, 1),
            "we_win": bool(diff > 0),
        }

    return {
        "window": {"from": start, "to": end},
        "pharmapulse": ours,
        "minmax": theirs,
        "saving": round(saving, 2),
        "saving_pct": round(pct, 1),
        "verdict": "pharmapulse cheaper" if saving > 0 else "min/max cheaper",
        # The full ladder. Beating min/max alone is a soft result - it is the
        # "no system" case. The rung that carries the claim is normal_approx,
        # which runs on OUR forecast and differs only in sizing method.
        "ladder": [against(p) for p in POLICIES if p != POLICY_PHARMAPULSE],
        "policies": {p: results[p] for p in POLICIES},
    }
