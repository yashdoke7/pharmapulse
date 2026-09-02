"""Write contracts/openapi.json from the FastAPI app.

Pod C2 runs this after every API shape change; Pod D generates TypeScript types from it:

    python scripts/dump_openapi.py
    cd web && npx openapi-typescript ../contracts/openapi.json -o src/api/types.ts

The schema comes from the same Pydantic annotations that validate requests at runtime,
so the contract cannot drift from the implementation - which is the entire reason this
stack was chosen while a frontend is built in parallel.
"""

from __future__ import annotations

import json
from pathlib import Path

import _bootstrap  # noqa: F401  - repo root onto sys.path; must precede repo imports

from api.main import app

OUT = Path("contracts/openapi.json")


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(app.openapi(), indent=2), encoding="utf-8")
    print(f"wrote {OUT}")
    print("Commit it. Pod D generates their types from this file.")


if __name__ == "__main__":
    main()
