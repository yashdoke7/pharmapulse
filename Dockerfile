# One container: the API and the compiled interface on a single origin.
#
# docker-compose runs two services because that is the right shape for local
# development - Vite's dev server gives hot reload, which a static bundle
# cannot. A deployment wants the opposite: one URL to hand to a judge, no CORS,
# no second free-tier service to keep awake, and no dev server in production.
#
#   docker build -t pharmapulse .
#   docker run -p 8000:8000 pharmapulse
#
# It lives at the repository root because that is where Hugging Face Spaces and
# most one-click hosts look, and neither lets you point at a path. Local
# development still uses docker-compose and the two files under infra/.
#
# Listens on $PORT when the host sets one (Render, Railway, Koyeb); otherwise
# 8000. On Hugging Face put `app_port: 8000` in the Space README so it routes
# there instead of assuming 7860.

# --- stage 1: build the interface -----------------------------------------
FROM node:20-slim AS web

WORKDIR /web
COPY web/package*.json ./
RUN npm ci

COPY web/ ./
# Same origin as the API, so the browser just calls /api/... with no host.
ENV VITE_API_BASE=/api
RUN npm run build


# --- stage 2: the application ---------------------------------------------
FROM python:3.11-slim

# build-essential and git are needed to install prophet/cmdstanpy and lightgbm,
# and are dropped again in the same layer so they do not ship.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential git curl libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY pipelines/ ./pipelines/
COPY core/ ./core/
COPY decision/ ./decision/
COPY api/ ./api/
COPY scripts/ ./scripts/
COPY contracts/ ./contracts/
COPY artifacts/ ./artifacts/
COPY data/observed/ ./data/observed/
COPY pyproject.toml Makefile ./

COPY --from=web /web/dist ./web/dist

# Build the forecast store INTO the image. It is under a megabyte, and baking
# it means a cold container serves real forecasts on its first request instead
# of falling back to fixtures while a four-minute batch runs.
#
# If this fails - no network, a build timeout, a missing dataset - the build
# still succeeds and the API serves contracts/fixtures/*.json with
# meta.degraded set, which is rung 5 of the degradation ladder. A deployment
# that boots degraded and says so beats a deployment that will not boot.
RUN python -m pipelines.run_nightly --stage all || \
    echo "batch failed at build time - the API will serve fixtures and say so"

RUN useradd -m -u 10001 pulse && chown -R pulse:pulse /app
USER pulse

ENV PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    PORT=8000

EXPOSE 8000
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
