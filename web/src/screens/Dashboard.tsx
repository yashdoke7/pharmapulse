import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Position, RiskItem } from "../api/types";
import {
  Bar,
  ErrorCard,
  Loading,
  PanelHead,
  Readout,
  StatusChip,
  inr,
  units,
} from "../components/ui";

/**
 * The home screen opens on EXCEPTIONS, never on a chart.
 * Redesigned into a premium Medical Intelligence & Pharmaceutical Sales Dashboard.
 */
// Fallback only, used while /api/settings is still loading. The real value is
// lead_time_days + review_period_days, read live from settings below - it used
// to be hardcoded here, so moving the sliders on the Settings screen never
// moved this line even though it changes what "the next order must cover"
// actually means.
const DEFAULT_PROTECTION = 11;

/**
 * Days of cover per product, as a horizontal runway, with the protection
 * interval drawn through it. Anything whose bar ends left of that line runs out
 * before the next delivery can possibly arrive.
 */
function CoverRunway({ positions, protection }: { positions: Position[]; protection: number }) {
  if (!positions.length) return null;

  const CAP = Math.max(protection * 3, 30);
  const rows = [...positions].sort((a, b) => a.days_of_cover - b.days_of_cover);
  const markerPct = (protection / CAP) * 100;

  return (
    <div>
      <div className="space-y-2.5">
        {rows.map((p) => {
          const over = p.days_of_cover > CAP;
          const pct = Math.min(p.days_of_cover / CAP, 1) * 100;
          const tone =
            p.status === "order_now"
              ? "bg-rose-500"
              : p.status === "overstocked"
                ? "bg-blue-500"
                : p.days_of_cover < protection * 1.4
                  ? "bg-amber-500"
                  : "bg-emerald-500";
          return (
            <div key={p.series_id} className="group py-1.5 sm:py-1">
              {/* Name + days sit above the bar on a phone - a fixed-width
                  label and a fixed-width day count either side of the bar
                  left no room for the bar itself below ~380px. */}
              <div className="mb-1 flex items-center justify-between gap-2 sm:hidden">
                <span className="truncate text-xs font-semibold text-ink" title={p.name}>
                  {p.name}
                </span>
                <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-slate-600">
                  {p.days_of_cover >= 999 ? "—" : `${p.days_of_cover.toFixed(1)}d`}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="hidden w-40 shrink-0 truncate text-xs font-semibold text-ink group-hover:text-medical-teal-deep transition-colors sm:block"
                  title={p.name}
                >
                  {p.name}
                </div>
                <div className="relative h-6 flex-1 rounded-full bg-slate-100/90 overflow-hidden">
                  <div
                    className={`h-full ${tone} rounded-full transition-[width] duration-500 shadow-xs`}
                    style={{ width: `${pct}%` }}
                  />
                  {/* Protection interval line */}
                  <div
                    className="pointer-events-none absolute inset-y-0 border-l-2 border-dashed border-slate-700/60 z-10"
                    style={{ left: `${markerPct}%` }}
                  />
                  {over ? (
                    <div className="absolute inset-y-0 right-2 flex items-center text-[11px] font-bold text-slate-500">
                      ›
                    </div>
                  ) : null}
                </div>
                <div className="hidden w-16 shrink-0 text-right font-mono text-xs font-semibold tabular-nums text-slate-600 sm:block">
                  {p.days_of_cover >= 999 ? "—" : `${p.days_of_cover.toFixed(1)}d`}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2.5 border-t border-slate-100 pt-3.5 text-xs text-slate-500">
        <Key className="bg-rose-500" label="order now" />
        <Key className="bg-amber-500" label="watch" />
        <Key className="bg-emerald-500" label="covered" />
        <Key className="bg-blue-500" label="capital tied up" />
        <span className="ml-auto max-w-[32rem] text-right text-[11px] leading-relaxed text-slate-400">
          dashed line = {protection} days. A bar ending left of it runs out before the next
          delivery can land. A slow mover can clear the line and still say “order now” —
          its reorder point carries safety stock for how erratic it is.
        </span>
      </div>
    </div>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-medium">
      <span className={`inline-block h-2.5 w-3.5 rounded-full ${className}`} />
      {label}
    </span>
  );
}

export function Dashboard() {
  const nav = useNavigate();
  const risk = useQuery({ queryKey: ["risk"], queryFn: () => api.risk(20) });
  const positions = useQuery({ queryKey: ["positions"], queryFn: () => api.positions() });
  // Same query key Settings.tsx uses, so this is a cache hit whenever that
  // screen has already been visited rather than a second network round trip.
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.settings() });

  if (risk.isError) return <ErrorCard error={risk.error} />;
  if (risk.isLoading || positions.isLoading) return <Loading label="Reading the shelf" />;

  // Matches decision/newsvendor.py::protection_interval_days exactly: lead
  // time plus review period, not lead time alone. Per-product lead-time
  // overrides (Settings screen, per series) are real, but this chart draws
  // ONE shared line across every product - so it reflects the shop-wide
  // setting, and a product overriding its own lead time will show a runway
  // slightly ahead of or behind where its bar actually needs to clear.
  const s = settings.data?.data;
  const protection = s
    ? s.lead_time_days + s.review_period_days
    : DEFAULT_PROTECTION;

  const asOf = risk.data?.meta.as_of ?? null;
  const asOfLabel = asOf
    ? new Date(asOf + "T00:00:00").toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "—";

  const items = risk.data?.data.items ?? [];
  const pos = positions.data?.data.positions ?? [];
  const exposure = risk.data?.data.total_exposure ?? 0;

  const needsDecision = pos.filter((p) => p.status !== "ok").length;
  const orderNow = pos.filter((p) => p.status === "order_now");
  const overstocked = pos.filter((p) => p.status === "overstocked");
  const totalUnits = orderNow.reduce((s, p) => s + (p.order_quantity ?? 0), 0);
  const maxExposure = Math.max(...items.map((i) => i.exposure ?? 0), 1);

  return (
    <div className="space-y-8">
      {/* Hero Header & KPI Cards */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-white via-[#FAFDFD] to-[#EDF8F8] p-6 sm:p-8 border border-slate-200/70 shadow-card">
        {/* Subtle decorative background circles */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-medical-teal/10 blur-3xl" />
        <div className="pointer-events-none absolute right-1/3 -bottom-20 h-48 w-48 rounded-full bg-medical-blue/10 blur-2xl" />

        <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-medical-cyan/60 px-3 py-1 text-xs font-semibold text-medical-teal-deep border border-medical-teal/20 mb-3 font-mono">
              <span className="h-2 w-2 rounded-full bg-medical-teal animate-pulse" />
              Deciding for · {asOfLabel}
            </div>

            <h1 className="display text-[34px] sm:text-[44px] font-extrabold text-ink leading-tight">
              {needsDecision === 0 ? (
                <>Nothing needs a decision today.</>
              ) : (
                <>
                  {word(needsDecision)} product{needsDecision === 1 ? "" : "s"} need
                  {needsDecision === 1 ? "s" : ""} a decision,
                  <br className="hidden sm:block" />{" "}
                  <span className="text-rose-600 underline decoration-rose-200 underline-offset-4">
                    {inr(exposure)}
                  </span>{" "}
                  at risk.
                </>
              )}
            </h1>

            <p className="lede mt-3 max-w-xl text-slate-500 text-sm sm:text-base">
              Ranked by money, not by probability. A 30% chance on your biggest seller
              matters more than a 90% chance on something that sells twice a month.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3.5">
            <Readout
              label="Order now"
              value={orderNow.length}
              hint={`${units(totalUnits)} units`}
              tone={orderNow.length ? "red" : "green"}
            />
            <Readout
              label="Capital stuck"
              value={overstocked.length}
              hint={overstocked.length ? `${Math.round(overstocked[0].days_of_cover)}d cover` : "none"}
              tone={overstocked.length ? "blue" : "green"}
            />
            <Readout
              label="Healthy"
              value={`${pos.length - needsDecision}/${pos.length}`}
              hint="inside cover"
              tone="green"
            />
          </div>
        </div>
      </section>

      {/* Exceptions List */}
      <section>
        <div className="mb-3 flex items-baseline justify-between px-1">
          <div>
            <h2 className="eyebrow text-medical-teal-deep font-bold">What needs a decision</h2>
            <div className="text-xs text-slate-500 mt-0.5">Prioritized by financial exposure</div>
          </div>
          <span className="fine text-slate-400 text-xs">
            every row is one click from the order that fixes it
          </span>
        </div>

        {items.length === 0 ? (
          <div className="panel pad text-center py-10">
            <p className="lede text-slate-500">
              No exceptions. Every product is inside its cover window.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item, i) => (
              <ExceptionRow
                key={`${item.series_id}-${item.type}-${i}`}
                item={item}
                index={i + 1}
                maxExposure={maxExposure}
                onOpen={() => nav(`/orders?series=${item.series_id}`)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Cover Runway Section */}
      <section>
        <div className="panel overflow-hidden">
          <PanelHead right={<span className="fine text-xs">each bar is days of stock left</span>}>
            Runway, against the {protection} days the next order must cover
          </PanelHead>
          <div className="p-5 sm:p-6">
            <CoverRunway positions={pos} protection={protection} />
          </div>
        </div>
      </section>

      {/* Shelf Position Table */}
      <section>
        <div className="panel overflow-hidden">
          <PanelHead right={<span className="fine text-xs">cover against a {protection}-day protection interval</span>}>
            Shelf position & Inventory Status
          </PanelHead>
          {/* Table for tablet+; a seven-column table has no honest way to
              fit a phone screen, so phones get a stacked card per product
              instead of a sideways scroll. */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50 text-left">
                  {["Product", "On hand", "Cover", "Reorder at", "Runs out", "Suggest", ""].map(
                    (h, i) => (
                      <th
                        key={h + i}
                        className={`cell eyebrow font-semibold text-slate-500 ${
                          i > 0 && i < 6 ? "text-right" : ""
                        }`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/80">
                {pos.map((p) => (
                  <PositionRow
                    key={p.series_id}
                    p={p}
                    onOpen={() => nav(`/orders?series=${p.series_id}`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="sm:hidden space-y-3 p-3">
            {pos.map((p) => (
              <PositionCard
                key={p.series_id}
                p={p}
                onOpen={() => nav(`/orders?series=${p.series_id}`)}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];
const word = (n: number) => WORDS[n] ?? String(n);

function ExceptionRow({
  item,
  index,
  maxExposure,
  onOpen,
}: {
  item: RiskItem;
  index: number;
  maxExposure: number;
  onOpen: () => void;
}) {
  const tone =
    item.type === "overstock" ? "blue" : item.severity === "high" ? "red" : "amber";

  const accentColor = {
    red: "text-rose-600",
    amber: "text-amber-600",
    blue: "text-blue-600",
  }[tone];

  const pillCls = {
    red: "bg-rose-50 text-rose-700 border-rose-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
  }[tone];

  return (
    <button
      onClick={onOpen}
      className="group w-full rounded-2xl border border-slate-200/80 bg-white p-4.5 sm:p-5 text-left shadow-card hover:shadow-card-hover hover:border-medical-teal/40 transition-all duration-300"
    >
      <div className="grid gap-4 sm:grid-cols-[auto_1fr_auto] sm:items-start">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-slate-100 font-mono text-xs font-bold text-slate-600">
          {String(index).padStart(2, "0")}
        </span>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-200/60">
              {item.series_id}
            </span>
            <span className={`chip font-semibold ${pillCls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${tone === "red" ? "bg-rose-500" : tone === "blue" ? "bg-blue-500" : "bg-amber-500"}`} />
              {item.type}
            </span>
            <span className="fine text-xs text-slate-500">{Math.round(item.probability * 100)}% probability</span>
          </div>

          <h3 className="display mt-2 text-[18px] sm:text-[20px] font-bold text-ink leading-snug group-hover:text-medical-teal-deep transition-colors">
            {item.headline}
          </h3>
          <p className="fine mt-1 text-slate-500 max-w-2xl text-xs sm:text-[13px]">{item.detail}</p>

          {item.recommended_quantity > 0 ? (
            <p className="mt-2.5 font-mono text-xs font-bold uppercase tracking-wider text-medical-teal-deep flex items-center gap-1.5">
              <span>{item.recommended_action.replace(/_/g, " ")} · {item.recommended_quantity} units</span>
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </p>
          ) : (
            <p className="mt-2.5 font-mono text-xs font-medium uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <span>{item.recommended_action.replace(/_/g, " ")}</span>
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </p>
          )}
        </div>

        <div className="sm:w-44 sm:text-right border-t sm:border-t-0 border-slate-100 pt-2 sm:pt-0">
          <div className={`figure text-[24px] font-bold leading-none ${accentColor}`}>
            {inr(item.exposure)}
          </div>
          <div className="eyebrow mt-1 text-[10px] text-slate-400">at risk</div>
          <div className="mt-2">
            <Bar value={item.exposure} max={maxExposure} tone={tone} />
          </div>
        </div>
      </div>
    </button>
  );
}

function PositionRow({ p, onOpen }: { p: Position; onOpen: () => void }) {
  const coverTone =
    p.status === "order_now"
      ? "text-rose-600 font-bold"
      : p.status === "overstocked"
        ? "text-blue-600 font-bold"
        : "text-slate-700";

  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer transition-colors hover:bg-medical-cyan/20 group"
    >
      <td className="cell">
        <div className="font-semibold text-ink group-hover:text-medical-teal-deep transition-colors">
          {p.name}
        </div>
        <div className="figure text-[10.5px] font-mono text-slate-400">{p.series_id}</div>
      </td>
      <td className="cell figure text-right text-slate-600">{units(p.stock_on_hand)}</td>
      <td className={`cell figure text-right ${coverTone}`}>
        {p.days_of_cover > 900 ? "—" : `${p.days_of_cover.toFixed(1)}d`}
      </td>
      <td className="cell figure text-right text-slate-500">{units(p.reorder_point)}</td>
      <td className="cell figure text-right text-slate-500">
        {p.projected_stockout_date?.slice(5) ?? <span className="text-slate-300">—</span>}
      </td>
      <td className="cell figure text-right font-bold text-ink">
        {p.order_quantity > 0 ? p.order_quantity : <span className="text-slate-300 font-normal">—</span>}
      </td>
      <td className="cell text-right">
        <StatusChip status={p.status} />
      </td>
    </tr>
  );
}

/** The phone equivalent of a PositionRow - same fields, stacked instead of
 * columned, because there is no honest way to fit seven columns under
 * ~380px without either scrolling sideways or shrinking numbers unreadable. */
function PositionCard({ p, onOpen }: { p: Position; onOpen: () => void }) {
  const coverTone =
    p.status === "order_now"
      ? "text-rose-600"
      : p.status === "overstocked"
        ? "text-blue-600"
        : "text-slate-700";

  return (
    <button
      onClick={onOpen}
      className="w-full rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-card active:bg-slate-50 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-ink truncate">{p.name}</div>
          <div className="figure text-[10.5px] font-mono text-slate-400">{p.series_id}</div>
        </div>
        <span className="shrink-0">
          <StatusChip status={p.status} />
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
        <Stat label="On hand" value={units(p.stock_on_hand)} />
        <Stat
          label="Cover"
          value={p.days_of_cover > 900 ? "—" : `${p.days_of_cover.toFixed(1)}d`}
          valueClass={coverTone}
        />
        <Stat label="Reorder at" value={units(p.reorder_point)} />
        <Stat label="Runs out" value={p.projected_stockout_date?.slice(5) ?? "—"} />
      </div>

      {p.order_quantity > 0 ? (
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5">
          <span className="fine text-slate-500">Suggested order</span>
          <span className="figure font-bold text-ink">{p.order_quantity} units</span>
        </div>
      ) : null}
    </button>
  );
}

function Stat({
  label,
  value,
  valueClass = "text-slate-700",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`figure font-semibold ${valueClass}`}>{value}</div>
    </div>
  );
}
