"""Regenerate contracts/fixtures/*.json.

Fixtures are captured from the LIVE API, so their shapes cannot drift from the
implementation and their values are real rather than invented. They exist so
that:

  - the frontend can build and run with the backend switched off, and
  - PHARMAPULSE_FIXTURES=1 still serves a complete, working app - rung 5 of the
    degradation ladder, and the switch to flip if the model layer dies on stage.

Requires a built forecast store (`make nightly`). If the store is missing the
script says so rather than silently writing fixtures full of error envelopes.

    python scripts/make_fixtures.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

OUT = Path("contracts/fixtures")

# Capture from the real implementation, never from fixtures.
os.environ["PHARMAPULSE_FIXTURES"] = "0"

ENDPOINTS = [
    ("health", "GET", "/api/health", None),
    ("series", "GET", "/api/series", None),
    ("history", "GET", "/api/history?series_id=N02BE&grain=week&limit=120", None),
    ("forecast", "GET", "/api/forecast?series_id=N02BE&grain=week&horizon=8", None),
    ("positions", "GET", "/api/positions", None),
    ("risk", "GET", "/api/risk?limit=20", None),
    ("explain", "GET", "/api/explain?series_id=R06&grain=month&horizon=1", None),
    ("metrics", "GET", "/api/metrics", None),
    ("settings", "GET", "/api/settings", None),
    ("recommend", "POST", "/api/recommend",
     {"series_id": "N02BE", "service_level": 0.95}),
]


def main() -> int:
    from core import forecast_store as fs

    if not fs.store_available():
        print("No forecast store found. Run:", file=sys.stderr)
        print("  python -m pipelines.run_nightly --stage all", file=sys.stderr)
        return 1

    from fastapi.testclient import TestClient

    from api.main import app

    client = TestClient(app)
    OUT.mkdir(parents=True, exist_ok=True)

    failures = 0
    for name, method, path, body in ENDPOINTS:
        response = (client.get(path) if method == "GET"
                    else client.post(path, json=body))
        if response.status_code != 200:
            print(f"  FAIL {name:10} {response.status_code} {path}", file=sys.stderr)
            failures += 1
            continue

        payload = response.json()
        payload["meta"]["correlation_id"] = "c-fixture01"
        (OUT / f"{name}.json").write_text(
            json.dumps(payload, indent=2), encoding="utf-8")

        size = len(json.dumps(payload))
        print(f"  ok   {name:10} {size:>7,} bytes  {path}")

    if failures:
        print(f"\n{failures} endpoint(s) failed - fixtures NOT trustworthy",
              file=sys.stderr)
        return 1

    print(f"\nwrote {len(ENDPOINTS)} fixtures to {OUT}")
    print("Shapes must not change without a CONTRACTS.md change-log entry.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
