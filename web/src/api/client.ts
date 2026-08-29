// Every request goes through here.
//
// The backend itself has a fixture mode (PHARMAPULSE_FIXTURES=1) that serves
// contracts/fixtures/*.json with the identical shape, so the frontend needs no
// separate mock layer - it just talks to the API and the API decides how
// degraded it is. meta.degraded tells us, and the UI renders a badge.

import type {
  BusinessCase,
  Envelope,
  ExplainResponse,
  ForecastResponse,
  Grain,
  MetricsResponse,
  Position,
  Recommendation,
  RiskResponse,
  Series,
  ReplaySnapshot,
  Settings,
} from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!response.ok) {
    let code = "UPSTREAM_DEGRADED";
    let message = response.statusText;
    try {
      const body = await response.json();
      const err = body?.detail?.error ?? body?.error;
      if (err) {
        code = err.code ?? code;
        message = err.message ?? message;
      }
    } catch {
      /* keep the status text */
    }
    throw new ApiError(response.status, code, message);
  }
  return response.json();
}

export const api = {
  health: () => request<Record<string, unknown>>("/health"),

  series: () => request<{ series: Series[] }>("/series"),

  history: (seriesId: string, grain: Grain = "week", limit = 120) =>
    request<{ series_id: string; grain: Grain; points: any[] }>(
      `/history?series_id=${seriesId}&grain=${grain}&limit=${limit}`,
    ),

  forecast: (seriesId: string, grain: Grain = "week", horizon = 8) =>
    request<ForecastResponse>(
      `/forecast?series_id=${seriesId}&grain=${grain}&horizon=${horizon}`,
    ),

  positions: () => request<{ positions: Position[] }>("/positions"),

  risk: (limit = 20) => request<RiskResponse>(`/risk?limit=${limit}`),

  explain: (seriesId: string, grain: Grain = "month", horizon = 1) =>
    request<ExplainResponse>(
      `/explain?series_id=${seriesId}&grain=${grain}&horizon=${horizon}`,
    ),

  metrics: () => request<MetricsResponse>("/metrics"),

  settings: () => request<Settings>("/settings"),

  saveSettings: (patch: Partial<Settings>) =>
    request<Settings>("/settings", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  recommend: (body: Record<string, unknown>) =>
    request<Recommendation>("/recommend", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  replayStart: (from: string, to: string) =>
    request<ReplaySnapshot>("/replay/start", {
      method: "POST",
      body: JSON.stringify({ from, to }),
    }),

  replayTick: (sessionId: string, steps = 1) =>
    request<ReplaySnapshot>("/replay/tick", {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId, steps }),
    }),

  businessCase: (start: string, end: string) =>
    request<BusinessCase>(
      `/replay/business-case?start_date=${start}&end_date=${end}`,
    ),

  commitOrder: (body: Record<string, unknown>) =>
    request<{ logged: boolean; hash: string; chain_valid: boolean }>("/orders", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
