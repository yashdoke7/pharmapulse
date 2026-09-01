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
  inr,
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
      // The decision moved the shelf, so every position-derived view is stale.
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

      <div className="flex flex-wrap gap-2">
        {list.map((s) => (
          <button
            key={s.series_id}
            onClick={() => setParams({ series: s.series_id })}
            className={`border px-3 py-2 text-left text-sm transition-colors ${
              s.series_id === selected
                ? "border-signal-green bg-signal-green/[0.07] text-ink"
                : "border-line text-ink-soft hover:bg-wash"
            }`}
          >
            <div className="font-medium">{s.short_name}</div>
            <div className="font-mono text-[10px] text-ink-faint">{s.series_id}</div>
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
            <div className="panel pad">
              <div className="flex items-center justify-between">
                <div className="eyebrow">Position</div>
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

            <div className="panel pad">
              <div className="eyebrow">What the position is made of</div>
              <p className="fine mt-1">
                Settings hold the opening stock; the ledger holds every movement since.
              </p>
              <div className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between text-ink-mute">
                  <span>opening stock</span>
                  <span className="font-mono">
                    {units(stockLedger.data?.data.opening_stock ?? 0)}
                  </span>
                </div>
                {(stockLedger.data?.data.movements ?? []).slice(-6).map((m, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="text-ink-mute">
                      {m.kind} <span className="text-ink-pale">{m.ds}</span>
                    </span>
                    <span
                      className={`font-mono ${
                        m.quantity >= 0 ? "text-signal-green" : "text-signal-red"
                      }`}
                    >
                      {m.quantity >= 0 ? "+" : ""}
                      {units(m.quantity)}
                    </span>
                  </div>
                ))}
                {(stockLedger.data?.data.movements ?? []).length === 0 ? (
                  <p className="text-xs text-ink-pale">No movements recorded yet.</p>
                ) : null}
                <div className="flex justify-between border-t border-line pt-1.5 font-medium">
                  <span className="text-ink-soft">on hand</span>
                  <span className="font-mono text-ink">
                    {units(stockLedger.data?.data.stock_on_hand ?? r.stock_on_hand)}
                  </span>
                </div>
              </div>
            </div>

            <div className="panel pad">
              <div className="eyebrow">Lead-time demand</div>
              <p className="fine mt-1">
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
                      <span className="w-10 font-mono text-[11px] text-ink-faint">
                        p{Math.round(Number(q) * 100)}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden bg-wash">
                        <div
                          className={`h-full ${
                            q === "0.50" ? "bg-signal-green" : "bg-signal-green/40"
                          }`}
                          style={{ width: `${(v / max) * 100}%` }}
                        />
                      </div>
                      <span className="w-14 text-right font-mono text-xs text-ink-soft">
                        {units(v)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="panel pad">
              <div className="eyebrow">Where each input came from</div>
              <ul className="mt-3 space-y-2 text-sm">
                {r.inputs_used.map((i) => (
                  <li key={i.name} className="flex items-center justify-between gap-3">
                    <span className="text-ink-soft">{i.name}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-ink-mute">{i.value}</span>
                      <ProvenanceBadge lane={i.lane} />
                    </span>
                  </li>
                ))}
              </ul>
              <p className="fine mt-3 text-xs">
                Only <strong className="text-signal-green">measured</strong> values train the
                model. Your settings enter here, at the decision, and nowhere else.
              </p>
            </div>
          </div>
        </div>
      )}

      {toast ? (
        <div
          className="panel pad border-signal-green text-sm"
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
      <dt className="text-ink-mute">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold text-signal-green" : "text-ink"}`}>
        {value}
      </dd>
    </div>
  );
}
