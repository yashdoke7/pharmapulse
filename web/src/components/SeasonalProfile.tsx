/**
 * A product's own month-by-month demand index, from observed sales only.
 *
 * This panel replaced the reliability diagram, which was identical on all
 * eight products because it is a GLOBAL calibration result - it belongs on
 * Evidence, not on a per-medicine screen.
 *
 * It also carries the weight of the seasonality claim above it. Saying
 * "coming off its May peak" and then showing the May bar at 1.74 is the
 * difference between an assertion and evidence a reader can check.
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
  const pad = { top: 14, right: 10, bottom: 30, left: 34 };
  const bw = (W - pad.left - pad.right) / 12;
  const y = (v: number) =>
    pad.top + (1 - v / hi) * (H - pad.top - pad.bottom);
  const baseY = y(1);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 210 }}>
        {[0.5, 1, 1.5].map((g) =>
          g <= hi ? (
            <g key={g}>
              <line
                x1={pad.left}
                x2={W - pad.right}
                y1={y(g)}
                y2={y(g)}
                stroke={g === 1 ? "#14110D" : "#14110D"}
                strokeWidth={g === 1 ? 1 : 0.5}
                strokeDasharray={g === 1 ? "none" : "3 3"}
                opacity={g === 1 ? 0.45 : 0.15}
              />
              <text
                x={pad.left - 6}
                y={y(g) + 3}
                textAnchor="end"
                fontSize="9"
                fill="#9A9287"
              >
                {g.toFixed(1)}
              </text>
            </g>
          ) : null,
        )}

        {months.map((m, i) => {
          const x = pad.left + i * bw;
          const top = y(m.index);
          const isPeak = m.month === peak.month;
          const isLow = m.month === low.month;
          const above = m.index >= 1;
          return (
            <g key={m.month}>
              <rect
                x={x + bw * 0.16}
                y={above ? top : baseY}
                width={bw * 0.68}
                height={Math.max(Math.abs(baseY - top), 1)}
                fill={isPeak ? "#A32E22" : isLow ? "#1C4E7A" : "#14110D"}
                opacity={isPeak || isLow ? 0.9 : 0.26}
              />
              <text
                x={x + bw / 2}
                y={H - pad.bottom + 13}
                textAnchor="middle"
                fontSize="9"
                fill={isPeak || isLow ? "#3B362F" : "#9A9287"}
              >
                {m.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs">
        <span>
          <span className="text-signal-red">▍</span> peaks in{" "}
          <strong className="text-ink">{peak.label}</strong> at{" "}
          <span className="font-mono">{peak.index.toFixed(2)}×</span> its own average
        </span>
        <span>
          <span className="text-signal-blue">▍</span> bottoms in{" "}
          <strong className="text-ink">{low.label}</strong> at{" "}
          <span className="font-mono">{low.index.toFixed(2)}×</span>
        </span>
      </div>
    </div>
  );
}
