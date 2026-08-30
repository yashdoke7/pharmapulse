"""The order arithmetic: closed-form cases plus the properties that must hold.

Property-based testing earns its place here because this is where correctness is
load-bearing and where a plausible-looking wrong answer is indistinguishable
from a right one.
"""

from __future__ import annotations

import math

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from decision.newsvendor import (
    OrderParams,
    build_cost_curve,
    critical_fractile,
    expected_cost,
    p_stockout,
    quantile_of,
    recommend_order,
    round_to_pack,
)

DIST = {"0.05": 88.0, "0.10": 94.0, "0.25": 106.0, "0.50": 121.0,
        "0.75": 139.0, "0.90": 156.0, "0.95": 168.0}


# --- closed form ----------------------------------------------------------

def test_critical_fractile_matches_the_textbook():
    """Cu three times Co gives q* = 0.75: order the amount you exceed 25% of
    the time. This is the number the whole product is built on."""
    assert critical_fractile(3.0, 1.0) == pytest.approx(0.75)
    assert critical_fractile(1.0, 1.0) == pytest.approx(0.50)
    assert critical_fractile(9.0, 1.0) == pytest.approx(0.90)


def test_q_star_goes_to_zero_when_shortage_is_free():
    assert critical_fractile(1e-9, 1.0) < 0.01


def test_q_star_goes_to_one_when_holding_is_free():
    assert critical_fractile(1.0, 1e-9) > 0.99


def test_quantile_interpolates_between_stored_levels():
    assert quantile_of(DIST, 0.50) == pytest.approx(121.0)
    assert quantile_of(DIST, 0.05) == pytest.approx(88.0)
    mid = quantile_of(DIST, 0.625)
    assert 121.0 < mid < 139.0


def test_quantile_is_anchored_at_zero_below_the_grid():
    """Demand is non-negative, so the quantile function really does approach
    zero as the level does. Clamping at the 5th percentile instead would give a
    product whose shortage is nearly free an order floor with no economic
    justification - see test_free_shortage_means_order_nothing."""
    assert quantile_of(DIST, 0.0) == pytest.approx(0.0)
    assert quantile_of(DIST, 0.025) == pytest.approx(44.0)   # halfway to the 5th
    assert quantile_of(DIST, 0.05) == pytest.approx(88.0)    # exact at a stored level


def test_quantile_clamps_above_the_grid():
    """Extrapolating a tail we did not estimate would invent confidence."""
    assert quantile_of(DIST, 1.0) == pytest.approx(168.0)
    assert quantile_of(DIST, 0.999) == pytest.approx(168.0)


# --- pack rounding --------------------------------------------------------

def test_rounding_is_asymmetric_not_nearest():
    """Rounding to the nearest pack is wrong: the two errors cost differently.
    With Cu > Co the correct direction is up."""
    assert round_to_pack(11.0, 10, cu=4.0, co=0.1) == 2      # rounds UP, not to 1
    assert round_to_pack(19.0, 10, cu=0.1, co=4.0) == 1      # rounds DOWN


def test_rounding_never_returns_negative_packs():
    assert round_to_pack(-50.0, 10, cu=4.0, co=1.0) == 0
    assert round_to_pack(0.0, 10, cu=4.0, co=1.0) == 0


# --- the properties -------------------------------------------------------

@given(level=st.floats(min_value=0.05, max_value=0.95))
@settings(max_examples=40, deadline=None)
def test_order_is_monotone_in_service_level(level: float):
    """Ask for a higher service level, get at least as many units. This is the
    property the slider depends on - a non-monotone curve would make the
    control feel broken even if every point were individually correct."""
    lower = recommend_order(DIST, OrderParams(service_level=level, stock_on_hand=0))
    higher = recommend_order(DIST, OrderParams(service_level=min(level + 0.04, 0.99),
                                               stock_on_hand=0))
    assert higher.order_quantity >= lower.order_quantity


@given(stock=st.floats(min_value=0.0, max_value=300.0))
@settings(max_examples=40, deadline=None)
def test_order_is_non_increasing_in_stock_on_hand(stock: float):
    less = recommend_order(DIST, OrderParams(stock_on_hand=stock, service_level=0.95))
    more = recommend_order(DIST, OrderParams(stock_on_hand=stock + 25.0,
                                             service_level=0.95))
    assert more.order_quantity <= less.order_quantity


