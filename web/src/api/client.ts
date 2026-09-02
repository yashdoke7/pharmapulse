// Every request goes through here.
//
// The backend itself has a fixture mode (PHARMAPULSE_FIXTURES=1) that serves
// contracts/fixtures/*.json with the identical shape, so the frontend needs no
// separate mock layer - it just talks to the API and the API decides how
// degraded it is. meta.degraded tells us, and the UI renders a badge.

import type {
  BuildJob,
  DatasetsResponse,
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
  StockLedger,
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

  // --- datasets: which one is live, rebuild it at any date, upload another
  datasets: () => request<DatasetsResponse>("/datasets"),

  rebuild: (body: { as_of?: string | null; source?: string | null; origin?: string }) =>
    request<BuildJob>("/datasets/rebuild", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  job: (id: string) => request<BuildJob>(`/datasets/jobs/${id}`),

  activateVersion: (slug: string) =>
    request<{ activated: string; clock: string | null; model_version: string }>(
      "/datasets/activate",
      { method: "POST", body: JSON.stringify({ slug }) },
    ),

  /** Multipart, so it cannot go through request() - that sets a JSON
   *  Content-Type, and setting it by hand on a FormData body strips the
   *  boundary the server needs to parse it. */
  uploadDataset: async (file: File, origin: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("origin", origin);
    const res = await fetch(`${BASE}/datasets/upload`, { method: "POST", body: form });
    const body = await res.json();
    if (!res.ok) {
      const err = body?.detail?.error ?? body?.error;
      throw new ApiError(res.status, err?.code ?? "UPLOAD_FAILED",
                         err?.message ?? res.statusText);
    }
    return body as Envelope<{ stored: string; size_kb: number; origin: string }>;
  },

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

  ledger: (seriesId: string) =>
    request<StockLedger>(`/ledger?series_id=${seriesId}`),

  commitOrder: (body: Record<string, unknown>) =>
    request<{
      logged: boolean;
      hash: string;
      chain_valid: boolean;
      stock_on_hand: number;
      received: number;
    }>("/orders", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
