import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { BuildJob } from "../api/types";
import { ErrorCard, Loading, PanelHead, SectionTitle } from "../components/ui";

export function Data() {
  const qc = useQueryClient();
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: () => api.datasets() });

  const [asOf, setAsOf] = useState("");
  const [source, setSource] = useState("");
  const [job, setJob] = useState<BuildJob | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") return;
    timer.current = window.setInterval(async () => {
      try {
        const r = await api.job(job.job_id);
        setJob(r.data);
        if (r.data.status === "done" || r.data.status === "failed") {
          qc.invalidateQueries();
        }
      } catch {
        /* keep polling; a transient failure is not a build failure */
      }
    }, 1200);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [job, qc]);

  const build = useMutation({
    mutationFn: () =>
      api.rebuild({
        as_of: asOf || null,
        source: source || null,
        origin: sourceOrigin(source),
      }),
    onSuccess: (r) => {
      setJob(r.data);
      setNotice(null);
    },
  });

  const activate = useMutation({
    mutationFn: (slug: string) => api.activateVersion(slug),
    onSuccess: (r) => {
      setNotice(`Now serving ${r.data.model_version} — the system's clock reads ${r.data.clock}.`);
      qc.invalidateQueries();
    },
  });

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadDataset(file, "observed"),
    onSuccess: (r) => {
      setSource(r.data.stored);
      setNotice(
        `Uploaded ${r.data.size_kb} KB and checked the columns. Choose a date, or leave it blank for the whole file, then Rebuild.`,
      );
      qc.invalidateQueries({ queryKey: ["datasets"] });
    },
  });

  if (datasets.isError) return <ErrorCard error={datasets.error} />;
  if (datasets.isLoading || !datasets.data) return <Loading label="Reading the warehouse" />;

  const d = datasets.data.data;
  function sourceOrigin(path: string): string {
    return d.sources.find((s) => s.path === path)?.origin ?? "observed";
  }

  const busy = build.isPending || (job !== null && job.status !== "done" && job.status !== "failed");
  const synthetic = d.current.origin !== "observed";

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Data"
        subtitle="Which dataset is live, what date the system is running as of, and how to change either."
      />

      {notice ? (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50/90 p-4 text-sm font-medium text-emerald-800 shadow-xs flex items-center gap-3">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>{notice}</span>
        </div>
      ) : null}

      {/* Live Dataset Card */}
      <div className={`panel pad ${synthetic ? "border-amber-300/80 bg-amber-50/20" : "bg-gradient-to-br from-white to-[#F0FDFD]"}`}>
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="eyebrow text-slate-500">Live Active Dataset</div>
            <div className="mt-1 font-mono text-xl font-bold text-ink flex items-center gap-2">
              <span>{d.current.model_version ?? "none"}</span>
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <dl className="mt-3.5 grid gap-x-8 gap-y-2 text-xs sm:grid-cols-2">
              <Row k="Deciding for" v={d.current.clock ?? "—"} />
              <Row k="Fitted as of" v={d.current.as_of ?? "the whole file"} />
              <Row k="Snapshot" v={d.current.snapshot_id ?? "—"} mono />
              <Row k="Warehouse" v={d.data_root} mono />
            </dl>
          </div>
          <div
            className={`rounded-2xl p-3.5 text-xs border ${
              synthetic
                ? "bg-amber-50 border-amber-200 text-amber-800"
                : "bg-medical-cyan/50 border-medical-teal/25 text-medical-teal-deep"
            }`}
          >
            <div className="font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${synthetic ? "bg-amber-500" : "bg-medical-teal"}`} />
              lane · {d.current.origin}
            </div>
            <div className="mt-1 max-w-xs text-xs leading-relaxed opacity-90">{d.lanes[d.current.origin]}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Run as of different date */}
        <div className="panel overflow-hidden">
          <PanelHead>Run it as of a different date</PanelHead>
          <div className="p-5 sm:p-6">
            <p className="fine text-slate-500 text-xs">
              The data is truncated <em>before</em> anything is fitted, so the demand class,
              the routing, the models and the calibration are all recomputed on what was
              knowable that day.
            </p>

            <label className="mt-4 block text-xs font-semibold text-slate-600">
              Source file
              <select
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs font-medium text-ink focus:border-medical-teal focus:bg-white focus:outline-none transition-colors"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="">Keep the data already loaded</option>
                {d.sources.map((s) => (
                  <option key={s.path} value={s.path}>
                    {s.label} ({s.size_kb} KB)
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3.5 block text-xs font-semibold text-slate-600">
              As of
              <input
                type="date"
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 font-mono text-xs text-ink focus:border-medical-teal focus:bg-white focus:outline-none transition-colors"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
              />
              <span className="fine mt-1 block text-slate-400 text-[11px]">
                Leave blank to run to the end of the file.
              </span>
            </label>

            <button
              className="btn-primary mt-4 w-full sm:w-auto shadow-sm hover:shadow-glow"
              disabled={busy}
              onClick={() => build.mutate()}
            >
              {busy ? "Building…" : "Rebuild"}
            </button>

            {build.isError ? (
              <div className="mt-3">
                <ErrorCard error={build.error} />
              </div>
            ) : null}

            {job ? (
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-slate-400">{job.job_id}</span>
                  <span
                    className={`font-semibold ${
                      job.status === "failed"
                        ? "text-rose-600"
                        : job.status === "done"
                          ? "text-emerald-600"
                          : "text-slate-600"
                    }`}
                  >
                    {job.status} · {job.step}
                  </span>
                </div>
                {job.status !== "done" && job.status !== "failed" ? (
                  <div className="mt-2 h-1.5 w-full rounded-full overflow-hidden bg-slate-200">
                    <div className="h-full w-1/3 rounded-full animate-pulse bg-medical-teal" />
                  </div>
                ) : null}
                {job.error ? (
                  <p className="mt-2 text-rose-600 font-medium">{job.error}</p>
                ) : null}
                {job.status === "done" ? (
                  <p className="fine mt-2 text-emerald-700 font-medium">
                    Published. The system now decides for {job.as_of_clock}.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* Use your own file */}
        <div className="panel overflow-hidden">
          <PanelHead>Use your own file</PanelHead>
          <div className="p-5 sm:p-6">
            <p className="fine text-slate-500 text-xs">
              A daily CSV with a <span className="font-mono text-slate-700 font-semibold">datum</span> column and one
              column per ATC code. The columns are checked before anything expensive
              starts.
            </p>
            <input
              type="file"
              accept=".csv"
              disabled={upload.isPending}
              className="mt-4 block w-full text-xs text-slate-500 file:mr-3 file:rounded-xl file:border-0 file:bg-medical-cyan/70 file:px-3.5 file:py-2 file:text-xs file:font-semibold file:text-medical-teal-deep hover:file:bg-medical-cyan cursor-pointer"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
              }}
            />
            {upload.isPending ? <p className="fine mt-2 text-slate-500">Uploading and validating schema…</p> : null}
            {upload.isError ? (
              <div className="mt-3">
                <ErrorCard error={upload.error} />
              </div>
            ) : null}

            <p className="fine mt-4 text-xs text-slate-400">
              An uploaded file is treated as lane 1, observed — it is your pharmacy's own
              sales. The synthetic extension in the dropdown is lane 3: it will run the
              whole pipeline and move the clock to 2026.
            </p>
          </div>
        </div>
      </div>

      {/* Versions table */}
      <div className="panel overflow-hidden">
        <PanelHead right={<span className="fine text-xs">publication is a pointer swap, so switching back is instant</span>}>
          Every version built
        </PanelHead>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50 text-left">
                {["Version", "Lane", "As of", "Built", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-semibold text-xs text-slate-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/70">
              {d.versions.map((v) => (
                <tr key={v.slug} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs font-bold text-slate-700">{v.slug}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`chip ${
                        v.origin === "observed"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                      }`}
                    >
                      {v.origin}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                    {v.as_of ?? "whole file"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">
                    {v.generated_at?.replace("T", " ").replace("Z", "") ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {v.is_current ? (
                      <span className="chip bg-medical-cyan/80 text-medical-teal-deep border-medical-teal/30 font-bold">
                        <span className="h-1.5 w-1.5 rounded-full bg-medical-teal" />
                        live
                      </span>
                    ) : (
                      <button
                        className="btn-ghost text-xs px-2.5 py-1"
                        disabled={activate.isPending}
                        onClick={() => activate.mutate(v.slug)}
                      >
                        Activate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-50 pb-1 last:border-0 last:pb-0">
      <dt className="text-slate-500">{k}</dt>
      <dd className={mono ? "font-mono font-bold text-slate-700" : "font-semibold text-ink"}>{v}</dd>
    </div>
  );
}
