import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { ReliabilityDiagram } from "../components/ReliabilityDiagram";
import { ErrorCard, Loading, SectionTitle, pct } from "../components/ui";

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

          <div className="panel pad">
            <div className="eyebrow">Are our confidence intervals honest?</div>
            <p className="fine mt-1">
              We measured our own intervals against what actually happened. The raw model
              band covered{" "}
              <strong className="text-signal-red">
                {pct(d.calibration.achieved_before ?? 0, 1)}
              </strong>{" "}
              of outcomes at a stated {pct(d.calibration.nominal)} — so it was too{" "}
              {(d.calibration.achieved_before ?? 0) > d.calibration.nominal
                ? "wide, which causes over-ordering and ties up capital"
                : "narrow, which silently under-orders"}
              . Conformal correction pulls it to{" "}
              <strong className="text-signal-green">
                {pct(d.calibration.achieved_after ?? 0, 1)}
              </strong>
              .
            </p>

            <div className="mt-4">
              <ReliabilityDiagram
                before={d.calibration.before}
                after={d.calibration.after}
                nPoints={d.calibration.n_points}
              />
            </div>

            <p className="fine mt-3 text-xs">
              {d.calibration.n_points} points is enough to establish a consistent
              direction of miscalibration, and not enough to certify a per-series level.
              Stated rather than glossed over.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
