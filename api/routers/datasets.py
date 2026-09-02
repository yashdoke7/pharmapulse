"""Datasets: which one is live, rebuild it at any date, upload another.

The system used to be frozen against one file at one cutoff. Two questions
kept coming back and neither had an answer on the screen:

  "What would this have said in June 2017?"   - there was one forecast store,
      built at the end of the file, and no way to ask for another.
  "Does it work on MY data?"                  - the pipeline is generic, but
      the only way to feed it was a shell.

Both are the same feature. A dataset is a source file plus a lane plus an
as-of date, and building one is a batch that takes about twenty seconds.
Twenty seconds is too long to hold a request open and far too short to
justify a queue, so jobs run on a thread and the caller polls.

WHAT IS DELIBERATELY NOT HERE: authentication, quotas, and any attempt to
survive a restart. Jobs live in memory and die with the process. That is
honest for a single-tenant demo and the wrong answer for anything else -
team/05 section 10 says so out loud rather than leaving it implied.
"""

from __future__ import annotations

import shutil
import threading
import traceback
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, Body, File, Form, HTTPException, UploadFile

from api import deps
from core import forecast_store as fs
from pipelines.ingest import LANES, SERIES_IDS
from pipelines.paths import data_root, forecast_root

router = APIRouter(prefix="/api/datasets", tags=["datasets"])

UPLOAD_DIR = Path("data/uploads")
MAX_UPLOAD_BYTES = 8 * 1024 * 1024

# job_id -> record. Guarded because the poller reads while the worker writes.
_JOBS: dict[str, dict[str, Any]] = {}
_LOCK = threading.Lock()


# --- helpers --------------------------------------------------------------

def _versions() -> list[dict]:
    """Every forecast store version on disk, newest first."""
    root = forecast_root()
    if not root.exists():
        return []

    current = fs.current_version()
    out = []
    for d in sorted(root.glob("version=*"), reverse=True):
        slug = d.name.removeprefix("version=")
        meta: dict[str, Any] = {}
        mp = d / "meta.json"
        if mp.exists():
            import json
            try:
                meta = json.loads(mp.read_text(encoding="utf-8"))
            except Exception:
                meta = {}
        out.append({
            "slug": slug,
            "is_current": slug == current,
            "model_version": meta.get("model_version", slug),
            "snapshot_id": meta.get("snapshot_id"),
            "origin": meta.get("origin", "observed"),
            "as_of": meta.get("as_of"),
            "generated_at": meta.get("generated_at"),
            "n_rows": meta.get("n_rows"),
        })
    return out


def _set_job(job_id: str, **fields: Any) -> None:
    with _LOCK:
        _JOBS.setdefault(job_id, {})["job_id"] = job_id
        _JOBS[job_id].update(fields)


def _run_build(job_id: str, source: str | None, origin: str,
               as_of: str | None, stage: str) -> None:
    """The batch, on a worker thread. Never raises into the thread pool."""
    try:
        _set_job(job_id, status="running", step="ingest",
                 started_at=datetime.now().isoformat(timespec="seconds"))

        from pipelines.run_nightly import run_forecast, run_gold

        if stage in ("gold", "all") and source:
            run_gold(Path(source), verbose=False, origin=origin)

        _set_job(job_id, step="forecast")
        run_forecast(verbose=False, as_of=as_of)

        _set_job(job_id, status="done", step="published",
                 finished_at=datetime.now().isoformat(timespec="seconds"),
                 model_version=fs.current_version(), as_of_clock=fs.as_of())
    except Exception as exc:                                  # noqa: BLE001
        # The message reaches a screen, so it has to be the useful line rather
        # than a stack. The stack is kept for the log.
        _set_job(job_id, status="failed", step="failed", error=str(exc),
                 finished_at=datetime.now().isoformat(timespec="seconds"))
        traceback.print_exc()


def _start(source: str | None, origin: str, as_of: str | None,
           stage: str) -> dict:
    with _LOCK:
        busy = [j for j in _JOBS.values() if j.get("status") == "running"]
    if busy:
        raise HTTPException(status_code=409, detail=deps.error(
            "BUILD_IN_PROGRESS",
            "a build is already running - one at a time, because they write "
            "to the same warehouse"))

    job_id = uuid.uuid4().hex[:10]
    _set_job(job_id, status="queued", step="queued", source=source,
             origin=origin, as_of=as_of, stage=stage, error=None)
    threading.Thread(target=_run_build, daemon=True,
                     args=(job_id, source, origin, as_of, stage)).start()
    return dict(_JOBS[job_id])


# --- routes ---------------------------------------------------------------

@router.get("")
def list_datasets() -> dict:
    """What is live, and everything else that has been built."""
    meta = fs.model_meta()
    return deps.envelope({
        "current": {
            "model_version": meta.get("model_version"),
            "snapshot_id": meta.get("snapshot_id"),
            "origin": meta.get("origin", "observed"),
            "as_of": meta.get("as_of"),
            "clock": fs.as_of(),
            "generated_at": meta.get("generated_at"),
        },
        "versions": _versions(),
        "data_root": str(data_root()),
        "sources": _known_sources(),
        "lanes": LANES,
    })


