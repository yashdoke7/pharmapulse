import { useMemo, useRef, useState } from "react";
import type { ForecastResponse } from "../api/types";
import { shortDate, units } from "./ui";

/**
 * The fan chart. Raw SVG rather than a chart library, because no library draws
 * a stacked-quantile fan with a history join and a cutoff rule the way this
 * needs it.
 *
 * Three bands, widest to narrowest: 5-95, 10-90, 25-75, with the median as a
 * solid line in Medical Teal.
 */

const BANDS: [string, string, number][] = [
  ["0.05", "0.95", 0.12],
  ["0.10", "0.90", 0.22],
  ["0.25", "0.75", 0.36],
];

interface Props {
  data: ForecastResponse;
  height?: number;
  historyWindow?: number;
}

export function FanChart({ data, height = 340, historyWindow = 26 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const W = 900;
  const H = height;
  const pad = { top: 20, right: 20, bottom: 36, left: 54 };

  const model = useMemo(() => {
    const history = data.history.slice(-historyWindow);
    const forecast = data.points;

    const xs = [...history.map((h) => h.ds), ...forecast.map((f) => f.ds)];
    const n = Math.max(xs.length - 1, 1);

    let lo = Infinity;
    let hi = -Infinity;
    history.forEach((h) => {
      lo = Math.min(lo, h.y);
      hi = Math.max(hi, h.y);
    });
    forecast.forEach((f) => {
      Object.values(f.q).forEach((v) => {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      });
    });
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    const span = Math.max(hi - lo, 1);
    lo = Math.max(0, lo - span * 0.12);
    hi = hi + span * 0.12;

    const x = (i: number) => pad.left + (i / n) * (W - pad.left - pad.right);
    const y = (v: number) =>
      pad.top + (1 - (v - lo) / (hi - lo)) * (H - pad.top - pad.bottom);

    let anchorIndex = history.length - 1;
    while (anchorIndex > 0 && history[anchorIndex].completeness < 1) anchorIndex--;

    return {
      history,
      forecast,
      xs,
      x,
      y,
      lo,
      hi,
      joinIndex: history.length - 1,
      anchorIndex,
    };
  }, [data, historyWindow, H]);

  const { history, forecast, xs, x, y, lo, hi, joinIndex, anchorIndex } = model;

  const bandPath = (loKey: string, hiKey: string) => {
    if (!forecast.length) return "";
    const anchor = history.length ? history[anchorIndex].y : forecast[0].q[loKey];
    const top = [`M ${x(anchorIndex)} ${y(anchor)}`];
    forecast.forEach((f, i) => top.push(`L ${x(joinIndex + 1 + i)} ${y(f.q[hiKey])}`));
    for (let i = forecast.length - 1; i >= 0; i--) {
      top.push(`L ${x(joinIndex + 1 + i)} ${y(forecast[i].q[loKey])}`);
    }
    top.push(`L ${x(anchorIndex)} ${y(anchor)} Z`);
    return top.join(" ");
  };

  const historyPath = history
    .slice(0, anchorIndex + 1)
    .map((h, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(h.y)}`)
    .join(" ");

  const partialPath =
    anchorIndex < history.length - 1
      ? history
          .slice(anchorIndex)
          .map((h, i) => `${i === 0 ? "M" : "L"} ${x(anchorIndex + i)} ${y(h.y)}`)
          .join(" ")
      : "";

  const medianPath = (() => {
    if (!forecast.length) return "";
    const anchor = history.length ? history[anchorIndex].y : forecast[0].q["0.50"];
    const parts = [`M ${x(anchorIndex)} ${y(anchor)}`];
    forecast.forEach((f, i) => parts.push(`L ${x(joinIndex + 1 + i)} ${y(f.q["0.50"])}`));
    return parts.join(" ");
  })();

  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i <= 4; i++) out.push(lo + ((hi - lo) * i) / 4);
    return out;
  }, [lo, hi]);

  const hoverPoint =
    hover !== null && hover > joinIndex ? forecast[hover - joinIndex - 1] : null;
  const hoverHistory = hover !== null && hover <= joinIndex ? history[hover] : null;

  return (
    <div ref={wrapRef} className="relative w-full overflow-hidden">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full select-none"
        style={{ height }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const n = Math.max(xs.length - 1, 1);
          const idx = Math.round(
            ((px - pad.left) / (W - pad.left - pad.right)) * n,
          );
          setHover(idx >= 0 && idx < xs.length ? idx : null);
        }}
      >
        <defs>
          <pattern
            id="partial"
            width="6"
            height="6"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <line x1="0" y1="0" x2="0" y2="6" stroke="#94A3B8" strokeWidth="2" />
          </pattern>
          <linearGradient id="histFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2F80ED" stopOpacity="0.20" />
            <stop offset="100%" stopColor="#2F80ED" stopOpacity="0.01" />
          </linearGradient>
          <linearGradient id="fanGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0F9FA8" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#087F86" stopOpacity="0.4" />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={pad.left}
              x2={W - pad.right}
              y1={y(t)}
              y2={y(t)}
              stroke="rgba(15, 159, 168, 0.08)"
              strokeWidth="1"
              strokeDasharray={i === 0 ? "none" : "3 3"}
            />
            <text
              x={pad.left - 10}
              y={y(t) + 4}
              textAnchor="end"
              className="fill-slate-400 font-mono"
              fontSize="10.5"
            >
              {units(t)}
            </text>
          </g>
        ))}

        {/* Forecast bands: widest first so narrower ones sit on top */}
        {BANDS.map(([loKey, hiKey, opacity]) => (
          <path
            key={loKey}
            d={bandPath(loKey, hiKey)}
            fill="#0F9FA8"
            opacity={opacity}
          />
        ))}

        {/* History actual sales */}
        <path
          d={`${historyPath} L ${x(joinIndex)} ${H - pad.bottom} L ${x(0)} ${H - pad.bottom} Z`}
          fill="url(#histFill)"
        />
        <path
          d={historyPath}
          fill="none"
          stroke="#2F80ED"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {partialPath ? (
          <>
            <path
              d={partialPath}
              fill="none"
              stroke="#2F80ED"
              strokeWidth="1.8"
              strokeDasharray="4 3"
              opacity={0.6}
            />
            <circle
              cx={x(joinIndex)}
              cy={y(history[joinIndex].y)}
              r={4}
              fill="#FFFFFF"
              stroke="#2F80ED"
              strokeWidth="2"
            />
            <text
              x={x(joinIndex)}
              y={y(history[joinIndex].y) + 18}
              textAnchor="middle"
              fontSize="9"
              fill="#D97706"
              fontWeight="600"
            >
              part period
            </text>
          </>
        ) : null}

        {/* Partial buckets marker */}
        {history.map((h, i) =>
          h.completeness < 1 ? (
            <rect
              key={h.ds}
              x={x(i) - 4}
              y={pad.top}
              width={8}
              height={H - pad.top - pad.bottom}
              fill="url(#partial)"
              opacity="0.25"
            />
          ) : null,
        )}

        {/* Median forecast line */}
        <path
          d={medianPath}
          fill="none"
          stroke="#087F86"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* The cutoff: everything right of this line is a forecast */}
        <line
          x1={x(joinIndex)}
          x2={x(joinIndex)}
          y1={pad.top}
          y2={H - pad.bottom}
          stroke="#0F9FA8"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
        <rect
          x={x(joinIndex) + 4}
          y={pad.top + 2}
          width="60"
          height="16"
          rx="4"
          fill="rgba(15, 159, 168, 0.12)"
        />
        <text
          x={x(joinIndex) + 34}
          y={pad.top + 13}
          textAnchor="middle"
          fontSize="9.5"
          fontWeight="600"
          className="fill-medical-teal-deep uppercase tracking-wider font-mono"
        >
          forecast
        </text>

        {/* Hover vertical crosshair */}
        {hover !== null && xs[hover] ? (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={pad.top}
            y2={H - pad.bottom}
            stroke="#0F9FA8"
            strokeOpacity="0.5"
            strokeWidth="1.5"
            strokeDasharray="2 2"
          />
        ) : null}

        {/* X-axis date labels */}
        {xs.map((ds, i) =>
          i % Math.ceil(xs.length / 8) === 0 ? (
            <text
              key={ds + i}
              x={x(i)}
              y={H - 14}
              textAnchor="middle"
              fontSize="10"
              className="fill-slate-400 font-mono"
            >
              {shortDate(ds)}
            </text>
          ) : null,
        )}
      </svg>

      {/* Modern floating tooltip */}
      {hover !== null && (hoverPoint || hoverHistory) ? (
        <div
          className="pointer-events-none absolute top-4 z-20 rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-md px-4 py-3 text-xs shadow-float"
          style={{
            left: `calc(${(x(hover) / W) * 100}% + 12px)`,
            transform: x(hover) / W > 0.65 ? "translateX(-112%)" : undefined,
          }}
        >
          <div className="font-bold text-ink text-sm flex items-center gap-2">
            <span>{shortDate(xs[hover])}</span>
            <span className="text-[10px] font-mono text-slate-400 font-normal">{xs[hover]}</span>
          </div>

          {hoverHistory ? (
            <div className="mt-2 flex items-center justify-between gap-4 text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-medical-blue" />
                Actual Sales
              </span>
              <span className="font-mono font-bold text-ink text-sm">
                {units(hoverHistory.y)}
              </span>
              {hoverHistory.completeness < 1 ? (
                <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded font-medium">
                  partial
                </span>
              ) : null}
            </div>
          ) : null}

          {hoverPoint ? (
            <div className="mt-2 pt-2 border-t border-slate-100">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-medical-teal-deep mb-1 font-mono">
                Conformal Quantiles
              </div>
              <table className="w-full">
                <tbody>
                  {["0.95", "0.75", "0.50", "0.25", "0.05"].map((q) => (
                    <tr key={q} className="py-0.5">
                      <td className="pr-4 text-slate-500 font-medium">
                        {q === "0.50" ? (
                          <span className="text-medical-teal-deep font-semibold flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-medical-teal" />
                            Median (p50)
                          </span>
                        ) : (
                          `p${Math.round(Number(q) * 100)}`
                        )}
                      </td>
                      <td
                        className={`text-right font-mono font-medium ${
                          q === "0.50"
                            ? "text-medical-teal-deep font-bold text-sm"
                            : "text-slate-700"
                        }`}
                      >
                        {units(hoverPoint.q[q])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Chart legends */}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[11.5px] text-slate-500 px-2">
        <Legend color="#2F80ED" label="Actual Sales History" />
        <Legend color="#087F86" label="Ensemble Median" />
        <Legend color="#0F9FA8" label="Quantile Bands (50% / 80% / 90%)" faded />
      </div>
    </div>
  );
}

function Legend({ color, label, faded }: { color: string; label: string; faded?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="inline-block h-2.5 w-4 rounded-sm"
        style={{ background: color, opacity: faded ? 0.35 : 1 }}
      />
      <span className="font-medium text-slate-600">{label}</span>
    </span>
  );
}
