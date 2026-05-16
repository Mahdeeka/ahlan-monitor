"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Activity, CheckCircle2, AlertTriangle, XCircle, Database,
  Server, Zap, Clock, Globe,
} from "lucide-react";

type Health = {
  now: number;
  ok: boolean;
  components: {
    database?:    { ok: boolean; latency_ms?: number; error?: string };
    scraper?:     {
      ok: boolean;
      last_run_ts: number | null;
      last_run_seconds_ago: number | null;
      runs_5m: number; runs_1h: number; runs_24h: number; runs_alltime: number;
      ok_24h: number; errors_24h: number;
      avg_latency_1h: number | null;
      priority_lane: { runs_1h: number; expected_per_hour: number; health: number };
      standard_lane: { runs_1h: number; expected_per_hour: number; health: number };
      first_run_ts: number | null;
      uptime_hours: number;
    };
    slug_errors?: { ok: boolean; currently_failing: number; failed_last_hour: number; max_consecutive: number; total_ever_failed: number };
    proxies?:     { ok: boolean; success_rate_24h: number; total_failures_24h: number; partial_failures_24h: number; note?: string };
    events?:      { ok: boolean; total_tracked: number; oldest_age_seconds: number | null; newest_age_seconds: number | null };
    runtime?:     { vercel_region?: string; deployment_id?: string | null; deployment_url?: string | null; node_version?: string };
  };
};

