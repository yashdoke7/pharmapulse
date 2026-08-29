"""Replay mode and the measured business case.

State is held in memory, keyed by session id. Deliberately not websockets: the
frontend polls /tick on a timer, which cannot break on stage.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api import deps
from decision import replay as replay_engine
from pipelines.gold import read_gold

router = APIRouter(prefix="/api/replay", tags=["replay"])

_SESSIONS: dict[str, replay_engine.ReplaySession] = {}
_MAX_SESSIONS = 8

DEFAULT_FROM = "2019-01-01"
DEFAULT_TO = "2019-03-31"


class StartRequest(BaseModel):
    from_: str = Field(default=DEFAULT_FROM, alias="from")
    to: str = DEFAULT_TO
    policy: str = replay_engine.POLICY_PHARMAPULSE

    model_config = {"populate_by_name": True}


class TickRequest(BaseModel):
    session_id: str
    steps: int = Field(default=1, ge=1, le=30)


def _actuals():
    try:
        return read_gold("day")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=deps.error(
            "NO_FORECAST_YET", "run the pipeline first")) from exc


@router.post("/start")
def start(body: StartRequest) -> dict:
    settings = deps.load_settings()
    try:
        session = replay_engine.ReplaySession(
            _actuals(), settings, settings.get("per_series", {}),
            start=body.from_, end=body.to, policy=body.policy)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=deps.error(
            "INVALID_PARAMS", str(exc))) from exc

    # Bound the number of live sessions so a demo cannot leak memory.
    while len(_SESSIONS) >= _MAX_SESSIONS:
        _SESSIONS.pop(next(iter(_SESSIONS)))
    _SESSIONS[session.session_id] = session

    return deps.envelope(session.snapshot(events=[]))


@router.post("/tick")
def tick(body: TickRequest) -> dict:
    session = _SESSIONS.get(body.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=deps.error(
            "INVALID_PARAMS", "unknown or expired replay session"))

    snapshot = session.snapshot(events=[])
    collected: list[dict] = []
    for _ in range(body.steps):
        if session.finished:
            break
        snapshot = session.tick()
        collected.extend(snapshot.get("events", []))
    snapshot["events"] = collected
    return deps.envelope(snapshot)


@router.post("/stop")
def stop(body: TickRequest) -> dict:
    session = _SESSIONS.pop(body.session_id, None)
    return deps.envelope({"stopped": session is not None})


@router.get("/business-case")
def business_case(start_date: str = DEFAULT_FROM, end_date: str = DEFAULT_TO) -> dict:
    """Our policy against a min/max policy, over the identical real days.

    Same data, same costs, same lead time, same review cadence, same protection
    interval. The ONLY difference is that min/max sizes against the mean while
    we size against the quantile the pharmacy's own cost ratio implies.

    That makes the difference attributable to the thesis rather than to a
    handicap given to the baseline.
    """
    settings = deps.load_settings()
    try:
        result = replay_engine.compare_policies(
            _actuals(), settings, settings.get("per_series", {}),
            start=start_date, end=end_date)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=deps.error(
            "INVALID_PARAMS", str(exc))) from exc

    result["method"] = (
        "Both policies replayed over the same real daily history with identical "
        "costs, lead time, review cadence and protection interval. Unmet demand "
        "is charged at the unit margin; stock held overnight is charged at the "
        "annual holding rate. Measured, not assumed."
    )
    return deps.envelope(result)
