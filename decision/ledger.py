"""Stock ledger: what is actually on the shelf right now.

A forecast of demand is only half of a reorder decision. The other half is what
you already have.

    opening + received - sold - wastage +/- stock-take adjustment = stock_on_hand

This is a TRANSACTIONAL workload - a running balance under concurrent writes -
not an analytical one, so it lives in SQLite rather than in Parquet.

Provenance: this dataset contains no inventory. The ledger is a LANE 2
structure - the pharmacy's own operational data, which a real pharmacy has in
its POS and goods-receipt system and a Kaggle export does not. Sales are the
real daily CSV replayed; opening stock and receipts are settings. Batch-level
expiry is NOT modelled, and is named as requiring real ERP data rather than
quietly faked.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import pandas as pd

DB_PATH = Path("data/warehouse/ops.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS stock_event (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    series_id    TEXT    NOT NULL,
    ds           TEXT    NOT NULL,
    kind         TEXT    NOT NULL,   -- opening|received|sold|wastage|adjustment
    quantity     REAL    NOT NULL,   -- signed: receipts +, sales -
    note         TEXT,
    created_at   TEXT    DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_stock_event_series ON stock_event(series_id, ds);

CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    series_id     TEXT NOT NULL,
    ds            TEXT NOT NULL,
    recommended   INTEGER NOT NULL,
    accepted      INTEGER NOT NULL,
    service_level REAL,
    reason        TEXT,
    actor         TEXT,
    prev_hash     TEXT,
    hash          TEXT,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);
"""

KIND_SIGN = {"opening": 1, "received": 1, "sold": -1, "wastage": -1, "adjustment": 1}


@dataclass
class Position:
    series_id: str
    stock_on_hand: float
    days_of_cover: float
    status: str
    projected_stockout_date: str | None

    def as_dict(self) -> dict:
        return {
            "series_id": self.series_id,
            "stock_on_hand": round(self.stock_on_hand, 2),
            "days_of_cover": round(self.days_of_cover, 2),
            "status": self.status,
            "projected_stockout_date": self.projected_stockout_date,
        }


@contextmanager
def connect(db_path: Path | str = DB_PATH):
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        conn.executescript(SCHEMA)
        yield conn
        conn.commit()
    finally:
        conn.close()


def reset(db_path: Path | str = DB_PATH) -> None:
    with connect(db_path) as conn:
        conn.execute("DELETE FROM stock_event")


def post(series_id: str, ds: str | date, kind: str, quantity: float,
         note: str = "", db_path: Path | str = DB_PATH) -> None:
    """Record one stock movement. Quantities are given unsigned; the kind
    decides the sign, so a caller cannot accidentally add a sale."""
    if kind not in KIND_SIGN:
        raise ValueError(f"unknown event kind {kind!r}; expected {sorted(KIND_SIGN)}")
    signed = abs(float(quantity)) * KIND_SIGN[kind] if kind != "adjustment" else float(quantity)
    with connect(db_path) as conn:
        conn.execute(
            "INSERT INTO stock_event (series_id, ds, kind, quantity, note) "
            "VALUES (?, ?, ?, ?, ?)",
            (series_id, str(ds), kind, signed, note),
        )


def post_many(events: list[dict], db_path: Path | str = DB_PATH) -> int:
    rows = []
    for e in events:
        kind = e["kind"]
        q = float(e["quantity"])
        signed = abs(q) * KIND_SIGN[kind] if kind != "adjustment" else q
        rows.append((e["series_id"], str(e["ds"]), kind, signed, e.get("note", "")))
    with connect(db_path) as conn:
        conn.executemany(
            "INSERT INTO stock_event (series_id, ds, kind, quantity, note) "
            "VALUES (?, ?, ?, ?, ?)", rows)
    return len(rows)


