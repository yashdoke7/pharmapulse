import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Position, RiskItem } from "../api/types";
import {
  ErrorCard,
  Loading,
  SectionTitle,
  Stat,
  StatusChip,
  inr,
  units,
} from "../components/ui";

/**
 * The home screen opens on EXCEPTIONS, never on a chart.
 *
 * A dashboard that opens on a time series makes the user do the work of finding
 * the problem. A screen that opens on "four things need your decision today,
 * worth 735 rupees" has already done it.
 */
export function Dashboard() {
  const nav = useNavigate();
  const risk = useQuery({ queryKey: ["risk"], queryFn: () => api.risk(20) });
  const positions = useQuery({ queryKey: ["positions"], queryFn: () => api.positions() });

  if (risk.isError) return <ErrorCard error={risk.error} />;
  if (risk.isLoading || positions.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Loading key={i} />
        ))}
      </div>
    );
  }

  const items = risk.data?.data.items ?? [];
  const pos = positions.data?.data.positions ?? [];
  const currency = risk.data?.data.currency ?? "INR";

  const needsDecision = pos.filter((p) => p.status !== "ok").length;
  const orderNow = pos.filter((p) => p.status === "order_now");
  const overstocked = pos.filter((p) => p.status === "overstocked");
  const totalOrder = orderNow.reduce((s, p) => s + p.order_quantity, 0);

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-5">
          <h1 className="text-2xl font-semibold text-white sm:text-3xl">
            {needsDecision === 0 ? (
              "Nothing needs a decision today."
            ) : (
              <>
                <span className="text-mint-400">{needsDecision}</span>{" "}
                {needsDecision === 1 ? "product needs" : "products need"} your decision
                today, worth{" "}
                <span className="text-mint-400">
                  {inr(risk.data?.data.total_exposure ?? 0)}
                </span>
                .
              </>
            )}
          </h1>
          <p className="subtle mt-1">
            Ranked by money at risk, not by probability — a 30% chance on your
            biggest seller matters more than a 90% chance on something that sells
            twice a month.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Exposure at risk"
            value={inr(risk.data?.data.total_exposure ?? 0)}
            hint={`${items.length} open exceptions · ${currency}`}
            tone={items.length ? "bad" : "good"}
          />
          <Stat
            label="Order now"
            value={orderNow.length}
            hint={`${units(totalOrder)} units across ${orderNow.length} products`}
            tone={orderNow.length ? "warn" : "good"}
          />
          <Stat
            label="Overstocked"
            value={overstocked.length}
            hint={
              overstocked.length
                ? `${overstocked[0].name} at ${Math.round(overstocked[0].days_of_cover)} days cover`
                : "no capital stuck"
            }
          />
          <Stat
            label="Products healthy"
            value={`${pos.length - needsDecision}/${pos.length}`}
            hint="within cover and below the reorder point"
            tone="good"
          />
        </div>
      </section>

      <section>
        <SectionTitle
          title="What needs a decision"
          subtitle="Every card is one click from the order that fixes it."
        />
        <div className="grid gap-3 lg:grid-cols-2">
          {items.length === 0 ? (
            <div className="card card-pad text-slate-400">
              No exceptions. Every product is inside its cover window.
            </div>
          ) : (
            items.map((item, i) => (
              <ExceptionCard
                key={`${item.series_id}-${item.type}-${i}`}
                item={item}
                onOpen={() => nav(`/orders?series=${item.series_id}`)}
              />
            ))
          )}
        </div>
      </section>

      <section>
        <SectionTitle
          title="Shelf position"
          subtitle="Days of cover against your lead time, per product."
        />
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left">
                  {["Product", "On hand", "Cover", "Reorder at", "Runs out", "Suggested", "Status"].map(
                    (h) => (
                      <th key={h} className="px-4 py-3 font-medium text-slate-400">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {pos.map((p) => (
                  <PositionRow key={p.series_id} p={p} onOpen={() => nav(`/orders?series=${p.series_id}`)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function ExceptionCard({ item, onOpen }: { item: RiskItem; onOpen: () => void }) {
  const tone =
    item.type === "overstock"
      ? "border-sky-500/25"
      : item.severity === "high"
        ? "border-alert-500/35"
        : "border-warn-500/25";

  return (
    <button
      onClick={onOpen}
      className={`card card-pad w-full border text-left transition-colors hover:bg-white/[0.04] ${tone}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-slate-500">{item.series_id}</span>
            <span
              className={`chip ${
                item.type === "overstock"
                  ? "bg-sky-500/15 text-sky-300"
                  : item.type === "anomaly"
                    ? "bg-violet-500/15 text-violet-300"
                    : "bg-alert-500/15 text-alert-400"
              }`}
            >
              {item.type}
            </span>
          </div>
          <h3 className="mt-2 font-semibold leading-snug text-white">{item.headline}</h3>
          <p className="subtle mt-1">{item.detail}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xl font-semibold tabular-nums text-white">
            {inr(item.exposure)}
          </div>
          <div className="subtle">at risk</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
        <span className="rounded-lg bg-white/5 px-2 py-1 text-slate-300">
          {Math.round(item.probability * 100)}% likely
        </span>
        {item.recommended_quantity > 0 ? (
          <span className="rounded-lg bg-mint-500/12 px-2 py-1 font-medium text-mint-400">
            {item.recommended_action.replace(/_/g, " ")} · {item.recommended_quantity} units
          </span>
        ) : (
          <span className="rounded-lg bg-white/5 px-2 py-1 text-slate-300">
            {item.recommended_action.replace(/_/g, " ")}
          </span>
        )}
        <span className="ml-auto text-slate-500">Open →</span>
      </div>
    </button>
  );
}

function PositionRow({ p, onOpen }: { p: Position; onOpen: () => void }) {
  const coverTone =
    p.status === "order_now"
      ? "text-alert-400"
      : p.status === "overstocked"
        ? "text-sky-300"
        : "text-slate-200";
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-b border-white/5 transition-colors last:border-0 hover:bg-white/[0.03]"
    >
      <td className="px-4 py-3">
        <div className="font-medium text-white">{p.name}</div>
        <div className="font-mono text-[11px] text-slate-500">{p.series_id}</div>
      </td>
      <td className="px-4 py-3 tabular-nums text-slate-300">{units(p.stock_on_hand)}</td>
      <td className={`px-4 py-3 tabular-nums font-medium ${coverTone}`}>
        {p.days_of_cover > 900 ? "—" : `${p.days_of_cover.toFixed(1)} d`}
      </td>
      <td className="px-4 py-3 tabular-nums text-slate-400">{units(p.reorder_point)}</td>
      <td className="px-4 py-3 text-slate-400">
        {p.projected_stockout_date ?? <span className="text-slate-600">—</span>}
      </td>
      <td className="px-4 py-3 tabular-nums font-medium text-mint-400">
        {p.order_quantity > 0 ? p.order_quantity : <span className="text-slate-600">—</span>}
      </td>
      <td className="px-4 py-3">
        <StatusChip status={p.status} />
      </td>
    </tr>
  );
}
