import type { ReactNode } from "react";
import type { LaneInput, Status } from "../api/types";

/* --------------------------------------------------------------- format */

/** Small amounts keep two decimals: the +/-1 pack comparison on the order
 *  screen differs by rupees, and rounding to whole rupees erases the very
 *  thing that panel exists to show. */
export const inr = (n: number) => {
  const abs = Math.abs(n);
  if (abs > 0 && abs < 100) return "₹" + n.toFixed(2);
  return "₹" + Math.round(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
};

export const units = (n: number) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: n < 10 ? 1 : 0 });

export const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;

export const shortDate = (ds: string) =>
  new Date(ds + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });

/* --------------------------------------------------------------- status */

const STATUS: Record<Status, { label: string; cls: string }> = {
  ok: { label: "OK", cls: "border-signal-green/35 text-signal-green bg-signal-green/[0.06]" },
  watch: { label: "Watch", cls: "border-signal-amber/40 text-signal-amber bg-signal-amber/[0.07]" },
  order_now: { label: "Order now", cls: "border-signal-red/40 text-signal-red bg-signal-red/[0.06]" },
  overstocked: { label: "Overstocked", cls: "border-signal-blue/35 text-signal-blue bg-signal-blue/[0.06]" },
};

export function StatusChip({ status }: { status: Status }) {
  const s = STATUS[status] ?? STATUS.ok;
  return <span className={`chip ${s.cls}`}>{s.label}</span>;
}

/* ----------------------------------------------------------- provenance */

/** The credibility feature: measured versus typed-in, visible at a glance. */
export function ProvenanceBadge({ lane }: { lane: LaneInput["lane"] }) {
  if (lane === "observed") {
    return (
      <span className="chip border-ink bg-ink text-paper" title="Derived from the sales history. May train a model.">
        measured
      </span>
    );
  }
  if (lane === "synthetic") {
    return <span className="chip border-signal-red/40 text-signal-red">demo data</span>;
  }
  return (
    <span className="chip border-ink-pale text-ink-mute" title="Your operational setting. Never reaches the trainer.">
      your setting
    </span>
  );
}

export function DemandClassChip({ value }: { value: string }) {
  const map: Record<string, string> = {
    smooth: "border-ink-pale text-ink-mute",
    intermittent: "border-signal-blue/40 text-signal-blue",
    erratic: "border-signal-amber/45 text-signal-amber",
    lumpy: "border-signal-red/40 text-signal-red",
  };
  return <span className={`chip ${map[value] ?? map.smooth}`}>{value}</span>;
}

/* -------------------------------------------------------------- banners */

export function StaleBadge({
  stale,
  degraded,
  generatedAt,
}: {
  stale: boolean;
  degraded: string | null;
  generatedAt?: string | null;
}) {
  if (!stale && !degraded) return null;
  const label = degraded
    ? degraded === "fixtures"
      ? "demo data · model layer offline"
      : `degraded · ${degraded}`
    : `stale · ${generatedAt?.slice(0, 10) ?? "earlier run"}`;
  return (
    <span className="chip border-signal-amber/45 bg-signal-amber/[0.07] text-signal-amber">
      <span className="h-1 w-1 bg-signal-amber" />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------ structure */

/** A reading of one number. Rules above, label in mono caps, figure large. */
export function Readout({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "ink" | "red" | "green" | "amber" | "blue";
}) {
  const toneCls = {
    ink: "text-ink",
    red: "text-signal-red",
    green: "text-signal-green",
    amber: "text-signal-amber",
    blue: "text-signal-blue",
  }[tone];
  return (
    <div className="border-t-2 border-ink pt-3">
      <div className="eyebrow">{label}</div>
      <div className={`figure mt-1.5 text-[26px] font-medium leading-none ${toneCls}`}>
        {value}
      </div>
      {hint ? <div className="fine mt-1.5">{hint}</div> : null}
    </div>
  );
}

export function SectionTitle({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-3">
      <div>
        <h2 className="display text-[26px]">{title}</h2>
        {subtitle ? <p className="lede mt-1 max-w-2xl">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

/** Small caps label above a block, with the hairline that carries structure. */
export function PanelHead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
      <div className="eyebrow">{children}</div>
      {right}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="panel-quiet pad">
      <div className="eyebrow">{label}</div>
      <div className="mt-3 space-y-2">
        {[70, 45, 58].map((w, i) => (
          <div
            key={i}
            className="h-[10px] animate-pulse bg-wash-strong"
            style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

export function ErrorCard({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code;
  return (
    <div className="border-t-2 border-signal-red bg-signal-red/[0.04] pad">
      <div className="eyebrow text-signal-red">
        {code === "NO_FORECAST_YET" ? "No forecast yet" : "Something went wrong"}
      </div>
      <p className="mt-2 text-sm text-ink-soft">{message}</p>
      {code === "NO_FORECAST_YET" ? (
        <p className="fine mt-2 font-mono">
          python -m pipelines.run_nightly --stage all
        </p>
      ) : null}
    </div>
  );
}

/** Horizontal bar used in tables where a magnitude helps the eye. */
export function Bar({ value, max, tone = "ink" }: { value: number; max: number; tone?: string }) {
  const pctWidth = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  const bg =
    tone === "red" ? "bg-signal-red" : tone === "blue" ? "bg-signal-blue" : "bg-ink";
  return (
    <span className="inline-flex h-[3px] w-full bg-wash-strong">
      <span className={bg} style={{ width: `${pctWidth}%` }} />
    </span>
  );
}
