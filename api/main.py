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

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api import deps
from api.routers import decisions, forecasting, ops

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
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173",
                   "http://localhost:4173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ops.router)
app.include_router(forecasting.router)
app.include_router(decisions.router)


@app.exception_handler(500)
async def internal_error(request: Request, exc: Exception) -> JSONResponse:
    """Never leak a stack trace to the browser; keep the envelope shape."""
    return JSONResponse(status_code=500, content=deps.error(
        "UPSTREAM_DEGRADED", "an internal error occurred"))


@app.get("/")
def root() -> dict:
    return {
        "name": "PharmaPulse",
        "docs": "/docs",
        "health": "/api/health",
        "mode": "fixtures" if deps.use_fixtures() else "live",
    }
