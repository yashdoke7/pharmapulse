"""Replay simulation and the measured business case.

These are also the closest thing the project has to an end-to-end integration
test: the same policy code the API serves is driven against real outcomes.
"""

from __future__ import annotations

import pytest

from decision.newsvendor import protection_interval_days
from decision.replay import (
    ReplaySession,
    compare_policies,
)

SETTINGS = {
    "lead_time_days": 4, "holding_cost_rate": 0.22, "expiry_risk_rate": 0.015,
    "review_period_days": 7, "service_level_default": 0.95,
}
PER_SERIES = {
    sid: {"pack_size": 10, "unit_cost": 12.5, "unit_margin": 4.0}
    for sid in ["M01AB", "M01AE", "N02BA", "N02BE", "N05B", "N05C", "R03", "R06"]
}

WINDOW = ("2019-01-01", "2019-02-28")


@pytest.fixture(scope="module")
def daily():
    """Replay needs BOTH the gold history and the forecast store: it replays
    real sales but sizes orders from the served distribution."""
    from core import forecast_store as fs
    from pipelines.gold import read_gold

    if not fs.store_available():
        pytest.skip("no forecast store - run `python -m pipelines.run_nightly --stage all`")
    try:
        return read_gold("day")
    except FileNotFoundError:
        pytest.skip("gold not built - run `python -m pipelines.run_nightly --stage gold`")


# --- the protection interval ---------------------------------------------

def test_protection_interval_covers_lead_time_plus_review():
    """Sizing against the lead time alone under-orders in a periodic-review
    system: you cannot reorder until the next review, so today's order must
    last until the order AFTER next arrives."""
    assert protection_interval_days(4, 7) == 11
    assert protection_interval_days(4, 0) == 4
    assert protection_interval_days(0, 7) == 8   # lead time floors at 1


# --- the simulation -------------------------------------------------------

def test_replay_advances_one_day_at_a_time(daily):
    session = ReplaySession(daily, SETTINGS, PER_SERIES, *WINDOW)
    first = session.tick()
    second = session.tick()
    assert first["day_index"] == 1
    assert second["day_index"] == 2
    assert second["current_date"] > first["current_date"]


def test_replay_finishes_and_stops_advancing(daily):
    session = ReplaySession(daily, SETTINGS, PER_SERIES, "2019-01-01", "2019-01-10")
    for _ in range(50):
        session.tick()
    assert session.finished
    last = session.snapshot()
    assert last["day_index"] == last["total_days"]


def test_units_are_conserved(daily):
    """opening + delivered - sold - short = on hand + still in transit.

    The stronger form of "sales deplete the shelf": a first version asserted
    stock simply falls, which is false on a day a delivery lands.
    """
    session = ReplaySession(daily, SETTINGS, PER_SERIES, *WINDOW)
    opening = {sid: st.stock for sid, st in session.state.items()}

    sold = {sid: 0.0 for sid in session.series_ids}
    for _ in range(20):
        if session.finished:
            break
        today = session.dates[session.index + 1]
        for sid in session.series_ids:
            sold[sid] += session.sales.get((sid, today), 0.0)
        session.tick()

    for sid, st in session.state.items():
        in_transit = sum(d.quantity for d in st.pending)
        supplied = sold[sid] - st.units_short
        assert st.stock + in_transit == pytest.approx(
            opening[sid] + st.units_ordered - supplied, abs=0.01), sid


def test_a_closure_day_moves_no_stock(daily):
    """1 January 2019 is one of the 26 closure days. The replay must reproduce
    that faithfully - the shop was shut, so nothing sold. Discovered by a test
    that assumed every day trades."""
    session = ReplaySession(daily, SETTINGS, PER_SERIES, "2019-01-01", "2019-01-31")
    before = {sid: st.stock for sid, st in session.state.items()}
    session.tick()
    assert session.current_date.strftime("%Y-%m-%d") == "2019-01-01"
    for sid, st in session.state.items():
        assert st.stock == pytest.approx(before[sid]), f"{sid} sold on a closure day"