@given(
    stock=st.floats(min_value=0.0, max_value=400.0),
    pack=st.integers(min_value=1, max_value=50),
    margin=st.floats(min_value=0.1, max_value=50.0),
    cost=st.floats(min_value=0.5, max_value=200.0),
    lead=st.integers(min_value=1, max_value=30),
)
@settings(max_examples=60, deadline=None)
def test_order_is_always_a_non_negative_multiple_of_the_pack(
        stock: float, pack: int, margin: float, cost: float, lead: int):
    r = recommend_order(DIST, OrderParams(
        stock_on_hand=stock, pack_size=pack, unit_margin=margin,
        unit_cost=cost, lead_time_days=lead))
    assert r.order_quantity >= 0
    assert r.order_quantity % pack == 0
    assert r.order_packs * pack == r.order_quantity


@given(margin=st.floats(min_value=0.1, max_value=100.0),
       cost=st.floats(min_value=0.5, max_value=500.0))
@settings(max_examples=40, deadline=None)
def test_q_star_is_always_a_probability(margin: float, cost: float):
    p = OrderParams(unit_margin=margin, unit_cost=cost)
    q = critical_fractile(p.underage_cost(), p.overage_cost())
    assert 0.0 < q < 1.0


def test_free_shortage_means_order_nothing():
    """If being short costs nothing, q* collapses and so does the order."""
    r = recommend_order(DIST, OrderParams(unit_margin=1e-9, unit_cost=100.0,
                                          stock_on_hand=0.0))
    assert r.q_star < 0.01
    assert r.order_quantity == 0


def test_ordering_more_than_the_top_quantile_drives_stockout_risk_to_zero():
    r = recommend_order(DIST, OrderParams(stock_on_hand=500.0))
    assert r.p_stockout == pytest.approx(0.0)
    assert r.order_quantity == 0


# --- expected cost --------------------------------------------------------

def test_expected_cost_is_convex_around_its_minimum():
    """The optimum must not be beaten by one pack either side, which is the
    claim the +/-1 pack figures on screen are making."""
    params = OrderParams(stock_on_hand=40.0, pack_size=10)
    r = recommend_order(DIST, params)
    assert r.expected_cost["at_order"] <= r.expected_cost["minus_one_pack"] + 1e-6
    assert r.expected_cost["at_order"] <= r.expected_cost["plus_one_pack"] + 1e-6


def test_cost_curve_covers_the_slider_range_in_one_response():
    """The frontend interpolates this array on drag and never hits the network."""
    params = OrderParams(stock_on_hand=40.0)
    curve = build_cost_curve(DIST, params, params.underage_cost(),
                             params.overage_cost())
    assert len(curve) >= 12
    levels = [c["service_level"] for c in curve]
    assert levels == sorted(levels)
    assert min(levels) <= 0.05 and max(levels) >= 0.99
    quantities = [c["order_quantity"] for c in curve]
    assert quantities == sorted(quantities), "quantity must rise with service level"


def test_p_stockout_falls_as_the_position_rises():
    assert p_stockout(DIST, 0.0) == pytest.approx(1.0)
    assert p_stockout(DIST, 121.0) == pytest.approx(0.5, abs=0.05)
    assert p_stockout(DIST, 1000.0) == pytest.approx(0.0)


def test_expected_cost_is_never_negative():
    for position in (0.0, 50.0, 121.0, 500.0):
        assert expected_cost(DIST, position, 4.0, 0.3) >= 0.0


# --- status ---------------------------------------------------------------

def test_status_flags_an_empty_shelf_as_order_now():
    r = recommend_order(DIST, OrderParams(stock_on_hand=5.0, service_level=0.95))
    assert r.status == "order_now"


def test_status_flags_a_full_shelf_as_overstocked():
    r = recommend_order(DIST, OrderParams(stock_on_hand=5000.0), daily_mean=30.0)
    assert r.status == "overstocked"


def test_every_input_is_labelled_with_its_provenance_lane():
    """The user can see that the forecast is measured and the lead time is theirs."""
    r = recommend_order(DIST, OrderParams(), series_id="N02BE")
    lanes = {i["lane"] for i in r.inputs_used}
    assert lanes == {"observed", "user_setting"}
    observed = [i for i in r.inputs_used if i["lane"] == "observed"]
    assert len(observed) == 1 and "forecast" in observed[0]["name"]


def test_result_serialises_to_the_api_contract_shape():
    d = recommend_order(DIST, OrderParams(), series_id="N02BE").as_dict()
    required = {"series_id", "status", "q_star", "service_level_used",
                "lead_time_demand", "target_level", "stock_on_hand",
                "order_units", "order_packs", "order_quantity", "reorder_point",
                "days_of_cover", "p_stockout", "expected_cost", "cost_curve",
                "min_cost_service_level", "inputs_used"}
    assert required <= set(d)
    assert isinstance(d["order_quantity"], int)
    assert math.isfinite(d["days_of_cover"])
