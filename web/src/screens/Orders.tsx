import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  pct,
  units,
} from "../components/ui";

export function Orders() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("series") ?? "N02BE";
  const [toast, setToast] = useState<string | null>(null);
  const qc = useQueryClient();

  const series = useQuery({ queryKey: ["series"], queryFn: () => api.series() });
  const rec = useQuery({
    queryKey: ["recommend", selected],
    queryFn: () => api.recommend({ series_id: selected }),
  });

  const stockLedger = useQuery({
    queryKey: ["ledger", selected],
    queryFn: () => api.ledger(selected),
  });

  const commit = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.commitOrder(body),
    onSuccess: (r) => {
      setToast(
        `Received ${r.data.received} units — on hand is now ${r.data.stock_on_hand}. ` +
          `Audit chain ${r.data.chain_valid ? "valid" : "BROKEN"} (${r.data.hash.slice(0, 8)}).`,
      );
      qc.invalidateQueries();
    },
    onError: (e: Error) => setToast(e.message),
  });

  if (rec.isError) return <ErrorCard error={rec.error} />;

  const list = series.data?.data.series ?? [];
  const r = rec.data?.data;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="The order"
        subtitle="A demand distribution, your costs, and the quantity that minimises the total cost of being wrong."
      />

      {/* Medicine Selector Pills */}
      <div className="flex flex-wrap gap-2 p-1.5 bg-slate-100/70 rounded-2xl border border-slate-200/60">
        {list.map((s) => {
          const active = s.series_id === selected;
          return (
            <button
              key={s.series_id}
              onClick={() => setParams({ series: s.series_id })}
              className={`px-3.5 py-2 rounded-xl text-left text-xs transition-all duration-200 ${
                active
                  ? "bg-white text-medical-teal-deep shadow-xs font-semibold border border-medical-teal/20"
                  : "text-slate-600 hover:text-ink hover:bg-white/50"
              }`}
            >
              <div className="font-semibold">{s.short_name}</div>
              <div className="font-mono text-[10px] text-slate-400">{s.series_id}</div>
            </button>
          );
        })}
      </div>

      {rec.isLoading || !r ? (
        <Loading label="Computing optimal order" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
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
            {/* Position Card */}
            <div className="panel pad">
              <div className="flex items-center justify-between">
                <div className="eyebrow text-slate-500">Current Position</div>
                <StatusChip status={r.status} />
              </div>
              <dl className="mt-3.5 space-y-2.5 text-sm">
                <Row label="On hand" value={`${units(r.stock_on_hand)} units`} />
                <Row label="Reorder point" value={`${units(r.reorder_point)} units`} />
                <Row label="Days of cover" value={`${r.days_of_cover.toFixed(1)} days`} />
                <Row
                  label="Runs out"
                  value={r.projected_stockout_date ?? "not inside horizon"}
                />
                <Row label="Target level" value={`${units(r.target_level)} units`} />
                <Row
                  label="Recommended"
                  value={`${r.order_quantity} units (${r.order_packs} packs)`}
                  strong
                />
              </dl>
            </div>

            {/* Ledger breakdown card */}
            <div className="panel pad">
              <div className="eyebrow text-slate-500">What the position is made of</div>
              <p className="fine mt-1 text-slate-400 text-xs">
                Settings hold the opening stock; the ledger holds every movement since.
              </p>
              <div className="mt-3 space-y-2 text-xs sm:text-sm">
                <div className="flex justify-between text-slate-500">
                  <span>opening stock</span>
                  <span className="font-mono font-medium">
                    {units(stockLedger.data?.data.opening_stock ?? 0)}
                  </span>
                </div>
                {(stockLedger.data?.data.movements ?? []).slice(-6).map((m, i) => (
                  <div key={i} className="flex justify-between items-center py-0.5">
                    <span className="text-slate-500 flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                      {m.kind} <span className="text-slate-400 font-mono text-[11px]">{m.ds}</span>
                    </span>
                    <span
                      className={`font-mono font-bold ${
                        m.quantity >= 0 ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {m.quantity >= 0 ? "+" : ""}
                      {units(m.quantity)}
                    </span>
                  </div>
                ))}
                {(stockLedger.data?.data.movements ?? []).length === 0 ? (
                  <p className="text-xs text-slate-400">No movements recorded yet.</p>
                ) : null}
                <div className="flex justify-between border-t border-slate-100 pt-2 font-semibold">
                  <span className="text-slate-700">on hand</span>
                  <span className="font-mono text-ink text-sm">
                    {units(stockLedger.data?.data.stock_on_hand ?? r.stock_on_hand)}
                  </span>
                </div>
              </div>
            </div>

            {/* Lead-time demand card */}
            <div className="panel pad">
              <div className="eyebrow text-slate-500">Lead-time demand</div>
              <p className="fine mt-1 text-slate-400 text-xs">
                The distribution the order is read from, over your{" "}
                <strong className="text-slate-600">
                  {r.inputs_used.find((i) => i.name === "lead time")?.value ?? "lead time"}
                </strong>.
              </p>
              <div className="mt-3.5 space-y-2 text-sm">
                {["0.05", "0.25", "0.50", "0.75", "0.95"].map((q) => {
                  const v = r.lead_time_demand[q];
                  if (v === undefined) return null;
                  const max = r.lead_time_demand["0.95"] ?? 1;
                  return (
                    <div key={q} className="flex items-center gap-3">
                      <span className="w-10 font-mono text-xs font-semibold text-slate-400">
                        p{Math.round(Number(q) * 100)}
                      </span>
                      <div className="h-2.5 flex-1 rounded-full overflow-hidden bg-slate-100">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            q === "0.50" ? "bg-medical-teal" : "bg-medical-teal/40"
                          }`}
                          style={{ width: `${(v / max) * 100}%` }}
                        />
                      </div>
                      <span className="w-14 text-right font-mono text-xs font-bold text-slate-700">
                        {units(v)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Input Provenance card */}
            <div className="panel pad">
              <div className="eyebrow text-slate-500">Where each input came from</div>
              <ul className="mt-3 space-y-2.5 text-sm">
                {r.inputs_used.map((i) => (
                  <li key={i.name} className="flex items-center justify-between gap-3 border-b border-slate-50 pb-1.5 last:border-0 last:pb-0">
                    <span className="text-slate-600 font-medium capitalize text-xs">{i.name}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-700">{i.value}</span>
                      <ProvenanceBadge lane={i.lane} />
                    </span>
                  </li>
                ))}
              </ul>
              <p className="fine mt-3 text-xs text-slate-400">
                Only <strong className="text-medical-teal-deep">measured</strong> values train the
                model. Your settings enter here, at the decision, and nowhere else.
              </p>
            </div>
          </div>
        </div>
      )}

      {toast ? (
        <div
          className="rounded-2xl border border-emerald-300 bg-emerald-50/90 p-4 text-sm text-emerald-800 shadow-sm cursor-pointer flex items-center justify-between gap-3"
          onClick={() => setToast(null)}
          role="status"
        >
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>{toast}</span>
          </div>
          <span className="text-xs text-emerald-600 font-semibold underline">dismiss</span>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-50 pb-1 last:border-0 last:pb-0">
      <dt className="text-slate-500 text-xs font-medium">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-bold text-medical-teal-deep text-sm" : "text-ink font-semibold"}`}>
        {value}
      </dd>
    </div>
  );
}