def test_orders_arrive_after_the_lead_time_not_instantly(daily):
    session = ReplaySession(daily, SETTINGS, PER_SERIES, *WINDOW)
    session.tick()
    pending = [d for s in session.state.values() for d in s.pending]
    assert pending, "the first review should place at least one order"
    for delivery in pending:
        gap = (delivery.arrives_on - session.current_date).days
        assert gap == SETTINGS["lead_time_days"]


def test_unmet_demand_is_counted_not_silently_dropped(daily):
    """Demand above what is on the shelf is a lost sale - and it is exactly the
    censoring the model cannot observe, so the simulation must record it."""
    starved = ReplaySession(daily, SETTINGS, PER_SERIES, *WINDOW,
                            opening_days_cover=0.0)
    for _ in range(10):
        starved.tick()
    assert starved.score.units_short > 0
    assert starved.score.shortage_cost > 0


def test_holding_cost_accrues_on_stock_held_overnight(daily):
    session = ReplaySession(daily, SETTINGS, PER_SERIES, *WINDOW,
                            opening_days_cover=30.0)
    for _ in range(10):
        session.tick()
    assert session.score.holding_cost > 0


def test_events_name_what_happened(daily):
    session = ReplaySession(daily, SETTINGS, PER_SERIES, *WINDOW)
    kinds = set()
    for _ in range(15):
        for event in session.tick()["events"]:
            kinds.add(event["type"])
    assert "order" in kinds
    assert "delivery" in kinds


def test_snapshot_matches_the_api_shape(daily):
    session = ReplaySession(daily, SETTINGS, PER_SERIES, *WINDOW)
    snap = session.tick()
    assert {"session_id", "policy", "current_date", "day_index", "total_days",
            "finished", "window", "positions", "events", "scorecard"} <= set(snap)
    for position in snap["positions"]:
        assert {"series_id", "stock_on_hand", "days_of_cover", "status",
                "incoming", "units_short"} <= set(position)
        assert position["status"] in {"ok", "watch", "order_now", "overstocked"}


def test_a_window_outside_the_data_is_refused(daily):
    with pytest.raises(ValueError, match="no history"):
        ReplaySession(daily, SETTINGS, PER_SERIES, "2030-01-01", "2030-02-01")


# --- the business case ----------------------------------------------------

def test_both_policies_face_identical_conditions(daily):
    """The comparison is only worth anything if the baseline is not handicapped.

    A first version gave min/max a shorter protection interval than ours and
    produced an 88% saving - which was a rigged benchmark, not a result.
    """
    result = compare_policies(daily, SETTINGS, PER_SERIES, *WINDOW)
    assert set(result) >= {"pharmapulse", "minmax", "saving", "saving_pct"}
    assert result["pharmapulse"]["orders_placed"] > 0
    assert result["minmax"]["orders_placed"] > 0


def test_the_empirical_quantile_beats_a_normal_approximation(daily):
    """THE claim, and the only one where everything else is held constant.

    normal_approx gets our forecast, our protection interval and our service
    level. It differs in exactly one thing: it sizes with mu + z*sigma instead
    of reading the quantile off the distribution. So whatever separates them is
    attributable to the DISTRIBUTION and to nothing else.

    Beating min/max is a much softer result - that is the "no system at all"
    case, and any policy carrying safety stock clears it.
    """
    result = compare_policies(daily, SETTINGS, PER_SERIES, *WINDOW)
    ours = result["policies"]["pharmapulse"]["total_cost"]
    normal = result["policies"]["normal_approx"]["total_cost"]
    assert ours < normal, (
        f"the empirical quantile cost {ours:.0f} against the normal "
        f"approximation's {normal:.0f} - if this inverts, the distribution is "
        f"not earning its place and the project should say so")


