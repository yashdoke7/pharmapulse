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
    <div className="space-y-5">
      <SectionTitle
        title="Why this number"
        subtitle="Feature-importance charts explain the model. A buyer needs an explanation of the quantity — so the answer is in units."
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

      {explain.isError ? <ErrorCard error={explain.error} /> : null}

      {explain.isLoading || !d ? (
        <Loading label="Computing attribution" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="panel pad">
            <div className="eyebrow">Attribution, in units</div>
            <h3 className="mt-2 text-xl font-semibold text-ink">{d.headline}</h3>
            <p className="fine mt-1">
              Baseline {Math.round(d.baseline_units)} units. The parts below sum to the
              whole — a test asserts it, because an explanation that does not add up to
              the number it explains is worse than no explanation.
            </p>

            <div className="mt-5 space-y-3">
              {d.components.map((c) => {
                const max = Math.max(
                  ...d.components.map((x) => Math.abs(x.units)),
                  1,
                );
                const width = (Math.abs(c.units) / max) * 100;
                const positive = c.units >= 0;
                return (
                  <div key={c.name}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium capitalize text-ink">
                        {c.name}
                      </span>
                      <span
                        className={`font-mono text-sm ${
                          positive ? "text-signal-green" : "text-signal-red"
                        }`}
                      >
                        {positive ? "+" : ""}
                        {c.units.toFixed(1)} units
                      </span>
                    </div>
                    <div className="mt-1.5 flex h-2 overflow-hidden bg-wash">
                      <div className="flex w-1/2 justify-end">
                        {!positive ? (
                          <div
                            className="h-full bg-signal-red"
                            style={{ width: `${width}%` }}
                          />
                        ) : null}
                      </div>
                      <div className="flex w-1/2">
                        {positive ? (
                          <div
                            className="h-full bg-signal-green"
                            style={{ width: `${width}%` }}
                          />
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-ink-faint">{c.detail}</p>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 flex items-center justify-between border border-line bg-paper-sunk px-3 py-2.5">
              <span className="text-sm text-ink-soft">Total change</span>
              <span className="font-mono font-semibold text-ink">
                {d.total_change_units >= 0 ? "+" : ""}
                {d.total_change_units.toFixed(1)} units
              </span>
            </div>

            <p className="fine mt-3 text-xs">
              Method: <span className="font-mono">{d.method}</span>. Computed over
              observed features only — a driver that does not exist in the data cannot
              appear in an explanation, which is why price and promotion are absent.
            </p>
          </div>

          {/* Was the reliability diagram, which is a GLOBAL result and so was
              byte-identical on all eight products - a panel that does not
              change when you change the subject is not about the subject. It
              lives on Evidence now. This is per-medicine, and it is the
              evidence for the seasonality line in the panel to the left. */}
          <div className="panel pad">
            <div className="eyebrow">When does this one actually sell?</div>
            <p className="fine mt-1">
              Every month indexed against this product&rsquo;s own average, computed from
              the observed sales file alone. 1.0 is a typical month. The seasonality
              figure on the left is read off this shape &mdash; so the claim is checkable
              here rather than taken on trust.
            </p>

            <div className="mt-4">
              <SeasonalProfile months={d.seasonal_profile ?? []} />
            </div>

            <p className="fine mt-3 text-xs">
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
