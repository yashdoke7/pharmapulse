-- CONTRACT C1 - produced by Pod A, consumed by Pod B.
-- Physical form: Parquet at data/warehouse/gold/grain=<g>/year=<yyyy>/*.parquet
-- Query with: SELECT * FROM 'data/warehouse/gold/**/*.parquet'
-- Changing this file requires a CONTRACTS.md change-log entry.

CREATE TABLE gold_demand (
  series_id     TEXT     NOT NULL,   -- ATC-2 code: M01AB M01AE N02BA N02BE N05B N05C R03 R06
  ds            DATE     NOT NULL,   -- period start, store-local calendar
  grain         TEXT     NOT NULL,   -- 'day' | 'week' | 'month'
  y             DOUBLE,              -- units dispensed (fractional values are real, keep them)
  origin        TEXT     NOT NULL,   -- 'observed' | 'user_setting' | 'synthetic'
  is_closed     BOOLEAN  NOT NULL,   -- pharmacy shut: mask from the training loss, do not impute
  is_outlier    BOOLEAN  NOT NULL,   -- flagged, NEVER removed or winsorised
  completeness  DOUBLE   NOT NULL,   -- 1.0 = full period, <1.0 = partial (render hatched)
  snapshot_id   TEXT     NOT NULL,   -- sha256 prefix of the source CSV
  PRIMARY KEY (series_id, ds, grain)
);

-- Feature table, same root, data/warehouse/features/
CREATE TABLE features (
  series_id        TEXT NOT NULL,
  ds               DATE NOT NULL,
  grain            TEXT NOT NULL,
  cutoff           DATE NOT NULL,   -- the as-of date these features were computed for
  lag_1            DOUBLE, lag_2 DOUBLE, lag_3 DOUBLE, lag_4 DOUBLE,
  lag_8            DOUBLE, lag_52 DOUBLE,
  roll_mean_4      DOUBLE, roll_std_4 DOUBLE,
  roll_mean_13     DOUBLE, roll_std_13 DOUBLE,
  roll_mean_52     DOUBLE, roll_std_52 DOUBLE,
  expanding_mean   DOUBLE,
  woy              INT, month INT, quarter INT, dow INT,
  fourier_sin_1    DOUBLE, fourier_cos_1 DOUBLE,
  fourier_sin_2    DOUBLE, fourier_cos_2 DOUBLE,
  fourier_sin_3    DOUBLE, fourier_cos_3 DOUBLE,
  is_holiday       BOOLEAN, days_to_holiday INT,
  is_closed        BOOLEAN, is_outlier BOOLEAN,
  PRIMARY KEY (series_id, ds, grain, cutoff)
);
