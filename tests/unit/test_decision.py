"""Ledger balance, audit chain, risk ranking and recommendations."""

from __future__ import annotations

import pytest

from decision import ledger
from decision.newsvendor import OrderParams, recommend_order
from decision.risk import (
    ACTION_ORDER_EARLY,
    ACTION_ORDER_NOW,
    ACTION_SLOW_MOVER,
    OVERSTOCK,
    STOCKOUT,
    build_recommendation,
    detect,
    rank,
    total_exposure,
)

DIST = {"0.05": 88.0, "0.10": 94.0, "0.25": 106.0, "0.50": 121.0,
        "0.75": 139.0, "0.90": 156.0, "0.95": 168.0}


@pytest.fixture
def db(tmp_path):
    return tmp_path / "ops.db"


# --- ledger ---------------------------------------------------------------

def test_balance_is_opening_plus_receipts_minus_sales(db):
    ledger.post("N02BE", "2019-01-01", "opening", 100, db_path=db)
    ledger.post("N02BE", "2019-01-02", "sold", 30, db_path=db)
    ledger.post("N02BE", "2019-01-03", "received", 50, db_path=db)
    ledger.post("N02BE", "2019-01-04", "wastage", 5, db_path=db)
    assert ledger.balance("N02BE", db_path=db)["N02BE"] == pytest.approx(115.0)


def test_event_kind_decides_the_sign(db):
    """A caller passing a positive number to `sold` must not increase stock."""
    ledger.post("R06", "2019-01-01", "opening", 50, db_path=db)
    ledger.post("R06", "2019-01-02", "sold", 20, db_path=db)
    assert ledger.balance("R06", db_path=db)["R06"] == pytest.approx(30.0)


def test_adjustment_may_be_negative(db):
    ledger.post("R06", "2019-01-01", "opening", 50, db_path=db)
    ledger.post("R06", "2019-01-05", "adjustment", -7, note="stock take", db_path=db)
    assert ledger.balance("R06", db_path=db)["R06"] == pytest.approx(43.0)


def test_unknown_event_kind_is_refused(db):
    with pytest.raises(ValueError, match="unknown event kind"):
        ledger.post("R06", "2019-01-01", "teleported", 5, db_path=db)


def test_balance_respects_an_as_of_date(db):
    ledger.post("R06", "2019-01-01", "opening", 50, db_path=db)
    ledger.post("R06", "2019-06-01", "sold", 20, db_path=db)
    assert ledger.balance("R06", as_of="2019-03-01", db_path=db)["R06"] == 50.0
    assert ledger.balance("R06", as_of="2019-12-01", db_path=db)["R06"] == 30.0


def test_days_of_cover_is_stock_over_daily_demand():
    assert ledger.days_of_cover(96.0, 30.0) == pytest.approx(3.2)


def test_days_of_cover_handles_a_product_that_does_not_sell():
    assert ledger.days_of_cover(10.0, 0.0) == 999.0


def test_projected_stockout_is_the_first_date_cover_runs_out():
    forecast = [("2019-10-09", 30.0), ("2019-10-10", 30.0),
                ("2019-10-11", 30.0), ("2019-10-12", 30.0)]
    # 70 units at 30/day: 40 left after day 1, 10 after day 2, empty during day 3.
    assert ledger.projected_stockout(70.0, forecast) == "2019-10-11"
    assert ledger.projected_stockout(500.0, forecast) is None


# --- audit chain ----------------------------------------------------------

def test_accepting_the_recommendation_needs_no_reason(db):
    ledger.log_order("N02BE", "2019-10-08", recommended=130, accepted=130, db_path=db)
    assert ledger.verify_chain(db_path=db)


def test_an_override_without_a_reason_is_refused(db):
    with pytest.raises(ValueError, match="reason"):
        ledger.log_order("N02BE", "2019-10-08", recommended=130, accepted=40,
                         db_path=db)


def test_the_audit_chain_detects_tampering(db):
    """Each entry stores the previous entry's hash, so an edit is detectable.
    This is what answers 'I never approved that order'."""
    ledger.log_order("N02BE", "2019-10-08", 130, 130, db_path=db)
    ledger.log_order("R06", "2019-10-08", 60, 20, reason="supplier shortage",
                     db_path=db)
    assert ledger.verify_chain(db_path=db)

    with ledger.connect(db) as conn:
        conn.execute("UPDATE order_log SET accepted = 999 WHERE id = 1")

    assert not ledger.verify_chain(db_path=db)


