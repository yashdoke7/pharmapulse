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
        title="Forecast Center"
        subtitle={question}
        right={
          <div className="flex items-center gap-1 rounded-xl border border-white/10 p-1">
            {GRAINS.map((g) => (
              <button
                key={g.value}
                onClick={() => {
                  setGrain(g.value);
                  setHorizon(g.value === "day" ? 21 : g.value === "week" ? 8 : 6);
                }}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  grain === g.value
                    ? "bg-white/10 text-white"
                    : "text-slate-400 hover:text-slate-200"
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
            className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
              s.series_id === selected
                ? "border-mint-500/40 bg-mint-500/10 text-white"
                : "border-white/10 text-slate-300 hover:bg-white/5"
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
          <div className="card card-pad">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-white">{meta?.name}</h3>
                  {meta ? <DemandClassChip value={meta.demand_class} /> : null}
                </div>
                <p className="subtle mt-1">
                  Last observation {data.cutoff}. {data.calibrated ? "Intervals are conformally calibrated." : ""}
                </p>
              </div>
              <label className="text-sm text-slate-400">
                Horizon
                <input
                  type="range"
                  className="pp-slider ml-3 w-40 align-middle"
                  min={1}
                  max={Math.min(data.max_horizon, grain === "day" ? 28 : grain === "week" ? 12 : 6)}
                  value={horizon}
                  onChange={(e) => setHorizon(Number(e.target.value))}
                  style={{
                    background: `linear-gradient(90deg,#22c98a ${(horizon / (grain === "day" ? 28 : grain === "week" ? 12 : 6)) * 100}%, rgba(255,255,255,.12) 0%)`,
                  }}
                />
                <span className="ml-2 font-mono text-white">{horizon}</span>
              </label>
            </div>

            <FanChart data={data} />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="card card-pad lg:col-span-2">
              <div className="label">The members behind the median</div>
              <p className="subtle mt-1">
                Each represents a different assumption about how demand is generated. We
                combine them rather than picking one — measured, not asserted.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left">
                      <th className="py-2 font-medium text-slate-400">Model</th>
                      {data.points.slice(0, 6).map((p) => (
                        <th key={p.ds} className="py-2 text-right font-medium text-slate-400">
                          h{p.h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.members.map((m) => (
                      <tr key={m.model} className="border-b border-white/5 last:border-0">
                        <td className="py-2 text-slate-300">{m.model}</td>
                        {m.p50.slice(0, 6).map((v, i) => (
                          <td key={i} className="py-2 text-right font-mono text-slate-400">
                            {units(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr className="border-t border-white/10">
                      <td className="py-2 font-semibold text-mint-400">Ensemble (median)</td>
                      {data.points.slice(0, 6).map((p) => (
                        <td
                          key={p.ds}
                          className="py-2 text-right font-mono font-semibold text-mint-400"
                        >
                          {units(p.q["0.50"])}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card card-pad">
              <div className="label">Series profile</div>
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
              <p className="subtle mt-4 text-xs">
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
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-mono text-slate-200">{value}</dd>
    </div>
  );
}
