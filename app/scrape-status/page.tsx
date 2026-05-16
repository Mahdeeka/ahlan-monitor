"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  Activity, CheckCircle2, AlertTriangle, XCircle, Clock,
  ArrowLeft, RefreshCw, Cpu, Database, Calendar, Zap,
} from "lucide-react";

type PerEvent = {
  slug: string;
  title: string;
  stage: string;
  venue: string;
  date: string;
  last_seen_ts: number;
  age_seconds: number | null;
  is_stale: boolean;
  stale_threshold_seconds: number;
  is_canonical: boolean;
  is_priority: boolean;
  priority_reasons: string[];
  poll_cadence: string;
  urgency: string;
  total_remaining: number | null;
  total_capacity: number | null;
  last_error: { ts: number; msg: string; consecutive_failures: number } | null;
};

type Run = {
  id: number;
  ts: number;
  source: string;
  received_count: number;
  ok_count: number;
  error_count: number;
  changes_count: number;
  elapsed_ms: number | null;
};

type Status = {
  now: number;
  summary: {
    canonical_slug_count: number;
    tracked_event_count: number;
    fresh_event_count: number;
    stale_event_count: number;
    priority_event_count: number;
    normal_event_count: number;
    stale_threshold_seconds: number;
    stale_threshold_priority_seconds: number;
    last_run_ts: number | null;
    seconds_since_last_run: number | null;
    runs_1h: number; runs_24h: number; runs_7d: number;
    events_ok_1h: number; events_ok_24h: number;
    events_err_1h: number; events_err_24h: number;
    priority_runs_1h: number; priority_runs_24h: number;
    all_runs_1h: number; all_runs_24h: number;
  };
  per_event: PerEvent[];
  recent_runs: Run[];
};

