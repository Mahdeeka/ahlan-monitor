"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import {
  ArrowLeft, Layers, Plus, X, GitCompare, Search,
} from "lucide-react";
import clsx from "clsx";
import type { Event } from "@/lib/types";

type Spark = { slug: string; points: Array<{ t: number; r: number; q: number }> };
const PALETTE = ["#818cf8", "#f472b6", "#34d399", "#fbbf24", "#60a5fa", "#a78bfa"];

export default function ComparePage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [sparks, setSparks] = useState<Record<string, Spark | null>>({});

  // Load events list
  useEffect(() => {
    fetch("/api/events", { cache: "no-store" })
      .then(r => r.json())
      .then(d => setEvents(d.events || []))
      .finally(() => setLoading(false));
  }, []);

  // Pre-select from URL ?slugs=a,b,c
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search).get("slugs");
    if (sp) setSelected(sp.split(",").filter(Boolean).slice(0, 4));
  }, []);

  // Load sparkline data for each selected slug
  useEffect(() => {
    for (const s of selected) {
      if (sparks[s] !== undefined) continue;
      setSparks(prev => ({ ...prev, [s]: null }));
      fetch(`/api/sparkline/${encodeURIComponent(s)}`)
        .then(r => r.json())
        .then(d => setSparks(prev => ({ ...prev, [s]: { slug: s, points: d.points || [] } })))
        .catch(() => setSparks(prev => ({ ...prev, [s]: { slug: s, points: [] } })));
    }
  }, [selected]);

  const eventsBySlug = useMemo(() => {
    const m = new Map<string, Event>();
    for (const e of events) m.set(e.slug, e);
    return m;
  }, [events]);

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter(e =>
      (!q || e.title.toLowerCase().includes(q) || e.slug.toLowerCase().includes(q) || e.stage.toLowerCase().includes(q)) &&
      !selected.includes(e.slug)
    ).slice(0, 30);
  }, [events, search, selected]);

  const toggleSlug = (slug: string) => {
    setSelected(prev => prev.includes(slug)
      ? prev.filter(s => s !== slug)
      : prev.length < 4 ? [...prev, slug] : prev);
  };

  // Merge spark series into a single chart-data array
  const chartData = useMemo(() => {
    const allTs = new Set<number>();
    for (const s of selected) {
      const p = sparks[s]?.points || [];
      for (const x of p) allTs.add(x.t);
    }
    const ts = Array.from(allTs).sort((a, b) => a - b);
    return ts.map(t => {
      const row: any = { t, time: new Date(t * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) };
      for (const s of selected) {
        const ev = eventsBySlug.get(s);
        const pt = sparks[s]?.points.find(p => p.t === t);
        if (pt && ev?.total_capacity) {
          row[s] = (pt.r / (ev.total_capacity || 1)) * 100; // normalized %
        }
      }
      return row;
    });
  }, [selected, sparks, eventsBySlug]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-slate-950/60 border-b border-white/5">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <Link href="/" className="text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <GitCompare className="w-6 h-6 text-pink-400" />
          <div>
            <div className="text-base sm:text-xl font-bold tracking-tight">Compare matches</div>
            <div className="text-[10px] sm:text-xs text-slate-400">
              Pick up to 4 to overlay their trends side-by-side
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {loading && (
          <div className="text-center py-12 text-slate-500">Loading events…</div>
        )}

        {!loading && (
          <>
            {/* SELECTOR */}
            <section className="glass rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Layers className="w-4 h-4 text-pink-400" />
                <span className="text-sm font-semibold">Selected ({selected.length} / 4)</span>
              </div>

              {selected.length === 0 ? (
                <div className="text-xs text-slate-500 italic mb-3">No matches selected yet — pick from the list below.</div>
              ) : (
                <div className="flex flex-wrap gap-2 mb-3">
                  {selected.map((slug, i) => {
                    const ev = eventsBySlug.get(slug);
                    return (
                      <div key={slug}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs"
                        style={{ borderColor: PALETTE[i] + "60", background: PALETTE[i] + "15" }}>
                        <span className="w-2 h-2 rounded-full" style={{ background: PALETTE[i] }} />
                        <span className="font-medium">{ev?.title || slug}</span>
                        <button onClick={() => toggleSlug(slug)} className="text-slate-400 hover:text-white">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search a match to add…"
                  className="w-full bg-slate-800/40 border border-white/5 rounded-lg pl-9 pr-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:border-pink-500/50"
                />
              </div>
              {search && (
                <div className="mt-2 max-h-60 overflow-y-auto space-y-1">
                  {filteredOptions.map(ev => (
                    <button key={ev.slug} onClick={() => { toggleSlug(ev.slug); setSearch(""); }}
                      disabled={selected.length >= 4}
                      className="w-full text-left px-3 py-1.5 rounded-lg bg-slate-800/30 hover:bg-slate-800/60 text-xs flex items-center gap-2 disabled:opacity-50">
                      <Plus className="w-3 h-3 opacity-60" />
                      <span className="text-[10px] text-slate-500">{ev.stage}</span>
                      <span className="flex-1 font-medium">{ev.title}</span>
                      <span className="text-[10px] text-slate-500">{ev.pct_sold}% sold</span>
                    </button>
                  ))}
                  {filteredOptions.length === 0 && (
                    <div className="text-xs text-slate-500 px-3 py-2">No matches.</div>
                  )}
                </div>
              )}
            </section>

            {selected.length === 0 && (
              <div className="glass rounded-2xl p-10 text-center">
                <Layers className="w-10 h-10 mx-auto mb-3 text-slate-600" />
                <div className="text-sm text-slate-400">Add at least one match to start comparing.</div>
              </div>
            )}

            {selected.length > 0 && (
              <>
                {/* OVERLAY CHART */}
                <section>
                  <h2 className="text-sm font-semibold text-slate-200 mb-2">% remaining over time (normalized)</h2>
                  <div className="glass rounded-2xl p-4 h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} />
                        <YAxis stroke="#64748b" fontSize={10} tickLine={false} domain={[0, 100]} unit="%" />
                        <Tooltip
                          contentStyle={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                          formatter={(v: any, name: any) => {
                            const ev = eventsBySlug.get(name);
                            return [`${(v as number).toFixed(1)}%`, ev?.title || name];
                          }}
                        />
                        <Legend formatter={(v) => {
                          const ev = eventsBySlug.get(v);
                          return ev?.title?.slice(0, 30) || v;
                        }} wrapperStyle={{ fontSize: 11 }} />
                        {selected.map((s, i) => (
                          <Line key={s} type="monotone" dataKey={s} stroke={PALETTE[i]}
                            strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                {/* SIDE-BY-SIDE STATS */}
                <section>
                  <h2 className="text-sm font-semibold text-slate-200 mb-2">Stats side-by-side</h2>
                  <div className="overflow-x-auto -mx-4 px-4">
                    <table className="w-full text-xs min-w-[700px]">
                      <thead className="text-slate-500 border-b border-white/5">
                        <tr>
                          <th className="text-left py-2 pr-2 font-medium">Metric</th>
                          {selected.map((s, i) => {
                            const ev = eventsBySlug.get(s);
                            return (
                              <th key={s} className="text-right py-2 pr-3 font-medium">
                                <div className="flex items-center justify-end gap-1.5">
                                  <span className="w-2 h-2 rounded-full" style={{ background: PALETTE[i] }} />
                                  <span className="truncate max-w-[140px]">{ev?.title || s}</span>
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        <Row label="Stage" cells={selected.map(s => eventsBySlug.get(s)?.stage)} />
                        <Row label="Date" cells={selected.map(s => eventsBySlug.get(s)?.date)} />
                        <Row label="Venue" cells={selected.map(s => eventsBySlug.get(s)?.venue)} />
                        <Row label="Capacity" cells={selected.map(s => eventsBySlug.get(s)?.total_capacity?.toLocaleString())} />
                        <Row label="Remaining" cells={selected.map(s => eventsBySlug.get(s)?.total_remaining?.toLocaleString())} />
                        <Row label="% sold" cells={selected.map(s => `${eventsBySlug.get(s)?.pct_sold}%`)}
                          highlightFn={(v) => parseFloat(v as string) >= 95 ? "text-red-400 font-bold"
                                              : parseFloat(v as string) >= 80 ? "text-orange-300"
                                              : "text-slate-200"} />
                        <Row label="Urgency" cells={selected.map(s => eventsBySlug.get(s)?.urgency.replace("_", " "))}
                          highlightFn={(v) => `urgency-${(v as string).replace(" ", "_")} font-medium`} />
                        <Row label="Categories" cells={selected.map(s => eventsBySlug.get(s)?.categories.length)} />
                        {/* Per-category breakdown */}
                        {(() => {
                          const allCats = new Set<string>();
                          for (const s of selected) {
                            for (const c of eventsBySlug.get(s)?.categories || []) allCats.add(c.name);
                          }
                          return Array.from(allCats).map(catName => (
                            <Row key={catName} label={`└ ${catName}`}
                              cells={selected.map(s => {
                                const c = eventsBySlug.get(s)?.categories.find(x => x.name === catName);
                                if (!c) return <span className="text-slate-600">—</span>;
                                if (c.sold_out) return <span className="text-red-400">SOLD OUT</span>;
                                return <span>{c.remaining}/{c.quantity} <span className="text-slate-500">· SAR {c.price}</span></span>;
                              })} />
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Row({ label, cells, highlightFn }: {
  label: string; cells: (React.ReactNode | undefined)[]; highlightFn?: (v: any) => string;
}) {
  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.02]">
      <td className="py-1.5 pr-2 text-slate-400">{label}</td>
      {cells.map((c, i) => (
        <td key={i} className={"py-1.5 pr-3 text-right tabular-nums " + (highlightFn ? highlightFn(c) : "text-slate-200")}>
          {c ?? "—"}
        </td>
      ))}
    </tr>
  );
}
