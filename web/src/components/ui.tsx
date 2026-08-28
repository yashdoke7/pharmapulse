import type { ReactNode } from "react";
import type { LaneInput, Status } from "../api/types";

/** Small amounts keep two decimals: the +/-1 pack comparison on the order
 *  screen differs by rupees, and rounding to whole rupees erases the very
 *  thing that panel exists to show. */
export const inr = (n: number) => {
  const abs = Math.abs(n);
  if (abs > 0 && abs < 100) {
    return "₹" + n.toFixed(2);
  }
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

/* ---------------------------------------------------------------- status */

const STATUS_STYLE: Record<Status, { label: string; cls: string }> = {
  ok: { label: "OK", cls: "bg-mint-500/15 text-mint-400 ring-1 ring-mint-500/30" },
  watch: { label: "Watch", cls: "bg-warn-500/15 text-warn-400 ring-1 ring-warn-500/30" },
  order_now: {
    label: "Order now",
    cls: "bg-alert-500/15 text-alert-400 ring-1 ring-alert-500/30",
  },
  overstocked: {
    label: "Overstocked",
    cls: "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30",
  },
};

export function StatusChip({ status }: { status: Status }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.ok;
  return <span className={`chip ${s.cls}`}>{s.label}</span>;
}

/* ------------------------------------------------------------ provenance */

/** The credibility feature: the reader can see at a glance what was measured
 *  and what was typed in by the pharmacy. */
export function ProvenanceBadge({ lane }: { lane: LaneInput["lane"] }) {
  if (lane === "observed") {
    return (
      <span className="chip bg-mint-500/12 text-mint-400 ring-1 ring-mint-500/25">
        measured
      </span>
    );
  }
  if (lane === "synthetic") {
    return (
      <span className="chip bg-fuchsia-500/12 text-fuchsia-300 ring-1 ring-fuchsia-500/25">
        demo data
      </span>
    );
  }
  return (
    <span className="chip bg-slate-500/15 text-slate-300 ring-1 ring-white/10">
      your setting
    </span>
  );
}

export function DemandClassChip({ value }: { value: string }) {
  const map: Record<string, string> = {
    smooth: "bg-slate-500/15 text-slate-300 ring-1 ring-white/10",
    intermittent: "bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30",
    erratic: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
    lumpy: "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30",
  };
  return <span className={`chip ${map[value] ?? map.smooth}`}>{value}</span>;
}

/* --------------------------------------------------------------- banners */

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
      ? "Demo data - the model layer is not running"
      : `Degraded: ${degraded}`
    : `Forecasts from ${generatedAt?.slice(0, 10) ?? "an earlier run"}`;
  return (
    <span className="chip bg-warn-500/15 text-warn-400 ring-1 ring-warn-500/30">
      <span className="h-1.5 w-1.5 rounded-full bg-warn-400" />
      {label}
    </span>
  );
}

/* ----------------------------------------------------------------- cards */

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "good" | "bad" | "warn";
}) {
  const toneCls = {
    default: "text-white",
    good: "text-mint-400",
    bad: "text-alert-400",
    warn: "text-warn-400",
  }[tone];
  return (
    <div className="card card-pad">
      <div className="label">{label}</div>
      <div className={`metric mt-2 ${toneCls}`}>{value}</div>
      {hint ? <div className="subtle mt-1">{hint}</div> : null}
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
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {subtitle ? <p className="subtle mt-0.5">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="card card-pad animate-pulse">
      <div className="h-3 w-28 rounded bg-white/10" />
      <div className="mt-4 h-8 w-40 rounded bg-white/10" />
      <div className="mt-2 h-3 w-56 rounded bg-white/5" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function ErrorCard({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code;
  return (
    <div className="card card-pad border-alert-500/30">
      <div className="label text-alert-400">
        {code === "NO_FORECAST_YET" ? "No forecast yet" : "Something went wrong"}
      </div>
      <p className="mt-2 text-sm text-slate-300">{message}</p>
      {code === "NO_FORECAST_YET" ? (
        <p className="subtle mt-2 font-mono text-xs">
          python -m pipelines.run_nightly --stage all
        </p>
      ) : null}
    </div>
  );
}
