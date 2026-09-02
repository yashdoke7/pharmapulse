"""Put the repository root on sys.path.

`python scripts/day1_benchmark.py` sets sys.path[0] to `scripts/`, NOT to the
repository root - so `from core import calibrate` searches site-packages and
finds whatever unrelated `core` distribution happens to be installed there:

    ImportError: cannot import name 'calibrate' from 'core'
    (...\site-packages\core\__init__.py)

Importing this module first fixes that. `scripts/` IS on sys.path when a script
in it is run directly, so this import always resolves. Prepending, not
appending, so the repository wins over a same-named installed package.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
