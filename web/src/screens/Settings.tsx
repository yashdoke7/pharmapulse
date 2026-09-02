import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Settings as SettingsType } from "../api/types";
import {
  ErrorCard,
  Loading,
  ProvenanceBadge,
  SectionTitle,
  pct,
} from "../components/ui";

/**
 * Lane 2: the pharmacy's own operational parameters.
 * Redesigned with clinical parameter sliders and editable inventory table.
 */

const GLOBAL_FIELDS: {
  key: keyof SettingsType;
  label: string;
  help: string;
  step: number;
  min: number;
  max: number;
  asPercent?: boolean;
}[] = [
  {
    key: "lead_time_days",
    label: "Lead time (days)",
    help: "How long a delivery takes. Widens the demand window the order must cover.",
    step: 1,
    min: 1,
    max: 60,
  },
  {
    key: "review_period_days",
    label: "Review period (days)",
    help: "How often you place orders. Added to the lead time to give the protection interval.",
    step: 1,
    min: 1,
    max: 60,
  },
  {
    key: "holding_cost_rate",
    label: "Holding cost (annual)",
    help: "Capital, storage, insurance and shrinkage. Raises Co, which lowers q*.",
    step: 0.01,
    min: 0,
    max: 2,
    asPercent: true,
  },
  {
    key: "expiry_risk_rate",
    label: "Expiry write-off",
    help: "Fraction of stock expected to expire unsold. Also raises Co.",
    step: 0.005,
    min: 0,
    max: 1,
    asPercent: true,
  },
  {
    key: "service_level_default",
    label: "Default service level",
    help: "Where the slider starts. Leave unset to use q* from your costs.",
    step: 0.01,
    min: 0.05,
    max: 0.99,
    asPercent: true,
  },
];

