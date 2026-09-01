import { useQuery } from "@tanstack/react-query";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api } from "./api/client";
import { StaleBadge } from "./components/ui";
import { Dashboard } from "./screens/Dashboard";
import { Explain } from "./screens/Explain";
import { Forecast } from "./screens/Forecast";
import { LiveOps } from "./screens/LiveOps";
import { Ops } from "./screens/Ops";
import { Orders } from "./screens/Orders";
import { Settings } from "./screens/Settings";

const NAV = [
  { to: "/", label: "Decisions", end: true },
  { to: "/orders", label: "Order" },
  { to: "/forecast", label: "Forecast" },
  { to: "/explain", label: "Why" },
  { to: "/live", label: "Replay" },
  { to: "/ops", label: "Evidence" },
  { to: "/settings", label: "Settings" },
];

export default function App() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    refetchInterval: 60_000,
  });
  const meta = health.data?.meta;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur-sm">
        <div className="mx-auto max-w-[1180px] px-6">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-3">
            <div className="flex items-baseline gap-2.5">
              <Mark />
              <span className="display text-[21px] leading-none">PharmaPulse</span>
              <span className="hidden font-mono text-[10px] uppercase tracking-micro text-ink-faint sm:inline">
                forecast → purchase order
              </span>
            </div>

            <div className="ml-auto flex items-center gap-3">
              {meta ? (
                <StaleBadge
                  stale={meta.stale}
                  degraded={meta.degraded}
                  generatedAt={meta.generated_at}
                />
              ) : null}
              <span
                className="hidden font-mono text-[10px] text-ink-faint lg:inline"
                title="the model version behind every number on screen"
              >
                {meta?.model_version ?? "…"}
              </span>
            </div>
          </div>

          <nav className="-mx-3 flex flex-wrap items-center">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => `tab ${isActive ? "tab-active" : ""}`}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-6 py-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/forecast" element={<Forecast />} />
          <Route path="/explain" element={<Explain />} />
          <Route path="/live" element={<LiveOps />} />
          <Route path="/ops" element={<Ops />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <footer className="mx-auto max-w-[1180px] px-6 pb-12">
        <div className="border-t border-line pt-4">
          <p className="fine max-w-3xl">
            <span className="font-medium text-ink-soft">A stated limitation.</span> These are
            forecasts of <em>sales</em>, not demand. A stockout records zero sales, so the
            observations are right-censored — worst on exactly the products that matter most.
            Stock levels, costs and lead times are your settings; they enter at the decision
            and never train a model.
          </p>
        </div>
      </footer>
    </div>
  );
}

/** A pulse trace that resolves into a fan — the whole product in one mark. */
function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden className="shrink-0">
      <path d="M1 17h4l2.4-8 3 13.5L13.8 3l2.6 12" stroke="#14110D" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.4 15 19 9.5 25 4" stroke="#A32E22" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.4 15 19 13l6 1.5" stroke="#A32E22" strokeWidth="1.6" strokeOpacity=".45"
            strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.4 15 19 18l6 5" stroke="#A32E22" strokeWidth="1.6" strokeOpacity=".22"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