def _known_sources() -> list[dict]:
    """Files this instance can build from, without an upload."""
    out = []
    for path, label, origin in [
        (Path("data/observed/salesdaily.csv"), "The real pharmacy file, 2014-2019", "observed"),
        (Path("data/synthetic/salesdaily_synthetic_2019_2026.csv"),
         "Synthetic extension to 2026 - lane 3, cannot back a claim", "synthetic"),
    ]:
        if path.exists():
            out.append({"path": str(path), "label": label, "origin": origin,
                        "size_kb": round(path.stat().st_size / 1024)})
    for path in sorted(UPLOAD_DIR.glob("*.csv")) if UPLOAD_DIR.exists() else []:
        out.append({"path": str(path), "label": f"Uploaded - {path.name}",
                    "origin": "observed",
                    "size_kb": round(path.stat().st_size / 1024)})
    return out


@router.post("/rebuild")
def rebuild(body: dict = Body(default={})) -> dict:
    """Rebuild the forecast store, optionally from another file or date.

    `as_of` is the interesting one: it runs the whole system as it would have
    run on that day. Gold is truncated before anything is fitted, so the demand
    class, the routing, the models and the calibration are all computed on what
    was knowable then - not filtered afterwards, which would already have
    leaked.
    """
    as_of = body.get("as_of") or None
    source = body.get("source") or None
    origin = body.get("origin") or "observed"

    if origin not in LANES:
        raise HTTPException(status_code=422, detail=deps.error(
            "UNKNOWN_LANE", f"origin must be one of {sorted(LANES)}"))

    if as_of:
        try:
            pd.Timestamp(as_of)
        except Exception:
            raise HTTPException(status_code=422, detail=deps.error(
                "BAD_DATE", f"as_of must be YYYY-MM-DD, got {as_of!r}")) from None

    if source and not Path(source).exists():
        raise HTTPException(status_code=404, detail=deps.error(
            "SOURCE_NOT_FOUND", f"no such file: {source}"))

    stage = "all" if source else "forecast"
    return deps.envelope(_start(source, origin, as_of, stage))


@router.post("/upload")
async def upload(file: UploadFile = File(...),
                 origin: str = Form("observed")) -> dict:
    """Accept a sales CSV and build from it.

    Validated here rather than inside the worker so a bad file fails in the
    request that sent it, where the person who chose it is still looking.
    """
    if origin not in LANES:
        raise HTTPException(status_code=422, detail=deps.error(
            "UNKNOWN_LANE", f"origin must be one of {sorted(LANES)}"))

    name = Path(file.filename or "upload.csv").name
    if not name.lower().endswith(".csv"):
        raise HTTPException(status_code=422, detail=deps.error(
            "NOT_A_CSV", "expected a .csv file"))

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = UPLOAD_DIR / f"{stamp}-{name}"

    size = 0
    with target.open("wb") as out:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                out.close()
                target.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail=deps.error(
                    "TOO_LARGE",
                    f"file exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)}MB"))
            out.write(chunk)

    # Shape check before anything expensive starts.
    try:
        head = pd.read_csv(target, nrows=5)
    except Exception as exc:                                  # noqa: BLE001
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=deps.error(
            "UNREADABLE_CSV", f"could not parse: {exc}")) from None

    missing = [c for c in ["datum", *SERIES_IDS] if c not in head.columns]
    if missing:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=deps.error(
            "MISSING_COLUMNS",
            f"missing {missing}. Expected a daily file with a 'datum' column "
            f"and one column per ATC code: {', '.join(SERIES_IDS)}"))

    return deps.envelope({
        "stored": str(target),
        "size_kb": round(size / 1024),
        "origin": origin,
        "columns_ok": True,
        "next": "POST /api/datasets/rebuild with this path as `source`",
    })


@router.get("/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    with _LOCK:
        job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=deps.error(
            "NO_SUCH_JOB", f"unknown job {job_id}"))
    return deps.envelope(dict(job))


@router.get("/jobs")
def list_jobs() -> dict:
    with _LOCK:
        jobs = sorted(_JOBS.values(),
                      key=lambda j: j.get("started_at") or "", reverse=True)
    return deps.envelope({"jobs": [dict(j) for j in jobs[:20]]})


@router.post("/activate")
def activate(body: dict = Body(...)) -> dict:
    """Point CURRENT at a version that already exists.

    Instant, because publication was always a pointer swap - the version
    directories are immutable and they all stay on disk. Switching back after
    a demo costs nothing and refits nothing.
    """
    slug = str(body.get("slug", "")).strip()
    target = forecast_root() / f"version={slug}"
    if not slug or not target.is_dir():
        raise HTTPException(status_code=404, detail=deps.error(
            "NO_SUCH_VERSION", f"no version {slug!r} on disk"))

    (forecast_root() / "CURRENT").write_text(slug, encoding="utf-8")
    deps.clear_caches()
    return deps.envelope({"activated": slug, "clock": fs.as_of(),
                          "model_version": fs.current_version()})


@router.delete("/versions/{slug}")
def delete_version(slug: str) -> dict:
    """Remove a version. Refuses to delete the live one."""
    if slug == fs.current_version():
        raise HTTPException(status_code=409, detail=deps.error(
            "VERSION_IS_LIVE",
            "activate another version before deleting this one"))
    target = forecast_root() / f"version={slug}"
    if not target.is_dir():
        raise HTTPException(status_code=404, detail=deps.error(
            "NO_SUCH_VERSION", f"no version {slug!r} on disk"))
    shutil.rmtree(target)
    return deps.envelope({"deleted": slug})
