/**
 * A product's own month-by-month demand index, from observed sales only.
 * Modern healthcare visualization with rounded bars and clear peak/low highlights.
 */

interface Month {
  month: number;
  label: string;
  index: number;
  n_years: number;
}

export function SeasonalProfile({ months }: { months: Month[] }) {
  if (!months.length) return null;

  const hi = Math.max(...months.map((m) => m.index), 1.2);
  const peak = months.reduce((a, b) => (b.index > a.index ? b : a));
  const low = months.reduce((a, b) => (b.index < a.index ? b : a));

  const W = 560;
  const H = 210;
  const pad = { top: 18, right: 12, bottom: 32, left: 38 };
  const bw = (W - pad.left - pad.right) / 12;
  const y = (v: number) =>
    pad.top + (1 - v / hi) * (H - pad.top - pad.bottom);
  const baseY = y(1);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" style={{ height: 210 }}>
        {/* Grid lines */}
        {[0.5, 1, 1.5].map((g) =>
          g <= hi ? (
            <g key={g}>
              <line
                x1={pad.left}
                x2={W - pad.right}
                y1={y(g)}
                y2={y(g)}
                stroke="rgba(15, 159, 168, 0.15)"
                strokeWidth={g === 1 ? 1.5 : 1}
                strokeDasharray={g === 1 ? "none" : "3 3"}
              />
              <text
                x={pad.left - 8}
                y={y(g) + 3.5}
                textAnchor="end"
                fontSize="9.5"
                className="fill-slate-400 font-mono"
              >
                {g.toFixed(1)}
              </text>
            </g>
          ) : null,
        )}

        {/* 1.0 Baseline label */}
        <text
          x={W - pad.right + 4}
          y={baseY + 3}
          fontSize="8.5"
          className="fill-slate-400 font-mono font-medium"
        >
          avg (1.0)
        </text>

        {/* Monthly bars */}
        {months.map((m, i) => {
          const x = pad.left + i * bw;
          const top = y(m.index);
          const isPeak = m.month === peak.month;
          const isLow = m.month === low.month;
          const above = m.index >= 1;
          const barHeight = Math.max(Math.abs(baseY - top), 2);
          const barY = above ? top : baseY;

          const fillColor = isPeak
            ? "#E11D48" // Rose / peak
            : isLow
              ? "#2F80ED" // Blue / low
              : "#0F9FA8"; // Teal / normal

          return (
            <g key={m.month} className="group">
              <rect
                x={x + bw * 0.15}
                y={barY}
                width={bw * 0.70}
                height={barHeight}
                rx={4}
                fill={fillColor}
                opacity={isPeak || isLow ? 0.95 : 0.45}
                className="transition-opacity duration-200 hover:opacity-100 cursor-pointer"
              />
              <text
                x={x + bw / 2}
                y={H - pad.bottom + 15}
                textAnchor="middle"
                fontSize="9.5"
                className={`font-mono font-medium ${
                  isPeak
                    ? "fill-rose-600 font-bold"
                    : isLow
                      ? "fill-blue-600 font-bold"
                      : "fill-slate-400"
                }`}
              >
                {m.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <span className="inline-flex items-center gap-1.5 bg-rose-50 text-rose-700 px-2.5 py-1 rounded-lg border border-rose-200/60 font-medium">
          <span className="h-2 w-2 rounded-full bg-rose-500" />
          Peaks in <strong className="text-rose-900">{peak.label}</strong> at{" "}
          <span className="font-mono font-bold">{peak.index.toFixed(2)}×</span> average
        </span>
        <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg border border-blue-200/60 font-medium">
          <span className="h-2 w-2 rounded-full bg-blue-500" />
          Bottoms in <strong className="text-blue-900">{low.label}</strong> at{" "}
          <span className="font-mono font-bold">{low.index.toFixed(2)}×</span> average
        </span>
      </div>
    </div>
  );
}
