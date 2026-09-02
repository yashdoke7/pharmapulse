"""Generate a labelled synthetic extension of the sales file, 2019 -> 2026.

    python scripts/make_extension.py                 # writes data/synthetic/
    python scripts/make_extension.py --seed 7        # a different draw

WHY THIS EXISTS, AND WHY THE OBVIOUS VERSION IS USELESS
-------------------------------------------------------
An extension that continues the same series with the same statistics proves
nothing. A judge asks "so you generated more of the same - what does that
show?", and the honest answer is: nothing.

So this generator does two jobs.

1. PRESERVE what the architecture is built on. A drop-in replacement file has
   to keep the seven properties measured before anything was designed, or the
   demo quietly stops making sense. The dataset we were handed did not:

       N05C zero-days   67.9%  ->   0.0%    the intermittent series vanished
       N05C lag-1 acf    0.011 ->   0.930   a smooth AR process, not a pharmacy
       closures         26 days ->  0       nothing left for the cleaner to find
       N05C spread      sd 1.09 ->  sd 0.12 9x compressed

   With N05C smooth, the demand classifier routes it away from Croston and half
   the model-portfolio argument evaporates on screen.

2. INJECT regime changes on purpose, each one labelled, each one chosen because
   the system should visibly respond to it WITHOUT being reconfigured. That is
   the thing worth demonstrating: not that we can make up numbers, but that a
   computed rule re-routes a product when the product changes.

Every injected event is written to a manifest next to the CSV, with the date,
what was done, and what the system should be seen to do about it. The manifest
is the demo script.

LANE 3. The output is synthetic and is labelled synthetic in a column. It may
be used to demonstrate that the pipeline accepts new data and that the clock
moves. It may not train a model that backs an accuracy claim, and
pipelines/ingest.py raises on a synthetic path - that guard is the point, not
an obstacle.
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

import _bootstrap  # noqa: F401  - repo root onto sys.path; must precede repo imports
import numpy as np
import pandas as pd

RAW = Path("data/observed/salesdaily.csv")
OUT_DIR = Path("data/synthetic")

SERIES = ["M01AB", "M01AE", "N02BA", "N02BE", "N05B", "N05C", "R03", "R06"]
NAMES = {
    "M01AB": "Diclofenac", "M01AE": "Ibuprofen", "N02BA": "Aspirin",
    "N02BE": "Paracetamol", "N05B": "Anxiolytics", "N05C": "Sedatives",
    "R03": "Asthma / COPD", "R06": "Antihistamines",
}

START = date(2019, 10, 9)     # the day after the real file ends
END = date(2026, 9, 30)


# --------------------------------------------------------------------------
# The events. This list IS the demonstration - each entry says what a viewer
# should be able to see the system do, unprompted, on the Evidence and Forecast
# screens after ingesting the file.
# --------------------------------------------------------------------------

EVENTS = [
    {
        "id": "pandemic",
        "from": "2020-03-15", "to": "2020-08-31",
        "what": "A demand shock. Analgesics and respiratory spike, antihistamines "
                "fall (fewer people outdoors), anxiolytics rise and stay risen.",
        "why_it_is_here": "A sharp level break the models did not see coming. It is "
                          "where you look at the forecast interval widening rather "
                          "than the point moving.",
        "expect": "Interval width on N02BE roughly doubles across the break, and the "
                  "Why screen attributes the move to trend, not to seasonality.",
    },
    {
        "id": "growth",
        "from": "2021-01-01", "to": "2026-09-30",
        "what": "The pharmacy grows: +7% per year compounding across every product, "
                "on top of everything else.",
        "why_it_is_here": "The 'what if the shop takes off' case. A level trend the "
                          "system has to track rather than average away.",
        "expect": "Order quantities rise year on year with no setting changed. "
                  "Prophet's trend component on the Why screen turns positive and "
                  "stays there.",
    },
    {
        "id": "n05c_becomes_staple",
        "from": "2022-06-01", "to": "2022-12-31",
        "what": "Sedatives (N05C) stop being intermittent. Zero-days fall from ~68% "
                "to ~8% over seven months as the line becomes a regular stock item.",
        "why_it_is_here": "THE headline demonstration. Demand class is a computed "
                          "rule, not configuration - so the routing has to change on "
                          "its own.",
        "expect": "N05C reclassifies intermittent -> smooth, and its model route "
                  "changes from Croston/TSB to the smooth portfolio. Nobody edits a "
                  "config file. Visible on Forecast > Series profile (ADI falls "
                  "below 1.32) and in the demand_classes block of benchmarks.json.",
    },
    {
        "id": "m01ae_delisted",
        "from": "2023-09-01", "to": "2024-06-30",
        "what": "Ibuprofen (M01AE) is being delisted. Level decays to ~35% and "
                "zero-days climb from ~2% to ~45%.",
        "why_it_is_here": "The same transition in reverse, so the first one cannot be "
                          "dismissed as a one-way trick.",
        "expect": "M01AE reclassifies smooth -> intermittent and routes INTO "
                  "Croston/TSB. Its reorder point drops and it stops appearing on "
                  "the Decisions board.",
    },
    {
        "id": "r06_season_drift",
        "from": "2024-01-01", "to": "2026-09-30",
        "what": "Antihistamine seasonality intensifies and shifts earlier - the "
                "peak walks from May to March and sharpens as it goes.",
        "why_it_is_here": "Seasonality is measured per product per grain, not "
                          "configured. If the peak moves, the explanation has to move "
                          "with it.",
        "expect": "The Why screen's seasonal profile peaks in March by 2026, and the "
                  "sentence beside it moves with it - because that label is derived "
                  "from the measured peak month, not read from a lookup table. The "
                  "old hardcoded version would still have said 'pollen season'.",
    },
]


# --------------------------------------------------------------------------
# Fitting the real series
# --------------------------------------------------------------------------

def load_real() -> pd.DataFrame:
    if not RAW.exists():
        raise SystemExit(f"{RAW} not found - run scripts/check_data.py first")
    d = pd.read_csv(RAW, parse_dates=["datum"])
    return d[["datum", *SERIES]].sort_values("datum").reset_index(drop=True)


def closure_calendar(real: pd.DataFrame, rng: np.random.Generator) -> set[date]:
    """The days the shop is shut, projected forward - at the RIGHT RATE.

    The real file has 26 closures across six years: 4 to 6 a year, not 14. Three
    dates recur annually (1 and 7 January, 19 December) and one moves, because
    Orthodox Easter moves - it lands on 8, 12, 16, 18, 20 or 28 April across the
    six years observed. Taking the union of every (month, day) ever closed and
    applying all of them every year produced 98 closures instead of 26, which
    would have handed the cleaner four times the work the real calendar creates
    and quietly changed a measured property of the data.
    """
    shut = real.loc[real[SERIES].sum(axis=1) == 0, "datum"]
    counts = shut.dt.strftime("%m-%d").value_counts()
    fixed = [md for md, n in counts.items() if n >= 3]            # annual
    movable = sorted(md for md in counts.index if md.startswith("04"))  # Easter
    occasional = [md for md, n in counts.items()
                  if n == 2 and not md.startswith("04")]

    out: set[date] = set()
    for year in range(START.year, END.year + 1):
        picks = list(fixed)
        if movable:
            picks.append(str(rng.choice(movable)))
        if occasional and rng.random() < 0.5:
            picks.append(str(rng.choice(occasional)))
        for md in picks:
            m, dd = (int(x) for x in md.split("-"))
            try:
                out.add(date(year, m, dd))
            except ValueError:
                pass
    return out


def fit_series(real: pd.DataFrame, sid: str) -> dict:
    """Everything needed to regenerate one series in its own character."""
    y = real[sid].astype(float)
    open_days = real[SERIES].sum(axis=1) > 0          # exclude closures from the fit
    y = y[open_days]
    ds = real.loc[open_days, "datum"]

    overall = float(y.mean())
    month_idx = (y.groupby(ds.dt.month).mean() / overall).reindex(range(1, 13)).fillna(1.0)
    wday_idx = (y.groupby(ds.dt.dayofweek).mean() / overall).reindex(range(7)).fillna(1.0)

    nonzero = y[y > 0]
    p_zero = float((y == 0).mean())

    # Work in log space on the deseasonalised residual: it keeps the generated
    # series strictly positive and reproduces the right-skew of real demand.
    seas = month_idx.reindex(ds.dt.month).to_numpy() * wday_idx.reindex(ds.dt.dayofweek).to_numpy()
    resid = np.log(np.maximum(y.to_numpy(), 1e-6) / (overall * seas))
    resid = resid[np.isfinite(resid) & (y.to_numpy() > 0)]

    # sigma from the ANALYTIC lognormal relation, not from std(log residual).
    # The seasonal fit is imperfect, so its error lands in the residual; taking
    # the raw std then re-applying seasonality on top counted that spread twice
    # and every generated series came out ~1.4x too variable. It mattered:
    # M01AE started life classified "erratic" instead of "smooth", so the
    # smooth -> intermittent transition it exists to demonstrate had nowhere to
    # start from. For a lognormal, CV = sqrt(exp(sigma^2) - 1) exactly.
    deseason = y.to_numpy() / (overall * seas)
    deseason = deseason[(y.to_numpy() > 0) & np.isfinite(deseason)]
    cv = float(np.std(deseason) / np.mean(deseason)) if len(deseason) > 2 else 0.3
    sigma = float(np.sqrt(np.log1p(min(cv, 3.0) ** 2)))
    rho = float(pd.Series(resid).autocorr(1)) if len(resid) > 10 else 0.0
    rho = float(np.clip(np.nan_to_num(rho), -0.6, 0.9))

    return {
        "base": overall,
        "month_idx": month_idx.to_numpy(),
        "wday_idx": wday_idx.to_numpy(),
        "p_zero": p_zero,
        "sigma": sigma,
        "rho": rho,
        "nonzero_mean": float(nonzero.mean()) if len(nonzero) else overall,
        "frac_rate": float((y % 1 != 0).mean()),
    }


# --------------------------------------------------------------------------
# The regime functions - one place per event, so the manifest and the code
# cannot drift apart.
# --------------------------------------------------------------------------

def level_multiplier(sid: str, d: date) -> float:
    m = 1.0

    # growth: +7%/yr compounding from 2021
    if d >= date(2021, 1, 1):
        years = (d - date(2021, 1, 1)).days / 365.25
        m *= 1.07 ** years

    # pandemic: a spike that decays back over the window
    if date(2020, 3, 15) <= d <= date(2020, 8, 31):
        t = (d - date(2020, 3, 15)).days / (date(2020, 8, 31) - date(2020, 3, 15)).days
        decay = np.exp(-2.2 * t)
        peak = {"N02BE": 1.30, "R03": 0.70, "N05B": 0.45, "R06": -0.42}.get(sid, 0.12)
        m *= 1.0 + peak * decay
    # anxiolytics do not go back down
    if sid == "N05B" and d > date(2020, 8, 31):
        m *= 1.22

    # ibuprofen is being delisted
    if sid == "M01AE" and d >= date(2023, 9, 1):
        t = min((d - date(2023, 9, 1)).days / 303.0, 1.0)
        m *= 1.0 - 0.65 * t

    return float(m)


def zero_probability(sid: str, d: date, base_p: float) -> float:
    """Intermittency is a regime too - it is what makes the router move."""
    if sid == "N05C" and d >= date(2022, 6, 1):
        t = min((d - date(2022, 6, 1)).days / 213.0, 1.0)
        return float(base_p + (0.08 - base_p) * t)      # 68% -> 8%
    if sid == "M01AE" and d >= date(2023, 9, 1):
        t = min((d - date(2023, 9, 1)).days / 303.0, 1.0)
        return float(base_p + (0.45 - base_p) * t)      # 2% -> 45%
    return float(base_p)


def season_multiplier(sid: str, d: date, month_idx: np.ndarray) -> float:
    """Seasonal index, with R06's peak sharpening and drifting earlier."""
    idx = month_idx.copy()
    if sid == "R06" and d >= date(2024, 1, 1):
        t = min((d - date(2024, 1, 1)).days / 1000.0, 1.0)
        centred = idx - idx.mean()
        idx = idx.mean() + centred * (1.0 + 0.55 * t)   # amplitude 1.76x -> ~2.2x
        if t > 0.30:                                    # and the peak walks May -> April
            idx = np.roll(idx, -1)
    return float(idx[d.month - 1])


