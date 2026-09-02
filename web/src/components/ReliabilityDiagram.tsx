import type { CoveragePoint } from "../api/types";
import { pct } from "./ui";

/**
 * Stated confidence against achieved coverage, before and after conformal
 * correction, with the 45-degree identity line.
 *
 * Staged in modern healthcare analytics aesthetic.
 */
export function ReliabilityDiagram({
  before,
  after,
  nPoints,
  height = 320,
}: {
  before: CoveragePoint[];
  after: CoveragePoint[];
  nPoints?: number | null;
  height?: number;
}) {
  const S = 340;
  const pad = 44;
  const x = (v: number) => pad + v * (S - pad * 2);
  const y = (v: number) => S - pad - v * (S - pad * 2);

  const line = (points: CoveragePoint[]) =>
    points
      .slice()
      .sort((a, b) => a.nominal - b.nominal)
      .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.nominal)} ${y(p.achieved)}`)
      .join(" ");

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${S} ${S}`} className="w-full select-none" style={{ maxHeight: height }}>
        {/* Background grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line
              x1={x(0)}
              x2={x(1)}
              y1={y(t)}
              y2={y(t)}
              stroke="rgba(15, 159, 168, 0.08)"
              strokeWidth="1"
            />
            <line
              x1={x(t)}
              x2={x(t)}
              y1={y(0)}
              y2={y(1)}
              stroke="rgba(15, 159, 168, 0.08)"
              strokeWidth="1"
            />
            <text
              x={pad - 8}
              y={y(t) + 3.5}
              textAnchor="end"
              fontSize="9.5"
              className="fill-slate-400 font-mono"
            >
              {pct(t)}
            </text>
            <text
              x={x(t)}
              y={S - pad + 16}
              textAnchor="middle"
              fontSize="9.5"
              className="fill-slate-400 font-mono"
            >
              {pct(t)}
            </text>
          </g>
        ))}

        {/* Perfect calibration 45-degree diagonal line */}
        <line
          x1={x(0)}
          y1={y(0)}
          x2={x(1)}
          y2={y(1)}
          stroke="rgba(15, 159, 168, 0.45)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
        <text
          x={x(0.62)}
          y={y(0.68)}
          fontSize="9"
          className="fill-slate-400 font-medium"
          transform={`rotate(-45 ${x(0.62)} ${y(0.68)})`}
        >
          perfect calibration
        </text>

        {/* Guidance labels */}
        <text x={x(0.06)} y={y(0.88)} fontSize="9" className="fill-slate-400 font-medium">
          above = range too WIDE
        </text>
        <text x={x(0.06)} y={y(0.79)} fontSize="8.5" className="fill-slate-400">
          (over-orders, ties up cash)
        </text>
        <text x={x(0.52)} y={y(0.14)} fontSize="9" className="fill-slate-400 font-medium">
          below = too NARROW
        </text>
        <text x={x(0.52)} y={y(0.05)} fontSize="8.5" className="fill-slate-400">
          (over-confident, runs out)
        </text>

        {/* Raw model curve (before) */}
        <path
          d={line(before)}
          fill="none"
          stroke="#E11D48"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {before.map((p) => (
          <circle
            key={`b${p.nominal}`}
            cx={x(p.nominal)}
            cy={y(p.achieved)}
            r="4"
            fill="#E11D48"
            stroke="#FFFFFF"
            strokeWidth="1.5"
          />
        ))}

        {/* Conformal corrected curve (after) */}
        <path
          d={line(after)}
          fill="none"
          stroke="#059669"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {after.map((p) => (
          <circle
            key={`a${p.nominal}`}
            cx={x(p.nominal)}
            cy={y(p.achieved)}
            r="4.5"
            fill="#059669"
            stroke="#FFFFFF"
            strokeWidth="1.5"
          />
        ))}

        {/* Axis titles */}
        <text
          x={S / 2}
          y={S - 6}
          textAnchor="middle"
          fontSize="10"
          className="fill-slate-500 font-semibold uppercase tracking-wider font-mono"
        >
          stated confidence
        </text>
        <text
          x={14}
          y={S / 2}
          fontSize="10"
          className="fill-slate-500 font-semibold uppercase tracking-wider font-mono"
          transform={`rotate(-90 14 ${S / 2})`}
          textAnchor="middle"
        >
          achieved coverage
        </text>
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
        <span className="inline-flex items-center gap-2 font-medium text-slate-600">
          <span className="inline-block h-2.5 w-4 rounded-full bg-rose-500" />
          Raw model interval
        </span>
        <span className="inline-flex items-center gap-2 font-medium text-slate-600">
          <span className="inline-block h-2.5 w-4 rounded-full bg-emerald-600" />
          After conformal correction
        </span>
        {nPoints ? (
          <span className="ml-auto font-mono text-slate-400 text-[11px] bg-slate-50 px-2 py-0.5 rounded border border-slate-200/60">
            n = {nPoints} points
          </span>
        ) : null}
      </div>
    </div>
  );
}
