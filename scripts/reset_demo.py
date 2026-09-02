"""Put the demo board back to its opening state.

Accepting an order posts a goods receipt to the ledger, which is the point -
the decision moves the shelf. But it means a rehearsal leaves the board in
whatever state the last run ended in, so run this between rehearsals and
immediately before presenting.

    python scripts/reset_demo.py

Clears the stock ledger and any saved settings override, so the board returns
to the seeded mix: 4 healthy, 3 needing an order, 1 overstocked. Does NOT touch
the forecast store, the gold tables or benchmarks.json - only lane-2 state.
"""

from __future__ import annotations

import argparse
import sys

import _bootstrap  # noqa: F401  - repo root onto sys.path; must precede repo imports

from decision import ledger


def reset(keep_audit: bool = True) -> dict:
    with ledger.connect() as conn:
        movements = conn.execute("SELECT COUNT(*) c FROM stock_event").fetchone()["c"]
        orders = conn.execute("SELECT COUNT(*) c FROM order_log").fetchone()["c"]
        settings = conn.execute("SELECT COUNT(*) c FROM settings").fetchone()["c"]

        conn.execute("DELETE FROM stock_event")
        conn.execute("DELETE FROM settings")
        if not keep_audit:
            conn.execute("DELETE FROM order_log")

    return {"movements_cleared": movements, "settings_cleared": settings,
            "orders_in_audit_log": orders, "audit_kept": keep_audit}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Reset the demo board")
    ap.add_argument("--clear-audit", action="store_true",
                    help="also wipe the order audit log (normally kept, so the "
                         "hash chain and its integrity check stay demonstrable)")
    args = ap.parse_args(argv)

    result = reset(keep_audit=not args.clear_audit)

    print(f"stock movements cleared   {result['movements_cleared']}")
    print(f"settings overrides cleared {result['settings_cleared']}")
    print(f"audit log                  {result['orders_in_audit_log']} entries, "
          f"{'kept' if result['audit_kept'] else 'cleared'}")
    print()
    print("Board is back to the seeded opening position.")
    print("Restart the API so it re-reads the defaults:")
    print("  docker compose restart api      (or restart uvicorn)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
