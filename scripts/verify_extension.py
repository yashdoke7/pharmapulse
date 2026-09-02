"""Check the synthetic extension against the real file, and against its own claims.

    python scripts/verify_extension.py

Two questions, and the second is the one a panel will actually ask.

  1. Does it still look like this pharmacy?  Every property the architecture was
     built on has to survive, or the demo quietly stops making sense. A file
     where the intermittent product is no longer intermittent takes half the
     model portfolio down with it.

  2. Does it prove anything?  "We generated seven more years of the same" proves
     nothing. The extension carries labelled regime changes, and this script
     shows the DEMAND CLASSIFIER moving on its own in response - no config edited,
     no series named in code. That is the demonstration.

Exits non-zero if a preserved property has drifted out of tolerance, so it can
run in CI next to the benchmark.
"""

from __future__ import annotations

import json
from pathlib import Path

import _bootstrap  # noqa: F401  - repo root onto sys.path; must precede repo imports
import pandas as pd

from core.classify import ADI_CUTOFF, CV2_CUTOFF, ROUTES, classify_one

REAL = Path("data/observed/salesdaily.csv")
SYN = Path("data/synthetic/salesdaily_synthetic_2019_2026.csv")
MANIFEST = Path("data/synthetic/extension_manifest.json")

SERIES = ["M01AB", "M01AE", "N02BA", "N02BE", "N05B", "N05C", "R03", "R06"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# The window before any injected regime starts. Comparing the whole 7 years
# against the real file would be comparing a changed pharmacy to an unchanged
# one and calling the difference a bug.
QUIET_END = "2020-03-01"


def rule(title: str) -> None:
    print(f"\n{title}\n{'-' * len(title)}")


def main() -> int:
    if not SYN.exists():
        print(f"{SYN} not found - run scripts/make_extension.py first")
        return 1

    real = pd.read_csv(REAL, parse_dates=["datum"])
    syn = pd.read_csv(SYN, parse_dates=["datum"])
    quiet = syn[syn.datum < QUIET_END]
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

    failures: list[str] = []
    warnings: list[str] = []

    def near_a_boundary(c) -> bool:
        """True if this series sits close enough to a cutoff to flip on noise.

        R03 has a real ADI of 1.27 against a 1.32 cutoff - a 4% margin. Any
        generator will land it on either side from run to run. Tuning the
        generator until it agrees would be fitting to the checker; flagging it
        as a boundary case says the true thing instead.
        """
        return (abs(c.adi - ADI_CUTOFF) / ADI_CUTOFF < 0.10
                or abs(c.cv2 - CV2_CUTOFF) / CV2_CUTOFF < 0.10)

    rule("1 - PRESERVED  (synthetic, before any regime starts, vs the real file)")
    print(f"{'series':7}{'mean':>15}{'sd':>15}{'zero %':>15}{'class':>28}")
    print(f"{'':7}{'real':>7}{'syn':>8}{'real':>7}{'syn':>8}{'real':>8}{'syn':>7}"
          f"{'real':>14}{'syn':>14}")
    for sid in SERIES:
        cr = classify_one(sid, real[sid])
        kr, ks = cr.demand_class, classify_one(sid, quiet[sid]).demand_class
        boundary = near_a_boundary(cr)
        mark = "" if kr == ks else ("  <- boundary" if boundary else "  <- DRIFTED")
        print(f"{sid:7}{real[sid].mean():7.2f}{quiet[sid].mean():8.2f}"
              f"{real[sid].std():7.2f}{quiet[sid].std():8.2f}"
              f"{(real[sid] == 0).mean() * 100:8.1f}{(quiet[sid] == 0).mean() * 100:7.1f}"
              f"{kr:>14}{ks:>14}{mark}")
        if kr != ks:
            msg = (f"{sid} classifies {ks} in the quiet window, real is {kr} "
                   f"(real ADI {cr.adi:.2f}, CV2 {cr.cv2:.2f})")
            (warnings if boundary else failures).append(msg)

    cl_real = (real[SERIES].sum(axis=1) == 0).sum() / (len(real) / 365.25)
    cl_syn = (syn[SERIES].sum(axis=1) == 0).sum() / (len(syn) / 365.25)
    print(f"\nclosures per year   real {cl_real:.1f}   synthetic {cl_syn:.1f}")
    if abs(cl_real - cl_syn) > 2:
        failures.append(f"closure rate drifted: {cl_real:.1f}/yr -> {cl_syn:.1f}/yr")

    # Weekday effects run in OPPOSITE directions - finding 7, and a single
    # global weekday coefficient would cancel them. It has to survive.
    print("\nweekend index (must stay opposite)")
    for sid in ("N02BE", "N05C"):
        wr = real.groupby(real.datum.dt.dayofweek)[sid].mean() / real[sid].mean()
        ws = syn.groupby(syn.datum.dt.dayofweek)[sid].mean() / syn[sid].mean()
        print(f"  {sid}  real Sun {wr[6]:.2f}   synthetic Sun {ws[6]:.2f}")
        if (wr[6] > 1) != (ws[6] > 1):
            failures.append(f"{sid} weekend effect flipped direction")

    rule("2 - WHAT IT PROVES  (the classifier moving on its own)")
    windows = [
        ("2019-2022  before", syn[syn.datum < "2022-06-01"]),
        ("2025-2026  after", syn[syn.datum >= "2025-01-01"]),
    ]
    for sid in ("N05C", "M01AE"):
        print(f"\n  {sid}")
        seen = []
        for label, df in windows:
            c = classify_one(sid, df[sid])
            seen.append(c.demand_class)
            print(f"    {label:20} {c.demand_class:13} ADI {c.adi:5.2f}  "
                  f"zero {c.zero_rate * 100:5.1f}%")
            print(f"    {'':20} routes to {', '.join(ROUTES[c.demand_class])}")
        if seen[0] == seen[1]:
            failures.append(f"{sid} never changed demand class - the event did not land")

    print("\n  R06 seasonal peak")
    for label, df in [("2020-2023", syn[syn.datum < "2024-01-01"]),
                      ("2026", syn[syn.datum >= "2026-01-01"])]:
        g = df.groupby(df.datum.dt.month)["R06"].mean()
        print(f"    {label:20} peaks in {MONTHS[int(g.idxmax()) - 1]}   "
              f"amplitude {g.max() / g.mean():.2f}x")

    rule("3 - THE LABELLED EVENTS")
    for e in manifest["events"]:
        print(f"  {e['from']} -> {e['to']}   {e['id']}")
        print(f"      {e['what']}")
        print(f"      expect: {e['expect']}\n")

    print(f"lane {manifest['lane']} - {manifest['lane_rule']}")

    if warnings:
        print(f"\n{len(warnings)} boundary case(s) - within 10% of a cutoff, "
              f"so a flip is sampling noise, not drift:")
        for w in warnings:
            print(f"  - {w}")

    if failures:
        print(f"\n{len(failures)} PROBLEM(S):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nAll preserved properties within tolerance; both transitions fired.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