function fmtAge(seconds: number | null): string {
  if (seconds == null) return "never";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function fmtTime(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function freshnessColor(seconds: number | null): string {
  if (seconds == null) return "text-slate-500";
  if (seconds < 60)   return "text-emerald-400";
  if (seconds < 300)  return "text-green-400";
  if (seconds < 600)  return "text-yellow-400";
  if (seconds < 1800) return "text-orange-400";
  return "text-red-400";
}

function freshnessBg(seconds: number | null): string {
  if (seconds == null) return "bg-slate-700/30 border-slate-600/40";
  if (seconds < 60)   return "bg-emerald-500/10 border-emerald-500/30";
  if (seconds < 300)  return "bg-green-500/10 border-green-500/30";
  if (seconds < 600)  return "bg-yellow-500/10 border-yellow-500/30";
  if (seconds < 1800) return "bg-orange-500/10 border-orange-500/30";
  return "bg-red-500/10 border-red-500/30";
}

export default function ScrapeStatusPage() {
  const [data, setData] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "priority" | "normal" | "stale" | "fresh" | "errors" | "non-canonical">("all");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    const fetcher = () =>
      fetch(`/api/scrape-status?t=${Date.now()}`, { cache: "no-store" })
        .then(r => r.json())
        .then(d => { if (live) { setData(d); setLoading(false); setErr(null); } })
        .catch(e => { if (live) { setErr(String(e)); setLoading(false); } });
    fetcher();
    const id = autoRefresh ? setInterval(fetcher, 15_000) : null;
    return () => { live = false; if (id) clearInterval(id); };
  }, [autoRefresh]);

  // Tick every second so age labels update live
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    let evts = data.per_event;
    if (filter === "priority") evts = evts.filter(e => e.is_priority);
    if (filter === "normal")   evts = evts.filter(e => !e.is_priority);
    if (filter === "stale")    evts = evts.filter(e => e.is_stale);
    if (filter === "fresh")    evts = evts.filter(e => !e.is_stale);
    if (filter === "errors")   evts = evts.filter(e => e.last_error && e.last_error.consecutive_failures > 0);
    if (filter === "non-canonical") evts = evts.filter(e => !e.is_canonical);
    return evts;
  }, [data, filter, tick]);

  const liveAge = (ts: number | null) => {
    if (!data || !ts) return null;
    // Account for time passing on the client + the small clock skew vs server
    return Math.floor(Date.now() / 1000) - ts;
  };

  return (
    <div className="min-h-screen">
      {/* HEADER */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-slate-950/60 border-b border-white/5">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 flex items-center gap-3 sm:gap-6">
          <Link href="/" className="text-slate-400 hover:text-white transition-colors" title="Back to dashboard">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-3">
            <Activity className="w-6 h-6 text-indigo-400" />
            <div>
              <div className="text-base sm:text-xl font-bold tracking-tight">Scrape Monitor</div>
              <div className="text-[10px] sm:text-xs text-slate-400">
                Per-match freshness · scrape run history · proxy health
              </div>
            </div>
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={
              "px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-colors " +
              (autoRefresh
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                : "bg-slate-700/40 text-slate-300 border-slate-600/30 hover:bg-slate-700/60")
            }
            title={autoRefresh ? "Auto-refresh: ON (15s)" : "Auto-refresh: OFF"}
          >
            <RefreshCw className={"w-3.5 h-3.5 " + (autoRefresh ? "animate-spin-slow" : "")} />
            <span className="hidden sm:inline">{autoRefresh ? "Auto 15s" : "Paused"}</span>
          </button>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {err && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-xl p-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" /> Failed to load: {err}
          </div>
        )}

        {data && (
          <>
            {/* TWO-TIER POLLING BANNER */}
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-2xl p-4 border border-red-500/30 bg-gradient-to-br from-red-500/15 to-red-500/5">
                <div className="flex items-center gap-2 text-[11px] text-red-300 uppercase tracking-wider mb-1">
                  <Zap className="w-3.5 h-3.5" />
                  Priority cadence · every 3 min
                </div>
                <div className="text-2xl font-bold text-red-200 tabular-nums">
                  {data.summary.priority_event_count}
                  <span className="text-base opacity-50"> events</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  Sold out / premium-cat sold out / 95%+ sold ·{" "}
                  {data.summary.priority_runs_1h} runs in last hour
                </div>
              </div>
              <div className="rounded-2xl p-4 border border-indigo-500/30 bg-gradient-to-br from-indigo-500/15 to-indigo-500/5">
                <div className="flex items-center gap-2 text-[11px] text-indigo-300 uppercase tracking-wider mb-1">
                  <Clock className="w-3.5 h-3.5" />
                  Standard cadence · every 10 min
                </div>
                <div className="text-2xl font-bold text-indigo-200 tabular-nums">
                  {data.summary.normal_event_count}
                  <span className="text-base opacity-50"> events</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  All other matches ·{" "}
                  {data.summary.all_runs_1h} runs in last hour
                </div>
              </div>
            </section>

            {/* TOP STATS */}
            <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard
                icon={<Database className="w-4 h-4" />}
                label="Tracked events"
                value={`${data.summary.tracked_event_count} / ${data.summary.canonical_slug_count}`}
                sub={data.summary.tracked_event_count >= data.summary.canonical_slug_count
                  ? "complete" : `${data.summary.canonical_slug_count - data.summary.tracked_event_count} missing`}
                tone={data.summary.tracked_event_count >= data.summary.canonical_slug_count ? "green" : "orange"}
              />
              <StatCard
                icon={<CheckCircle2 className="w-4 h-4" />}
                label="Fresh"
                value={data.summary.fresh_event_count}
                sub={`fresh per match's cadence`}
                tone="green"
              />
              <StatCard
                icon={<AlertTriangle className="w-4 h-4" />}
                label="Stale"
                value={data.summary.stale_event_count}
                sub={`past expected cadence`}
                tone={data.summary.stale_event_count > 0 ? "red" : "green"}
              />
              <StatCard
                icon={<Clock className="w-4 h-4" />}
                label="Last scrape"
                value={fmtAge(liveAge(data.summary.last_run_ts))}
                sub={fmtTime(data.summary.last_run_ts)}
                tone={liveAge(data.summary.last_run_ts) != null && liveAge(data.summary.last_run_ts)! < 200 ? "green" : "orange"}
              />
              <StatCard
                icon={<Cpu className="w-4 h-4" />}
                label="Runs (1h / 24h)"
                value={`${data.summary.runs_1h} / ${data.summary.runs_24h}`}
                sub={`${data.summary.priority_runs_1h}p · ${data.summary.all_runs_1h}all (1h)`}
              />
              <StatCard
                icon={<XCircle className="w-4 h-4" />}
                label="Errors (24h)"
                value={data.summary.events_err_24h}
                sub={`${data.summary.events_err_1h} in last hour`}
                tone={data.summary.events_err_24h > 0 ? "orange" : "green"}
              />
            </section>

            {/* FILTERS */}
            <section className="glass rounded-2xl p-3 sm:p-4 flex flex-wrap gap-2 items-center">
              <span className="text-xs text-slate-400 px-2">View:</span>
              {(["all","priority","normal","stale","fresh","errors","non-canonical"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={
                    "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors " +
                    (filter === f
                      ? "bg-indigo-500/20 text-indigo-200 border-indigo-500/40"
                      : "bg-slate-800/40 text-slate-300 border-white/5 hover:bg-slate-800/60")
                  }
                >
                  {f === "all" ? `All (${data.per_event.length})` :
                   f === "priority" ? `🔥 Priority (${data.per_event.filter(e => e.is_priority).length})` :
                   f === "normal" ? `Normal (${data.per_event.filter(e => !e.is_priority).length})` :
                   f === "stale" ? `Stale (${data.per_event.filter(e => e.is_stale).length})` :
                   f === "fresh" ? `Fresh (${data.per_event.filter(e => !e.is_stale).length})` :
                   f === "errors" ? `Errors (${data.per_event.filter(e => e.last_error && e.last_error.consecutive_failures > 0).length})` :
                   `Non-canonical (${data.per_event.filter(e => !e.is_canonical).length})`}
                </button>
              ))}
            </section>

            {/* PER-EVENT GRID */}
            <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.length === 0 && (
                <div className="col-span-full text-center text-slate-500 py-8">
                  No events match this filter.
                </div>
              )}
              {filtered.map(ev => {
                const age = liveAge(ev.last_seen_ts);
                const hasError = ev.last_error && ev.last_error.consecutive_failures > 0;
                return (
                  <div
                    key={ev.slug}
                    className={"rounded-xl p-3 border transition-colors " +
                      (hasError ? "bg-red-500/10 border-red-500/40"
                        : ev.is_stale ? "bg-orange-500/5 border-orange-500/30"
                        : "bg-slate-800/30 border-white/5 hover:border-white/15")}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate flex items-center gap-1.5" title={ev.title}>
                          {ev.is_priority && (
                            <span title={`Fast-poll (every 3 min) — ${ev.priority_reasons.join(", ")}`}>
                              <Zap className="w-3.5 h-3.5 text-red-400 shrink-0" />
                            </span>
                          )}
                          <span className="truncate">{ev.title}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 truncate" title={ev.slug}>{ev.slug}</div>
                      </div>
                      <span className={"text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 " +
                        (ev.stage === "FINAL" ? "bg-purple-500/20 text-purple-300"
                          : ev.stage === "Semifinal" ? "bg-indigo-500/20 text-indigo-300"
                          : ev.stage === "Quarterfinal" ? "bg-blue-500/20 text-blue-300"
                          : ev.stage === "Round of 16" ? "bg-cyan-500/20 text-cyan-300"
                          : "bg-slate-700/40 text-slate-300")}>
                        {ev.stage}
                      </span>
                    </div>

                    <div className={"rounded-lg px-2.5 py-1.5 border " + freshnessBg(age)}>
                      <div className="flex items-baseline gap-2">
                        <div className={"text-sm font-semibold tabular-nums " + freshnessColor(age)}>
                          {fmtAge(age)}
                        </div>
                        <div className="text-[10px] text-slate-500 tabular-nums">
                          {fmtTime(ev.last_seen_ts)}
                        </div>
                      </div>
                    </div>

                    {ev.total_capacity != null && (
                      <div className="mt-2 flex items-center justify-between text-[11px]">
                        <span className="text-slate-400">
                          {ev.total_remaining}/{ev.total_capacity} left
                        </span>
                        <span className={`urgency-${ev.urgency} font-medium`}>
                          {ev.urgency.replace("_", " ")}
                        </span>
                      </div>
                    )}

                    {!ev.is_canonical && (
                      <div className="mt-2 text-[10px] text-amber-300 bg-amber-500/10 rounded px-2 py-1 border border-amber-500/30">
                        ⚠ Not in canonical slug list (legacy/test)
                      </div>
                    )}

                    {hasError && (
                      <div className="mt-2 text-[10px] text-red-300 bg-red-500/10 rounded px-2 py-1 border border-red-500/30">
                        <div className="font-semibold">
                          {ev.last_error!.consecutive_failures}× consecutive failures
                        </div>
                        <div className="truncate" title={ev.last_error!.msg}>
                          {ev.last_error!.msg}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>

            {/* SCRAPE RUNS LOG */}
            <section className="glass rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="w-4 h-4 text-indigo-400" />
                <h2 className="text-sm font-semibold">Recent scrape runs</h2>
                <span className="text-[10px] text-slate-500">
                  ({data.recent_runs.length} most recent)
                </span>
              </div>
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-xs">
                  <thead className="text-slate-500 border-b border-white/5">
                    <tr>
                      <th className="text-left font-medium py-2 pr-4">When</th>
                      <th className="text-left font-medium py-2 pr-4">Source</th>
                      <th className="text-right font-medium py-2 pr-4">Recv</th>
                      <th className="text-right font-medium py-2 pr-4">OK</th>
                      <th className="text-right font-medium py-2 pr-4">Err</th>
                      <th className="text-right font-medium py-2 pr-4">Changes</th>
                      <th className="text-right font-medium py-2">Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_runs.length === 0 && (
                      <tr><td colSpan={7} className="py-6 text-center text-slate-500">
                        No scrape runs recorded yet — waiting for first GitHub Actions run.
                      </td></tr>
                    )}
                    {data.recent_runs.map(r => (
                      <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="py-1.5 pr-4 tabular-nums">
                          <span className={freshnessColor(liveAge(r.ts))}>{fmtAge(liveAge(r.ts))}</span>
                          <div className="text-[10px] text-slate-500">{fmtTime(r.ts)}</div>
                        </td>
                        <td className="py-1.5 pr-4 text-slate-300">{r.source}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{r.received_count}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums text-emerald-400">{r.ok_count}</td>
                        <td className={"py-1.5 pr-4 text-right tabular-nums " +
                          (r.error_count > 0 ? "text-red-400" : "text-slate-500")}>
                          {r.error_count}
                        </td>
                        <td className={"py-1.5 pr-4 text-right tabular-nums " +
                          (r.changes_count > 0 ? "text-indigo-300" : "text-slate-500")}>
                          {r.changes_count || "·"}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-slate-400">
                          {r.elapsed_ms != null ? `${r.elapsed_ms}ms` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* FOOTER NOTE */}
            <section className="text-[11px] text-slate-500 px-2 pb-8 space-y-1">
              <div>
                Page auto-refreshes every 15s when enabled. Two scrape cadences run via
                GitHub Actions:
              </div>
              <div>
                <span className="text-red-300">🔥 Priority lane</span> — every{" "}
                <span className="text-slate-300">3 min</span>, only sold-out events or events
                with premium categories sold out (currently{" "}
                <span className="text-slate-300">{data.summary.priority_event_count}</span> matches).
                Stale threshold: {Math.floor(data.summary.stale_threshold_priority_seconds / 60)}m.
              </div>
              <div>
                <span className="text-indigo-300">⏱ Standard lane</span> — every{" "}
                <span className="text-slate-300">10 min</span>, all{" "}
                <span className="text-slate-300">{data.summary.canonical_slug_count}</span> events.
                Stale threshold: {Math.floor(data.summary.stale_threshold_seconds / 60)}m.
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function StatCard({
  icon, label, value, sub, tone,
}: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string;
  tone?: "green" | "red" | "orange" | "yellow";
}) {
  const tones: Record<string, string> = {
    green:  "bg-emerald-500/10 border-emerald-500/30 text-emerald-200",
    red:    "bg-red-500/10 border-red-500/30 text-red-200",
    orange: "bg-orange-500/10 border-orange-500/30 text-orange-200",
    yellow: "bg-yellow-500/10 border-yellow-500/30 text-yellow-200",
  };
  return (
    <div className={"rounded-xl p-3 border " + (tone ? tones[tone] : "glass")}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide opacity-70 mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] opacity-60 mt-0.5">{sub}</div>}
    </div>
  );
}
