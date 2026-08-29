# INTEGRATION, DOCKER & OPS

> Owner: **Pod A2**, with the lead. Everyone reads sections 1, 2 and 7.

**The premise:** with 8 people and 4 days, integration is not a phase — it is a property you either
maintain from hour one or lose entirely. *"If you are integrating on Day 3, you have already failed,
so do not arrive there."*

---

## 1 · How the pieces connect

```
  data/observed/salesdaily.csv
        │
        │  POD A   make pipeline
        ▼
  data/warehouse/gold/**.parquet          ← CONTRACT C1
  data/warehouse/features/**.parquet
        │
        │  POD B   make forecast
        ▼
  data/warehouse/forecast/version=<slug>/ ← CONTRACT C2
  data/warehouse/forecast/CURRENT         ← pointer, written last
  artifacts/benchmarks.json               ← CONTRACT C4
        │
        │  POD C   uvicorn api.main:app
        ▼
  http://localhost:8000/api/*             ← CONTRACT C3
  data/warehouse/ops.db  (settings, ledger, orders, audit)
        │
        │  POD D   npm run dev
        ▼
  http://localhost:5173
```

**Three seams, and each one has a fallback that keeps the demo alive:**

| Seam | If the producer is not ready | Fallback |
|---|---|---|
| A → B | gold not built | B works against a CSV read directly, same column names |
| B → C | forecast store empty | `lead_time_demand()` stub returns a scaled daily median |
| C → D | API down or wrong | `VITE_USE_FIXTURES=1` — the whole app runs from `contracts/fixtures/` |

**Keep all three fallbacks working all week.** They are not scaffolding to be removed; they are the
degradation ladder, and the last one is what you flip on stage if the backend dies.

---

## 2 · Getting a machine running (everyone, Day 0)

```bash
git clone <repo> && cd pharmapulse
python -m venv .venv && source .venv/Scripts/activate   # Windows Git Bash
pip install -r requirements.txt
python scripts/check_data.py          # must print a snapshot_id
python scripts/make_fixtures.py       # regenerates contracts/fixtures/
pytest -q
cd web && npm install && npm run dev
```

**Day-0 gate: all 8 people have merged a one-line PR and CI went green on it.** Anyone still broken
at the Day-1 standup pairs with A2 until fixed — do not let one person debug an environment alone
for a morning.

### The known install risk: Prophet

`prophet` pulls `cmdstanpy` and can take 10+ minutes or fail outright on Windows.

```bash
python -c "from prophet import Prophet; print('prophet ok')"
```

- **Works:** carry on.
- **Fails:** use the container (`docker compose run --rm api bash`), or work without it — Pod B's
  portfolio guards the import and runs a four-member ensemble. **Tell Pod B immediately**, because
  `benchmarks.json` must record which members were actually present. Never ship a different ensemble
  than the one on the slide.

**Windows-specific:** `numpy==1.26.4` is pinned because `numba` (inside `statsforecast`) does not
accept numpy 2.x. Do not bump it. If `lightgbm` fails to build, install the wheel:
`pip install --only-binary :all: lightgbm==4.5.0`.

---

## 3 · `docker-compose.yml`

> **Status: written, NOT verified.** Docker was not installed on the build machine, so
> `docker compose up` has never actually been run against this repo. The Dockerfiles and compose
> file are complete and the dependency pins are the ones the working venv uses, but treat the first
> run as a task with unknown duration rather than a guarantee. The local venv path in the root
> README is the one that is known to work.

Already at the repo root. One command:

```bash
docker compose up --build
```

| Service | Port | Notes |
|---|---|---|
| `api` | 8000 | FastAPI + the whole Python stack; mounts `./data` and `./artifacts` |
| `web` | 5173 | Vite dev server against `http://api:8000/api` |

There is **no database service and no Redis** — deliberately. Analytical storage is Parquet read by
DuckDB (no server, no port, no credentials, identical on a laptop and in CI). Operational storage is
SQLite in the same volume. Adding Postgres and Redis costs a day of operations and buys nothing at
this data size.

The pipeline is a one-shot, not a service:

```bash
docker compose run --rm api python -m pipelines.run_nightly --stage all
docker compose run --rm api python scripts/day1_benchmark.py
```

---

## 4 · CI — `.github/workflows/ci.yml`

Runs on every push and blocks merge on red:

1. `ruff check .`
2. `pytest -q` — including `test_no_leakage.py` and the contract tests
3. `python scripts/day1_benchmark.py --fast` — a 2-fold version, so a model regression is caught by
   the build rather than by a person
4. `cd web && npm ci && npm run build`

**Why the benchmark runs in CI:** the whole portfolio fits in about 25 seconds on one CPU. That is
the reason `statsforecast` (Numba-compiled) is in the stack — it makes a full backtest affordable on
every commit instead of being an offline exercise somebody re-runs by hand and forgets.

**Branch protection:** one approval, CI green, no direct pushes to `main`.

---

## 5 · Deployment

