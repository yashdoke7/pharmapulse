import { useMemo, useState } from "react";
import type { CostPoint, Recommendation } from "../api/types";
import { inr, pct, units } from "./ui";

/**
 * THE demo control.
 *
 * /api/recommend ships the whole cost curve - 16 service levels with the order
 * quantity, expected cost and stockout probability at each. Dragging
 * interpolates that array in the browser and makes ZERO network calls, which is
 * only possible because the newsvendor calculation is closed form and the
 * demand distribution was already resolved by last night's batch.
 *
 * If this fetched on drag, the control would stutter and the "closed form, O(1)"
 * claim would die on stage.
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
        // Quantity is a whole number of packs, so it steps rather than glides.
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
    const H = 150;
    const pad = { top: 12, right: 12, bottom: 22, left: 40 };
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

  return (
    <div className="panel pad">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-ink">
            How often are you willing to run out?
          </h3>
          <p className="fine mt-1 max-w-md">
            This moves the critical fractile <span className="font-mono">q*</span>, which
            moves the order quantity. Nothing is fetched while you drag - the whole cost
            curve arrived with the recommendation.
          </p>
        </div>
        <div className="text-right">
          <div className="eyebrow">Order</div>
          <div className="figure text-[28px] font-medium leading-none text-signal-green">{current.order_quantity}</div>
          <div className="fine">
            {Math.round(current.order_quantity / (rec.order_packs ? rec.order_quantity / rec.order_packs : 10))}{" "}
            packs
          </div>
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
            background: `linear-gradient(90deg,#14110D ${((level - 0.05) / 0.94) * 100}%, rgba(20,17,13,.14) ${
              ((level - 0.05) / 0.94) * 100
            }%)`,
          }}
        />
        <div className="mt-2 flex justify-between text-[11px] text-ink-faint">
          <span>run out often · cheap</span>
          <span>rarely run out · costly</span>
        </div>
      </div>

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

      <div className="mt-5">
        <div className="eyebrow mb-1">Expected cost per order cycle, across service levels</div>
        <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="w-full" style={{ height: 150 }}>
          <path
            d={`${chart.path} L ${chart.x(0.99)} ${chart.H - chart.pad.bottom} L ${chart.x(
              0.05,
            )} ${chart.H - chart.pad.bottom} Z`}
            fill="#14110D"
            opacity="0.10"
          />
          <path d={chart.path} fill="none" stroke="#14110D" strokeWidth="2" />

          {/* the minimum-cost point: where the maths says to sit */}
          <circle
            cx={chart.x(cheapest.service_level)}
            cy={chart.y(cheapest.expected_cost)}
            r="4"
            fill="#F7F4EE"
            stroke="#8A6410"
            strokeWidth="2"
          />
          <text
            x={chart.x(cheapest.service_level)}
            y={chart.y(cheapest.expected_cost) - 9}
            textAnchor="middle"
            fontSize="9"
            className="fill-signal-amber"
          >
            cheapest
          </text>

          <line
            x1={chart.x(level)}
            x2={chart.x(level)}
            y1={chart.pad.top}
            y2={chart.H - chart.pad.bottom}
            stroke="#14110D"
            strokeOpacity="0.55"
            strokeWidth="1"
          />
          <circle
            cx={chart.x(level)}
            cy={chart.y(current.expected_cost)}
            r="5"
            fill="#14110D"
            stroke="#F7F4EE"
            strokeWidth="2"
          />

          {[0.05, 0.25, 0.5, 0.75, 0.95].map((t) => (
            <text
              key={t}
              x={chart.x(t)}
              y={chart.H - 6}
              textAnchor="middle"
              fontSize="9"
              className="fill-ink-faint"
            >
              {pct(t)}
            </text>
          ))}
        </svg>
      </div>

      <div className="mt-5 grid gap-4 border-t border-line pt-3 text-xs sm:grid-cols-3">
        <CostAt label="1 pack fewer" value={rec.expected_cost.minus_one_pack} base={rec.expected_cost.at_order} />
        <CostAt label="Recommended" value={rec.expected_cost.at_order} base={rec.expected_cost.at_order} highlight />
        <CostAt label="1 pack more" value={rec.expected_cost.plus_one_pack} base={rec.expected_cost.at_order} />
      </div>

      {onCommit ? (
        <div className="mt-4 flex items-center gap-3">
          <button
            className="btn-primary"
            onClick={() => onCommit(level, current.order_quantity)}
          >
            Accept {current.order_quantity} units
          </button>
          <span className="fine">
            q* from your costs is {pct(rec.q_star, 1)}; the target level is{" "}
            {units(rec.target_level)} units.
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
      ? "text-signal-green"
      : tone === "rose"
        ? "text-signal-red"
        : tone === "amber"
          ? "text-signal-amber"
          : "text-ink";
  return (
    <div className="border-t border-line pt-2">
      <div className="eyebrow">{label}</div>
      <div className={`figure mt-1 text-[19px] font-medium leading-none ${cls}`}>{value}</div>
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
    <div className={highlight ? "text-signal-green" : "text-ink-soft"}>
      <div className="eyebrow">{label}</div>
      <div className="mt-0.5 font-mono">
        {inr(value)}
        {!highlight && Math.abs(diff) > 0.5 ? (
          <span className="ml-1 text-ink-faint">(+{inr(diff)})</span>
        ) : null}
      </div>
    </div>
  );
}
