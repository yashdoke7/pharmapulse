# `infra/` — containers, CI, deployment

**Owner:** Pod A2. **Full brief:** `team/05_INTEGRATION_DOCKER_OPS.md`

---

## Target

> One command brings the whole system up, on anyone's machine, and that is also how CI runs it.
> "Works on my machine" should be impossible to say.

## Inputs

`requirements.txt` (pinned) · `web/package.json` · the repo source

## Outputs

| Output | Used by |
|---|---|
| `api` container on :8000 | everyone, locally and in the demo fallback |
| `web` container on :5173 | everyone |
| a green CI run on every push | merge protection |
| a public HTTPS URL | the demo |

## Contents

| File | What |
|---|---|
| `Dockerfile.api` | python:3.11-slim, build deps for prophet/lightgbm, **non-root uid 10001** |
| `Dockerfile.web` | node:20-alpine, dependency layer first so a source edit does not reinstall |
| `../docker-compose.yml` | the two services, at the repo root |
| `../.github/workflows/ci.yml` | ruff → pytest → web build → fixture-shape check |

## No database service. No Redis. Deliberate.

Analytical storage is **Parquet read by DuckDB** — SQL directly over files with no server, no port
and no credentials, so the same code path runs on a laptop, in CI and in a container. Operational
storage is **SQLite** in the same volume. At eight series, adding Postgres and Redis costs a day of
operations and changes nothing a judge can see. Say that out loud rather than half-building them.

## Commands

```bash
docker compose up --build                                              # the whole system
docker compose run --rm api python -m pipelines.run_nightly --stage all # the batch
docker compose run --rm api python scripts/day1_benchmark.py            # the numbers
docker compose run --rm api bash                                        # a shell with the ML stack
```

The pipeline is a one-shot, not a service.

## Known install risks

| Risk | Handling |
|---|---|
| **Prophet / cmdstanpy** — slow or failing, especially on Windows | Verify `python -c "from prophet import Prophet"` on all 8 machines on **Day 0**. The container is the escape hatch. Pod B guards the import and falls back to a four-member ensemble — but `benchmarks.json` must record which members were present. |
| **numpy 2.x** | Pinned to `1.26.4` because `numba` inside `statsforecast` rejects 2.x. **Do not bump it.** |
| **lightgbm build failure** | `pip install --only-binary :all: lightgbm==4.5.0` |

## Deployment

Web on **Vercel**, API on **Render or Fly.io**, both free tier, both public HTTPS.

**Cold start is the single largest demo risk.** In order: a keep-alive ping every 10 minutes on
`/api/health`; warm the service **30 minutes before the slot** and keep a tab open; `docker compose
up` already running on the presenter's laptop as hot standby; the recorded video offline on **two**
devices.

**Rehearse the fallback switch itself.** Knowing the video exists is not the same as reaching it in
eight seconds with a projector attached.

## Definition of done

- [ ] `docker compose up` works from a clean clone on a machine that is **not** A2's
- [ ] CI green on every push and blocking merge on red
- [ ] The deployed URL is live, warm, and someone other than A2 has deployed once
- [ ] `.env.example` committed; `.env` never committed
