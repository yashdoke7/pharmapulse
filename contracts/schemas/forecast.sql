-- CONTRACT C2 - produced by Pod B, consumed by Pod C.
-- Physical form: Parquet at data/warehouse/forecast/version=<slug>/*.parquet
-- Live version named in the pointer file data/warehouse/forecast/CURRENT
-- Publication is a pointer swap: write the directory first, rewrite CURRENT last.
-- Changing this file requires a CONTRACTS.md change-log entry.

CREATE TABLE forecast (
  series_id      TEXT    NOT NULL,
  grain          TEXT    NOT NULL,   -- 'day' | 'week' | 'month'
  cutoff         DATE    NOT NULL,   -- last observation used
  ds             DATE    NOT NULL,   -- period being forecast
  horizon        INT     NOT NULL,   -- steps ahead, 1-indexed
  quantile       DOUBLE  NOT NULL,   -- one of the 21 stored levels
  value          DOUBLE  NOT NULL,   -- >= 0, monotone non-decreasing in quantile
  model_version  TEXT    NOT NULL,
  snapshot_id    TEXT    NOT NULL,
  calibrated     BOOLEAN NOT NULL,   -- false only on the cold path
  PRIMARY KEY (series_id, grain, cutoff, ds, quantile)
);

-- Per-member forecasts, kept for the model-comparison overlay on screen 2.
-- Optional: may be empty until Day 3.
CREATE TABLE forecast_members (
  series_id      TEXT   NOT NULL,
  grain          TEXT   NOT NULL,
  cutoff         DATE   NOT NULL,
  ds             DATE   NOT NULL,
  model          TEXT   NOT NULL,   -- 'Prophet' | 'AutoARIMA' | 'MSTL' | 'SeasonalNaive' | 'LightGBM' | 'CrostonTSB'
  p50            DOUBLE NOT NULL,
  PRIMARY KEY (series_id, grain, cutoff, ds, model)
);

-- Demand classification, recomputed nightly. Drives routing and the UI chip.
CREATE TABLE demand_class (
  series_id      TEXT   NOT NULL,
  grain          TEXT   NOT NULL,
  adi            DOUBLE NOT NULL,
  cv2            DOUBLE NOT NULL,
  demand_class   TEXT   NOT NULL,   -- 'smooth' | 'intermittent' | 'erratic' | 'lumpy'
  computed_at    TIMESTAMP NOT NULL,
  PRIMARY KEY (series_id, grain)
);
