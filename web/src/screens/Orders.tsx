import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { ServiceLevelSlider } from "../components/ServiceLevelSlider";
import {
  ErrorCard,
  Loading,
  ProvenanceBadge,
  SectionTitle,
  StatusChip,
  inr,
  pct,
  units,
} from "../components/ui";

export function Orders() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("series") ?? "N02BE";
  const [toast, setToast] = useState<string | null>(null);

  const series = useQuery({ queryKey: ["series"], queryFn: () => api.series() });
  const rec = useQuery({
    queryKey: ["recommend", selected],
    queryFn: () => api.recommend({ series_id: selected }),
  });

  const commit = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.commitOrder(body),
    onSuccess: (r) =>
      setToast(
        `Logged. Audit chain ${r.data.chain_valid ? "valid" : "BROKEN"} · ${r.data.hash}`,
      ),
    onError: (e: Error) => setToast(e.message),
  });

  if (rec.isError) return <ErrorCard error={rec.error} />;

  const list = series.data?.data.series ?? [];
  const r = rec.data?.data;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Orders & Risk"
        subtitle="A demand distribution, your costs, and the quantity that minimises the total."
      />

      <div className="flex flex-wrap gap-2">
        {list.map((s) => (
          <button
            key={s.series_id}
            onClick={() => setParams({ series: s.series_id })}
            className={`rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
              s.series_id === selected
                ? "border-mint-500/40 bg-mint-500/10 text-white"
                : "border-white/10 text-slate-300 hover:bg-white/5"
            }`}
          >
            <div className="font-medium">{s.short_name}</div>
            <div className="font-mono text-[10px] text-slate-500">{s.series_id}</div>
          </button>
        ))}
      </div>

      {rec.isLoading || !r ? (
        <Loading />
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ServiceLevelSlider
              rec={r}
              onCommit={(level, quantity) =>
                commit.mutate({
                  series_id: r.series_id,
                  recommended: r.order_quantity,
                  accepted: quantity,
                  service_level: level,
                  reason:
                    quantity === r.order_quantity
                      ? ""
                      : `buyer moved the service level to ${pct(level, 1)}`,
                })
              }
            />
          </div>

          <div className="space-y-5">
            <div className="card card-pad">
              <div className="flex items-center justify-between">
                <div className="label">Position</div>
                <StatusChip status={r.status} />
              </div>
              <dl className="mt-3 space-y-2.5 text-sm">
                <Row label="On hand" value={`${units(r.stock_on_hand)} units`} />
                <Row label="Reorder point" value={`${units(r.reorder_point)} units`} />
                <Row label="Days of cover" value={`${r.days_of_cover.toFixed(1)} days`} />
                <Row
                  label="Runs out"
                  value={r.projected_stockout_date ?? "not inside the horizon"}
                />
                <Row label="Target level" value={`${units(r.target_level)} units`} />
                <Row
                  label="Recommended"
                  value={`${r.order_quantity} units (${r.order_packs} packs)`}
                  strong
                />
              </dl>
            </div>

            <div className="card card-pad">
              <div className="label">Lead-time demand</div>
              <p className="subtle mt-1">
                The distribution the order is read from, over your{" "}
                {r.inputs_used.find((i) => i.name === "lead time")?.value ?? "lead time"}.
              </p>
              <div className="mt-3 space-y-1.5 text-sm">
                {["0.05", "0.25", "0.50", "0.75", "0.95"].map((q) => {
                  const v = r.lead_time_demand[q];
                  if (v === undefined) return null;
                  const max = r.lead_time_demand["0.95"] ?? 1;
                  return (
                    <div key={q} className="flex items-center gap-3">
                      <span className="w-10 font-mono text-[11px] text-slate-500">
                        p{Math.round(Number(q) * 100)}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                        <div
                          className={`h-full rounded-full ${
                            q === "0.50" ? "bg-mint-500" : "bg-mint-500/40"
                          }`}
                          style={{ width: `${(v / max) * 100}%` }}
                        />
                      </div>
                      <span className="w-14 text-right font-mono text-xs text-slate-300">
                        {units(v)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card card-pad">
              <div className="label">Where each input came from</div>
              <ul className="mt-3 space-y-2 text-sm">
                {r.inputs_used.map((i) => (
                  <li key={i.name} className="flex items-center justify-between gap-3">
                    <span className="text-slate-300">{i.name}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-400">{i.value}</span>
                      <ProvenanceBadge lane={i.lane} />
                    </span>
                  </li>
                ))}
              </ul>
              <p className="subtle mt-3 text-xs">
                Only <strong className="text-mint-400">measured</strong> values train the
                model. Your settings enter here, at the decision, and nowhere else.
              </p>
            </div>
          </div>
        </div>
      )}

      {toast ? (
        <div
          className="card card-pad border-mint-500/30 text-sm"
          onClick={() => setToast(null)}
          role="status"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold text-mint-400" : "text-slate-200"}`}>
        {value}
      </dd>
    </div>
  );
}
