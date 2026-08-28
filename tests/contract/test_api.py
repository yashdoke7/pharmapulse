"""API contract: the shapes Pod D (and the frontend) codes against.

If a shape changes here, this goes red before the frontend build does.
Contract: CONTRACTS.md section C3.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)

META_KEYS = {"origin", "model_version", "snapshot_id", "generated_at",
             "stale", "degraded", "correlation_id"}


def data_of(response) -> dict:
    assert response.status_code == 200, response.text
    body = response.json()
    assert "data" in body and "meta" in body, "every 200 carries the envelope"
    assert META_KEYS <= set(body["meta"]), (
        f"meta missing {META_KEYS - set(body['meta'])}")
    return body["data"]


# --- envelope -------------------------------------------------------------

@pytest.mark.parametrize("path", [
    "/api/health", "/api/series", "/api/history", "/api/forecast",
    "/api/risk", "/api/metrics", "/api/settings", "/api/positions",
])
def test_every_get_carries_the_envelope(path: str):
    data_of(client.get(path))


def test_correlation_id_is_unique_per_request():
    a = client.get("/api/health").json()["meta"]["correlation_id"]
    b = client.get("/api/health").json()["meta"]["correlation_id"]
    assert a != b


# --- series ---------------------------------------------------------------

def test_series_lists_all_eight_with_a_demand_class():
    d = data_of(client.get("/api/series"))
    assert len(d["series"]) == 8
    required = {"series_id", "name", "short_name", "demand_class",
                "daily_mean", "peak_month", "unit"}
    for s in d["series"]:
        assert required <= set(s)
        assert s["demand_class"] in {"smooth", "intermittent", "erratic", "lumpy"}


def test_n05c_is_reported_as_intermittent():
    """The UI chip must say intermittent, because that is why its chart looks
    different - and it is measured, not configured."""
    d = data_of(client.get("/api/series"))
    n05c = next(s for s in d["series"] if s["series_id"] == "N05C")
    assert n05c["demand_class"] == "intermittent"
    assert n05c["zero_day_pct"] > 60


# --- forecast -------------------------------------------------------------

def test_forecast_returns_quantiles_history_and_members():
    d = data_of(client.get("/api/forecast?series_id=N02BE&grain=week&horizon=4"))
    assert {"series_id", "grain", "cutoff", "horizon", "calibrated",
            "max_horizon", "points", "history", "members"} <= set(d)
    assert len(d["points"]) == 4

    first = d["points"][0]
    assert {"ds", "h", "q"} <= set(first)
    assert {"0.05", "0.50", "0.95"} <= set(first["q"])


def test_forecast_quantiles_are_monotone_and_non_negative():
    d = data_of(client.get("/api/forecast?series_id=N02BE&grain=week&horizon=8"))
    for point in d["points"]:
        levels = sorted(point["q"], key=float)
        values = [point["q"][k] for k in levels]
        assert all(v >= 0 for v in values), "demand cannot be negative"
        assert values == sorted(values), f"quantiles out of order at {point['ds']}"


def test_forecast_history_carries_completeness_for_partial_buckets():
    """The truncated final bucket must be visible and labelled, not missing."""
    d = data_of(client.get("/api/history?series_id=N02BE&grain=month&limit=12"))
    assert d["points"]
    assert all("completeness" in p for p in d["points"])
    assert d["points"][-1]["completeness"] < 1.0


def test_horizon_beyond_support_is_refused():
    r = client.get("/api/forecast?series_id=N02BE&grain=week&horizon=999")
    assert r.status_code == 422
    assert r.json()["detail"]["error"]["code"] == "HORIZON_TOO_LONG"


def test_unknown_series_is_a_404_with_a_code():
    r = client.get("/api/forecast?series_id=NOPE")
    assert r.status_code == 404
    assert r.json()["detail"]["error"]["code"] == "SERIES_NOT_FOUND"


# --- recommend ------------------------------------------------------------

def test_recommend_returns_the_full_order_shape():
    d = data_of(client.post("/api/recommend",
                            json={"series_id": "N02BE", "service_level": 0.95}))
    required = {"series_id", "status", "q_star", "service_level_used",
                "lead_time_demand", "target_level", "stock_on_hand",
                "order_units", "order_packs", "order_quantity", "reorder_point",
                "days_of_cover", "p_stockout", "expected_cost", "cost_curve",
                "min_cost_service_level", "inputs_used"}
    assert required <= set(d)
    assert d["status"] in {"ok", "watch", "order_now", "overstocked"}


def test_the_cost_curve_ships_in_one_response():
    """The slider interpolates this locally and never hits the network."""
    d = data_of(client.post("/api/recommend", json={"series_id": "N02BE"}))
    curve = d["cost_curve"]
    assert len(curve) >= 12
    levels = [c["service_level"] for c in curve]
    assert levels == sorted(levels)
    quantities = [c["order_quantity"] for c in curve]
    assert quantities == sorted(quantities)


def test_a_higher_service_level_never_orders_less_over_http():
    low = data_of(client.post("/api/recommend",
                              json={"series_id": "N02BE", "service_level": 0.50}))
    high = data_of(client.post("/api/recommend",
                               json={"series_id": "N02BE", "service_level": 0.95}))
    assert high["order_quantity"] >= low["order_quantity"]


def test_every_input_is_lane_labelled():
    d = data_of(client.post("/api/recommend", json={"series_id": "N02BE"}))
    lanes = {i["lane"] for i in d["inputs_used"]}
    assert lanes <= {"observed", "user_setting"}
    assert "observed" in lanes and "user_setting" in lanes


def test_invalid_service_level_is_rejected_by_the_schema():
    r = client.post("/api/recommend",
                    json={"series_id": "N02BE", "service_level": 5.0})
    assert r.status_code == 422


# --- risk -----------------------------------------------------------------

def test_risk_items_are_ranked_by_exposure_descending():
    d = data_of(client.get("/api/risk?limit=20"))
    assert {"total_exposure", "currency", "items"} <= set(d)
    exposures = [i["exposure"] for i in d["items"]]
    assert exposures == sorted(exposures, reverse=True)


def test_risk_items_carry_an_action_and_a_headline():
    d = data_of(client.get("/api/risk"))
    for item in d["items"]:
        assert {"series_id", "type", "severity", "probability", "exposure",
                "headline", "detail", "recommended_action"} <= set(item)
        assert item["type"] in {"stockout", "overstock", "expiry", "anomaly"}


# --- explain --------------------------------------------------------------

def test_explain_components_sum_to_the_total():
    """An explanation that does not add up to the number it explains is worse
    than no explanation."""
    d = data_of(client.get("/api/explain?series_id=R06&grain=month&horizon=1"))
    assert {"headline", "total_change_units", "components", "calibration"} <= set(d)
    total = sum(c["units"] for c in d["components"])
    assert total == pytest.approx(d["total_change_units"], abs=0.5)


def test_explain_carries_the_calibration_curves():
    d = data_of(client.get("/api/explain?series_id=N02BE&grain=month"))
    calib = d["calibration"]
    assert calib["before"] and calib["after"]
    assert calib["n_points"]


# --- ops ------------------------------------------------------------------

def test_health_reports_the_degradation_rung():
    d = data_of(client.get("/api/health"))
    assert d["ladder_rung"] in {1, 5, 6}
    assert d["forecast_store"] in {"present", "fixtures", "missing"}


def test_metrics_exposes_the_benchmark_leaderboard():
    d = data_of(client.get("/api/metrics"))
    board = d["benchmarks"]["leaderboard"]
    assert any(m.get("is_shipped") for m in board), "the shipped model is flagged"
    assert any(m.get("is_benchmark") for m in board), "the baseline is flagged"


def test_per_series_results_flag_where_the_ensemble_loses():
    """Showing where we lose is a scoring point, not a bug - so the field the
    UI colours on must exist."""
    d = data_of(client.get("/api/metrics"))
    for row in d["benchmarks"]["per_series"]:
        assert "ensemble_wins" in row
        assert {"series_id", "seasonal_naive", "ensemble", "best_model"} <= set(row)


# --- settings and orders --------------------------------------------------

def test_settings_round_trip():
    original = data_of(client.get("/api/settings"))["lead_time_days"]
    try:
        updated = data_of(client.put("/api/settings", json={"lead_time_days": 9}))
        assert updated["lead_time_days"] == 9
        assert data_of(client.get("/api/settings"))["lead_time_days"] == 9
    finally:
        client.put("/api/settings", json={"lead_time_days": original})


def test_an_override_without_a_reason_is_refused_over_http():
    r = client.post("/api/orders", json={"series_id": "N02BE",
                                         "recommended": 130, "accepted": 40})
    assert r.status_code == 422
    assert r.json()["detail"]["error"]["code"] == "INVALID_PARAMS"


def test_accepting_a_recommendation_extends_the_audit_chain():
    d = data_of(client.post("/api/orders", json={
        "series_id": "N02BE", "recommended": 130, "accepted": 130}))
    assert d["logged"] and d["chain_valid"]
