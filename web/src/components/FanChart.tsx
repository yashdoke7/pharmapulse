import { useMemo, useRef, useState } from "react";
import type { ForecastResponse } from "../api/types";
import { shortDate, units } from "./ui";

/**
 * The fan chart. Raw SVG rather than a chart library, because no library draws
 * a stacked-quantile fan with a history join and a cutoff rule the way this
 * needs it.
 *
 * Three bands, widest to narrowest: 5-95, 10-90, 25-75, with the median as a
 * solid line. Reading the width of the fan IS the product - the decision layer
 * consumes that spread, so it has to be the most visible thing on the screen.
 */

const BANDS: [string, string, number][] = [
  ["0.05", "0.95", 0.1],
  ["0.10", "0.90", 0.16],
  ["0.25", "0.75", 0.26],
];

interface Props {
  data: ForecastResponse;
  height?: number;
  historyWindow?: number;
}

export function FanChart({ data, height = 320, historyWindow = 26 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const W = 900;
  const H = height;
  const pad = { top: 18, right: 18, bottom: 34, left: 52 };

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

    // The last bucket is almost always TRUNCATED - the file ends mid-week and
    // mid-month, so that point is 2 days of sales, not 7. Anchoring the fan to
    // it dragged the start of the forecast down to the partial value and then
    // jumped back up, which reads as the model ignoring its own last
    // observation. Anchor on the last COMPLETE bucket instead and draw the
    // partial tail as a dashed stub, so it is visible but not load-bearing.
    let anchorIndex = history.length - 1;
    while (anchorIndex > 0 && history[anchorIndex].completeness < 1) anchorIndex--;

    return {
      history, forecast, xs, x, y, lo, hi,
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

  // The truncated tail, drawn dashed so nobody reads it as a real fall.
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
    <div ref={wrapRef} className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
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
            <line x1="0" y1="0" x2="0" y2="6" stroke="#94a3b8" strokeWidth="2" />
          </pattern>
          <linearGradient id="histFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1C4E7A" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#1C4E7A" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={pad.left}
              x2={W - pad.right}
              y1={y(t)}
              y2={y(t)}
              stroke="rgba(20,17,13,.08)"
              strokeWidth="1"
            />
            <text x={pad.left - 10} y={y(t) + 4} textAnchor="end" className="fill-ink-faint" fontSize="11">
              {units(t)}
            </text>
          </g>
        ))}

        {/* forecast bands, widest first so narrower ones sit on top */}
        {BANDS.map(([loKey, hiKey, opacity]) => (
          <path key={loKey} d={bandPath(loKey, hiKey)} fill="#14110D" opacity={opacity} />
        ))}

        {/* history */}
        <path
          d={`${historyPath} L ${x(joinIndex)} ${H - pad.bottom} L ${x(0)} ${H - pad.bottom} Z`}
          fill="url(#histFill)"
        />
        <path d={historyPath} fill="none" stroke="#1C4E7A" strokeWidth="2" />
        {partialPath ? (
          <>
            <path
              d={partialPath}
              fill="none"
              stroke="#1C4E7A"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              opacity={0.5}
            />
            <circle
              cx={x(joinIndex)}
              cy={y(history[joinIndex].y)}
              r={3.5}
              fill="#F7F4EE"
              stroke="#1C4E7A"
              strokeWidth="1.5"
              opacity={0.7}
            />
            <text
              x={x(joinIndex)}
              y={y(history[joinIndex].y) + 18}
              textAnchor="middle"
              fontSize="9"
              fill="#8A6410"
            >
              part period
            </text>
          </>
        ) : null}

        {/* partial buckets are shown, never hidden */}
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

        <path d={medianPath} fill="none" stroke="#14110D" strokeWidth="2.5" />

        {/* the cutoff: everything right of this line is a forecast */}
        <line
          x1={x(joinIndex)}
          x2={x(joinIndex)}
          y1={pad.top}
          y2={H - pad.bottom}
          stroke="rgba(20,17,13,.40)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        <text x={x(joinIndex) + 6} y={pad.top + 11} fontSize="10" className="fill-ink-mute">
          forecast
        </text>

        {hover !== null && xs[hover] ? (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={pad.top}
            y2={H - pad.bottom}
            stroke="rgba(20,17,13,.35)"
            strokeWidth="1"
          />
        ) : null}

        {xs.map((ds, i) =>
          i % Math.ceil(xs.length / 8) === 0 ? (
            <text
              key={ds + i}
              x={x(i)}
              y={H - 12}
              textAnchor="middle"
              fontSize="10"
              className="fill-ink-faint"
            >
              {shortDate(ds)}
            </text>
          ) : null,
        )}
      </svg>

      {hover !== null && (hoverPoint || hoverHistory) ? (
        <div
          className="pointer-events-none absolute top-2 border border-line bg-paper-raised px-3 py-2 text-xs shadow-xl"
          style={{
            left: `calc(${(x(hover) / W) * 100}% + 8px)`,
            transform: x(hover) / W > 0.65 ? "translateX(-108%)" : undefined,
          }}
        >
          <div className="font-semibold text-ink">{shortDate(xs[hover])}</div>
          {hoverHistory ? (
            <div className="mt-1 text-ink-soft">
              actual <span className="font-mono text-ink">{units(hoverHistory.y)}</span>
              {hoverHistory.completeness < 1 ? (
                <span className="ml-1 text-signal-amber">(partial)</span>
              ) : null}
            </div>
          ) : null}
          {hoverPoint ? (
            <table className="mt-1">
              <tbody>
                {["0.95", "0.75", "0.50", "0.25", "0.05"].map((q) => (
                  <tr key={q}>
                    <td className="pr-3 text-ink-mute">
                      {q === "0.50" ? "median" : `p${Math.round(Number(q) * 100)}`}
                    </td>
                    <td
                      className={`text-right font-mono ${
                        q === "0.50" ? "text-signal-green" : "text-ink"
                      }`}
                    >
                      {units(hoverPoint.q[q])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-ink-mute">
        <Legend color="#1C4E7A" label="actual" />
        <Legend color="#14110D" label="median forecast" />
        <Legend color="#14110D" label="50% / 80% / 90% bands" faded />
      </div>
    </div>
  );
}

function Legend({ color, label, faded }: { color: string; label: string; faded?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-4 rounded"
        style={{ background: color, opacity: faded ? 0.3 : 1 }}
      />
      {label}
    </span>
  );
}
