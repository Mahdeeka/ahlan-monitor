"use client";

import { useEffect, useState } from "react";
import { Clock, TrendingUp, TrendingDown, AlertOctagon, XCircle } from "lucide-react";

type Drop = {
  id: number;
  ts: number;
  type: "back_in_stock" | "tickets_added" | "category_sold_out" | "bulk_sale";
  category?: string;
  remaining?: number;
  added?: number;
  delta?: number;
  before?: number;
  after?: number;
  tickets_lost?: number;
  last_remaining?: number;
  per_category?: Array<{ category: string; before: number; after: number; delta: number }>;
};

type Data = {
  drops: Drop[];
  patterns: {
    by_hour: Record<number, number>;
    by_dow: Record<number, number>;
    total: number;
  };
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtAge(ts: number): string {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function DropsTimeline({ slug }: { slug: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/drops/${encodeURIComponent(slug)}`, { cache: "no-store" })
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return <div className="text-[11px] text-slate-500 py-2">Loading drops…</div>;
  }
  if (!data || data.drops.length === 0) {
    return <div className="text-[11px] text-slate-500 py-2 italic">No drop events recorded yet.</div>;
  }

  const peakHour = Object.entries(data.patterns.by_hour)
    .sort((a, b) => b[1] - a[1])[0];
  const peakDow = Object.entries(data.patterns.by_dow)
    .sort((a, b) => b[1] - a[1])[0];

  return (
    <div>
      {/* Pattern summary */}
      {data.patterns.total > 1 && (
        <div className="mb-3 grid grid-cols-2 gap-2 text-[11px]">
          <div className="glass rounded-lg p-2">
            <div className="text-slate-500 text-[10px]">Most common hour (UTC)</div>
            <div className="text-slate-200 font-semibold">
              {peakHour[0].padStart(2, "0")}:00 <span className="text-slate-500 font-normal">({peakHour[1]}×)</span>
            </div>
          </div>
          <div className="glass rounded-lg p-2">
            <div className="text-slate-500 text-[10px]">Most common day</div>
            <div className="text-slate-200 font-semibold">
              {DOW[parseInt(peakDow[0])]} <span className="text-slate-500 font-normal">({peakDow[1]}×)</span>
            </div>
          </div>
        </div>
      )}

      {/* Hour-of-day histogram */}
      {data.patterns.total > 3 && (
        <div className="mb-3">
          <div className="text-[10px] text-slate-500 mb-1">Drop frequency by hour (UTC)</div>
          <div className="flex items-end gap-0.5 h-10">
            {Object.entries(data.patterns.by_hour).map(([h, n]) => {
              const max = Math.max(...Object.values(data.patterns.by_hour));
              const pct = max ? (n / max) * 100 : 0;
              return (
                <div key={h} className="flex-1 flex flex-col items-center justify-end" title={`${h}:00 — ${n} drops`}>
                  <div
                    className={n > 0 ? "w-full bg-indigo-500/60 rounded-sm" : "w-full"}
                    style={{ height: `${Math.max(pct, n > 0 ? 8 : 0)}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[9px] text-slate-600 mt-1">
            <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
          </div>
        </div>
      )}

      {/* Timeline list */}
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {data.drops.slice(0, 50).map(d => {
          const isPositive = d.type === "back_in_stock" || d.type === "tickets_added";
          const isBulk = d.type === "bulk_sale";
          const isCatSold = d.type === "category_sold_out";
          const tone =
            isPositive ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
            : isBulk   ? "bg-red-500/10 border-red-500/30 text-red-200"
            : isCatSold ? "bg-orange-500/10 border-orange-500/30 text-orange-200"
            : "bg-slate-800/40 border-white/5 text-slate-200";
          const Icon =
            isPositive ? TrendingUp
            : isBulk   ? AlertOctagon
            : isCatSold ? XCircle
            : TrendingDown;
          return (
            <div key={d.id} className={"rounded-lg border px-2.5 py-1.5 flex items-center gap-2 " + tone}>
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium">
                  {d.type === "back_in_stock" && (
                    <>Restock · {d.category}{d.added != null && <span className="opacity-70"> (+{d.added})</span>}{d.remaining != null && <span className="opacity-50"> → {d.remaining} left</span>}</>
                  )}
                  {d.type === "tickets_added" && (
                    <>+{d.delta} tickets added{d.before != null && d.after != null && <span className="opacity-50"> ({d.before} → {d.after})</span>}</>
                  )}
                  {d.type === "category_sold_out" && (
                    <>SOLD OUT · {d.category}{d.last_remaining != null && <span className="opacity-50"> (last {d.last_remaining})</span>}</>
                  )}
                  {d.type === "bulk_sale" && (
                    <>⚠ BULK SALE · {d.tickets_lost} tickets gone in one interval</>
                  )}
                </div>
                <div className="text-[10px] opacity-60 tabular-nums">
                  {fmtTime(d.ts)} · {fmtAge(d.ts)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {data.drops.length > 50 && (
        <div className="text-[10px] text-slate-500 mt-2">…and {data.drops.length - 50} more older events</div>
      )}
    </div>
  );
}
