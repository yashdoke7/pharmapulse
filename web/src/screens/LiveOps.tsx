import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { ReplaySnapshot } from "../api/types";
import {
  ErrorCard,
  Loading,
  SectionTitle,
  StatusChip,
  inr,
  units,
} from "../components/ui";

/**
 * Replay mode.
 *
 * A chosen window of the ACTUAL daily history, stepped one day at a time.
 * Redesigned into a clinical simulation control deck.
 */

const SPEEDS = [
  { label: "1 day / 1.5s", ms: 1500 },
  { label: "1 day / 0.7s", ms: 700 },
  { label: "fast", ms: 250 },
];

const WINDOWS = [
  { from: "2019-01-01", to: "2019-03-31", label: "Jan–Mar 2019", note: "the flu wave" },
  { from: "2019-04-01", to: "2019-06-30", label: "Apr–Jun 2019", note: "pollen season" },
  { from: "2018-10-01", to: "2018-12-31", label: "Oct–Dec 2018", note: "winter build-up" },
];

export function LiveOps() {
  const [window_, setWindow] = useState(WINDOWS[0]);
  const [snap, setSnap] = useState<ReplaySnapshot | null>(null);
  const [running, setRunning] = useState(false);
  const [feed, setFeed] = useState<{ type: string; series_id: string; date: string; message: string }[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [speed, setSpeed] = useState(SPEEDS[0]);
  const timer = useRef<number | null>(null);

  const businessCase = useQuery({
    queryKey: ["business-case", window_.from, window_.to],
    queryFn: () => api.businessCase(window_.from, window_.to),
  });

  const stop = useCallback(() => {
    setRunning(false);
    if (timer.current) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    stop();
    setFeed([]);
    setError(null);
    try {
      const r = await api.replayStart(window_.from, window_.to);
      setSnap(r.data);
      setRunning(true);
    } catch (e) {
      setError(e);
    }
  }, [window_, stop]);

  useEffect(() => {
    if (!running || !snap?.session_id) return;
    timer.current = window.setInterval(async () => {
      try {
        const r = await api.replayTick(snap.session_id, 1);
        setSnap(r.data);
        if (r.data.events.length) {
          setFeed((f) => [...r.data.events, ...f].slice(0, 40));
        }
        if (r.data.finished) stop();
      } catch (e) {
        setError(e);
        stop();
      }
    }, speed.ms);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [running, snap?.session_id, stop, speed.ms]);

  useEffect(() => () => stop(), [stop]);

  const progress = snap ? (snap.day_index / snap.total_days) * 100 : 0;
  const bc = businessCase.data?.data;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Replay"
        subtitle="The real 2019 history, replayed one day per tick. Nothing is simulated except the shelf."
        right={
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-2xl border border-slate-200/70">
            {WINDOWS.map((w) => (
              <button
                key={w.from}
                onClick={() => {
                  stop();
                  setSnap(null);
                  setWindow(w);
                }}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all duration-200 ${
                  w.from === window_.from
                    ? "bg-white text-medical-teal-deep shadow-xs"
                    : "text-slate-500 hover:text-ink"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        }
      />

      {error ? <ErrorCard error={error} /> : null}

      {/* Simulation Controller Card */}
      <div className="panel pad relative overflow-hidden">
        <div className="pointer-events-none absolute right-5 top-4 select-none font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-medical-teal/30">
          Simulation Deck · {window_.label}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="eyebrow text-slate-500">Simulated Date</div>
            <div className="figure text-[32px] sm:text-[38px] font-extrabold text-ink leading-none mt-1.5 tabular-nums">
              {snap?.current_date ?? "—"}
            </div>
            <div className="fine mt-1.5 text-xs font-medium text-slate-500">
              {snap
                ? `day ${snap.day_index} of ${snap.total_days} · ${window_.note}`
                : `${window_.label} · ${window_.note}`}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {!running ? (
              <button className="btn-primary shadow-sm hover:shadow-glow" onClick={start}>
                <span className="h-2 w-2 rounded-full bg-white" />
                {snap && !snap.finished ? "Resume" : "Start replay"}
              </button>
            ) : (
              <button className="btn-ghost border-amber-300 text-amber-700 bg-amber-50" onClick={stop}>
                Pause
              </button>
            )}

            {/* Speed toggle */}
            <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-0.5">
              {SPEEDS.map((sp) => (
                <button
                  key={sp.label}
                  onClick={() => setSpeed(sp)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                    sp.ms === speed.ms
                      ? "bg-white text-medical-teal-deep shadow-xs"
                      : "text-slate-500 hover:text-ink"
                  }`}
                >
                  {sp.label}
                </button>
              ))}
            </div>

            {snap ? (
              <button
                className="btn-ghost"
                onClick={async () => {
                  const wasRunning = running;
                  stop();
                  const r = await api.replayTick(snap.session_id, 1);
                  setSnap(r.data);
                  if (r.data.events.length) {
                    setFeed((f) => [...r.data.events, ...f].slice(0, 40));
                  }
                  if (wasRunning && !r.data.finished) setRunning(true);
                }}
                disabled={snap.finished}
              >
                Step 1 day
              </button>
            ) : null}

            {snap ? (
              <button
                className="btn-ghost"
                onClick={async () => {
                  const wasRunning = running;
                  stop();
                  const r = await api.replayTick(snap.session_id, 7);
                  setSnap(r.data);
                  if (r.data.events.length) {
                    setFeed((f) => [...r.data.events, ...f].slice(0, 40));
                  }
                  if (wasRunning && !r.data.finished) setRunning(true);
                }}
                disabled={snap.finished}
              >
                Skip a week
              </button>
            ) : null}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-5 h-2 w-full rounded-full overflow-hidden bg-slate-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-medical-teal to-medical-blue transition-[width] duration-300 shadow-xs"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Mini scorecard tiles */}
        {snap ? (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini label="Orders placed" value={String(snap.scorecard.orders_placed)} />
            <Mini
              label="Units short"
              value={units(snap.scorecard.units_short)}
              tone={snap.scorecard.units_short > 0 ? "rose" : "mint"}
            />
            <Mini label="Holding cost" value={inr(snap.scorecard.holding_cost)} />
            <Mini
              label="Total cost"
              value={inr(snap.scorecard.total_cost)}
              tone="mint"
            />
          </div>
        ) : null}
      </div>

      {snap ? (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Live Shelf table */}
          <div className="panel overflow-hidden lg:col-span-2">
            <div className="border-b border-slate-100 px-5 sm:px-6 py-3.5 bg-slate-50/50">
              <div className="eyebrow text-slate-600">Shelf, right now</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/30 text-left">
                    {["Product", "On hand", "Incoming", "Cover", "Lost", "Status"].map((h) => (
                      <th key={h} className="px-4 py-2.5 font-semibold text-xs text-slate-500">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100/70">
                  {snap.positions.map((p) => (
                    <tr key={p.series_id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs font-bold text-slate-700">{p.series_id}</td>
                      <td className="px-4 py-2.5 font-mono text-xs font-semibold text-ink">
                        {units(p.stock_on_hand)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-400">
                        {p.incoming > 0 ? (
                          <span className="text-blue-600 font-bold">+{units(p.incoming)}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className={`px-4 py-2.5 font-mono text-xs ${
                          p.days_of_cover < 5 ? "text-rose-600 font-bold" : "text-slate-600"
                        }`}
                      >
                        {p.days_of_cover > 900 ? "—" : `${p.days_of_cover.toFixed(1)} d`}
                      </td>
                      <td
                        className={`px-4 py-2.5 font-mono text-xs ${
                          p.units_short > 0 ? "text-rose-600 font-bold" : "text-slate-300"
                        }`}
                      >
                        {p.units_short > 0 ? units(p.units_short) : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusChip status={p.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Live event feed */}
          <div className="panel pad">
            <div className="eyebrow text-slate-500">Event feed</div>
            <div className="mt-3.5 max-h-[340px] space-y-2 overflow-y-auto pr-1">
              {feed.length === 0 ? (
                <p className="fine text-slate-400">Nothing yet. Press start.</p>
              ) : (
                feed.map((e, i) => (
                  <div key={i} className="flex gap-2.5 text-xs rounded-xl bg-slate-50/60 p-2.5 border border-slate-100">
                    <span
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                        e.type === "stockout"
                          ? "bg-rose-500 animate-pulse"
                          : e.type === "delivery"
                            ? "bg-blue-500"
                            : "bg-emerald-500"
                      }`}
                    />
                    <div>
                      <span className="font-mono text-[10.5px] text-slate-400">{e.date}</span>{" "}
                      <span className="font-mono text-[11px] font-bold text-slate-700">{e.series_id}</span>
                      <div className="text-slate-600 mt-0.5">{e.message}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Business Case Comparison */}
      <div>
        <SectionTitle
          title="What it was worth"
          subtitle="Our policy against a min/max policy, replayed over the identical real days."
        />
        {businessCase.isLoading ? (
          <Loading label="Simulating policies across history" />
        ) : businessCase.isError ? (
          <ErrorCard error={businessCase.error} />
        ) : bc ? (
          <div className="panel pad border border-emerald-200/80 bg-gradient-to-b from-white to-emerald-50/20">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Policy label="PharmaPulse" s={bc.pharmapulse} best />
              {(bc.ladder ?? []).map((row) => (
                <Policy
                  key={row.policy}
                  label={POLICY_NAMES[row.policy] ?? row.policy}
                  s={bc.policies?.[row.policy] ?? bc.minmax}
                  worse={row.we_win}
                  delta={row}
                />
              ))}
            </div>
            <p className="fine mt-4 text-xs text-slate-400">{bc.method}</p>

            {/* Explanatory terms */}
            <div className="mt-5 border-t border-slate-100 pt-4">
              <div className="eyebrow text-slate-500">Reading this comparison</div>
              <dl className="mt-3.5 grid gap-x-8 gap-y-4 text-xs sm:grid-cols-2">
                {[
                  [
                    "Min/max on the mean — the floor",
                    "Hold a minimum, top back up to a maximum, both set from AVERAGE demand. Blind to how much that demand varies. This is the “no system at all” case, and beating it alone would be a soft result.",
                  ],
                  [
                    "(s, S) safety stock — what an ERP does",
                    "Order up to μ·L + z·σ·√L. Real inventory software implements this, so it is the baseline that actually matters. We run roughly level with it, and we say so rather than leaving it out.",
                  ],
                  [
                    "Our forecast, sized the textbook way",
                    "The rung that carries the claim. It gets OUR forecast, OUR service level, and differs in exactly one thing: it sizes with a normal approximation instead of reading the quantile off the calibrated distribution. Forecast quality is held constant, so the gap is the distribution and nothing else.",
                  ],
                  [
                    "PharmaPulse",
                    "Same shelf, same days, same costs, same information. We size against the quantile the cost ratio implies. Being wrong is asymmetric, so the target should not sit at the middle.",
                  ],
                  [
                    "Lost margin",
                    "Demand arrived and there was nothing to sell. Charged at the unit margin — the profit that walked out of the door. This is the number that dominates.",
                  ],
                  [
                    "Holding",
                    "Stock that sat on the shelf overnight, charged at the annual holding rate plus expiry risk. Ours is HIGHER than min/max, deliberately.",
                  ],
                  [
                    "Units unsupplied",
                    "Total units of real demand that could not be met over the window. The physical version of lost margin.",
                  ],
                  [
                    "Why the saving is credible",
                    "It does not come from holding less stock — we hold more. It comes entirely from running out less often, and a test asserts that relationship so the claim cannot drift.",
                  ],
                  [
                    "What this does NOT yet measure",
                    "Every policy sizes off a trailing window of real sales, so the comparison isolates the decision rule. That means none of them can anticipate a seasonal turn — on 1 January the last 180 days are autumn. Anticipating it is what the forecast layer is for, and exercising it here needs a forecast produced at each review point rather than one vintage.",
                  ],
                ].map(([term, body]) => (
                  <div key={term} className="rounded-xl bg-slate-50/60 p-3 border border-slate-100">
                    <dt className="font-bold text-ink">{term}</dt>
                    <dd className="mt-1 text-slate-500 leading-relaxed">{body}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const POLICY_NAMES: Record<string, string> = {
  normal_approx: "Our forecast, sized the textbook way",
  safety_stock: "(s, S) safety stock — what an ERP does",
  minmax: "Min/max on the mean — no system",
};

function Policy({
  label,
  s,
  best,
  worse,
  delta,
}: {
  label: string;
  s: { total_cost: number; holding_cost: number; shortage_cost: number; units_short: number };
  best?: boolean;
  worse?: boolean;
  delta?: { we_win: boolean; saving_pct: number };
}) {
  return (
    <div
      className={`rounded-2xl border p-4 transition-all ${
        best
          ? "border-emerald-300 bg-emerald-50/50 shadow-xs"
          : worse
            ? "border-slate-200/90 bg-white"
            : "border-slate-200/90 bg-white"
      }`}
    >
      <div className="eyebrow min-h-[2.2em] text-[10px] text-slate-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-extrabold font-mono tabular-nums ${
          best ? "text-emerald-700" : "text-ink"
        }`}
      >
        {inr(s.total_cost)}
      </div>
      {delta ? (
        <div
          className={`mt-1.5 inline-block px-2 py-0.5 rounded-full font-mono text-[10.5px] font-semibold ${
            delta.we_win
              ? "bg-emerald-100/90 text-emerald-800"
              : "bg-amber-100/90 text-amber-800"
          }`}
        >
          {delta.we_win
            ? `we are ${delta.saving_pct.toFixed(1)}% cheaper`
            : `they are ${Math.abs(delta.saving_pct).toFixed(1)}% cheaper`}
        </div>
      ) : null}
      <dl className="mt-3 space-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-2">
        <div className="flex justify-between">
          <dt>lost margin</dt>
          <dd className="font-mono font-medium text-slate-700">{inr(s.shortage_cost)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>holding</dt>
          <dd className="font-mono font-medium text-slate-700">{inr(s.holding_cost)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>units unsupplied</dt>
          <dd className="font-mono font-medium text-slate-700">{units(s.units_short)}</dd>
        </div>
      </dl>
    </div>
  );
}

function Mini({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "mint" | "rose";
}) {
  const cls =
    tone === "mint"
      ? "text-emerald-700 bg-emerald-50/70 border-emerald-200/70"
      : tone === "rose"
        ? "text-rose-700 bg-rose-50/70 border-rose-200/70"
        : "text-ink bg-slate-50 border-slate-200/70";

  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="eyebrow text-[10px] text-slate-500">{label}</div>
      <div className="figure mt-1 text-[20px] font-bold leading-none">{value}</div>
    </div>
  );
}