# --- risk -----------------------------------------------------------------

def _order(stock: float, **kw):
    params = OrderParams(stock_on_hand=stock, **kw)
    return recommend_order(DIST, params, series_id="N02BE",
                           daily_mean=30.0), params


def test_an_empty_shelf_raises_a_stockout_risk():
    order, params = _order(5.0)
    risks = detect("N02BE", order, params)
    assert any(r.type == STOCKOUT for r in risks)


def test_stockout_risk_is_measured_before_the_order_not_after():
    """order.p_stockout is the risk REMAINING after ordering. The exception
    list must show the risk the buyer has right now, or nothing ever fires."""
    order, params = _order(5.0)
    risks = [r for r in detect("N02BE", order, params) if r.type == STOCKOUT]
    assert risks, "an almost-empty shelf must raise a stockout risk"
    assert risks[0].probability > order.p_stockout
    assert risks[0].probability > 0.9


def test_a_full_shelf_raises_an_overstock_risk_not_a_stockout():
    order, params = _order(3000.0)
    types = {r.type for r in detect("N02BE", order, params)}
    assert OVERSTOCK in types
    assert STOCKOUT not in types


def test_risks_are_ranked_by_money_not_probability():
    """A 30% chance on the highest-volume product beats a 90% chance on
    something that sells twice a month. This ordering is a design claim."""
    big, big_params = _order(5.0, unit_margin=40.0)
    small, small_params = _order(5.0, unit_margin=0.5)

    risks = detect("N02BE", big, big_params) + detect("N05C", small, small_params)
    ranked = rank(risks)

    assert ranked[0].exposure >= ranked[-1].exposure
    assert ranked[0].series_id == "N02BE"


def test_total_exposure_sums_the_list():
    order, params = _order(5.0)
    risks = detect("N02BE", order, params)
    assert total_exposure(risks) == pytest.approx(
        sum(r.exposure for r in risks), abs=0.01)   # the helper rounds to paise


def test_a_known_seasonal_peak_triggers_order_early():
    """The May pollen peak is visible months ahead in six years of history, so
    it can be ordered against rather than reacted to."""
    order, params = _order(50.0)
    risks = detect("R06", order, params, month=4)
    assert any(r.recommended_action == ACTION_ORDER_EARLY for r in risks)


def test_an_observation_outside_the_band_is_flagged_as_an_anomaly():
    order, params = _order(150.0)
    risks = detect("N02BE", order, params,
                   last_observation=400.0, forecast_band=(80.0, 170.0))
    assert any(r.type == "anomaly" for r in risks)


# --- recommendations ------------------------------------------------------

def test_low_stock_recommends_ordering_now():
    order, params = _order(5.0)
    rec = build_recommendation("N02BE", order, detect("N02BE", order, params))
    assert rec.action == ACTION_ORDER_NOW
    assert rec.quantity > 0


def test_a_slow_mover_recommends_not_ordering():
    order, params = _order(3000.0)
    rec = build_recommendation("N02BE", order, detect("N02BE", order, params))
    assert rec.action == ACTION_SLOW_MOVER
    assert rec.quantity == 0


def test_every_recommendation_carries_its_basis():
    """The interface shows why, rather than presenting an instruction."""
    order, params = _order(5.0)
    rec = build_recommendation("N02BE", order, detect("N02BE", order, params))
    assert rec.basis
    assert {i["lane"] for i in rec.basis} == {"observed", "user_setting"}
    assert rec.rationale


def test_ledger_honours_the_db_env_var(tmp_path, monkeypatch):
    """The demo board must be unreachable from a test.

    Regression test for a real leak: db_path defaulted to the module constant
    in the signature, so Python captured it at import time and no later
    override could take effect. The contract tests POST /api/orders through the
    real app, so every pytest run wrote a receipt and a hash-chained order_log
    row into data/warehouse/ops.db - the board the demo runs on. After a few
    runs the Order screen recommends 0 units and looks broken.
    """
    real = ledger.DB_PATH
    before = real.read_bytes() if real.exists() else None

    target = tmp_path / "elsewhere.db"
    monkeypatch.setenv("PHARMAPULSE_DB", str(target))

    ledger.post("N02BE", "2019-01-01", "received", 130)

    assert target.exists(), "the env var did not redirect the write"
    assert ledger.balance("N02BE")["N02BE"] == 130

    after = real.read_bytes() if real.exists() else None
    assert after == before, "the write reached the real demo database"