def test_the_ladder_is_reported_in_full_including_where_we_lose(daily):
    """We do NOT dominate the ladder, and the code must not pretend otherwise.

    Across the three windows in the product we beat min/max everywhere, beat the
    normal approximation everywhere, and split roughly level with an ERP-style
    (s, S) safety-stock policy - winning one, losing two by a couple of percent.
    In this shorter Jan-Feb window we lose to both.

    THE REASON IS WORTH KNOWING, because it is the honest limit of the current
    replay. Every policy now sizes off a trailing empirical window, and a
    trailing window cannot anticipate a SEASONAL TURN: on 1 January the last 180
    days are autumn, and paracetamol's January peak has not happened yet. A
    policy that simply holds more - min/max orders up to 18 days of mean cover -
    survives that turn by accident.

    Anticipating the turn is exactly what the forecast layer is for, and the
    replay does not currently exercise it: it would need a forecast produced at
    each review point rather than one vintage. Until it does, the business case
    measures the DECISION RULE on a common information set and nothing more,
    and this test asserts that the comparison is reported in full rather than
    filtered down to the flattering rungs.
    """
    result = compare_policies(daily, SETTINGS, PER_SERIES, *WINDOW)

    reported = {row["policy"] for row in result["ladder"]}
    assert reported == {"minmax", "safety_stock", "normal_approx"}, (
        "a baseline vanished from the ladder - every rung ships, including the "
        "ones we lose")

    for row in result["ladder"]:
        ours = result["policies"]["pharmapulse"]["total_cost"]
        assert row["we_win"] == (row["total_cost"] > ours), (
            f"{row['policy']} reports we_win={row['we_win']} against costs "
            f"{row['total_cost']:.0f} vs our {ours:.0f}")


def test_the_saving_where_it_exists_comes_from_fewer_lost_sales(daily):
    """Whenever we are cheaper, it must be because we ran out less - never
    because we held less stock.

    That direction is the whole business argument, and it is the one thing that
    could quietly invert without anybody noticing.
    """
    result = compare_policies(daily, SETTINGS, PER_SERIES, *WINDOW)
    ours = result["policies"]["pharmapulse"]
    for policy in ("minmax", "safety_stock", "normal_approx"):
        other = result["policies"][policy]
        if ours["total_cost"] < other["total_cost"]:
            assert ours["units_short"] <= other["units_short"], (
                f"we beat {policy} on cost while running out MORE - the saving "
                f"is coming from holding less stock, which is not the claim")


def test_scorecard_totals_are_consistent(daily):
    result = compare_policies(daily, SETTINGS, PER_SERIES, *WINDOW)
    for policy in ("pharmapulse", "minmax"):
        s = result[policy]
        assert s["total_cost"] == pytest.approx(
            s["holding_cost"] + s["shortage_cost"], abs=0.02)


def test_the_result_holds_in_a_different_quarter(daily):
    """One flattering window is an anecdote. Check another."""
    result = compare_policies(daily, SETTINGS, PER_SERIES,
                              "2018-10-01", "2018-12-31")
    assert result["pharmapulse"]["total_cost"] < result["minmax"]["total_cost"]


# --- concurrency ----------------------------------------------------------

def test_concurrent_ticks_do_not_corrupt_the_run(daily):
    """FastAPI runs sync endpoints in a threadpool, so two requests can land in
    tick() at once. Without a lock they interleave inside the
    sell/deliver/order sequence and the run diverges - observed in the browser
    as 121 units short becoming 547 after clicking "skip a week" while the
    poller was running.
    """
    import threading

    reference = ReplaySession(daily, SETTINGS, PER_SERIES, "2019-01-01", "2019-02-28")
    while not reference.finished:
        reference.tick()

    concurrent = ReplaySession(daily, SETTINGS, PER_SERIES, "2019-01-01", "2019-02-28")
    total = len(concurrent.dates)

    def worker():
        while not concurrent.finished:
            concurrent.tick()

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)

    assert concurrent.index == total - 1
    assert concurrent.score.units_short == pytest.approx(
        reference.score.units_short, abs=0.01)
    assert concurrent.score.total_cost == pytest.approx(
        reference.score.total_cost, abs=0.05)
