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
 *
 * No inventory system on earth knows a pharmacy's lead time or cost of
 * capital - all of them ask. These are inputs to the DECISION and they never
 * reach the trainer, which is enforced by the shape of the pipeline rather
 * than by discipline.
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
      // Every downstream number depends on these, so invalidate broadly.
      qc.invalidateQueries();
    },
  });

  if (isError) return <ErrorCard error={error} />;
  if (isLoading || !draft) return <Loading label="Loading settings" />;

  const protection = draft.lead_time_days + draft.review_period_days;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Your numbers"
        subtitle="Lane 2 — the parameters only your pharmacy knows. They shape every order quantity and they never train a model."
        right={
          <div className="flex items-center gap-3">
            {saved ? <span className="chip bg-signal-green/15 text-signal-green">saved</span> : null}
            <button
              className="btn-primary"
              onClick={() => save.mutate(draft)}
              disabled={save.isPending}
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        }
      />

      <div className="panel pad border-signal-green">
        <div className="flex flex-wrap items-center gap-3">
          <ProvenanceBadge lane="user_setting" />
          <p className="fine max-w-3xl">
            Everything on this page is <strong className="text-ink-soft">lane 2</strong>.
            No inventory system knows a pharmacy's cost of capital — all of them ask. These
            values enter at the decision engine and nowhere else, so no fitted coefficient
            can ever depend on them.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="panel pad lg:col-span-2">
          <div className="eyebrow">Across all products</div>
          <div className="mt-4 space-y-5">
            {GLOBAL_FIELDS.map((f) => {
              const value = draft[f.key] as number;
              return (
                <div key={String(f.key)}>
                  <div className="flex items-baseline justify-between gap-3">
                    <label className="text-sm font-medium text-ink">{f.label}</label>
                    <span className="font-mono text-sm text-signal-green">
                      {f.asPercent ? pct(value, 1) : value}
                    </span>
                  </div>
                  <input
                    type="range"
                    className="pp-slider mt-2 w-full"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={value}
                    onChange={(e) =>
                      setDraft({ ...draft, [f.key]: Number(e.target.value) })
                    }
                    style={{
                      background: `linear-gradient(90deg,#14110D ${
                        ((value - f.min) / (f.max - f.min)) * 100
                      }%, rgba(20,17,13,.14) ${
                        ((value - f.min) / (f.max - f.min)) * 100
                      }%)`,
                    }}
                  />
                  <p className="mt-1 text-xs text-ink-faint">{f.help}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel pad">
          <div className="eyebrow">What this implies</div>
          <dl className="mt-3 space-y-2.5 text-sm">
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
          <p className="fine mt-4 text-xs">
            An order has to survive the protection interval, not just the lead time: once
            you have ordered you cannot order again until the next review, so today's
            order must cover demand until the order after next arrives.
          </p>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="border-b border-line px-5 py-3">
          <div className="eyebrow">Per product</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Product", "Pack size", "Unit cost", "Unit margin", "Stock on hand", "Lead time", "q*"].map(
                  (h) => (
                    <th key={h} className="px-4 py-2.5 font-medium text-ink-mute">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {Object.entries(draft.per_series).map(([sid, s]) => {
                const cu = s.unit_margin;
                // Product override if one is set, otherwise the shop-wide rate.
                const lead = s.lead_time_days ?? draft.lead_time_days;
                const hold = s.holding_cost_rate ?? draft.holding_cost_rate;
                const expiry = s.expiry_risk_rate ?? draft.expiry_risk_rate;
                const co = s.unit_cost * hold * (lead / 365) + s.unit_cost * expiry;
                const qStar = cu / (cu + co);
                return (
                  <tr key={sid} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-2 font-mono text-ink-soft">{sid}</td>
                    {(["pack_size", "unit_cost", "unit_margin", "stock_on_hand"] as const).map(
                      (field) => (
                        <td key={field} className="px-4 py-2">
                          <input
                            type="number"
                            className="w-24 border border-line bg-paper-sunk px-2 py-1 text-right font-mono text-sm text-ink focus:border-ink focus:outline-none"
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
                    {/* Lead time genuinely varies per line in a pharmacy - a
                        controlled drug from one licensed distributor does not
                        arrive on the same clock as generic paracetamol from a
                        wholesaler who calls twice a week. Blank = follow the shop. */}
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          className={`w-16 border bg-paper-sunk px-2 py-1 text-right font-mono text-sm focus:border-ink focus:outline-none ${
                            s.lead_time_days == null
                              ? "border-line text-ink-faint"
                              : "border-signal-blue text-ink"
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
                        <span className="text-[10px] text-ink-faint">
                          {s.lead_time_days == null ? "shop" : `+${lead + draft.review_period_days}d cover`}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2 font-mono text-signal-green">{pct(qStar, 1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="fine px-5 py-3 text-xs">
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
    <div>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-ink-mute">{label}</dt>
        <dd className="font-mono text-ink">{value}</dd>
      </div>
      {hint ? <p className="mt-0.5 text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}
