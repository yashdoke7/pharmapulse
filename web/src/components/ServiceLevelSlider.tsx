import { useMemo, useState } from "react";
import type { CostPoint, Recommendation } from "../api/types";
import { inr, pct, units } from "./ui";

/**
 * THE demo control.
 *
 * /api/recommend ships the whole cost curve - 16 service levels with the order
 * quantity, expected cost and stockout probability at each. Dragging
 * interpolates that array in the browser and makes ZERO network calls.
 *
 * Transformed into a modern AI-powered prediction & decision card.
 */

function interpolate(curve: CostPoint[], level: number): CostPoint {
  if (!curve.length) {
    return { service_level: level, order_quantity: 0, expected_cost: 0, p_stockout: 0 };
  }
  if (level <= curve[0].service_level) return curve[0];
  if (level >= curve[curve.length - 1].service_level) return curve[curve.length - 1];

  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (level >= a.service_level && level <= b.service_level) {
      const t = (level - a.service_level) / (b.service_level - a.service_level || 1);
      return {
        service_level: level,
        order_quantity: t < 0.5 ? a.order_quantity : b.order_quantity,
        expected_cost: a.expected_cost + t * (b.expected_cost - a.expected_cost),
        p_stockout: a.p_stockout + t * (b.p_stockout - a.p_stockout),
      };
    }
  }
  return curve[curve.length - 1];
}