export function Settings() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.settings(),
  });

  const [draft, setDraft] = useState<SettingsType | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data?.data) setDraft(structuredClone(data.data));
  }, [data]);

  const save = useMutation({
    mutationFn: (patch: Partial<SettingsType>) => api.saveSettings(patch),
    onSuccess: () => {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
      qc.invalidateQueries();
    },
  });

  if (isError) return <ErrorCard error={error} />;
  if (isLoading || !draft) return <Loading label="Loading operational parameters" />;

  const protection = draft.lead_time_days + draft.review_period_days;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Your numbers"
        subtitle="Lane 2 — the parameters only your pharmacy knows. They shape every order quantity and they never train a model."
        right={
          <div className="flex items-center gap-3">
            {saved ? (
              <span className="chip bg-emerald-50 text-emerald-700 border-emerald-300 font-semibold shadow-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                saved
              </span>
            ) : null}
            <button
              className="btn-primary shadow-sm hover:shadow-glow px-5 py-2.5"
              onClick={() => save.mutate(draft)}
              disabled={save.isPending}
            >
              {save.isPending ? "Saving…" : "Save Settings"}
            </button>
          </div>
        }
      />

      {/* Lane 2 Credibility Notice */}
      <div className="panel pad border border-medical-teal/20 bg-gradient-to-r from-white via-white to-medical-cyan/25">
        <div className="flex flex-wrap items-center gap-3">
          <ProvenanceBadge lane="user_setting" />
          <p className="fine max-w-3xl text-xs sm:text-sm text-slate-600">
            Everything on this page is <strong className="text-ink font-bold">lane 2</strong>.
            No inventory system knows a pharmacy's cost of capital — all of them ask. These
            values enter at the decision engine and nowhere else, so no fitted coefficient
            can ever depend on them.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Across all products */}
        <div className="panel pad lg:col-span-2">
          <div className="eyebrow text-slate-500">Across all products</div>
          <div className="mt-5 space-y-6">
            {GLOBAL_FIELDS.map((f) => {
              const value = draft[f.key] as number;
              return (
                <div key={String(f.key)} className="rounded-2xl bg-slate-50/60 p-4 border border-slate-100">
                  <div className="flex items-baseline justify-between gap-3">
                    <label className="text-xs font-bold text-slate-700">{f.label}</label>
                    <span className="font-mono text-sm font-bold text-medical-teal-deep">
                      {f.asPercent ? pct(value, 1) : value}
                    </span>
                  </div>
                  <input
                    type="range"
                    className="pp-slider mt-2.5 w-full"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={value}
                    onChange={(e) =>
                      setDraft({ ...draft, [f.key]: Number(e.target.value) })
                    }
                    style={{
                      background: `linear-gradient(90deg, #0F9FA8 ${
                        ((value - f.min) / (f.max - f.min)) * 100
                      }%, rgba(15, 159, 168, 0.16) ${
                        ((value - f.min) / (f.max - f.min)) * 100
                      }%)`,
                    }}
                  />
                  <p className="mt-1.5 text-[11px] text-slate-400 leading-snug">{f.help}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Implications */}
        <div className="panel pad">
          <div className="eyebrow text-slate-500">What this implies</div>
          <dl className="mt-4 space-y-3 text-sm">
            <Row
              label="Protection interval"
              value={`${protection} days`}
              hint="lead time + review period"
            />
            <Row
              label="Currency"
              value={draft.currency}
            />
          </dl>
          <div className="mt-5 rounded-xl bg-medical-cyan/25 p-3.5 border border-medical-teal/20 text-xs text-slate-600 leading-relaxed">
            An order has to survive the protection interval, not just the lead time: once
            you have ordered you cannot order again until the next review, so today's
            order must cover demand until the order after next arrives.
          </div>
        </div>
      </div>

      {/* Per product table */}
      <div className="panel overflow-hidden">
        <div className="border-b border-slate-100 px-5 sm:px-6 py-3.5 bg-slate-50/50">
          <div className="eyebrow text-slate-600">Per product operational parameters</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/30 text-left">
                {["Product", "Pack size", "Unit cost", "Unit margin", "Stock on hand", "Lead time", "q*"].map(
                  (h) => (
                    <th key={h} className="px-4 py-2.5 font-semibold text-xs text-slate-500">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/70">
              {Object.entries(draft.per_series).map(([sid, s]) => {
                const cu = s.unit_margin;
                const lead = s.lead_time_days ?? draft.lead_time_days;
                const hold = s.holding_cost_rate ?? draft.holding_cost_rate;
                const expiry = s.expiry_risk_rate ?? draft.expiry_risk_rate;
                const co = s.unit_cost * hold * (lead / 365) + s.unit_cost * expiry;
                const qStar = cu / (cu + co);
                return (
                  <tr key={sid} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-xs font-bold text-slate-700">{sid}</td>
                    {(["pack_size", "unit_cost", "unit_margin", "stock_on_hand"] as const).map(
                      (field) => (
                        <td key={field} className="px-4 py-2.5">
                          <input
                            type="number"
                            className="w-24 rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1 text-right font-mono text-xs font-medium text-ink focus:border-medical-teal focus:bg-white focus:outline-none transition-colors"
                            value={s[field]}
                            step={field === "pack_size" ? 1 : 0.5}
                            min={0}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                per_series: {
                                  ...draft.per_series,
                                  [sid]: { ...s, [field]: Number(e.target.value) },
                                },
                              })
                            }
                          />
                        </td>
                      ),
                    )}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          className={`w-16 rounded-lg border px-2 py-1 text-right font-mono text-xs font-medium focus:border-medical-teal focus:bg-white focus:outline-none transition-colors ${
                            s.lead_time_days == null
                              ? "border-slate-200 bg-slate-50/70 text-slate-400"
                              : "border-blue-300 bg-blue-50/50 text-blue-900 font-bold"
                          }`}
                          placeholder={String(draft.lead_time_days)}
                          value={s.lead_time_days ?? ""}
                          step={1}
                          min={1}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setDraft({
                              ...draft,
                              per_series: {
                                ...draft.per_series,
                                [sid]: {
                                  ...s,
                                  lead_time_days: raw === "" ? null : Number(raw),
                                },
                              },
                            });
                          }}
                        />
                        <span className="text-[10.5px] font-medium text-slate-400">
                          {s.lead_time_days == null ? "shop" : `+${lead + draft.review_period_days}d cover`}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs font-bold text-medical-teal-deep">
                      {pct(qStar, 1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="fine px-5 sm:px-6 py-3.5 text-xs text-slate-400 bg-slate-50/30 border-t border-slate-100">
          q* = Cu / (Cu + Co) is computed live from these values. Raise the margin and the
          system orders more; raise the holding cost and it orders less. That is the whole
          decision, and it is visible here rather than buried. Leave lead time blank to
          follow the shop-wide value &mdash; blank tracks a change to it, a typed number
          does not.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-b border-slate-100 pb-2 last:border-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <dt className="text-slate-500 text-xs font-medium">{label}</dt>
        <dd className="font-mono font-bold text-ink text-sm">{value}</dd>
      </div>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  );
}
