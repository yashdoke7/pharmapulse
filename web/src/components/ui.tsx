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

const STATUS: Record<
  Status,
  { label: string; dot: string; cls: string }
> = {
  ok: {
    label: "OK",
    dot: "bg-emerald-500",
    cls: "bg-emerald-50/90 text-emerald-700 border-emerald-200/80 shadow-xs",
  },
  watch: {
    label: "Watch",
    dot: "bg-amber-500",
    cls: "bg-amber-50/90 text-amber-700 border-amber-200/80 shadow-xs",
  },
  order_now: {
    label: "Order now",
    dot: "bg-rose-500 animate-pulse",
    cls: "bg-rose-50/90 text-rose-700 border-rose-200/80 shadow-xs font-semibold",
  },
  overstocked: {
    label: "Overstocked",
    dot: "bg-blue-500",
    cls: "bg-blue-50/90 text-blue-700 border-blue-200/80 shadow-xs",
  },
};

export function StatusChip({ status }: { status: Status }) {
  const s = STATUS[status] ?? STATUS.ok;
  return (
    <span className={`chip ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

/* ----------------------------------------------------------- provenance */

/** The credibility feature: measured versus typed-in, visible at a glance. */
export function ProvenanceBadge({ lane }: { lane: LaneInput["lane"] }) {
  if (lane === "observed") {
    return (
      <span
        className="chip border-medical-teal/30 bg-medical-cyan/70 text-medical-teal-deep font-semibold"
        title="Derived from the sales history. May train a model."
      >
        <span className="h-1.5 w-1.5 rounded-full bg-medical-teal" />
        measured
      </span>
    );
  }
  if (lane === "synthetic") {
    return (
      <span className="chip border-rose-200 bg-rose-50 text-rose-700">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
        demo data
      </span>
    );
  }
  return (
    <span
      className="chip border-slate-200 bg-slate-50 text-slate-600"
      title="Your operational setting. Never reaches the trainer."
    >
      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
      your setting
    </span>
  );
}

export function DemandClassChip({ value }: { value: string }) {
  const map: Record<string, string> = {
    smooth: "border-emerald-200 bg-emerald-50/80 text-emerald-700",
    intermittent: "border-blue-200 bg-blue-50/80 text-blue-700",
    erratic: "border-amber-200 bg-amber-50/80 text-amber-700",
    lumpy: "border-rose-200 bg-rose-50/80 text-rose-700",
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
    <span className="chip border-amber-300/80 bg-amber-50 text-amber-800 shadow-xs">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------ structure */

/** A reading of one number. Elevated medical card with large tabular figure. */
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
  const toneMap = {
    ink: {
      text: "text-ink",
      bg: "bg-medical-cyan/20",
      accent: "text-medical-teal-deep",
    },
    red: {
      text: "text-rose-600",
      bg: "bg-rose-50",
      accent: "text-rose-600",
    },
    green: {
      text: "text-emerald-600",
      bg: "bg-emerald-50",
      accent: "text-emerald-600",
    },
    amber: {
      text: "text-amber-600",
      bg: "bg-amber-50",
      accent: "text-amber-600",
    },
    blue: {
      text: "text-blue-600",
      bg: "bg-blue-50",
      accent: "text-blue-600",
    },
  }[tone];

  return (
    <div className="group rounded-2xl bg-white p-4.5 sm:p-5 border border-slate-100/90 shadow-card hover:shadow-card-hover transition-all duration-300">
      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow text-[10px] tracking-wider text-slate-500 group-hover:text-medical-teal-deep transition-colors">
          {label}
        </div>
        <span className={`h-2 w-2 rounded-full ${toneMap.bg} border border-current ${toneMap.accent}`} />
      </div>
      <div className={`figure mt-2 text-[28px] font-bold tracking-tight leading-none ${toneMap.text}`}>
        {value}
      </div>
      {hint ? <div className="fine mt-2 text-slate-500 text-[11.5px]">{hint}</div> : null}
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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 pb-1">
      <div>
        <h2 className="display text-[26px] sm:text-[30px] font-bold text-ink">{title}</h2>
        {subtitle ? <p className="lede mt-1.5 max-w-2xl text-[14px] text-slate-500">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

/** Small caps label above a block, with the subtle separator line. */
export function PanelHead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100/80 px-5 sm:px-6 py-3.5 bg-slate-50/40 rounded-t-card">
      <div className="eyebrow text-slate-600">{children}</div>
      {right}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="panel pad flex flex-col items-center justify-center py-12">
      <div className="relative mb-4 flex items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-medical-teal/20 border-t-medical-teal" />
        <div className="absolute h-2 w-2 rounded-full bg-medical-teal animate-pulse" />
      </div>
      <div className="eyebrow text-medical-teal-deep">{label}</div>
      <div className="mt-3 flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-1.5 w-6 rounded-full bg-medical-teal/30 animate-pulse"
            style={{ animationDelay: `${i * 150}ms` }}
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
    <div className="rounded-2xl border border-rose-200/90 bg-rose-50/60 p-5 shadow-xs">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 font-bold text-xs">
          !
        </span>
        <div className="eyebrow text-rose-700">
          {code === "NO_FORECAST_YET" ? "No forecast yet" : "Something went wrong"}
        </div>
      </div>
      <p className="mt-2 text-sm text-slate-700">{message}</p>
      {code === "NO_FORECAST_YET" ? (
        <p className="fine mt-2.5 font-mono text-xs text-rose-800 bg-white/80 p-2 rounded-lg border border-rose-200">
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
    tone === "red"
      ? "bg-rose-500"
      : tone === "blue"
        ? "bg-blue-500"
        : tone === "green"
          ? "bg-emerald-500"
          : tone === "amber"
            ? "bg-amber-500"
            : "bg-medical-teal";
  return (
    <span className="inline-flex h-2 w-full rounded-full bg-slate-100 overflow-hidden">
      <span
        className={`rounded-full ${bg} transition-all duration-300`}
        style={{ width: `${pctWidth}%` }}
      />
    </span>
  );
}

export { ErrorBoundary } from "./ErrorBoundary";