| Piece | Host | Notes |
|---|---|---|
| Web | Vercel | free tier, public HTTPS, auto-deploy from `main` |
| API | Render or Fly.io | free tier; **cold start is the demo risk** |

**Cold start kills live demos.** Mitigations, in order:
1. A keep-alive ping every 10 minutes hitting `/api/health`.
2. **Warm the service 30 minutes before the slot** and keep a tab open on it.
3. `docker compose up` on the presenter's laptop as a hot standby, already running.
4. The recorded video, offline, on **two** devices.

**Rehearse the fallback switch itself**, not just the demo. Knowing the video exists is not the same
as being able to reach it in eight seconds with a projector attached.

---

## 6 · Environment variables

| Variable | Default | Used by |
|---|---|---|
| `PHARMAPULSE_FIXTURES` | `1` until Day 2, then `0` | API — serve fixtures instead of real reads |
| `PHARMAPULSE_DATA_ROOT` | `data/warehouse` | pipelines, core, api |
| `PHARMAPULSE_ALLOW_SYNTHETIC_TRAINING` | **never set this** | the trainer raises if a synthetic path is passed |
| `VITE_USE_FIXTURES` | `1` until Day 2, then `0` | web |
| `VITE_API_BASE` | `http://localhost:8000/api` | web |

`.env.example` is committed; `.env` never is. Run `gitleaks` in pre-commit if it is one command; skip
it if it is not.

---

## 7 · The integration checklist — run it at the 20:00 demo, out loud, every night

```
[ ] main is green in CI
[ ] docker compose up works from a clean clone on a machine that is not A2's
[ ] make pipeline produces gold           (Pod A)
[ ] make benchmark writes benchmarks.json and prints the leaderboard   (Pod B)
[ ] the forecast store has a CURRENT pointer and 8 series of quantiles (Pod B)
[ ] every P0 endpoint answers on the DEPLOYED url, not localhost       (Pod C)
[ ] the deployed web app loads and every screen renders                (Pod D)
[ ] the service-level slider moves with the network tab empty          (Pod C+D)
[ ] VITE_USE_FIXTURES=1 still produces a complete working app          (fallback)
[ ] someone other than the owner has run each of the above once
```

**Nothing is "done" until it is merged and visible in the deployed app.** Local-only work does not
count at the 20:00 demo, and saying so consistently is the lead's main job.

---

## 8 · Degradation ladder — build it into the responses, it costs almost nothing

When something fails the system descends one rung **and says which rung it is on**. `meta.degraded`
carries the name; Pod D renders a chip.

| Rung | State | Serves | User sees |
|---|---|---|---|
| 1 | Healthy | calibrated ensemble | nothing unusual |
| 2 | Cache down | direct store reads | slower page, no functional change |
| 3 | Nightly job failed | yesterday's forecasts | **amber staleness badge with the exact vintage** |
| 4 | Model runtime down | statistical fallback in-process | *"fallback model"* chip on every forecast |
| 5 | Store unreadable | fixtures | *"demo data"* watermark |
| 6 | Everything down | last cached table, read-only | banner; **ordering disabled** so a bad commit cannot happen |

Rungs 3, 5 and 6 are three lines of code each and they are the most convincing thing in the Q&A:
*"the worst outcome of a bad night is forecasts that are one day old and visibly labelled as such —
never fresh forecasts that are wrong."*

---

## 9 · Merge protocol — the boring rules that save the sprint

1. **Branch `pod-x/short-name`.** Never commit to `main`.
2. **PR under ~400 lines.** A 1,200-line PR at 23:00 on Day 3 does not get reviewed, it gets merged
   blind.
3. **One approval, CI green.** Review inside 30 minutes during working hours.
4. **Only your pod's paths.** A PR touching two pods' folders needs both owners.
5. **Rebase on `main` before opening a PR.** Merge conflicts in `contracts/` are the lead's to
   resolve, nobody else's.
6. **A contract change is its own PR**, containing: the `CONTRACTS.md` edit, the change-log line, the
   regenerated fixture, and nothing else. It is announced in the channel before it is merged.

## 10 · What is deliberately not built, and how to say so

A judge asking *"where is your authentication?"* deserves a better answer than silence or a
half-built login page.

| Not built | The line to use |
|---|---|
| OIDC auth, multi-tenant row-level security | *"Designed, specified in the architecture document, not built in four days. Tenant isolation is the one failure whose consequence is disclosure of another pharmacy's commercial data, so it belongs in the database, not in application code — and half-building that is worse than not building it."* |
| Redis, Postgres, Prefect, OpenTelemetry | *"Production choices for a production load. At eight series they add services to operate and change nothing a judge can see. DuckDB over Parquet runs identically on a laptop, in CI and in a container."* |
| Batch-level expiry tracking | *"The dataset has no batches. Claiming a batch-expiry feature on data without batches is exactly what our provenance rule exists to prevent. It is the next integration, not a shipped feature."* |
| Live POS integration | *"Simulated by replaying the real historical records in their original order — which is also our integration test."* |