function fmtAge(s: number | null | undefined): string {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m`;
  if (s < 86400) return `${Math.floor(s/3600)}h`;
  return `${Math.floor(s/86400)}d`;
}

export default function HealthPage() {
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    let alive = true;
    const fetcher = () =>
      fetch("/api/health", { cache: "no-store" })
        .then(r => r.json())
        .then(d => { if (alive) { setData(d); setLoading(false); } })
        .catch(() => { if (alive) setLoading(false); });
    fetcher();
    const id = autoRefresh ? setInterval(fetcher, 10_000) : null;
    return () => { alive = false; if (id) clearInterval(id); };
  }, [autoRefresh]);

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const c = data.components;
  const overall = data.ok ? "operational" : "degraded";
  const overallColor = data.ok ? "text-emerald-400" : "text-orange-400";
  const overallBg = data.ok
    ? "from-emerald-500/15 to-emerald-600/5 border-emerald-500/30"
    : "from-orange-500/20 to-red-600/5 border-orange-500/40";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-slate-950/60 border-b border-white/5">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <Link href="/" className="text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Server className="w-6 h-6 text-emerald-400" />
          <div>
            <div className="text-base sm:text-xl font-bold tracking-tight">System Status</div>
            <div className="text-[10px] sm:text-xs text-slate-400">
              Live health checks · refreshes every 10s
            </div>
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={"px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 " +
              (autoRefresh ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                : "bg-slate-700/40 text-slate-300 border-slate-600/30")}>
            <Activity className={"w-3.5 h-3.5 " + (autoRefresh ? "animate-pulse" : "")} />
            {autoRefresh ? "Live" : "Paused"}
          </button>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Overall status banner */}
        <section className={"rounded-2xl p-5 border bg-gradient-to-br " + overallBg}>
          <div className="flex items-center gap-3">
            {data.ok ? <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                     : <AlertTriangle className="w-7 h-7 text-orange-400" />}
            <div>
              <div className={"text-2xl font-bold " + overallColor}>
                {data.ok ? "All systems operational" : "System degraded"}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                Last checked {new Date(data.now * 1000).toLocaleTimeString()}{" "}
                · uptime monitoring active
              </div>
            </div>
          </div>
        </section>

        {/* Component cards */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* SCRAPER */}
          {c.scraper && (
            <Card title="Ticket scraper" icon={<Activity className="w-4 h-4" />} ok={c.scraper.ok}>
              <Stat label="Last scrape" value={fmtAge(c.scraper.last_run_seconds_ago) + " ago"}
                tone={(c.scraper.last_run_seconds_ago ?? 9999) < 300 ? "good" : "warn"} />
              <Stat label="Runs in last 5m"  value={c.scraper.runs_5m} />
              <Stat label="Runs in last 1h"  value={c.scraper.runs_1h} />
              <Stat label="Runs in last 24h" value={c.scraper.runs_24h} />
              <Stat label="Lifetime runs"    value={c.scraper.runs_alltime?.toLocaleString()} />
              <Stat label="Uptime"  value={`${c.scraper.uptime_hours.toFixed(1)}h`} />
              {c.scraper.avg_latency_1h != null && (
                <Stat label="Avg run latency (1h)" value={`${c.scraper.avg_latency_1h}ms`} />
              )}
            </Card>
          )}

          {/* PROXIES */}
          {c.proxies && (
            <Card title="Webshare proxy pool" icon={<Globe className="w-4 h-4" />} ok={c.proxies.ok}>
              <Stat label="Success rate (24h)" value={`${c.proxies.success_rate_24h}%`}
                tone={c.proxies.success_rate_24h >= 95 ? "good" : c.proxies.success_rate_24h >= 80 ? "warn" : "bad"} />
              <Stat label="Total-fail runs (24h)" value={c.proxies.total_failures_24h}
                tone={c.proxies.total_failures_24h === 0 ? "good" : "warn"} />
              <Stat label="Partial-fail runs (24h)" value={c.proxies.partial_failures_24h}
                tone={c.proxies.partial_failures_24h === 0 ? "good" : "warn"} />
              {c.proxies.note && (
                <div className="text-[10px] text-slate-500 mt-2 leading-snug">{c.proxies.note}</div>
              )}
            </Card>
          )}

          {/* DATABASE */}
          {c.database && (
            <Card title="Database (Neon Postgres)" icon={<Database className="w-4 h-4" />} ok={c.database.ok}>
              <Stat label="Status" value={c.database.ok ? "Connected" : "Down"}
                tone={c.database.ok ? "good" : "bad"} />
              {c.database.latency_ms != null && (
                <Stat label="Query latency" value={`${c.database.latency_ms}ms`}
                  tone={c.database.latency_ms < 100 ? "good" : c.database.latency_ms < 500 ? "warn" : "bad"} />
              )}
              {c.database.error && (
                <div className="text-[10px] text-red-300 mt-2">{c.database.error}</div>
              )}
            </Card>
          )}

          {/* EVENTS FRESHNESS */}
          {c.events && (
            <Card title="Events freshness" icon={<Clock className="w-4 h-4" />} ok={c.events.ok}>
              <Stat label="Total tracked" value={c.events.total_tracked} />
              <Stat label="Newest update" value={fmtAge(c.events.newest_age_seconds) + " ago"}
                tone={(c.events.newest_age_seconds ?? 9999) < 600 ? "good" : "warn"} />
              <Stat label="Oldest update" value={fmtAge(c.events.oldest_age_seconds) + " ago"}
                tone={(c.events.oldest_age_seconds ?? 9999) < 1200 ? "good" : "warn"} />
            </Card>
          )}

          {/* PRIORITY LANE */}
          {c.scraper?.priority_lane && (
            <Card title="Priority lane (3-min)" icon={<Zap className="w-4 h-4 text-red-400" />} ok={c.scraper.priority_lane.health > 70}>
              <Stat label="Runs in last 1h" value={`${c.scraper.priority_lane.runs_1h} / ${c.scraper.priority_lane.expected_per_hour}`} />
              <Stat label="Health" value={`${c.scraper.priority_lane.health}%`}
                tone={c.scraper.priority_lane.health >= 80 ? "good" : c.scraper.priority_lane.health >= 50 ? "warn" : "bad"} />
              <ProgressBar pct={c.scraper.priority_lane.health} />
            </Card>
          )}

          {/* STANDARD LANE */}
          {c.scraper?.standard_lane && (
            <Card title="Standard lane (10-min)" icon={<Clock className="w-4 h-4 text-indigo-400" />} ok={c.scraper.standard_lane.health > 70}>
              <Stat label="Runs in last 1h" value={`${c.scraper.standard_lane.runs_1h} / ${c.scraper.standard_lane.expected_per_hour}`} />
              <Stat label="Health" value={`${c.scraper.standard_lane.health}%`}
                tone={c.scraper.standard_lane.health >= 80 ? "good" : c.scraper.standard_lane.health >= 50 ? "warn" : "bad"} />
              <ProgressBar pct={c.scraper.standard_lane.health} />
            </Card>
          )}

          {/* SLUG ERRORS */}
          {c.slug_errors && (
            <Card title="Per-slug failures" icon={<XCircle className="w-4 h-4" />} ok={c.slug_errors.ok}>
              <Stat label="Currently failing" value={c.slug_errors.currently_failing}
                tone={c.slug_errors.currently_failing === 0 ? "good" : "bad"} />
              <Stat label="Failed in last hour" value={c.slug_errors.failed_last_hour}
                tone={c.slug_errors.failed_last_hour === 0 ? "good" : "warn"} />
              <Stat label="Max consecutive failures" value={c.slug_errors.max_consecutive} />
            </Card>
          )}

          {/* RUNTIME */}
          {c.runtime && (
            <Card title="Runtime" icon={<Server className="w-4 h-4" />}>
              <Stat label="Vercel region" value={c.runtime.vercel_region || "—"} />
              <Stat label="Node.js" value={c.runtime.node_version || "—"} />
              {c.runtime.deployment_id && (
                <Stat label="Deployment" value={c.runtime.deployment_id.slice(0, 12)} />
              )}
            </Card>
          )}
        </section>

        <div className="text-[10px] text-slate-500 pb-8 pt-2 text-center">
          This status page is generated server-side from real metrics in the Postgres DB.{" "}
          <a href="/api/health" className="underline hover:text-slate-300">Raw JSON</a> available for monitoring tools.
        </div>
      </main>
    </div>
  );
}

function Card({ title, icon, ok, children }: {
  title: string; icon: React.ReactNode; ok?: boolean; children: React.ReactNode;
}) {
  const ringClass = ok === true ? "border-emerald-500/20" : ok === false ? "border-orange-500/30" : "border-white/10";
  return (
    <div className={"glass rounded-2xl p-4 border " + ringClass}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          <span>{title}</span>
        </div>
        {ok !== undefined && (
          ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
             : <AlertTriangle className="w-4 h-4 text-orange-400" />
        )}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Stat({ label, value, tone }: {
  label: string; value: React.ReactNode; tone?: "good" | "warn" | "bad";
}) {
  const toneClass = tone === "good" ? "text-emerald-300"
    : tone === "warn" ? "text-orange-300"
    : tone === "bad" ? "text-red-300" : "text-slate-200";
  return (
    <div className="flex items-baseline justify-between text-xs">
      <span className="text-slate-400">{label}</span>
      <span className={`font-semibold tabular-nums ${toneClass}`}>{value}</span>
    </div>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="w-full h-1.5 bg-slate-700/40 rounded-full overflow-hidden mt-2">
      <div className={"h-full transition-all " + color} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}
