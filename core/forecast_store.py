"""Forecast store: contract C2. The boundary between batch and request.

Nothing below this line runs a model. Batch pays O(n) once a night so every
request is O(1) - which is why the response is fast, why two users opening the
same product on the same day see the same number, and why the service-level
slider can recompute live as it moves.

Publication is a POINTER SWAP: the version directory is written in full, then
the CURRENT file is rewritten as the last operation. A partially-written run is
therefore never readable.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

from pipelines.paths import forecast_root, resolve

# Kept for callers that import it, but every function resolves the root per
# call from PHARMAPULSE_DATA_ROOT instead - see pipelines/paths.py for why a
# default argument was the wrong place for this.
ROOT = Path("data/warehouse/forecast")
# NOT a module constant any more. It was `ROOT / "CURRENT"`, computed once at
# import from the hardcoded root - so after the root became configurable,
# write_version wrote its version into the NEW warehouse and then repointed the
# OLD one at it. The demo store ended up pointing at a version that did not
# exist inside it. Exactly the failure the pointer swap exists to prevent,
# reintroduced by leaving one path behind during the migration.
def pointer_path(root: Path | None = None) -> Path:
    return resolve(root, forecast_root()) / "CURRENT"

QUANTILE_LEVELS = [
    0.01, 0.025, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.50,
    0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 0.975, 0.99,
]
UI_LEVELS = [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95]


# --- writing --------------------------------------------------------------

def version_slug(model_version: str) -> str:
    return model_version.replace(":", "").replace("/", "_")


def write_version(quantiles: pd.DataFrame, model_version: str, snapshot_id: str,
                  members: pd.DataFrame | None = None,
                  demand_classes: pd.DataFrame | None = None,
                  meta: dict | None = None, root: Path | None = None) -> Path:
    """Write a complete forecast version, then swap the pointer."""
    root = resolve(root, forecast_root())
    slug = version_slug(model_version)
    target = root / f"version={slug}"
    target.mkdir(parents=True, exist_ok=True)

    df = quantiles.copy()
    df["model_version"] = model_version
    df["snapshot_id"] = snapshot_id
    if "calibrated" not in df.columns:
        df["calibrated"] = True
    df["ds"] = pd.to_datetime(df["ds"])
    df["cutoff"] = pd.to_datetime(df["cutoff"])
    df.to_parquet(target / "forecast.parquet", index=False, compression="zstd")

    if members is not None and not members.empty:
        members.to_parquet(target / "members.parquet", index=False, compression="zstd")
    if demand_classes is not None and not demand_classes.empty:
        dc = demand_classes.copy()
        if "models" in dc.columns:
            dc["models"] = dc["models"].astype(str)
        dc.to_parquet(target / "demand_class.parquet", index=False, compression="zstd")

    payload = {
        "model_version": model_version,
        "snapshot_id": snapshot_id,
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        **(meta or {}),
    }
    (target / "meta.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")

    # Last operation. Until this line runs, the new version is invisible.
    root.mkdir(parents=True, exist_ok=True)
    (root / "CURRENT").write_text(slug, encoding="utf-8")
    return target


# --- reading --------------------------------------------------------------

def current_version(root: Path | None = None) -> str | None:
    root = resolve(root, forecast_root())
    pointer = root / "CURRENT"
    if not pointer.exists():
        return None
    return pointer.read_text(encoding="utf-8").strip()


def _version_dir(root: Path | None = None) -> Path | None:
    root = resolve(root, forecast_root())
    slug = current_version(root)
    if slug is None:
        return None
    d = root / f"version={slug}"
    return d if d.exists() else None


def store_available(root: Path | None = None) -> bool:
    d = _version_dir(root)
    return bool(d and (d / "forecast.parquet").exists())


def _load(root: Path | None = None) -> pd.DataFrame:
    d = _version_dir(root)
    if d is None:
        raise FileNotFoundError(
            "no forecast store - run `python -m pipelines.run_nightly --stage forecast`"
        )
    df = pd.read_parquet(d / "forecast.parquet")
    df["ds"] = pd.to_datetime(df["ds"])
    df["cutoff"] = pd.to_datetime(df["cutoff"])
    return df


def model_meta(root: Path | None = None) -> dict:
    d = _version_dir(root)
    if d is None or not (d / "meta.json").exists():
        return {"model_version": "none", "snapshot_id": "none",
                "generated_at": None, "stale": True}
    meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    meta.setdefault("stale", False)
    return meta


def series_catalogue(root: Path | None = None) -> pd.DataFrame:
    d = _version_dir(root)
    if d is None or not (d / "demand_class.parquet").exists():
        return pd.DataFrame()
    return pd.read_parquet(d / "demand_class.parquet")


def read_forecast(series_id: str, grain: str = "week", horizon: int = 8,
                  cutoff: str | None = None, root: Path | None = None) -> pd.DataFrame:
    """Long frame: ds, horizon, quantile, value."""
    df = _load(root)
    df = df[(df["series_id"] == series_id) & (df["grain"] == grain)]
    if df.empty:
        raise KeyError(f"no forecast for {series_id} at {grain} grain")

    target_cutoff = pd.Timestamp(cutoff) if cutoff else df["cutoff"].max()
    df = df[df["cutoff"] == target_cutoff]
    df = df[df["horizon"] <= horizon]
    return df[["ds", "horizon", "quantile", "value"]].sort_values(
        ["horizon", "quantile"]).reset_index(drop=True)


def read_quantiles(series_id: str, grain: str = "week", horizon: int = 8,
                   levels: list[float] | None = None,
                   root: Path | None = None) -> dict[str, dict[str, float]]:
    """{"2019-10-06": {"0.05": 142.1, "0.50": 187.4, ...}, ...}"""
    df = read_forecast(series_id, grain, horizon, root=root)
    levels = levels or UI_LEVELS
    df = df[df["quantile"].isin(levels)]

    out: dict[str, dict[str, float]] = {}
    for ds, grp in df.groupby("ds"):
        key = pd.Timestamp(ds).strftime("%Y-%m-%d")
        out[key] = {f"{q:.2f}": round(float(v), 2)
                    for q, v in zip(grp["quantile"], grp["value"], strict=True)}
    return dict(sorted(out.items()))


def read_members(series_id: str, grain: str = "week",
                 root: Path | None = None) -> list[dict]:
    d = _version_dir(root)
    if d is None or not (d / "members.parquet").exists():
        return []
    m = pd.read_parquet(d / "members.parquet")
    m = m[(m["series_id"] == series_id) & (m["grain"] == grain)]
    if m.empty:
        return []
    out = []
    for model, grp in m.sort_values("ds").groupby("model"):
        out.append({"model": str(model),
                    "p50": [round(float(v), 2) for v in grp["value"]]})
    return out


def lead_time_demand(series_id: str, lead_time_days: int,
                     root: Path | None = None) -> dict[str, float]:
    """Distribution of TOTAL demand over the next `lead_time_days` days.

    This is the only function the decision engine needs.

    Daily quantiles are aggregated over the lead time by scaling the central
    estimate linearly and the spread by sqrt(n) - independent-ish daily errors
    partially cancel, so lead-time uncertainty grows slower than the mean.
    Summing the quantiles directly would overstate the tail badly.
    """
    df = _load(root)
    daily = df[(df["series_id"] == series_id) & (df["grain"] == "day")]

    if daily.empty:
        weekly = df[(df["series_id"] == series_id) & (df["grain"] == "week")]
        if weekly.empty:
            raise KeyError(f"no forecast for {series_id}")
        cutoff = weekly["cutoff"].max()
        first = weekly[(weekly["cutoff"] == cutoff) & (weekly["horizon"] == 1)]
        per_day = first.set_index("quantile")["value"] / 7.0
    else:
        cutoff = daily["cutoff"].max()
        window = daily[(daily["cutoff"] == cutoff)
                       & (daily["horizon"] <= max(lead_time_days, 1))]
        per_day = window.groupby("quantile")["value"].mean()

    median = float(per_day.get(0.50, per_day.median()))
    n = max(int(lead_time_days), 1)

    out: dict[str, float] = {}
    for q, v in per_day.items():
        centre = median * n
        deviation = (float(v) - median) * np.sqrt(n)
        out[f"{float(q):.2f}"] = round(max(0.0, centre + deviation), 2)
    return dict(sorted(out.items(), key=lambda kv: float(kv[0])))


def quantile_at(dist: dict[str, float], level: float) -> float:
    """Interpolate a stored quantile dict at an arbitrary level."""
    levels = sorted(float(k) for k in dist)
    values = [dist[f"{q:.2f}"] for q in levels]
    if level <= levels[0]:
        return float(values[0])
    if level >= levels[-1]:
        return float(values[-1])
    return float(np.interp(level, levels, values))
