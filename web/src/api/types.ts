// Shapes mirror CONTRACTS.md section C3. Regenerate types from
// contracts/openapi.json if the API changes shape.

export interface Meta {
  origin: string;
  model_version: string;
  snapshot_id: string;
  generated_at: string | null;
  stale: boolean;
  degraded: string | null;
  correlation_id: string;
}

export interface Envelope<T> {
  data: T;
  meta: Meta;
}

export type DemandClass = "smooth" | "intermittent" | "erratic" | "lumpy";
export type Status = "ok" | "watch" | "order_now" | "overstocked";
export type Grain = "day" | "week" | "month";

export interface Series {
  series_id: string;
  name: string;
  short_name: string;
  demand_class: DemandClass;
  adi: number | null;
  cv2: number | null;
  daily_mean: number;
  zero_day_pct: number | null;
  peak_month: string;
  unit: string;
}

export interface HistoryPoint {
  ds: string;
  y: number;
  is_closed?: boolean;
  is_outlier?: boolean;
  completeness: number;
}

export interface ForecastPoint {
  ds: string;
  h: number;
  q: Record<string, number>;
}

export interface Member {
  model: string;
  p50: number[];
}

export interface ForecastResponse {
  series_id: string;
  grain: Grain;
  cutoff: string | null;
  horizon: number;
  calibrated: boolean;
  max_horizon: number;
  points: ForecastPoint[];
  history: HistoryPoint[];
  members: Member[];
}

export interface CostPoint {
  service_level: number;
  order_quantity: number;
  expected_cost: number;
  p_stockout: number;
}

export interface LaneInput {
  name: string;
  value: string;
  lane: "observed" | "user_setting" | "synthetic";
}

export interface Recommendation {
  series_id: string;
  status: Status;
  q_star: number;
  service_level_used: number;
  lead_time_demand: Record<string, number>;
  target_level: number;
  stock_on_hand: number;
  order_units: number;
  order_packs: number;
  order_quantity: number;
  reorder_point: number;
  days_of_cover: number;
  p_stockout: number;
  expected_cost: {
    at_order: number;
    minus_one_pack: number;
    plus_one_pack: number;
  };
  cost_curve: CostPoint[];
  min_cost_service_level: number | null;
  inputs_used: LaneInput[];
  projected_stockout_date?: string | null;
}

export interface RiskItem {
  series_id: string;
  type: "stockout" | "overstock" | "expiry" | "anomaly";
  severity: "high" | "medium" | "low";
  probability: number;
  exposure: number;
  headline: string;
  detail: string;
  recommended_action: string;
  recommended_quantity: number;
}

export interface RiskResponse {
  total_exposure: number;
  currency: string;
  items: RiskItem[];
}

export interface Position {
  series_id: string;
  name: string;
  stock_on_hand: number;
  days_of_cover: number;
  status: Status;
  order_quantity: number;
  p_stockout: number;
  reorder_point: number;
  projected_stockout_date: string | null;
  daily_mean: number;
}

export interface CoveragePoint {
  nominal: number;
  achieved: number;
}

export interface ExplainResponse {
  series_id: string;
  headline: string;
  total_change_units: number;
  baseline_units: number;
  method: string;
  components: { name: string; units: number; detail: string }[];
  decomposition: {
    ds: string[];
    trend: number[];
    yearly: number[];
    holidays: number[];
  };
  calibration: {
    before: CoveragePoint[];
    after: CoveragePoint[];
    n_points: number | null;
    conformal_scale: number | null;
    nominal: number;
    achieved_before: number | null;
    achieved_after: number | null;
  };
}

export interface LeaderboardRow {
  model: string;
  mase: number;
  is_benchmark?: boolean;
  is_shipped?: boolean;
  is_bound?: boolean;
}

export interface PerSeriesRow {
  series_id: string;
  seasonal_naive: number;
  ensemble: number;
  best_model: string;
  best_mase: number;
  ensemble_wins: boolean;
}

export interface Benchmarks {
  generated_at: string;
  snapshot_id: string;
  protocol: Record<string, unknown>;
  ensemble_members: string[];
  leaderboard: LeaderboardRow[];
  per_series: PerSeriesRow[];
  ablations: {
    selection_vs_combination: {
      selection: number;
      combination: number;
      oracle: number;
      verdict: string;
    };
  };
  calibration: {
    nominal: number;
    achieved_before: number;
    achieved_after: number;
    conformal_scale: number;
    n_points: number;
  };
  runtime: Record<string, unknown>;
}

export interface MetricsResponse {
  benchmarks: Benchmarks;
  runtime: Record<string, unknown>;
}

export interface Settings {
  lead_time_days: number;
  holding_cost_rate: number;
  expiry_risk_rate: number;
  review_period_days: number;
  currency: string;
  service_level_default: number;
  per_series: Record<
    string,
    { pack_size: number; unit_cost: number; unit_margin: number; stock_on_hand: number }
  >;
}

export interface ReplayPosition {
  series_id: string;
  stock_on_hand: number;
  days_of_cover: number;
  status: Status;
  incoming: number;
  units_short: number;
}

export interface ReplayEvent {
  type: "order" | "delivery" | "stockout";
  series_id: string;
  date: string;
  message: string;
}

export interface Scorecard {
  units_short: number;
  units_ordered: number;
  holding_cost: number;
  shortage_cost: number;
  total_cost: number;
  stockout_days: number;
  orders_placed: number;
}

export interface ReplaySnapshot {
  session_id: string;
  policy: string;
  current_date: string | null;
  day_index: number;
  total_days: number;
  finished: boolean;
  window: { from: string; to: string };
  positions: ReplayPosition[];
  events: ReplayEvent[];
  scorecard: Scorecard;
}

export interface BusinessCase {
  window: { from: string; to: string };
  pharmapulse: Scorecard;
  minmax: Scorecard;
  saving: number;
  saving_pct: number;
  verdict: string;
  method: string;
}

export interface StockMovement {
  ds: string;
  kind: "opening" | "received" | "sold" | "wastage" | "adjustment";
  quantity: number;
}

export interface StockLedger {
  series_id: string;
  opening_stock: number;
  movements: StockMovement[];
  stock_on_hand: number;
}
