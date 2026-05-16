"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  X, ExternalLink, Bell, BellOff, MapPin, Users, Trophy, Clock,
  TrendingUp, DollarSign, Flame, Info, Sparkles,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Area, AreaChart,
} from "recharts";
import clsx from "clsx";
import type { Event } from "@/lib/types";

interface HistPoint { ts: number; r: number; q: number; }

type Insights = {
  event: Event;
  last_update: number;
  stadium: { name: string; city: string; capacity: number; key: string };
  teams: { home: any; away: any } | null;
  bracket: { match: number; kind: string; positions: [string, string] } | null;
  is_knockout: boolean;
  matchups: Array<{
    homeCode: string; awayCode: string; prob: number;
    homeName: string; awayName: string; homeFlag: string; awayFlag: string;
  }>;
  team_reach_prob: Array<{ code: string; name: string; flag: string; prob: number }>;
  buy_score: {
    score: number; label: string; recommendation: string;
    tone: "red" | "orange" | "yellow" | "green" | "slate";
    breakdown: Array<{ factor: string; impact: number; note: string }>;
    velocity_per_day: number | null;
    velocity_per_hour: number | null;
    days_to_match: number | null;
    hours_to_match: number | null;
  };
  insights: Array<{ icon: string; text: string }>;
};

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
  const [insights, setInsights] = useState<Insights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(true);

  /* ── History ── */
  useEffect(() => {
    setLoading(true);
    try {
      const raw = localStorage.getItem(`afc.history.${event.slug}`);
      const arr = raw ? JSON.parse(raw) : [];
      setHistory(arr.map((x: any) => ({ ts: x.ts, r: x.remaining ?? 0, q: x.capacity ?? 0 })));
    } catch { /* */ }
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
      .catch(() => {/* */})
      .finally(() => setLoading(false));
  }, [event.slug, range]);

  /* ── Insights (only fetched once per modal open) ── */
  useEffect(() => {
    setInsightsLoading(true);
    fetch(`/api/insights/${encodeURIComponent(event.slug)}`)
      .then(r => r.json())
      .then(d => { if (!d?.error) setInsights(d); })
      .finally(() => setInsightsLoading(false));
  }, [event.slug]);

  const chartData = history.map(h => {
    const d = new Date(h.ts * 1000);
    const fmt = (range === "1d")
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
        d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return { time: fmt, remaining: h.r };
  });

  const stadiumCap = insights?.stadium.capacity || 0;
  const allocationPct = stadiumCap > 0 && event.total_capacity > 0
    ? (event.total_capacity / stadiumCap) * 100 : null;

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
        className="glass rounded-2xl w-full max-w-4xl my-4 max-h-[95vh] overflow-y-auto border border-white/10"
      >
        {/* HEADER */}
        <div className="sticky top-0 z-10 flex items-start justify-between p-6 pb-3 backdrop-blur-xl bg-slate-950/70 border-b border-white/5">
          <div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700/40 text-slate-300 border border-slate-600/30">
              {event.stage} · #{event.match_number}
            </span>
            <h2 className="text-2xl font-bold mt-2 tracking-tight">
              {insights?.teams ? (
                <>
                  <span>{insights.teams.home.flag}</span> {insights.teams.home.name}
                  <span className="text-slate-500 mx-2">vs</span>
                  <span>{insights.teams.away.flag}</span> {insights.teams.away.name}
                </>
              ) : event.title}
            </h2>
            <div className="text-sm text-slate-400">{event.date}</div>
            <div className="text-sm text-slate-500 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              {insights?.stadium.name || event.venue}{insights?.stadium.city ? `, ${insights.stadium.city}` : event.city ? `, ${event.city}` : ""}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* ───── BUY SCORE ───── */}
          {insights?.buy_score && <BuyScoreCard buy={insights.buy_score} />}

          {/* ───── CAPACITY / ALLOCATION ───── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile
              icon={<Users className="w-3.5 h-3.5" />}
              label="Stadium capacity"
              value={stadiumCap ? stadiumCap.toLocaleString() : "—"}
              sub={insights?.stadium.name ? insights.stadium.city : "Total seats"}
            />
            <StatTile
              icon={<Trophy className="w-3.5 h-3.5" />}
              label="On sale"
              value={event.total_capacity.toLocaleString()}
              sub={allocationPct != null ? `${allocationPct.toFixed(0)}% of stadium` : "Allocated"}
            />
            <StatTile
              icon={<TrendingUp className="w-3.5 h-3.5" />}
              label="Sold"
              value={(event.total_capacity - event.total_remaining).toLocaleString()}
              sub={`${event.pct_sold}% of allocation`}
              tone={event.urgency}
            />
            <StatTile
              icon={<Clock className="w-3.5 h-3.5" />}
              label="Remaining"
              value={event.total_remaining.toLocaleString()}
              sub={
                insights?.buy_score?.velocity_per_day != null && insights.buy_score.velocity_per_day > 0
                  ? `~${Math.round(event.total_remaining / insights.buy_score.velocity_per_day)}d at current pace`
                  : "Live"
              }
              tone={event.urgency}
            />
          </div>

          {/* ───── KNOCKOUT MATCHUP FORECAST ───── */}
          {insights?.is_knockout && insights.matchups.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-semibold text-slate-200">
                  Most likely matchups
                </h3>
                <span className="text-[10px] text-slate-500">
                  (6,000-simulation Monte Carlo · {insights.bracket?.positions.join(" v ")})
                </span>
              </div>
              <div className="space-y-1.5">
                {insights.matchups.map(m => (
                  <div key={`${m.homeCode}-${m.awayCode}`}
                    className="glass rounded-lg p-2.5 flex items-center gap-3">
                    <div className="text-sm font-medium flex-1 truncate">
                      <span className="text-lg">{m.homeFlag}</span> {m.homeName}
                      <span className="text-slate-500 mx-2">vs</span>
                      <span className="text-lg">{m.awayFlag}</span> {m.awayName}
                    </div>
                    <div className="w-32 h-2 bg-slate-700/40 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-500 to-purple-500"
                        style={{ width: `${Math.max(2, m.prob * 100)}%` }}
                      />
                    </div>
                    <div className="text-sm font-semibold tabular-nums text-indigo-300 w-12 text-right">
                      {(m.prob * 100).toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
              {/* Per-team reach prob */}
              {insights.team_reach_prob.length > 0 && (
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer text-slate-400 hover:text-slate-200 inline-flex items-center gap-1">
                    <Info className="w-3 h-3" /> Probability each team appears in this match
                  </summary>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-2">
                    {insights.team_reach_prob.slice(0, 12).map(t => (
                      <div key={t.code} className="flex items-center justify-between px-2 py-1 rounded bg-slate-800/30">
                        <span><span className="text-base">{t.flag}</span> {t.name}</span>
                        <span className="tabular-nums text-slate-300">{(t.prob * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </section>
          )}

          {/* ───── TREND CHART ───── */}
          {chartData.length > 1 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-200">📉 Trend over time</h3>
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
                  <div className="absolute top-2 right-2 text-[10px] text-slate-500 animate-pulse">Loading…</div>
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
                    <Tooltip contentStyle={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
                    <Area type="monotone" dataKey="remaining" stroke="#818cf8" strokeWidth={2} fill="url(#g1)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* ───── MARKET INSIGHTS ───── */}
          {insights?.insights && insights.insights.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-slate-200 mb-2">
                <Flame className="w-4 h-4 inline mr-1 text-orange-400" />
                Market insights
              </h3>
              <div className="space-y-1.5">
                {insights.insights.map((i, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-sm text-slate-300 bg-slate-800/30 rounded-lg px-3 py-2">
                    <span className="text-base shrink-0">{i.icon}</span>
                    <span>{i.text}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ───── CATEGORIES (per price tier) — public + hospitality split ───── */}
          {(() => {
            const publicCats = event.categories.filter(c =>
              c.is_hospitality === false ||
              (c.is_hospitality === undefined && !c.name.toUpperCase().startsWith("MATCH"))
            );
            const hospCats = event.categories.filter(c =>
              c.is_hospitality === true ||
              (c.is_hospitality === undefined && c.name.toUpperCase().startsWith("MATCH"))
            );
            const CategoryRow = ({ c }: { c: typeof event.categories[number] }) => {
              const pctSold = c.quantity ? ((c.quantity - c.remaining) / c.quantity) * 100 : 0;
              return (
                <div key={c.name} className="glass rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Max per order: {c.max_per_order}
                        {c.price > 0 && <> · SAR {c.price.toLocaleString()}</>}
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
                  <div className="w-full h-1.5 bg-slate-700/40 rounded-full overflow-hidden">
                    <div className={clsx("h-full transition-all",
                      c.sold_out ? "bg-red-500"
                      : pctSold >= 90 ? "bg-orange-500"
                      : pctSold >= 70 ? "bg-yellow-500"
                      : "bg-emerald-500")}
                      style={{ width: `${pctSold}%` }} />
                  </div>
                </div>
              );
            };
            return (
              <>
                <section>
                  <h3 className="text-sm font-semibold text-slate-200 mb-2">
                    <DollarSign className="w-4 h-4 inline mr-1 text-emerald-400" />
                    Public tickets
                  </h3>
                  <div className="space-y-2">
                    {publicCats.map(c => <CategoryRow key={c.name} c={c} />)}
                    {publicCats.length === 0 && (
                      <div className="glass rounded-lg p-3 text-xs text-slate-500 text-center">
                        No public categories on sale.
                      </div>
                    )}
                  </div>
                </section>
                {hospCats.length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold text-slate-200 mb-2">
                      <DollarSign className="w-4 h-4 inline mr-1 text-amber-400" />
                      Hospitality packages
                      <span className="text-[10px] text-slate-500 ml-2 font-normal">
                        (premium add-ons, not counted in &quot;sold out&quot; status)
                      </span>
                    </h3>
                    <div className="space-y-2 opacity-90">
                      {hospCats.map(c => <CategoryRow key={c.name} c={c} />)}
                    </div>
                  </section>
                )}
              </>
            );
          })()}

          {insightsLoading && !insights && (
            <div className="text-center text-xs text-slate-500 py-2 animate-pulse">
              Loading enriched insights…
            </div>
          )}

          {/* ───── ACTIONS ───── */}
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
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

/* ────────────── Sub-components ────────────── */

function StatTile({
  icon, label, value, sub, tone,
}: {
  icon: React.ReactNode; label: string; value: string; sub?: string; tone?: string;
}) {
  return (
    <div className="glass rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-wider mb-1">
        {icon}<span>{label}</span>
      </div>
      <div className={clsx("text-xl font-bold tabular-nums", tone && `urgency-${tone}`)}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function BuyScoreCard({ buy }: { buy: Insights["buy_score"] }) {
  const toneBg: Record<string, string> = {
    red:    "from-red-500/20 to-red-600/5 border-red-500/40",
    orange: "from-orange-500/20 to-orange-600/5 border-orange-500/40",
    yellow: "from-yellow-500/20 to-yellow-600/5 border-yellow-500/40",
    green:  "from-emerald-500/20 to-emerald-600/5 border-emerald-500/40",
    slate:  "from-slate-500/20 to-slate-600/5 border-slate-500/40",
  };
  const toneText: Record<string, string> = {
    red: "text-red-300", orange: "text-orange-300", yellow: "text-yellow-300",
    green: "text-emerald-300", slate: "text-slate-300",
  };
  const toneBar: Record<string, string> = {
    red: "from-red-500 to-red-400", orange: "from-orange-500 to-orange-400",
    yellow: "from-yellow-500 to-yellow-400", green: "from-emerald-500 to-emerald-400",
    slate: "from-slate-500 to-slate-400",
  };
  return (
    <section className={clsx(
      "rounded-2xl p-4 sm:p-5 border bg-gradient-to-br",
      toneBg[buy.tone] || toneBg.slate,
    )}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-70">Buy Score</div>
          <div className={clsx("text-3xl sm:text-4xl font-bold tabular-nums", toneText[buy.tone])}>
            {buy.score}<span className="text-base opacity-50">/100</span>
          </div>
          <div className={clsx("text-base sm:text-lg font-semibold mt-1", toneText[buy.tone])}>
            {buy.label}
          </div>
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="text-sm text-slate-200 mb-3">{buy.recommendation}</div>
          <div className="w-full h-2 bg-slate-800/60 rounded-full overflow-hidden">
            <div className={clsx("h-full bg-gradient-to-r transition-all", toneBar[buy.tone])}
              style={{ width: `${buy.score}%` }} />
          </div>
          {buy.breakdown.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-200 inline-flex items-center gap-1">
                <Info className="w-3 h-3" /> Why this score?
              </summary>
              <div className="mt-2 space-y-1">
                {buy.breakdown.map((b, i) => (
                  <div key={i} className="text-[11px] flex items-center justify-between gap-2 bg-slate-800/40 rounded px-2 py-1.5">
                    <div>
                      <div className="text-slate-200">{b.factor}</div>
                      <div className="text-slate-500">{b.note}</div>
                    </div>
                    <div className={clsx(
                      "tabular-nums font-semibold text-xs px-1.5 py-0.5 rounded",
                      b.impact > 0 ? "bg-emerald-500/15 text-emerald-300" : "text-slate-500"
                    )}>
                      {b.impact > 0 ? "+" : ""}{b.impact}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}
