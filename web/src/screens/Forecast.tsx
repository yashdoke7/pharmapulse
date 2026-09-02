import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import type { Grain } from "../api/types";
import { FanChart } from "../components/FanChart";
import {
  DemandClassChip,
  ErrorCard,
  Loading,
  SectionTitle,
  units,
} from "../components/ui";

const GRAINS: { value: Grain; label: string; question: string }[] = [
  { value: "day", label: "Daily", question: "Will I run out before the next delivery?" },
  { value: "week", label: "Weekly", question: "What do I order on Tuesday?" },
  { value: "month", label: "Monthly", question: "How much cash do I need, and when?" },
];

export function Forecast() {
  const [selected, setSelected] = useState("N02BE");
  const [grain, setGrain] = useState<Grain>("week");
  const [horizon, setHorizon] = useState(8);

  const series = useQuery({ queryKey: ["series"], queryFn: () => api.series() });
  const forecast = useQuery({
    queryKey: ["forecast", selected, grain, horizon],
    queryFn: () => api.forecast(selected, grain, horizon),
  });

  const list = series.data?.data.series ?? [];
  const meta = list.find((s) => s.series_id === selected);
  const data = forecast.data?.data;
  const question = GRAINS.find((g) => g.value === grain)?.question;

  return (
    <div className="space-y-5">
      <SectionTitle
        title="The forecast"
        subtitle={question}
        right={
          <div className="flex items-center gap-1 border border-line p-1">
            {GRAINS.map((g) => (
              <button
                key={g.value}
                onClick={() => {
                  setGrain(g.value);
                  setHorizon(g.value === "day" ? 21 : g.value === "week" ? 8 : 6);
                }}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  grain === g.value
                    ? "bg-wash-strong text-ink"
                    : "text-ink-mute hover:text-ink"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        {list.map((s) => (
          <button
            key={s.series_id}
            onClick={() => setSelected(s.series_id)}
            className={`border px-3 py-2 text-sm transition-colors ${
              s.series_id === selected
                ? "border-signal-green bg-signal-green/[0.07] text-ink"
                : "border-line text-ink-soft hover:bg-wash"
            }`}
          >
            {s.short_name}
          </button>
        ))}
      </div>

      {forecast.isError ? <ErrorCard error={forecast.error} /> : null}

      {forecast.isLoading || !data ? (
        <Loading label="Loading forecast" />
      ) : (
        <>
          <div className="panel pad">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  {/* The tab says "Paracetamol", so the card has to as well. The ATC
                      class is the secondary label, not the headline - a buyer does
                      not shop by "Anilides". */}
                  <h3 className="text-lg font-semibold text-ink">{meta?.short_name}</h3>
                  <span className="fine">{meta?.name}</span>
                  {meta ? <DemandClassChip value={meta.demand_class} /> : null}
                </div>
                <p className="fine mt-1">
                  Last observation {data.cutoff}. {data.calibrated ? "Intervals are conformally calibrated." : ""}
                </p>
              </div>
              <label className="text-sm text-ink-mute">
                Horizon
                <input
                  type="range"
                  className="pp-slider ml-3 w-40 align-middle"
                  min={1}
                  max={Math.min(data.max_horizon, grain === "day" ? 28 : grain === "week" ? 12 : 6)}
                  value={horizon}
                  onChange={(e) => setHorizon(Number(e.target.value))}
                  style={{
                    background: `linear-gradient(90deg,#14110D ${(horizon / (grain === "day" ? 28 : grain === "week" ? 12 : 6)) * 100}%, rgba(20,17,13,.14) 0%)`,
                  }}
                />
                <span className="ml-2 font-mono text-ink">{horizon}</span>
              </label>
            </div>

            <FanChart data={data} />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="panel pad lg:col-span-2">
              <div className="eyebrow">The members behind the median</div>
              <p className="fine mt-1">
                Each represents a different assumption about how demand is generated. We
                combine them rather than picking one — measured, not asserted.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left">
                      <th className="py-2 font-medium text-ink-mute">Model</th>
                      {data.points.slice(0, 6).map((p) => (
                        <th key={p.ds} className="py-2 text-right font-medium text-ink-mute">
                          h{p.h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.members.map((m) => (
                      <tr key={m.model} className="border-b border-line-soft last:border-0">
                        <td className="py-2 text-ink-soft">{m.model}</td>
                        {m.p50.slice(0, 6).map((v, i) => (
                          <td key={i} className="py-2 text-right font-mono text-ink-mute">
                            {units(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr className="border-t border-line">
                      <td className="py-2 font-semibold text-signal-green">Ensemble (median)</td>
                      {data.points.slice(0, 6).map((p) => (
                        <td
                          key={p.ds}
                          className="py-2 text-right font-mono font-semibold text-signal-green"
                        >
                          {units(p.q["0.50"])}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel pad">
              <div className="eyebrow">Series profile</div>
              {meta ? (
                <dl className="mt-3 space-y-2.5 text-sm">
                  <Row label="Demand class" value={meta.demand_class} />
                  <Row label="ADI" value={meta.adi?.toFixed(2) ?? "—"} />
                  <Row label="CV²" value={meta.cv2?.toFixed(2) ?? "—"} />
                  <Row label="Daily mean" value={`${meta.daily_mean} units`} />
                  <Row label="Zero-sale days" value={`${meta.zero_day_pct ?? 0}%`} />
                  <Row label="Peak month" value={meta.peak_month} />
                </dl>
              ) : null}
              <p className="fine mt-4 text-xs">
                The demand class is computed nightly from ADI and CV², not configured.
                When a product's behaviour changes, its model family changes with it.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-mute">{label}</dt>
      <dd className="font-mono text-ink">{value}</dd>
    </div>
  );
}
