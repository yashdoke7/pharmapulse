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
    <div className="space-y-6">
      <SectionTitle
        title="The forecast"
        subtitle={question}
        right={
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl border border-slate-200/70">
            {GRAINS.map((g) => (
              <button
                key={g.value}
                onClick={() => {
                  setGrain(g.value);
                  setHorizon(g.value === "day" ? 21 : g.value === "week" ? 8 : 6);
                }}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all duration-200 ${
                  grain === g.value
                    ? "bg-white text-medical-teal-deep shadow-xs"
                    : "text-slate-500 hover:text-ink"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        }
      />

      {/* Medicine pills */}
      <div className="flex flex-wrap gap-2 p-1.5 bg-slate-100/70 rounded-2xl border border-slate-200/60">
        {list.map((s) => (
          <button
            key={s.series_id}
            onClick={() => setSelected(s.series_id)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${
              s.series_id === selected
                ? "bg-white text-medical-teal-deep shadow-xs border border-medical-teal/20"
                : "text-slate-600 hover:text-ink hover:bg-white/50"
            }`}
          >
            {s.short_name}
          </button>
        ))}
      </div>

      {forecast.isError ? <ErrorCard error={forecast.error} /> : null}

      {forecast.isLoading || !data ? (
        <Loading label="Loading forecast models" />
      ) : (
        <>
          {/* Main FanChart Card */}
          <div className="panel pad">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h3 className="text-xl font-bold text-ink">{meta?.short_name}</h3>
                  <span className="text-xs text-slate-500 font-medium">{meta?.name}</span>
                  {meta ? <DemandClassChip value={meta.demand_class} /> : null}
                </div>
                <p className="fine mt-1 text-slate-500 text-xs">
                  Last observation {data.cutoff}.{" "}
                  {data.calibrated ? (
                    <span className="text-emerald-700 font-medium">
                      Intervals are conformally calibrated.
                    </span>
                  ) : (
                    ""
                  )}
                </p>
              </div>

              <label className="flex items-center text-xs font-semibold text-slate-600 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200/60">
                Horizon
                <input
                  type="range"
                  className="pp-slider ml-3 w-36 align-middle"
                  min={1}
                  max={Math.min(data.max_horizon, grain === "day" ? 28 : grain === "week" ? 12 : 6)}
                  value={horizon}
                  onChange={(e) => setHorizon(Number(e.target.value))}
                  style={{
                    background: `linear-gradient(90deg, #0F9FA8 ${
                      (horizon / (grain === "day" ? 28 : grain === "week" ? 12 : 6)) * 100
                    }%, rgba(15, 159, 168, 0.16) 0%)`,
                  }}
                />
                <span className="ml-2.5 font-mono font-bold text-medical-teal-deep text-sm">
                  {horizon}
                </span>
              </label>
            </div>

            <FanChart data={data} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Members table */}
            <div className="panel pad lg:col-span-2">
              <div className="eyebrow text-slate-500">The members behind the median</div>
              <p className="fine mt-1 text-slate-400 text-xs">
                Each represents a different assumption about how demand is generated. We
                combine them rather than picking one — measured, not asserted.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/50 text-left">
                      <th className="py-2.5 px-3 font-semibold text-xs text-slate-500 rounded-l-lg">
                        Model
                      </th>
                      {data.points.slice(0, 6).map((p) => (
                        <th key={p.ds} className="py-2.5 px-3 text-right font-semibold text-xs text-slate-500 font-mono">
                          h{p.h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100/70">
                    {data.members.map((m) => (
                      <tr key={m.model} className="hover:bg-slate-50/50 transition-colors">
                        <td className="py-2.5 px-3 text-slate-700 font-medium text-xs">{m.model}</td>
                        {m.p50.slice(0, 6).map((v, i) => (
                          <td key={i} className="py-2.5 px-3 text-right font-mono text-xs text-slate-500">
                            {units(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr className="border-t-2 border-medical-teal/30 bg-medical-cyan/20 font-bold">
                      <td className="py-3 px-3 text-medical-teal-deep text-xs flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-medical-teal" />
                        Ensemble (median)
                      </td>
                      {data.points.slice(0, 6).map((p) => (
                        <td
                          key={p.ds}
                          className="py-3 px-3 text-right font-mono text-xs font-bold text-medical-teal-deep"
                        >
                          {units(p.q["0.50"])}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Series Profile */}
            <div className="panel pad">
              <div className="eyebrow text-slate-500">Series profile</div>
              {meta ? (
                <dl className="mt-3.5 space-y-2.5 text-sm">
                  <Row label="Demand class" value={meta.demand_class} />
                  <Row label="ADI" value={meta.adi?.toFixed(2) ?? "—"} />
                  <Row label="CV²" value={meta.cv2?.toFixed(2) ?? "—"} />
                  <Row label="Daily mean" value={`${meta.daily_mean} units`} />
                  <Row label="Zero-sale days" value={`${meta.zero_day_pct ?? 0}%`} />
                  <Row label="Peak month" value={meta.peak_month} />
                </dl>
              ) : null}
              <p className="fine mt-4 text-xs text-slate-400">
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
    <div className="flex items-center justify-between gap-3 border-b border-slate-50 pb-1.5 last:border-0 last:pb-0">
      <dt className="text-slate-500 text-xs font-medium">{label}</dt>
      <dd className="font-mono font-bold text-ink text-xs">{value}</dd>
    </div>
  );
}
