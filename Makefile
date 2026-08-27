# PharmaPulse — one entry point per thing anyone needs to run.
# Windows: use `make` from Git Bash, or copy the command out of the recipe.

PY := python
export PYTHONPATH := .

.PHONY: setup data pipeline benchmark api web test lint fixtures up down clean

setup:            ## install python deps
	$(PY) -m pip install -r requirements.txt

data:             ## verify the raw dataset is present + checksummed
	$(PY) scripts/check_data.py

pipeline:         ## raw csv -> bronze -> silver -> gold parquet
	$(PY) -m pipelines.run_nightly --stage gold

forecast:         ## gold -> fit portfolio -> combine -> calibrate -> forecast store
	$(PY) -m pipelines.run_nightly --stage forecast

nightly:          ## the whole batch, end to end
	$(PY) -m pipelines.run_nightly --stage all

benchmark:        ## reproduce every accuracy number -> artifacts/benchmarks.json
	$(PY) scripts/day1_benchmark.py

fixtures:         ## regenerate contracts/fixtures/*.json from the current store
	$(PY) scripts/make_fixtures.py

api:              ## run the API on :8000
	uvicorn api.main:app --reload --port 8000

web:              ## run the frontend on :5173
	cd web && npm run dev

test:
	pytest -q

lint:
	ruff check . && ruff format --check .

up:
	docker compose up --build

down:
	docker compose down -v

clean:
	rm -rf data/warehouse/* artifacts/runs/*
