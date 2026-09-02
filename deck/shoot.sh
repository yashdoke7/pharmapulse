#!/usr/bin/env bash
# Capture the product screenshots the deck embeds, with headless Chrome.
#
# Needs both servers up:
#     uvicorn api.main:app --port 8000
#     cd web && npm run dev
# Then:
#     python scripts/reset_demo.py     # so the Order screen is not already filled
#     bash deck/shoot.sh
#
# Shot at 2x device scale, so the images stay sharp on a projector.
set -eu
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
OUT="$(cd "$(dirname "$0")" && pwd)/img"
mkdir -p "$OUT"

shoot () {  # name route width height
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --virtual-time-budget=6000 --screenshot="$(cygpath -w "$OUT/$1.png")" \
    --window-size="$3,$4" "http://localhost:5173$2" >/dev/null 2>&1
  echo "  $1.png"
}

echo "capturing -> $OUT"
shoot dashboard /          1500 1560
shoot orders    /orders    1500 1080
shoot forecast  /forecast  1500 1180
shoot why       /explain   1500 1180
shoot liveops   /live      1500 1240
shoot ops       /ops       1500 1240
shoot settings  /settings  1500 1000

python - <<'PY'
import pathlib
import numpy as np
from PIL import Image

d = pathlib.Path("deck/img")

# 1. Trim dead space below the content. The page background carries a faint
#    grid, so the threshold has to ignore ~3% ink or nothing ever trims.
for p in sorted(d.glob("*.png")):
    im = Image.open(p).convert("RGB")
    a = np.asarray(im)
    diff = np.abs(a.astype(int) - a[5, 5].astype(int)).sum(axis=2) > 60
    rows = np.where(diff.sum(axis=1) > 3)[0]
    im.crop((0, 0, a.shape[1], min(a.shape[0], int(rows[-1]) + 48))).save(p)

# 2. Derived crops. A full page is the wrong shape for 16:9, and one panel
#    shown large beats seven panels shown small.
def crop(src, box, dst):
    Image.open(d / src).crop(box).save(d / dst)
    print(f"  {dst}")

crop("dashboard.png", (0, 0, 3000, 1900), "dashboard_hero.png")
crop("why.png",       (1480, 575, 2680, 1580), "why_calibration.png")
crop("liveops.png",   (330, 690, 2680, 1350), "liveops_case.png")
crop("ops.png",       (350, 1100, 1500, 2110), "ops_board.png")
PY
