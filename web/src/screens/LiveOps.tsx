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
 * A chosen window of the ACTUAL daily history, stepped one day at a time. Sales
 * post, stock depletes, orders go out, deliveries land after the lead time, and
 * status chips flip. Nothing here is invented - which is why the screen is
 * watermarked with the window being replayed.
 */

// 320ms was unwatchable - a quarter went past in half a minute and nobody
// could see a delivery land. Default to a pace where each day is legible, and
// let the presenter speed up once the point has landed.
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

  // Polling on a timer rather than websockets: it cannot break on stage.
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
          <div className="flex flex-wrap items-center gap-2">
            {WINDOWS.map((w) => (
              <button
                key={w.from}
                onClick={() => {
                  stop();
                  setSnap(null);
                  setWindow(w);
                }}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  w.from === window_.from
                    ? "bg-wash-strong text-ink"
                    : "text-ink-mute hover:text-ink"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        }
      />

      {error ? <ErrorCard error={error} /> : null}

      <div className="panel pad relative overflow-hidden">
        <div className="pointer-events-none absolute right-4 top-3 select-none text-[10px] font-bold uppercase tracking-[0.28em] text-ink/15">
          Replay · {window_.label}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow">Simulated date</div>
            <div className="figure text-[28px] font-medium leading-none mt-1 tabular-nums">
              {snap?.current_date ?? "—"}
            </div>
            <div className="fine mt-1">
              {snap
                ? `day ${snap.day_index} of ${snap.total_days} · ${window_.note}`
                : `${window_.label} · ${window_.note}`}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!running ? (
              <button className="btn-primary" onClick={start}>
                {snap && !snap.finished ? "Resume" : "Start replay"}
              </button>
            ) : (
              <button className="btn-ghost" onClick={stop}>
                Pause
              </button>
            )}
            <div className="flex items-center border border-line">
              {SPEEDS.map((sp) => (
                <button
                  key={sp.label}
                  onClick={() => setSpeed(sp)}
                  className={`px-2.5 py-1.5 text-xs transition-colors ${
                    sp.ms === speed.ms
                      ? "bg-wash-strong text-ink"
                      : "text-ink-mute hover:text-ink"
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
                  // Pause the poller first: two concurrent ticks on one
                  // session would interleave inside the state machine.
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

        <div className="mt-4 h-1.5 w-full overflow-hidden bg-wash">
          <div
            className="h-full bg-signal-green transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

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
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="panel overflow-hidden lg:col-span-2">
            <div className="border-b border-line px-5 py-3">
              <div className="eyebrow">Shelf, right now</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    {["Product", "On hand", "Incoming", "Cover", "Lost", "Status"].map((h) => (
                      <th key={h} className="px-4 py-2.5 font-medium text-ink-mute">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {snap.positions.map((p) => (
                    <tr key={p.series_id} className="border-b border-line-soft last:border-0">
                      <td className="px-4 py-2.5 font-mono text-ink-soft">{p.series_id}</td>
                      <td className="px-4 py-2.5 tabular-nums text-ink">
                        {units(p.stock_on_hand)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-ink-faint">
                        {p.incoming > 0 ? `+${units(p.incoming)}` : "—"}
                      </td>
                      <td
                        className={`px-4 py-2.5 tabular-nums ${
                          p.days_of_cover < 5 ? "text-signal-red" : "text-ink-soft"
                        }`}
                      >
                        {p.days_of_cover > 900 ? "—" : `${p.days_of_cover.toFixed(1)} d`}
                      </td>
                      <td
                        className={`px-4 py-2.5 tabular-nums ${
                          p.units_short > 0 ? "text-signal-red" : "text-ink-pale"
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

          <div className="panel pad">
            <div className="eyebrow">Event feed</div>
            <div className="mt-3 max-h-[340px] space-y-2 overflow-y-auto pr-1">
              {feed.length === 0 ? (
                <p className="fine">Nothing yet. Press start.</p>
              ) : (
                feed.map((e, i) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <span
                      className={`mt-1 h-1.5 w-1.5 shrink-0 ${
                        e.type === "stockout"
                          ? "bg-signal-red"
                          : e.type === "delivery"
                            ? "bg-signal-blue"
                            : "bg-signal-green"
                      }`}
                    />
                    <div>
                      <span className="font-mono text-ink-faint">{e.date}</span>{" "}
                      <span className="font-mono text-ink-mute">{e.series_id}</span>
                      <div className="text-ink-soft">{e.message}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div>
        <SectionTitle
          title="What it was worth"
          subtitle="Our policy against a min/max policy, replayed over the identical real days."
        />
        {businessCase.isLoading ? (
          <Loading label="Simulating both policies" />
        ) : businessCase.isError ? (
          <ErrorCard error={businessCase.error} />
        ) : bc ? (
          <div className="panel pad border-signal-green">
            {/* Four policies, weakest first. Showing only min/max would be the
                easiest result in the project to discount: it is the "no system
                at all" case, and anyone who works in inventory knows every ERP
                carries safety stock. The rungs we lose ship too. */}
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
            <p className="fine mt-4 text-xs">{bc.method}</p>

            {/* Nobody outside inventory knows what "min/max" or "lost margin"
                mean, and a business case nobody can read is not a business
                case. Spelled out on the screen rather than in a doc. */}
            <div className="mt-5 border-t border-line pt-4">
              <div className="eyebrow">Reading this comparison</div>
              <dl className="mt-3 grid gap-x-8 gap-y-3 text-xs sm:grid-cols-2">
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
                  <div key={term}>
                    <dt className="font-medium text-ink">{term}</dt>
                    <dd className="mt-0.5 text-ink-mute">{body}</dd>
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
      className={`border px-4 py-3 ${
        best ? "border-signal-green bg-signal-green/[0.04]" : worse ? "border-signal-red" : "border-line"
      }`}
    >
      <div className="eyebrow min-h-[2.2em]">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          best ? "text-signal-green" : "text-ink-soft"
        }`}
      >
        {inr(s.total_cost)}
      </div>
      {delta ? (
        <div
          className={`mt-1 inline-block px-1.5 py-0.5 font-mono text-[10px] ${
            delta.we_win
              ? "bg-signal-green/[0.10] text-signal-green"
              : "bg-signal-amber/[0.12] text-signal-amber"
          }`}
        >
          {delta.we_win
            ? `we are ${delta.saving_pct.toFixed(1)}% cheaper`
            : `they are ${Math.abs(delta.saving_pct).toFixed(1)}% cheaper`}
        </div>
      ) : null}
      <dl className="mt-2 space-y-1 text-xs text-ink-mute">
        <div className="flex justify-between">
          <dt>lost margin</dt>
          <dd className="font-mono">{inr(s.shortage_cost)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>holding</dt>
          <dd className="font-mono">{inr(s.holding_cost)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>units unsupplied</dt>
          <dd className="font-mono">{units(s.units_short)}</dd>
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
    tone === "mint" ? "text-signal-green" : tone === "rose" ? "text-signal-red" : "text-ink";
  return (
    <div className="border-t border-line pt-2">
      <div className="eyebrow">{label}</div>
      <div className={`figure mt-1 text-[19px] font-medium leading-none ${cls}`}>{value}</div>
    </div>
  );
}
