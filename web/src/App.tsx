import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { StaleBadge } from "./components/ui";
import { Dashboard } from "./screens/Dashboard";
import { Explain } from "./screens/Explain";
import { Forecast } from "./screens/Forecast";
import { LiveOps } from "./screens/LiveOps";
import { Ops } from "./screens/Ops";
import { Orders } from "./screens/Orders";
import { Data } from "./screens/Data";
import { Settings } from "./screens/Settings";

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  icon: (active: boolean) => JSX.Element;
}

const NAV: NavItem[] = [
  {
    to: "/",
    label: "Decisions",
    end: true,
    icon: (active) => (
      <svg className={`h-5 w-5 shrink-0 ${active ? "text-white" : "text-slate-400 group-hover:text-medical-teal"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
  {
    to: "/orders",
    label: "Order",
    icon: (active) => (
      <svg className={`h-5 w-5 shrink-0 ${active ? "text-white" : "text-slate-400 group-hover:text-medical-teal"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
      </svg>
    ),
  },
  {
    to: "/forecast",
    label: "Forecast",
    icon: (active) => (
      <svg className={`h-5 w-5 shrink-0 ${active ? "text-white" : "text-slate-400 group-hover:text-medical-teal"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
  },
  {
    to: "/explain",
    label: "Why",
    icon: (active) => (
      <svg className={`h-5 w-5 shrink-0 ${active ? "text-white" : "text-slate-400 group-hover:text-medical-teal"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    to: "/live",
    label: "Replay",
    icon: (active) => (
      <svg className={`h-5 w-5 shrink-0 ${active ? "text-white" : "text-slate-400 group-hover:text-medical-teal"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    to: "/ops",
    label: "Evidence",
    icon: (active) => (
      <svg className={`h-5 w-5 shrink-0 ${active ? "text-white" : "text-slate-400 group-hover:text-medical-teal"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    to: "/data",
    label: "Data",
    icon: (active) => (
      <svg className={`h-5 w-5 shrink-0 ${active ? "text-white" : "text-slate-400 group-hover:text-medical-teal"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
      </svg>
    ),
  },
  {
    to: "/settings",
    label: "Settings",
    icon: (active) => (
      <svg className={`h-5 w-5 shrink-0 ${active ? "text-white" : "text-slate-400 group-hover:text-medical-teal"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
      </svg>
    ),
  },
];

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    refetchInterval: 60_000,
  });
  const meta = health.data?.meta;

  const currentNav = NAV.find((n) =>
    n.end ? location.pathname === n.to : location.pathname.startsWith(n.to),
  );

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#F4FAFA]">
      {/* Mobile sidebar overlay */}
      {sidebarOpen ? (
        <div
          className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      {/* Modern Medical SaaS Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 transform bg-white/95 backdrop-blur-md border-r border-slate-200/80 transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:inset-auto lg:z-auto flex flex-col justify-between ${
          sidebarOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        }`}
      >
        <div>
          {/* Brand header */}
          <div className="p-5 border-b border-slate-100/90 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-medical-teal to-medical-blue shadow-glow/40 p-2">
                <Mark />
              </div>
              <div>
                <div className="display text-[19px] leading-tight text-ink font-bold tracking-tight">
                  PharmaPulse
                </div>
                <div className="font-mono text-[9.5px] uppercase tracking-wider text-medical-teal-deep font-semibold">
                  forecast → purchase order
                </div>
              </div>
            </div>
            {/* Close button for mobile */}
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Navigation links */}
          <nav className="p-3.5 space-y-1">
            <div className="px-3 pt-2 pb-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Intelligence &amp; Ops
            </div>
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `group flex items-center gap-3 px-3 py-2.5 text-xs font-medium rounded-xl transition-all duration-200 ${
                    isActive
                      ? "bg-gradient-to-r from-medical-teal to-medical-teal-deep text-white shadow-sm font-semibold"
                      : "text-slate-600 hover:text-ink hover:bg-medical-cyan/35"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {n.icon(isActive)}
                    <span className="flex-1">{n.label}</span>
                    {isActive ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                    ) : null}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Sidebar bottom system status */}
        <div className="p-4 border-t border-slate-100/90 bg-slate-50/60 m-3 rounded-2xl">
          <div className="flex items-center justify-between text-[11px] mb-1.5">
            <span className="text-slate-500 font-medium">Model Engine</span>
            <span className="inline-flex items-center gap-1 font-medium text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          </div>
          <div
            className="font-mono text-[11px] text-ink font-semibold truncate bg-white px-2 py-1 rounded-lg border border-slate-200/70"
            title="the model version behind every number on screen"
          >
            {meta?.model_version ?? "loading…"}
          </div>
          {meta ? (
            <div className="mt-2">
              <StaleBadge
                stale={meta.stale}
                degraded={meta.degraded}
                generatedAt={meta.generated_at}
              />
            </div>
          ) : null}
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-slate-200/60 shadow-sm">
          <div className="px-5 sm:px-8 py-3.5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
                aria-label="Open navigation menu"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-display font-semibold text-ink text-base">
                    {currentNav?.label ?? "Overview"}
                  </span>
                  <span className="hidden sm:inline text-xs text-slate-400">·</span>
                  <span className="hidden sm:inline font-mono text-[10.5px] uppercase tracking-wider text-medical-teal-deep font-medium bg-medical-cyan/50 px-2 py-0.5 rounded-md">
                    Pharmaceutical Sales Intelligence
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {meta ? (
                <StaleBadge
                  stale={meta.stale}
                  degraded={meta.degraded}
                  generatedAt={meta.generated_at}
                />
              ) : null}

              <div
                className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-600 text-xs font-mono"
                title="the model version behind every number on screen"
              >
                <span className="h-2 w-2 rounded-full bg-medical-teal" />
                <span>{meta?.model_version ?? "…"}</span>
              </div>
            </div>
          </div>
        </header>

        {/* Page body */}
        <main className="flex-1 p-5 sm:p-8 lg:p-10 max-w-[1440px] w-full mx-auto">
          <ErrorBoundary key={location.pathname}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/forecast" element={<Forecast />} />
              <Route path="/explain" element={<Explain />} />
              <Route path="/live" element={<LiveOps />} />
              <Route path="/ops" element={<Ops />} />
              <Route path="/data" element={<Data />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </main>

        {/* Footer */}
        <footer className="px-5 sm:px-8 pb-10 max-w-[1440px] w-full mx-auto">
          <div className="rounded-2xl border border-slate-200/70 bg-white/70 backdrop-blur-sm p-5 shadow-sm">
            <p className="fine text-slate-500 max-w-4xl text-xs leading-relaxed">
              <span className="font-semibold text-ink">A stated limitation.</span> These are
              forecasts of <em>sales</em>, not demand. A stockout records zero sales, so the
              observations are right-censored — worst on exactly the products that matter most.
              Stock levels, costs and lead times are your settings; they enter at the decision
              and never train a model.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

/** A pulse trace that resolves into a fan — the whole product in one mark with medical teal & healthcare blue. */
function Mark() {
  return (
    <svg width="24" height="24" viewBox="0 0 26 26" fill="none" aria-hidden className="shrink-0">
      <path
        d="M1 17h4l2.4-8 3 13.5L13.8 3l2.6 12"
        stroke="#FFFFFF"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.4 15 19 9.5 25 4"
        stroke="#FFFFFF"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.4 15 19 13l6 1.5"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeOpacity=".65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.4 15 19 18l6 5"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeOpacity=".35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
