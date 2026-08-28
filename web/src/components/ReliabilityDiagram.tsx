import type { CoveragePoint } from "../api/types";
import { pct } from "./ui";

/**
 * Stated confidence against achieved coverage, before and after conformal
 * correction, with the 45-degree identity line.
 *
 * Almost nobody in this market ships this. A confidence band the user cannot
 * verify is not a confidence claim, and the honesty IS the feature: we measured
 * our own intervals, found them wrong, corrected them, and show both curves.
 */
export function ReliabilityDiagram({
  before,
  after,
  nPoints,
  height = 300,
}: {
  before: CoveragePoint[];
  after: CoveragePoint[];
  nPoints?: number | null;
  height?: number;
}) {
  const S = 320;
  const pad = 40;
  const x = (v: number) => pad + v * (S - pad * 2);
  const y = (v: number) => S - pad - v * (S - pad * 2);

  const line = (points: CoveragePoint[]) =>
    points
      .slice()
      .sort((a, b) => a.nominal - b.nominal)
      .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.nominal)} ${y(p.achieved)}`)
      .join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${S} ${S}`} className="w-full" style={{ maxHeight: height }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,.06)" />
            <line x1={x(t)} x2={x(t)} y1={y(0)} y2={y(1)} stroke="rgba(255,255,255,.06)" />
            <text x={pad - 8} y={y(t) + 4} textAnchor="end" fontSize="9" className="fill-slate-500">
              {pct(t)}
            </text>
            <text x={x(t)} y={S - pad + 16} textAnchor="middle" fontSize="9" className="fill-slate-500">
              {pct(t)}
            </text>
          </g>
        ))}

        {/* perfect calibration */}
        <line
          x1={x(0)}
          y1={y(0)}
          x2={x(1)}
          y2={y(1)}
          stroke="rgba(255,255,255,.35)"
          strokeWidth="1.5"
          strokeDasharray="5 5"
        />
        <text x={x(0.62)} y={y(0.68)} fontSize="9" className="fill-slate-400" transform={`rotate(-45 ${x(0.62)} ${y(0.68)})`}>
          perfectly calibrated
        </text>

        <path d={line(before)} fill="none" stroke="#fb7185" strokeWidth="2.5" />
        {before.map((p) => (
          <circle key={`b${p.nominal}`} cx={x(p.nominal)} cy={y(p.achieved)} r="3.5" fill="#fb7185" />
        ))}

        <path d={line(after)} fill="none" stroke="#22c98a" strokeWidth="2.5" />
        {after.map((p) => (
          <circle key={`a${p.nominal}`} cx={x(p.nominal)} cy={y(p.achieved)} r="3.5" fill="#22c98a" />
        ))}

        <text x={S / 2} y={S - 6} textAnchor="middle" fontSize="10" className="fill-slate-400">
          stated confidence
        </text>
        <text
          x={12}
          y={S / 2}
          fontSize="10"
          className="fill-slate-400"
          transform={`rotate(-90 12 ${S / 2})`}
          textAnchor="middle"
        >
          achieved coverage
        </text>
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded bg-alert-400" /> raw model interval
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded bg-mint-500" /> after conformal correction
        </span>
        {nPoints ? <span className="ml-auto font-mono">n = {nPoints}</span> : null}
      </div>
    </div>
  );
}
