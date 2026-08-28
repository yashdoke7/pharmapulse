"""Serbian Orthodox holiday calendar.

The pharmacy's country is inferred, not stated. 21 of the 26 all-zero days in the
data map to the Serbian Orthodox calendar: 7 January every year, all six Orthodox
Easter Sundays, 19 December (St. Nicholas / Nikoljdan), New Year and 1 May.

That inference is strong but it IS an inference, so it is used only for calendar
features derived from dates - never to join external data such as weather, which
would stack an assumption on an inference. See architecture section 11.6.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

CALENDAR_CSV = Path("data/observed/holidays.csv")

# Orthodox (Julian-reckoned) Easter Sunday. Verified against the closure days in
# the data: all six 2014-2019 dates are exact all-zero days.
ORTHODOX_EASTER = {
    2013: "2013-05-05",
    2014: "2014-04-20",
    2015: "2015-04-12",
    2016: "2016-05-01",
    2017: "2017-04-16",
    2018: "2018-04-08",
    2019: "2019-04-28",
    2020: "2020-04-19",
    2021: "2021-05-02",
}

FIXED = [
    ("01-01", "New Year"),
    ("01-02", "New Year Holiday"),
    ("01-07", "Orthodox Christmas"),
    ("02-15", "Statehood Day"),
    ("02-16", "Statehood Day Holiday"),
    ("05-01", "Labour Day"),
    ("05-02", "Labour Day Holiday"),
    ("11-11", "Armistice Day"),
    ("12-19", "St. Nicholas (Nikoljdan)"),
    ("12-25", "Christmas (Gregorian)"),
]


def build_calendar(start_year: int = 2013, end_year: int = 2021) -> pd.DataFrame:
    """Generate the holiday table. One row per (ds, holiday name)."""
    rows: list[dict] = []

    for year in range(start_year, end_year + 1):
        for md, name in FIXED:
            rows.append({"ds": f"{year}-{md}", "holiday": name})

        easter = ORTHODOX_EASTER.get(year)
        if easter:
            e = pd.Timestamp(easter)
            # Good Friday through Easter Monday - the closure window observed
            # in the data is the Sunday itself, but the surrounding days move
            # demand, which is why Prophet gets an asymmetric window.
            rows.append({"ds": str((e - pd.Timedelta(days=2)).date()),
                         "holiday": "Orthodox Good Friday"})
            rows.append({"ds": str(e.date()), "holiday": "Orthodox Easter"})
            rows.append({"ds": str((e + pd.Timedelta(days=1)).date()),
                         "holiday": "Orthodox Easter Monday"})

    df = pd.DataFrame(rows)
    df["ds"] = pd.to_datetime(df["ds"])
    return df.sort_values("ds").drop_duplicates(subset=["ds", "holiday"]).reset_index(drop=True)


def write_calendar(path: str | Path = CALENDAR_CSV) -> Path:
    """Write the versioned calendar CSV. Committed to git so it is reproducible."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    df = build_calendar()
    df.assign(ds=df["ds"].dt.strftime("%Y-%m-%d")).to_csv(path, index=False)
    return path


def load_calendar(path: str | Path = CALENDAR_CSV) -> pd.DataFrame:
    """Load the committed calendar, generating it if absent."""
    path = Path(path)
    if not path.exists():
        write_calendar(path)
    df = pd.read_csv(path)
    df["ds"] = pd.to_datetime(df["ds"])
    return df


def holiday_flags(dates: pd.Series, calendar: pd.DataFrame | None = None) -> pd.DataFrame:
    """Per-date is_holiday and days_to_holiday (signed, nearest holiday)."""
    cal = load_calendar() if calendar is None else calendar
    holiday_days = pd.DatetimeIndex(sorted(cal["ds"].unique()))

    ds = pd.DatetimeIndex(pd.to_datetime(dates))
    is_holiday = ds.isin(holiday_days)

    if len(holiday_days) == 0:
        days_to = pd.Series(999, index=range(len(ds)))
    else:
        target = holiday_days.values.astype("datetime64[D]").astype("int64")
        source = ds.values.astype("datetime64[D]").astype("int64")
        # signed distance to the nearest holiday: negative = holiday is ahead
        diffs = source[:, None] - target[None, :]
        nearest = diffs[range(len(source)), abs(diffs).argmin(axis=1)]
        days_to = pd.Series(nearest).clip(-60, 60)

    return pd.DataFrame({
        "ds": ds,
        "is_holiday": is_holiday,
        "days_to_holiday": days_to.to_numpy(),
    })


if __name__ == "__main__":
    p = write_calendar()
    cal = load_calendar(p)
    print(f"wrote {p} - {len(cal)} holiday rows, {cal.ds.dt.year.min()}-{cal.ds.dt.year.max()}")