export function ServiceLevelSlider({
  rec,
  onCommit,
}: {
  rec: Recommendation;
  onCommit?: (level: number, quantity: number) => void;
}) {
  const [level, setLevel] = useState(rec.service_level_used);
  const curve = rec.cost_curve;

  const current = useMemo(() => interpolate(curve, level), [curve, level]);

  const cheapest = useMemo(
    () => curve.reduce((best, c) => (c.expected_cost < best.expected_cost ? c : best), curve[0]),
    [curve],
  );

  const chart = useMemo(() => {
    const W = 600;
    const H = 160;
    const pad = { top: 16, right: 16, bottom: 26, left: 46 };
    const costs = curve.map((c) => c.expected_cost);
    const lo = Math.min(...costs);
    const hi = Math.max(...costs);
    const span = Math.max(hi - lo, 1);
    const x = (sl: number) =>
      pad.left + ((sl - 0.05) / 0.94) * (W - pad.left - pad.right);
    const y = (c: number) =>
      pad.top + (1 - (c - lo + span * 0.08) / (span * 1.16)) * (H - pad.top - pad.bottom);
    const path = curve
      .map((c, i) => `${i === 0 ? "M" : "L"} ${x(c.service_level)} ${y(c.expected_cost)}`)
      .join(" ");
    return { W, H, pad, x, y, path, lo, hi };
  }, [curve]);

  const delta = current.expected_cost - cheapest.expected_cost;

  const packSize = rec.order_packs ? rec.order_quantity / rec.order_packs : 10;
  const packs = Math.round(current.order_quantity / (packSize || 10));
  const qtyDelta = current.order_quantity - rec.order_quantity;
  const atRecommendation = Math.abs(level - rec.service_level_used) < 0.0025;

  return (
    <div className="panel pad relative overflow-hidden">
      {/* Subtle top teal glow */}
      <div className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-medical-teal/10 blur-3xl" />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-medical-cyan text-medical-teal-deep text-xs font-bold">
              AI
            </span>
            <h3 className="text-lg font-bold text-ink">
              How often are you willing to run out?
            </h3>
          </div>
          <p className="fine mt-1 max-w-md text-slate-500">
            This moves the critical fractile <span className="font-mono text-medical-teal-deep font-semibold">q*</span>, which
            moves the order quantity. Nothing is fetched while you drag — the whole cost
            curve is solved in closed form.
          </p>
        </div>

        <div className="text-right bg-slate-50/80 border border-slate-200/70 px-4 py-3 rounded-2xl">
          <div className="eyebrow text-slate-500">Suggested Order</div>
          <div
            className={`figure text-[36px] font-bold leading-none mt-1 transition-colors ${
              atRecommendation ? "text-medical-teal-deep" : "text-ink"
            }`}
          >
            {current.order_quantity}
          </div>
          <div className="fine text-slate-500 font-medium mt-0.5">{packs} packs</div>
          {qtyDelta !== 0 ? (
            <div
              className={`mt-1.5 inline-block px-2 py-0.5 rounded-full font-mono text-[10.5px] font-semibold ${
                qtyDelta > 0
                  ? "bg-blue-50 text-blue-700 border border-blue-200"
                  : "bg-rose-50 text-rose-700 border border-rose-200"
              }`}
            >
              {qtyDelta > 0 ? "+" : ""}
              {qtyDelta} vs recommended
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-6">
        <input
          type="range"
          className="pp-slider w-full"
          min={0.05}
          max={0.99}
          step={0.005}
          value={level}
          onChange={(e) => setLevel(Number(e.target.value))}
          style={{
            background: `linear-gradient(90deg, #0F9FA8 ${((level - 0.05) / 0.94) * 100}%, rgba(15, 159, 168, 0.16) ${
              ((level - 0.05) / 0.94) * 100
            }%)`,
          }}
        />
        <div className="mt-2 flex justify-between text-[11px] font-medium text-slate-400">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
            run out often · cheap
          </span>
          <span className="flex items-center gap-1">
            rarely run out · costly
            <span className="h-1.5 w-1.5 rounded-full bg-medical-teal" />
          </span>
        </div>

        {/* Narrative decision consequence */}
        <div className="mt-4 rounded-xl border border-medical-teal/20 bg-medical-cyan/20 p-3.5 text-sm text-slate-700">
          Accept a{" "}
          <strong className="text-ink font-semibold">{pct(current.p_stockout, 1)}</strong> chance of
          running out and you order{" "}
          <strong className="font-mono text-medical-teal-deep font-bold">{current.order_quantity} units</strong> (
          {packs} packs) at{" "}
          <strong className="font-mono text-ink font-bold">{inr(current.expected_cost)}</strong>.
          {atRecommendation ? (
            <span className="text-emerald-700 font-medium">
              {" "}
              That is the recommendation — the minimum cost point on the risk curve below.
            </span>
          ) : (
            <span>
              {" "}
              The recommendation is{" "}
              <span className="font-mono font-medium">{rec.order_quantity}</span> at{" "}
              {pct(rec.service_level_used, 1)}; this costs{" "}
              <span className="font-mono font-medium">{inr(Math.abs(delta))}</span> more per cycle.
            </span>
          )}
        </div>
      </div>

      {/* KPI statistics cards */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Mini label="Service level" value={pct(level, 1)} tone="mint" />
        <Mini label="Stockout risk" value={pct(current.p_stockout, 1)} tone="rose" />
        <Mini label="Cost this cycle" value={inr(current.expected_cost)} />
        <Mini
          label="vs cheapest"
          value={delta <= 0.5 ? "optimal" : `+${inr(delta)}`}
          tone={delta <= 0.5 ? "mint" : "amber"}
        />
      </div>

      {/* Expected cost curve */}
      <div className="mt-6">
        <div className="eyebrow mb-1 text-slate-500">Expected cost per order cycle, across service levels</div>
        <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="w-full select-none" style={{ height: 160 }}>
          <defs>
            <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0F9FA8" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#0F9FA8" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Area under curve */}
          <path
            d={`${chart.path} L ${chart.x(0.99)} ${chart.H - chart.pad.bottom} L ${chart.x(
              0.05,
            )} ${chart.H - chart.pad.bottom} Z`}
            fill="url(#curveFill)"
          />
          {/* Main curve */}
          <path d={chart.path} fill="none" stroke="#087F86" strokeWidth="2.5" strokeLinecap="round" />

          {/* The minimum-cost point */}
          <circle
            cx={chart.x(cheapest.service_level)}
            cy={chart.y(cheapest.expected_cost)}
            r="5"
            fill="#FFFFFF"
            stroke="#D97706"
            strokeWidth="2.5"
          />
          <rect
            x={chart.x(cheapest.service_level) - 24}
            y={chart.y(cheapest.expected_cost) - 22}
            width="48"
            height="15"
            rx="3"
            fill="#FFFBEB"
            stroke="#FDE68A"
            strokeWidth="1"
          />
          <text
            x={chart.x(cheapest.service_level)}
            y={chart.y(cheapest.expected_cost) - 11}
            textAnchor="middle"
            fontSize="8.5"
            fontWeight="bold"
            className="fill-amber-800 uppercase tracking-wider font-mono"
          >
            cheapest
          </text>

          {/* Current selected level vertical line */}
          <line
            x1={chart.x(level)}
            x2={chart.x(level)}
            y1={chart.pad.top}
            y2={chart.H - chart.pad.bottom}
            stroke="#0F9FA8"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
          <circle
            cx={chart.x(level)}
            cy={chart.y(current.expected_cost)}
            r="6"
            fill="#0F9FA8"
            stroke="#FFFFFF"
            strokeWidth="2.5"
          />

          {/* X ticks */}
          {[0.05, 0.25, 0.5, 0.75, 0.95].map((t) => (
            <text
              key={t}
              x={chart.x(t)}
              y={chart.H - 8}
              textAnchor="middle"
              fontSize="9.5"
              className="fill-slate-400 font-mono"
            >
              {pct(t)}
            </text>
          ))}
        </svg>
      </div>

      {/* Comparative packs */}
      <div className="mt-5 grid gap-3 border-t border-slate-100 pt-4 text-xs sm:grid-cols-3">
        <CostAt label="1 pack fewer" value={rec.expected_cost.minus_one_pack} base={rec.expected_cost.at_order} />
        <CostAt label="Recommended" value={rec.expected_cost.at_order} base={rec.expected_cost.at_order} highlight />
        <CostAt label="1 pack more" value={rec.expected_cost.plus_one_pack} base={rec.expected_cost.at_order} />
      </div>

      {onCommit ? (
        <div className="mt-5 flex flex-wrap items-center gap-4 pt-2">
          <button
            className="btn-primary px-5 py-2.5 shadow-sm hover:shadow-glow text-sm font-semibold rounded-xl"
            onClick={() => onCommit(level, current.order_quantity)}
          >
            Accept {current.order_quantity} units
          </button>
          <span className="fine text-slate-500">
            q* from your costs is <strong className="text-slate-700">{pct(rec.q_star, 1)}</strong>; the target level is{" "}
            <strong className="text-slate-700 font-mono">{units(rec.target_level)} units</strong>.
          </span>
        </div>
      ) : null}
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
  tone?: "mint" | "rose" | "amber";
}) {
  const cls =
    tone === "mint"
      ? "text-emerald-700 bg-emerald-50/80 border-emerald-200/70"
      : tone === "rose"
        ? "text-rose-700 bg-rose-50/80 border-rose-200/70"
        : tone === "amber"
          ? "text-amber-700 bg-amber-50/80 border-amber-200/70"
          : "text-ink bg-slate-50 border-slate-200/70";

  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="eyebrow text-[10px] text-slate-500">{label}</div>
      <div className="figure mt-1 text-[20px] font-bold leading-none">{value}</div>
    </div>
  );
}

function CostAt({
  label,
  value,
  base,
  highlight,
}: {
  label: string;
  value: number;
  base: number;
  highlight?: boolean;
}) {
  const diff = value - base;
  return (
    <div
      className={`rounded-xl p-3 border ${
        highlight
          ? "bg-medical-cyan/30 border-medical-teal/30 text-medical-teal-deep shadow-xs"
          : "bg-slate-50/60 border-slate-200/60 text-slate-600"
      }`}
    >
      <div className="eyebrow text-[10px]">{label}</div>
      <div className="mt-1 font-mono font-bold text-sm text-ink">
        {inr(value)}
        {!highlight && Math.abs(diff) > 0.5 ? (
          <span className="ml-1 text-[11px] font-medium text-slate-400 font-mono">
            (+{inr(diff)})
          </span>
        ) : null}
      </div>
    </div>
  );
}
