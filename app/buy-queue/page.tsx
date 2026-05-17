"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ShoppingCart, CheckCircle2, XCircle, Loader2, Clock,
  AlertTriangle, ExternalLink, Trash2, Activity,
} from "lucide-react";
import clsx from "clsx";

type Order = {
  id: number;
  slug: string; title: string | null; category: string;
  qty: number; max_price_sar: number | null;
  status: "pending" | "claimed" | "success" | "failed" | "sold_out" | "auth_error" | "cancelled" | "skipped";
  worker_id: string | null;
  result: string | null;
  error_msg: string | null;
  receipt_url: string | null;
  notes: string | null;
  account_email: string | null;
  account_name: string | null;
  created_at: number;
  claimed_at: number | null;
  completed_at: number | null;
  auto_rule_id: number | null;
};

type Data = {
  now: number;
  orders: Order[];
  stats: Record<string, number>;
  worker: { online: boolean; last_activity_seconds_ago: number | null; last_activity_ts: number | null };
};

function fmtAge(s: number | null | undefined): string {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m`;
  if (s < 86400) return `${Math.floor(s/3600)}h`;
  return `${Math.floor(s/86400)}d`;
}

function statusBadge(s: Order["status"]) {
  const cls = s === "pending"   ? "bg-slate-700/50 text-slate-300 border-slate-600/40"
    : s === "claimed"   ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/40 animate-pulse"
    : s === "success"   ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
    : s === "failed"    ? "bg-red-500/20 text-red-300 border-red-500/40"
    : s === "sold_out"  ? "bg-orange-500/20 text-orange-300 border-orange-500/40"
    : s === "auth_error"? "bg-purple-500/20 text-purple-300 border-purple-500/40"
    : s === "cancelled" ? "bg-slate-700/30 text-slate-400 border-slate-600/30 line-through"
    : "bg-slate-700/30 text-slate-400 border-slate-600/30";
  const label = s.replace("_", " ").toUpperCase();
  return <span className={"text-[10px] px-2 py-0.5 rounded font-bold border " + cls}>{label}</span>;
}

export default function BuyQueuePage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "done">("all");

  useEffect(() => {
    let alive = true;
    const fetcher = () =>
      fetch("/api/buy/orders", { cache: "no-store" })
        .then(r => r.json())
        .then(d => { if (alive) { setData(d); setLoading(false); } })
        .catch(() => { if (alive) setLoading(false); });
    fetcher();
    const id = autoRefresh ? setInterval(fetcher, 2500) : null;
    return () => { alive = false; if (id) clearInterval(id); };
  }, [autoRefresh]);

  async function cancel(id: number) {
    await fetch(`/api/buy/cancel/${id}`, { method: "POST" });
    // Refresh
    const r = await fetch("/api/buy/orders", { cache: "no-store" });
    setData(await r.json());
  }

  if (loading || !data) {
    return <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
    </div>;
  }

  const filtered = data.orders.filter(o =>
    filter === "all" ? true
    : filter === "active" ? (o.status === "pending" || o.status === "claimed")
    : (o.status !== "pending" && o.status !== "claimed")
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-slate-950/60 border-b border-white/5">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <Link href="/" className="text-slate-400 hover:text-white"><ArrowLeft className="w-5 h-5" /></Link>
          <ShoppingCart className="w-6 h-6 text-indigo-400" />
          <div>
            <div className="text-base sm:text-xl font-bold tracking-tight">Buy queue</div>
            <div className="text-[10px] sm:text-xs text-slate-400">
              Click-to-buy orders waiting for your local bot
            </div>
          </div>
          <Link href="/buy-queue/by-account"
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25">
            ✉ By account
          </Link>
          <div className="flex-1" />
          <div className={clsx(
            "px-2.5 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5",
            data.worker.online
              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
              : "bg-red-500/15 text-red-300 border-red-500/30"
          )}>
            <span className={clsx("inline-block w-1.5 h-1.5 rounded-full",
              data.worker.online ? "bg-emerald-400 animate-pulse" : "bg-red-400")} />
            {data.worker.online
              ? "Bot worker online"
              : data.worker.last_activity_seconds_ago != null
                ? `Bot last seen ${fmtAge(data.worker.last_activity_seconds_ago)} ago`
                : "Bot never connected"}
          </div>
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={clsx("px-2.5 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5",
              autoRefresh ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
                          : "bg-slate-700/40 text-slate-300 border-slate-600/30")}
          >
            <Activity className={"w-3.5 h-3.5 " + (autoRefresh ? "animate-pulse" : "")} />
            {autoRefresh ? "Live" : "Paused"}
          </button>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Worker setup hint */}
        {!data.worker.online && data.worker.last_activity_ts == null && (
          <section className="rounded-2xl border border-amber-500/40 bg-gradient-to-r from-amber-500/10 to-orange-500/5 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-amber-200 mb-1">
                  Worker bot not connected
                </div>
                <div className="text-xs text-amber-100/80 leading-relaxed">
                  Run <code className="text-amber-300 bg-amber-500/10 px-1 rounded">python scripts/buy_worker.py</code>{" "}
                  on your local machine (the one with your <code>ahlan_multi_bot.py</code>).
                  Set <code>DASHBOARD_URL</code> + <code>BUY_WORKER_TOKEN</code> env vars first.
                  Once it's running it'll pick up queued orders within 2 seconds.
                  <Link href="/buy-queue/setup" className="ml-2 underline">Setup guide →</Link>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Stats tiles */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile label="Pending"  value={data.stats.pending  || 0} icon={<Clock className="w-4 h-4" />} tone="slate" />
          <Tile label="In flight" value={data.stats.claimed || 0} icon={<Loader2 className="w-4 h-4" />} tone="yellow" />
          <Tile label="Successful" value={data.stats.success || 0} icon={<CheckCircle2 className="w-4 h-4" />} tone="green" />
          <Tile label="Failed"    value={(data.stats.failed || 0) + (data.stats.auth_error || 0) + (data.stats.sold_out || 0)}
                icon={<XCircle className="w-4 h-4" />} tone="red" />
        </section>

        {/* Filter */}
        <section className="flex gap-2">
          {(["all", "active", "done"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={clsx("px-3 py-1.5 rounded-lg text-xs font-medium border",
                filter === f
                  ? "bg-indigo-500/20 text-indigo-200 border-indigo-500/40"
                  : "bg-slate-800/40 text-slate-300 border-white/5 hover:bg-slate-800/60")}>
              {f === "all" ? `All (${data.orders.length})`
               : f === "active" ? `Active (${data.orders.filter(o => o.status === "pending" || o.status === "claimed").length})`
               : `Done (${data.orders.filter(o => o.status !== "pending" && o.status !== "claimed").length})`}
            </button>
          ))}
        </section>

        {/* Orders list */}
        <section className="space-y-2">
          {filtered.length === 0 && (
            <div className="glass rounded-xl p-8 text-center text-slate-500 text-sm">
              {filter === "all"
                ? "No buy orders yet. Open any match → click the Buy button on a category to queue your first one."
                : "No matches with this filter."}
            </div>
          )}
          {filtered.map(o => {
            const age = data.now - o.created_at;
            const inFlight = (o.status === "claimed");
            const flightTime = inFlight && o.claimed_at ? data.now - o.claimed_at : null;
            return (
              <div key={o.id} className={clsx(
                "glass rounded-xl p-4 flex items-center gap-3 border",
                o.status === "success" ? "border-emerald-500/30"
                : o.status === "failed" || o.status === "auth_error" ? "border-red-500/30"
                : o.status === "claimed" ? "border-yellow-500/30"
                : "border-white/5"
              )}>
                <div className="text-[10px] text-slate-500 tabular-nums w-10 shrink-0">#{o.id}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {statusBadge(o.status)}
                    <Link href={`/?open=${encodeURIComponent(o.slug)}`} className="text-sm font-semibold hover:text-indigo-300 truncate">
                      {o.title || o.slug}
                    </Link>
                    {o.auto_rule_id && (
                      <span title="From auto-buy rule" className="text-[9px] bg-purple-500/20 text-purple-300 px-1 rounded">AUTO</span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span><b className="text-slate-300">{o.category}</b> × {o.qty}</span>
                    {o.max_price_sar != null && <span>cap SAR {o.max_price_sar}</span>}
                    <span>queued {fmtAge(age)} ago</span>
                    {o.worker_id && <span>worker: {o.worker_id}</span>}
                    {flightTime != null && <span className="text-yellow-300">in flight {flightTime}s</span>}
                    {o.completed_at != null && (
                      <span>done in {(o.completed_at - o.created_at)}s</span>
                    )}
                    {o.account_email && (
                      <span className="bg-emerald-500/15 text-emerald-300 px-1.5 rounded font-semibold">
                        ✉ {o.account_email}
                      </span>
                    )}
                  </div>
                  {o.error_msg && (
                    <div className="mt-1 text-[10px] text-red-300/80 bg-red-500/5 rounded px-2 py-1">{o.error_msg}</div>
                  )}
                  {o.notes && (
                    <div className="mt-1 text-[10px] text-slate-400 italic">{o.notes}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {o.receipt_url && (
                    <a href={o.receipt_url} target="_blank" rel="noopener"
                       className="px-2 py-1 rounded text-[10px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 flex items-center gap-1">
                      <ExternalLink className="w-2.5 h-2.5" /> Receipt
                    </a>
                  )}
                  {o.status === "pending" && (
                    <button onClick={() => cancel(o.id)}
                      className="p-1.5 rounded hover:bg-red-500/15 text-slate-500 hover:text-red-300"
                      title="Cancel this order">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        <div className="text-[10px] text-slate-500 pb-8 pt-2 text-center">
          The dashboard never holds payment credentials — your local bot does. View{" "}
          <Link href="/buy-queue/setup" className="underline hover:text-slate-300">setup guide</Link>{" "}
          to wire up the worker.
        </div>
      </main>
    </div>
  );
}

function Tile({ label, value, icon, tone }: {
  label: string; value: number; icon: React.ReactNode; tone: "slate" | "yellow" | "green" | "red";
}) {
  const cls = tone === "slate" ? "bg-slate-800/40 text-slate-300 border-white/5"
    : tone === "yellow" ? "bg-yellow-500/10 text-yellow-300 border-yellow-500/30"
    : tone === "green" ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
    : "bg-red-500/10 text-red-300 border-red-500/30";
  return (
    <div className={"rounded-xl p-3 border " + cls}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide opacity-70 mb-1">
        {icon}<span>{label}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
