"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, ExternalLink, Bell, BellOff } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Area, AreaChart
} from "recharts";
import clsx from "clsx";
import type { Event } from "@/lib/types";

interface HistPoint { ts: number; r: number; q: number; }

function rangeToCutoff(r: "1d" | "7d" | "30d" | "all"): number {
  const now = Math.floor(Date.now() / 1000);
  if (r === "1d") return now - 86400;
  if (r === "7d") return now - 7 * 86400;
  if (r === "30d") return now - 30 * 86400;
  return 0;
}

export function DetailModal({
  event, subscribed, onToggleSubscribe, onClose,
}: {
  event: Event;
  subscribed: boolean;
  onToggleSubscribe: () => void;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<HistPoint[]>([]);
  const [range, setRange] = useState<"1d" | "7d" | "30d" | "all">("7d");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    // 1) Show instant local cache while server loads
    try {
      const raw = localStorage.getItem(`afc.history.${event.slug}`);
      const arr = raw ? JSON.parse(raw) : [];
      setHistory(arr.map((x: any) => ({ ts: x.ts, r: x.remaining ?? 0, q: x.capacity ?? 0 })));
    } catch { /* */ }
    // 2) Then fetch full history from server DB
    const limit = range === "1d" ? 2000 : range === "7d" ? 5000 : range === "30d" ? 10000 : 10000;
    fetch(`/api/history/${encodeURIComponent(event.slug)}?limit=${limit}`)
      .then(r => r.json())
      .then(data => {
        if (data?.history?.length) {
          const cutoff = rangeToCutoff(range);
          const filtered = (data.history as any[])
            .filter(h => !cutoff || h.ts >= cutoff)
            .map(h => ({ ts: h.ts, r: h.total_remaining, q: h.total_capacity }));
          setHistory(filtered);
        }
      })
      .catch(() => {/* keep cache */})
      .finally(() => setLoading(false));
  }, [event.slug, range]);

  const chartData = history.map(h => {
    const d = new Date(h.ts * 1000);
    const fmt = (range === "1d")
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
        d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return { time: fmt, remaining: h.r };
  });

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: "spring", damping: 22, stiffness: 250 }}
        onClick={e => e.stopPropagation()}
        className="glass rounded-2xl w-full max-w-3xl my-4 max-h-[95vh] overflow-y-auto border border-white/10"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between p-6 pb-3 backdrop-blur-xl bg-slate-950/70 border-b border-white/5">
          <div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700/40 text-slate-300 border border-slate-600/30">
              {event.stage} · #{event.match_number}
            </span>
            <h2 className="text-2xl font-bold mt-2 tracking-tight">{event.title}</h2>
            <div className="text-sm text-slate-400">{event.date}</div>
            <div className="text-sm text-slate-500">{event.venue}, {event.city}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="glass rounded-xl p-3">
              <div className="text-2xl font-bold">{event.total_remaining.toLocaleString()}</div>
              <div className="text-xs text-slate-400 uppercase tracking-wider">Remaining</div>
            </div>
            <div className="glass rounded-xl p-3">
              <div className="text-2xl font-bold">{event.total_capacity.toLocaleString()}</div>
              <div className="text-xs text-slate-400 uppercase tracking-wider">Capacity</div>
            </div>
            <div className="glass rounded-xl p-3">
              <div className={clsx("text-2xl font-bold", `urgency-${event.urgency}`)}>{event.pct_sold}%</div>
              <div className="text-xs text-slate-400 uppercase tracking-wider">Sold</div>
            </div>
          </div>

          {/* Trend chart with range selector */}
          {chartData.length > 1 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-300">📉 Trend over time</h3>
                <div className="flex gap-1 text-xs">
                  {(["1d","7d","30d","all"] as const).map(r => (
                    <button key={r} onClick={() => setRange(r)}
                      className={clsx("px-2 py-1 rounded-md transition-colors",
                        range === r
                          ? "bg-indigo-500/30 text-indigo-200"
                          : "bg-slate-700/30 text-slate-400 hover:bg-slate-700/50")}>
                      {r === "1d" ? "24h" : r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="glass rounded-xl p-3 h-48 relative">
                {loading && (
                  <div className="absolute top-2 right-2 text-[10px] text-slate-500 animate-pulse">Loading history...</div>
                )}
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.6} />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} />
                    <YAxis stroke="#64748b" fontSize={10} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                    />
                    <Area type="monotone" dataKey="remaining" stroke="#818cf8" strokeWidth={2} fill="url(#g1)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          {chartData.length <= 1 && (
            <div className="mb-6 glass rounded-xl p-6 text-center text-sm text-slate-500">
              Trend chart will appear after a few minutes of monitoring.
            </div>
          )}

          {/* Categories */}
          <h3 className="text-sm font-semibold text-slate-300 mb-2">All categories</h3>
          <div className="space-y-2">
            {event.categories.map(c => {
              const pctSold = c.quantity ? ((c.quantity - c.remaining) / c.quantity) * 100 : 0;
              return (
                <div key={c.name} className="glass rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{c.name}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Max per order: {c.max_per_order}
                      {c.price > 0 && <> · SAR {c.price}</>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={clsx("text-sm font-semibold", c.sold_out ? "text-red-400" : "text-slate-100")}>
                      {c.sold_out ? "SOLD OUT" : `${c.remaining.toLocaleString()} / ${c.quantity.toLocaleString()}`}
                    </div>
                    {!c.sold_out && c.quantity > 0 && (
                      <div className="text-[11px] text-slate-500">{pctSold.toFixed(0)}% sold</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="mt-6 flex flex-col sm:flex-row gap-2">
            <button
              onClick={onToggleSubscribe}
              className={clsx(
                "flex-1 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2",
                subscribed
                  ? "bg-indigo-500/20 text-indigo-200 border border-indigo-400/30"
                  : "bg-slate-700/30 text-slate-300 border border-slate-600/30 hover:bg-slate-700/50"
              )}
            >
              {subscribed ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
              {subscribed ? "Subscribed — click to unsubscribe" : "Get notifications for this match"}
            </button>
            <a
              href={`https://www.ahlan.sa/events/details?event=${event.slug}`}
              target="_blank"
              rel="noopener"
              className="px-4 py-2.5 rounded-lg text-sm bg-slate-700/40 hover:bg-slate-700/60 transition-colors flex items-center justify-center gap-2"
            >
              <ExternalLink className="w-4 h-4" /> Open on ahlan.sa
            </a>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
