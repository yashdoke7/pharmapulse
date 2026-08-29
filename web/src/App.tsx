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

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/orders", label: "Orders & Risk" },
  { to: "/forecast", label: "Forecast" },
  { to: "/explain", label: "Why" },
  { to: "/live", label: "Live Ops" },
  { to: "/ops", label: "Ops" },
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
      <header className="sticky top-0 z-20 border-b border-white/10 bg-ink-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <Logo />
            <div>
              <div className="text-[15px] font-semibold leading-tight text-white">
                PharmaPulse
              </div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                Forecast to purchase order
              </div>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-white/10 text-white"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {meta ? (
              <StaleBadge
                stale={meta.stale}
                degraded={meta.degraded}
                generatedAt={meta.generated_at}
              />
            ) : null}
            <span
              className="hidden font-mono text-[10px] text-slate-500 sm:inline"
              title="the model version that produced every number on screen"
            >
              {meta?.model_version ?? "…"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/forecast" element={<Forecast />} />
          <Route path="/explain" element={<Explain />} />
          <Route path="/live" element={<LiveOps />} />
          <Route path="/ops" element={<Ops />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <footer className="mx-auto max-w-7xl px-5 pb-10 pt-2 text-[11px] leading-relaxed text-slate-500">
        Forecasts are of <strong className="text-slate-400">sales</strong>, not demand: a
        stockout records zero sales, so the observations are right-censored, worst on
        exactly the products that matter most. Stated as a limitation rather than hidden.
        Stock levels, costs and lead times are your settings, never model inputs.
      </footer>
    </div>
  );
}

function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#12a771" fillOpacity="0.18" />
      <path
        d="M5 20.5h4.2l2.3-7.4 3.1 12.2 3.4-17.6 2.7 12.8 1.9-4.4H27"
        stroke="#22c98a"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