def seed_opening_stock(levels: dict[str, float], ds: str = "2019-01-01",
                       db_path: Path | str = DB_PATH) -> None:
    """Seed the shelf. Editable in settings, as every inventory system does."""
    post_many([{"series_id": s, "ds": ds, "kind": "opening", "quantity": q,
                "note": "seeded opening stock"} for s, q in levels.items()],
              db_path=db_path)


def balance(series_id: str | None = None, as_of: str | None = None,
            db_path: Path | str = DB_PATH) -> dict[str, float]:
    """Running balance per series: the sum of every signed movement."""
    sql = "SELECT series_id, SUM(quantity) AS soh FROM stock_event WHERE 1=1"
    params: list = []
    if series_id:
        sql += " AND series_id = ?"
        params.append(series_id)
    if as_of:
        sql += " AND ds <= ?"
        params.append(str(as_of))
    sql += " GROUP BY series_id"

    with connect(db_path) as conn:
        rows = conn.execute(sql, params).fetchall()
    return {r["series_id"]: float(r["soh"]) for r in rows}


def ledger_frame(series_id: str, db_path: Path | str = DB_PATH) -> pd.DataFrame:
    with connect(db_path) as conn:
        return pd.read_sql_query(
            "SELECT ds, kind, quantity FROM stock_event WHERE series_id = ? "
            "ORDER BY ds, id", conn, params=(series_id,))


def days_of_cover(stock_on_hand: float, daily_demand: float) -> float:
    """'You have 3.2 days left.' The number a buyer actually reasons with."""
    if daily_demand <= 0:
        return 999.0
    return float(stock_on_hand / daily_demand)


def projected_stockout(stock_on_hand: float, daily_forecast: list[tuple[str, float]]
                       ) -> str | None:
    """First date at which cumulative forecast demand exceeds stock on hand."""
    running = 0.0
    for ds, demand in daily_forecast:
        running += max(float(demand), 0.0)
        if running >= stock_on_hand:
            return str(ds)
    return None


# --- audit chain ----------------------------------------------------------

def log_order(series_id: str, ds: str, recommended: int, accepted: int,
              service_level: float | None = None, reason: str = "",
              actor: str = "demo", db_path: Path | str = DB_PATH) -> str:
    """Append-only, hash-chained order log.

    Each entry stores the previous entry's hash, so deleting or editing one
    breaks the chain and is detectable. This is what answers "I never approved
    that order", and an override without a reason is refused.
    """
    import hashlib
    import json

    if accepted != recommended and not reason.strip():
        raise ValueError("an override must carry a reason")

    with connect(db_path) as conn:
        prev = conn.execute(
            "SELECT hash FROM order_log ORDER BY id DESC LIMIT 1").fetchone()
        prev_hash = prev["hash"] if prev else "genesis"
        payload = json.dumps({
            "series_id": series_id, "ds": ds, "recommended": recommended,
            "accepted": accepted, "service_level": service_level,
            "reason": reason, "actor": actor, "prev": prev_hash,
        }, sort_keys=True)
        digest = hashlib.sha256(payload.encode()).hexdigest()
        conn.execute(
            "INSERT INTO order_log (series_id, ds, recommended, accepted, "
            "service_level, reason, actor, prev_hash, hash) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (series_id, ds, recommended, accepted, service_level, reason,
             actor, prev_hash, digest))
    return digest


def verify_chain(db_path: Path | str = DB_PATH) -> bool:
    """True if no entry has been edited or removed."""
    import hashlib
    import json

    with connect(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM order_log ORDER BY id").fetchall()

    prev_hash = "genesis"
    for r in rows:
        payload = json.dumps({
            "series_id": r["series_id"], "ds": r["ds"],
            "recommended": r["recommended"], "accepted": r["accepted"],
            "service_level": r["service_level"], "reason": r["reason"],
            "actor": r["actor"], "prev": prev_hash,
        }, sort_keys=True)
        if hashlib.sha256(payload.encode()).hexdigest() != r["hash"]:
            return False
        prev_hash = r["hash"]
    return True