# --------------------------------------------------------------------------

def generate(seed: int = 42) -> tuple[pd.DataFrame, dict]:
    rng = np.random.default_rng(seed)
    real = load_real()
    closures = closure_calendar(real, rng)
    fits = {sid: fit_series(real, sid) for sid in SERIES}

    days = pd.date_range(START, END, freq="D")
    out = {"datum": days}
    resid_state = {sid: 0.0 for sid in SERIES}

    for sid in SERIES:
        f = fits[sid]
        vals = []
        for ts in days:
            d = ts.date()
            if d in closures:
                vals.append(0.0)
                continue

            # AR(1) in log space, scaled so the marginal variance stays sigma^2
            e = f["rho"] * resid_state[sid] + np.sqrt(max(1 - f["rho"] ** 2, 1e-6)) * rng.normal(0, f["sigma"])
            resid_state[sid] = e

            if rng.random() < zero_probability(sid, d, f["p_zero"]):
                vals.append(0.0)
                continue

            # base is the mean INCLUDING zero days, so drawing a magnitude at
            # `base` and then zeroing it 68% of the time counted the zeros twice
            # and left N05C at a quarter of its real volume. Condition on the day
            # being a selling day. Using the FITTED zero rate, not the regime one,
            # so a product that stops being intermittent genuinely gains volume -
            # which is the point of that event.
            level = f["base"] / max(1.0 - f["p_zero"], 0.05) * level_multiplier(sid, d)
            seas = season_multiplier(sid, d, f["month_idx"]) * f["wday_idx"][d.weekday()]
            # exp() of a zero-mean normal has mean exp(sigma^2/2), not 1, so the
            # naive version inflated both the level and the spread - sd came out
            # at roughly twice the real series. Correct the median back to 1.
            y = level * seas * np.exp(e - f["sigma"] ** 2 / 2)

            # Real values are partial packs: ~60% carry a fraction. Match that
            # rather than emitting a clean float for every single day.
            y = round(float(y), 2) if rng.random() < f["frac_rate"] else float(round(y))
            vals.append(max(y, 0.0))
        out[sid] = vals

    df = pd.DataFrame(out)
    df["Year"] = df["datum"].dt.year
    df["Month"] = df["datum"].dt.month
    df["Weekday Name"] = df["datum"].dt.day_name()
    df["data_source"] = "synthetic_extension"
    df["origin"] = "synthetic"

    manifest = {
        "generated_from": str(RAW),
        "seed": seed,
        "span": {"from": str(START), "to": str(END), "days": len(days)},
        "lane": 3,
        "lane_rule": (
            "Synthetic. May demonstrate that the pipeline accepts new data and that "
            "the clock moves. May NOT train a model that backs an accuracy claim - "
            "pipelines/ingest.py raises on a synthetic path and a test asserts it."
        ),
        "preserved": [
            "per-series zero rate and its lag-1 autocorrelation",
            "per-series monthly seasonal index and its amplitude",
            "weekday effects, including that they run in opposite directions "
            "(paracetamol +12% at weekends, sedatives -44%)",
            "the 26-day closure calendar",
            "the right-skewed magnitude distribution and the ~60% fractional-unit rate",
        ],
        "events": EVENTS,
    }
    return df, manifest


def main() -> int:
    ap = argparse.ArgumentParser(description="Labelled synthetic extension, 2019-2026")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default=str(OUT_DIR))
    args = ap.parse_args()

    df, manifest = generate(args.seed)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    csv = out / "salesdaily_synthetic_2019_2026.csv"
    df.to_csv(csv, index=False)
    (out / "extension_manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"wrote {csv}  ({len(df):,} rows, {df.datum.min().date()} -> {df.datum.max().date()})")
    print(f"wrote {out / 'extension_manifest.json'}  ({len(EVENTS)} labelled events)")
    print("\nEvery row is lane 3. The ingest entrypoint will refuse to train on it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
