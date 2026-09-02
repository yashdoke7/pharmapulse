import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { SeasonalProfile } from "../components/SeasonalProfile";
import { ErrorCard, Loading, SectionTitle } from "../components/ui";

export function Explain() {
  const [selected, setSelected] = useState("R06");

  const series = useQuery({ queryKey: ["series"], queryFn: () => api.series() });
  const explain = useQuery({
    queryKey: ["explain", selected],
    queryFn: () => api.explain(selected, "month", 1),
  });

  const list = series.data?.data.series ?? [];
  const d = explain.data?.data;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Why this number"
        subtitle="Feature-importance charts explain the model. A buyer needs an explanation of the quantity — so the answer is in units."
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

      {explain.isError ? <ErrorCard error={explain.error} /> : null}

      {explain.isLoading || !d ? (
        <Loading label="Computing attribution in units" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Attribution card */}
          <div className="panel pad">
            <div className="eyebrow text-slate-500">Attribution, in units</div>
            <h3 className="mt-2 text-xl font-bold text-ink">{d.headline}</h3>
            <p className="fine mt-1 text-slate-500 text-xs">
              Baseline <span className="font-mono font-bold text-ink">{Math.round(d.baseline_units)} units</span>. The parts below sum to the
              whole — a test asserts it, because an explanation that does not add up to
              the number it explains is worse than no explanation.
            </p>

            <div className="mt-6 space-y-4">
              {d.components.map((c) => {
                const max = Math.max(
                  ...d.components.map((x) => Math.abs(x.units)),
                  1,
                );
                const width = (Math.abs(c.units) / max) * 100;
                const positive = c.units >= 0;
                return (
                  <div key={c.name} className="rounded-xl bg-slate-50/60 p-3 border border-slate-100">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-xs font-bold capitalize text-slate-700">
                        {c.name}
                      </span>
                      <span
                        className={`font-mono text-xs font-bold ${
                          positive ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {positive ? "+" : ""}
                        {c.units.toFixed(1)} units
                      </span>
                    </div>
                    {/* Waterfall bar */}
                    <div className="mt-2 flex h-2 rounded-full overflow-hidden bg-slate-200/70">
                      <div className="flex w-1/2 justify-end">
                        {!positive ? (
                          <div
                            className="h-full rounded-l-full bg-rose-500"
                            style={{ width: `${width}%` }}
                          />
                        ) : null}
                      </div>
                      <div className="flex w-1/2">
                        {positive ? (
                          <div
                            className="h-full rounded-r-full bg-emerald-500"
                            style={{ width: `${width}%` }}
                          />
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-1.5 text-[11px] text-slate-400 leading-snug">{c.detail}</p>
                  </div>
                );
              })}
            </div>

            {/* Total Change Box */}
            <div className="mt-5 flex items-center justify-between rounded-xl border border-medical-teal/20 bg-medical-cyan/25 px-4 py-3">
              <span className="text-xs font-bold text-slate-700">Total change</span>
              <span className="font-mono text-sm font-bold text-medical-teal-deep">
                {d.total_change_units >= 0 ? "+" : ""}
                {d.total_change_units.toFixed(1)} units
              </span>
            </div>

            <p className="fine mt-4 text-xs text-slate-400">
              Method: <span className="font-mono font-medium text-slate-600">{d.method}</span>. Computed over
              observed features only — a driver that does not exist in the data cannot
              appear in an explanation, which is why price and promotion are absent.
            </p>
          </div>

          {/* Seasonal Profile card */}
          <div className="panel pad">
            <div className="eyebrow text-slate-500">When does this one actually sell?</div>
            <p className="fine mt-1 text-slate-500 text-xs">
              Every month indexed against this product&rsquo;s own average, computed from
              the observed sales file alone. 1.0 is a typical month. The seasonality
              figure on the left is read off this shape &mdash; so the claim is checkable
              here rather than taken on trust.
            </p>

            <div className="mt-5">
              <SeasonalProfile months={d.seasonal_profile ?? []} />
            </div>

            <p className="fine mt-4 text-xs text-slate-400">
              Six years of history, closure days masked and part-periods excluded. Nothing
              here is configured: the peak month is measured per product, which is why
              antihistamines and paracetamol peak six months apart and a single global
              seasonal profile would have smeared both.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
