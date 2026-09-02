import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { BuildJob } from "../api/types";
import { ErrorCard, Loading, PanelHead, SectionTitle } from "../components/ui";

/**
 * The dataset screen.
 *
 * Two questions kept being asked of a system frozen at one file and one
 * cutoff: "what would this have said in June 2017?" and "does it work on MY
 * data?". They are the same feature - a dataset is a source file, a lane, and
 * an as-of date - so they live on one screen.
 *
 * The as-of control is the one worth understanding. It does not filter a
 * finished forecast; it truncates the data and refits, so the demand class,
 * the routing, the models and the calibration are all recomputed on what was
 * knowable that day. That takes about twenty seconds, which is why this screen
 * has a progress state at all.
 */
export function Data() {
  const qc = useQueryClient();
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: () => api.datasets() });

  const [asOf, setAsOf] = useState("");
  const [source, setSource] = useState("");
  const [job, setJob] = useState<BuildJob | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  // Poll while a build runs. Twenty seconds is too long to block a request and
  // far too short to justify a queue, so the server runs it on a thread and
  // this asks how it is going.
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
      api.rebuild({ as_of: asOf || null, source: source || null,
                    origin: sourceOrigin(source) }),
    onSuccess: (r) => { setJob(r.data); setNotice(null); },
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
      setNotice(`Uploaded ${r.data.size_kb} KB and checked the columns. Choose a date, or leave it blank for the whole file, then Rebuild.`);
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
        <div className="panel pad border-l-2 border-l-signal-green text-sm text-ink-soft">
          {notice}
        </div>
      ) : null}

      {/* The lane badge is loud on purpose. A synthetic dataset may demonstrate
          the pipeline and may never back an accuracy claim, and the moment
          that is not obvious on screen the guarantee is worth nothing. */}
      <div className={`panel pad ${synthetic ? "border-signal-amber" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="eyebrow">Live dataset</div>
            <div className="mt-1 font-mono text-lg text-ink">
              {d.current.model_version ?? "none"}
            </div>
            <dl className="mt-3 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
              <Row k="Deciding for" v={d.current.clock ?? "—"} />
              <Row k="Fitted as of" v={d.current.as_of ?? "the whole file"} />
              <Row k="Snapshot" v={d.current.snapshot_id ?? "—"} mono />
              <Row k="Warehouse" v={d.data_root} mono />
            </dl>
          </div>
          <div
            className={`px-3 py-2 text-sm ${
              synthetic
                ? "bg-signal-amber/[0.12] text-signal-amber"
                : "bg-signal-green/[0.08] text-signal-green"
            }`}
          >
            <div className="font-mono text-xs uppercase tracking-[0.18em]">
              lane · {d.current.origin}
            </div>
            <div className="mt-1 max-w-xs text-xs">{d.lanes[d.current.origin]}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="panel">
          <PanelHead>Run it as of a different date</PanelHead>
          <div className="px-5 py-4">
            <p className="fine">
              The data is truncated <em>before</em> anything is fitted, so the demand class,
              the routing, the models and the calibration are all recomputed on what was
              knowable that day. It is not a filter over a finished forecast — that would
              already have leaked.
            </p>

            <label className="mt-4 block text-sm text-ink-soft">
              Source file
              <select
                className="mt-1 w-full border border-line bg-paper-sunk px-2 py-1.5 text-sm text-ink focus:border-ink focus:outline-none"
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

            <label className="mt-3 block text-sm text-ink-soft">
              As of
              <input
                type="date"
                className="mt-1 w-full border border-line bg-paper-sunk px-2 py-1.5 font-mono text-sm text-ink focus:border-ink focus:outline-none"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
              />
              <span className="fine mt-1 block">
                Leave blank to run to the end of the file.
              </span>
            </label>

            <button
              className="btn-primary mt-4"
              disabled={busy}
              onClick={() => build.mutate()}
            >
              {busy ? "Building…" : "Rebuild"}
            </button>

            {build.isError ? <div className="mt-3"><ErrorCard error={build.error} /></div> : null}

            {job ? (
              <div className="mt-4 border-t border-line pt-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-ink-mute">{job.job_id}</span>
                  <span
                    className={
                      job.status === "failed"
                        ? "text-signal-red"
                        : job.status === "done"
                          ? "text-signal-green"
                          : "text-ink-mute"
                    }
                  >
                    {job.status} · {job.step}
                  </span>
                </div>
                {job.status !== "done" && job.status !== "failed" ? (
                  <div className="mt-2 h-1 w-full overflow-hidden bg-wash">
                    <div className="h-full w-1/3 animate-pulse bg-ink/40" />
                  </div>
                ) : null}
                {job.error ? (
                  <p className="mt-2 text-signal-red">{job.error}</p>
                ) : null}
                {job.status === "done" ? (
                  <p className="fine mt-2">
                    Published. The system now decides for {job.as_of_clock}.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="panel">
          <PanelHead>Use your own file</PanelHead>
          <div className="px-5 py-4">
            <p className="fine">
              A daily CSV with a <span className="font-mono">datum</span> column and one
              column per ATC code. The columns are checked before anything expensive
              starts, so a wrong file fails here rather than four minutes later.
            </p>
            <input
              type="file"
              accept=".csv"
              disabled={upload.isPending}
              className="mt-4 block w-full text-sm text-ink-soft file:mr-3 file:border file:border-line file:bg-paper-sunk file:px-3 file:py-1.5 file:text-sm file:text-ink"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
              }}
            />
            {upload.isPending ? <p className="fine mt-2">Uploading…</p> : null}
            {upload.isError ? <div className="mt-3"><ErrorCard error={upload.error} /></div> : null}

            <p className="fine mt-4 text-xs">
              An uploaded file is treated as lane 1, observed — it is your pharmacy's own
              sales. The synthetic extension in the dropdown is lane 3: it will run the
              whole pipeline and move the clock to 2026, and every accuracy figure it
              produces is labelled as unable to back a claim.
            </p>
          </div>
        </div>
      </div>

      <div className="panel">
        <PanelHead right={<span className="fine">publication is a pointer swap, so switching back is instant</span>}>
          Every version built
        </PanelHead>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Version", "Lane", "As of", "Built", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-medium text-ink-mute">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.versions.map((v) => (
                <tr key={v.slug} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-2 font-mono text-xs text-ink-soft">{v.slug}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`chip ${
                        v.origin === "observed"
                          ? "bg-signal-green/[0.08] text-signal-green"
                          : "bg-signal-amber/[0.12] text-signal-amber"
                      }`}
                    >
                      {v.origin}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-mute">
                    {v.as_of ?? "whole file"}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-faint">
                    {v.generated_at?.replace("T", " ").replace("Z", "") ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {v.is_current ? (
                      <span className="chip bg-wash-strong text-ink">live</span>
                    ) : (
                      <button
                        className="btn-ghost text-xs"
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
    <div className="flex justify-between gap-4">
      <dt className="text-ink-mute">{k}</dt>
      <dd className={mono ? "font-mono text-xs text-ink-soft" : "text-ink"}>{v}</dd>
    </div>
  );
}
