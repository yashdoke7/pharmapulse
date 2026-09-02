"""PharmaPulse API.

Nothing below this line runs a model. The nightly batch pays O(n) once so every
request is O(1) - which is why the response is fast, why two users opening the
same product on the same day see the same number, and why the service-level
slider can recompute live as it moves.

Set PHARMAPULSE_FIXTURES=1 to serve contracts/fixtures/*.json instead of real
reads. That is rung 5 of the degradation ladder and the switch to flip if the
model layer dies during a demo.

Contract: CONTRACTS.md section C3.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from api import deps
from api.routers import datasets, decisions, forecasting, ops, replay

app = FastAPI(
    title="PharmaPulse API",
    version="1.0.0",
    description=(
        "A pharmacy's sales history becomes a purchase quantity, with the odds "
        "and the cost of being wrong attached. See CONTRACTS.md section C3."
    ),
)

app.add_middleware(
    CORSMiddleware,
    # Local dev origins, plus anything named at deploy time. In the single
    # container the browser and the API share an origin, so CORS never applies -
    # this list only matters when the two are hosted separately.
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173",
        *[o for o in os.getenv("PHARMAPULSE_ALLOWED_ORIGINS", "").split(",") if o],
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ops.router)
app.include_router(forecasting.router)
app.include_router(decisions.router)
app.include_router(replay.router)
app.include_router(datasets.router)


@app.exception_handler(500)
async def internal_error(request: Request, exc: Exception) -> JSONResponse:
    """Never leak a stack trace to the browser; keep the envelope shape."""
    return JSONResponse(status_code=500, content=deps.error(
        "UPSTREAM_DEGRADED", "an internal error occurred"))


# --- the built interface, when one is present ------------------------------
#
# A deployed container serves the API and the compiled frontend from the SAME
# origin, so there is one URL to hand out, no CORS, and no second service to
# keep alive on a free tier. When web/dist is absent - which is every local dev
# run, where Vite serves the interface itself - none of this mounts and the
# root stays the JSON index below.

_DIST = Path(os.getenv("PHARMAPULSE_WEB_DIST", "web/dist"))

if (_DIST / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        """Client-side routing: every unmatched path returns index.html.

        Registered last, so it cannot shadow /api/* or /docs - FastAPI matches
        routes in definition order. A direct hit on /orders has to return the
        app rather than a 404, or a refresh on any screen but the first one
        breaks.
        """
        # Never swallow the API surface. Without this an unmatched /api path -
        # a typo, a renamed route, a version skew between a deployed frontend
        # and a deployed backend - returns index.html with a 200, and the
        # caller gets HTML where it expected JSON. A 404 is the honest answer
        # and it is far easier to debug than a page that silently arrives
        # instead of data.
        if full_path.startswith(("api/", "docs", "openapi.json", "redoc")):
            raise HTTPException(status_code=404, detail=deps.error(
                "NOT_FOUND", f"no such endpoint: /{full_path}"))

        candidate = _DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_DIST / "index.html")


@app.get("/")
def root() -> dict:
    return {
        "name": "PharmaPulse",
        "docs": "/docs",
        "health": "/api/health",
        "mode": "fixtures" if deps.use_fixtures() else "live",
    }
