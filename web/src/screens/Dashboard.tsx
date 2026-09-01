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
 *
 * A dashboard that opens on a time series makes the user do the work of finding
 * the problem. A screen that opens on "three products need your decision today,
 * worth 677 rupees" has already done it.
 */
export function Dashboard() {
  const nav = useNavigate();
  const risk = useQuery({ queryKey: ["risk"], queryFn: () => api.risk(20) });
  const positions = useQuery({ queryKey: ["positions"], queryFn: () => api.positions() });

  if (risk.isError) return <ErrorCard error={risk.error} />;
  if (risk.isLoading || positions.isLoading) return <Loading label="Reading the shelf" />;

  const items = risk.data?.data.items ?? [];
  const pos = positions.data?.data.positions ?? [];
  const exposure = risk.data?.data.total_exposure ?? 0;

  const needsDecision = pos.filter((p) => p.status !== "ok").length;
  const orderNow = pos.filter((p) => p.status === "order_now");
  const overstocked = pos.filter((p) => p.status === "overstocked");
  const totalUnits = orderNow.reduce((s, p) => s + p.order_quantity, 0);
  const maxExposure = Math.max(...items.map((i) => i.exposure), 1);

  return (
    <div className="space-y-10">
      {/* The statement. Not a KPI row - a sentence a buyer can act on. */}
      <section>
        <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr] lg:items-end">
          <div>
            <div className="eyebrow">Today · {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long" })}</div>
            <h1 className="display mt-3 text-[42px] sm:text-[52px]">
              {needsDecision === 0 ? (
                <>Nothing needs a decision today.</>
              ) : (
                <>
                  {word(needsDecision)} product{needsDecision === 1 ? "" : "s"} need
                  {needsDecision === 1 ? "s" : ""} a decision,
                  <br className="hidden sm:block" />{" "}
                  <span className="text-signal-red">{inr(exposure)}</span> at risk.
                </>
              )}
            </h1>
            <p className="lede mt-4 max-w-xl">
              Ranked by money, not by probability. A 30% chance on your biggest seller
              matters more than a 90% chance on something that sells twice a month.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-5">
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

      {/* Exceptions, as an editorial list rather than a grid of cards. */}
      <section>
        <div className="mb-1 flex items-baseline justify-between border-b border-line pb-2">
          <h2 className="eyebrow">What needs a decision</h2>
          <span className="fine">every row is one click from the order that fixes it</span>
        </div>

        {items.length === 0 ? (
          <p className="lede py-8">
            No exceptions. Every product is inside its cover window.
          </p>
        ) : (
          <ul>
            {items.map((item, i) => (
              <ExceptionRow
                key={`${item.series_id}-${item.type}-${i}`}
                item={item}
                index={i + 1}
                maxExposure={maxExposure}
                onOpen={() => nav(`/orders?series=${item.series_id}`)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* The full shelf. */}
      <section>
        <div className="panel">
          <PanelHead right={<span className="fine">cover against an 11-day protection interval</span>}>
            Shelf position
          </PanelHead>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  {["Product", "On hand", "Cover", "Reorder at", "Runs out", "Suggest", ""].map(
                    (h, i) => (
                      <th
                        key={h + i}
                        className={`cell eyebrow font-normal ${i > 0 && i < 6 ? "text-right" : ""}`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
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
  const accent = {
    red: "text-signal-red",
    amber: "text-signal-amber",
    blue: "text-signal-blue",
  }[tone];

  return (
    <li>
      <button
        onClick={onOpen}
        className="group w-full border-b border-line py-5 text-left transition-colors hover:bg-wash"
      >
        <div className="grid gap-4 sm:grid-cols-[auto_1fr_auto] sm:items-start">
          <span className="figure pt-1 text-[11px] text-ink-faint">
            {String(index).padStart(2, "0")}
          </span>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="figure text-[11px] text-ink-faint">{item.series_id}</span>
              <span className={`chip border-current ${accent}`}>{item.type}</span>
              <span className="fine">{Math.round(item.probability * 100)}% likely</span>
            </div>
            <h3 className="display mt-1.5 text-[21px] leading-snug">{item.headline}</h3>
            <p className="fine mt-1 max-w-2xl">{item.detail}</p>
            {item.recommended_quantity > 0 ? (
              <p className="mt-2 font-mono text-[11px] uppercase tracking-micro text-ink-soft">
                {item.recommended_action.replace(/_/g, " ")} · {item.recommended_quantity} units
                <span className="ml-2 text-ink-faint transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </p>
            ) : (
              <p className="mt-2 font-mono text-[11px] uppercase tracking-micro text-ink-mute">
                {item.recommended_action.replace(/_/g, " ")}
                <span className="ml-2 text-ink-faint">→</span>
              </p>
            )}
          </div>

          <div className="sm:w-36 sm:text-right">
            <div className={`figure text-[24px] font-medium leading-none ${accent}`}>
              {inr(item.exposure)}
            </div>
            <div className="eyebrow mt-1">at risk</div>
            <div className="mt-2">
              <Bar value={item.exposure} max={maxExposure} tone={tone} />
            </div>
          </div>
        </div>
      </button>
    </li>
  );
}

function PositionRow({ p, onOpen }: { p: Position; onOpen: () => void }) {
  const coverTone =
    p.status === "order_now"
      ? "text-signal-red"
      : p.status === "overstocked"
        ? "text-signal-blue"
        : "text-ink-soft";
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-b border-line-soft transition-colors last:border-0 hover:bg-wash"
    >
      <td className="cell">
        <div className="font-medium">{p.name}</div>
        <div className="figure text-[10px] text-ink-faint">{p.series_id}</div>
      </td>
      <td className="cell figure text-right text-ink-soft">{units(p.stock_on_hand)}</td>
      <td className={`cell figure text-right font-medium ${coverTone}`}>
        {p.days_of_cover > 900 ? "—" : `${p.days_of_cover.toFixed(1)}d`}
      </td>
      <td className="cell figure text-right text-ink-mute">{units(p.reorder_point)}</td>
      <td className="cell figure text-right text-ink-mute">
        {p.projected_stockout_date?.slice(5) ?? <span className="text-ink-pale">—</span>}
      </td>
      <td className="cell figure text-right font-medium">
        {p.order_quantity > 0 ? p.order_quantity : <span className="text-ink-pale">—</span>}
      </td>
      <td className="cell text-right">
        <StatusChip status={p.status} />
      </td>
    </tr>
  );
}
