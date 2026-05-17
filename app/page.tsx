"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  Bell, BellOff, X, Search, ExternalLink, TrendingUp,
  TrendingDown, Activity, AlertCircle, Sparkles, Filter, Crown,
  AlertOctagon, GitCompare, Server, ShoppingCart,
} from "lucide-react";
import type { Event, StateSnapshot, Subscription, Change, ChangeType } from "@/lib/types";
import { EventCard } from "@/components/EventCard";
import { DetailModal } from "@/components/DetailModal";
import { SubsPanel } from "@/components/SubsPanel";
import { StatCard } from "@/components/StatCard";

const POLL_INTERVAL_MS = 30_000;
const SUBS_KEY = "afc.subscriptions.v1";
const NOTIFS_KEY = "afc.notifications.v1";
const HISTORY_KEY_PREFIX = "afc.history.";
const HISTORY_MAX = 200;

const DEFAULT_TRIGGERS: ChangeType[] = ["back_in_stock", "tickets_added", "status_change"];

export default function Page() {
  const [state, setState] = useState<StateSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [urgencyFilter, setUrgencyFilter] = useState("");
  const [sortBy, setSortBy] = useState("date");
  const [subscribedOnly, setSubscribedOnly] = useState(false);
  const [subscriptions, setSubscriptions] = useState<Record<string, Subscription>>({});
  const [notifications, setNotifications] = useState<Change[]>([]);
  const [showSubs, setShowSubs] = useState(false);
  const [detail, setDetail] = useState<Event | null>(null);
  const [browserPerm, setBrowserPerm] = useState<NotificationPermission | "default">("default");
  const [agoText, setAgoText] = useState("—");
  const [stale, setStale] = useState(false);
  const [extState, setExtState] = useState<"unknown" | "missing" | "ready">("unknown");
  const prevEventsRef = useRef<Event[]>([]);

  // Detect Chrome/Edge extension bridge
  useEffect(() => {
    function check() {
      const ext = (window as any).__ahlanExt;
      setExtState(ext?.installed ? "ready" : "missing");
    }
    check();
    window.addEventListener("ahlan-ext-ready", check);
    const t = setTimeout(check, 1500); // catch late injection
    return () => { window.removeEventListener("ahlan-ext-ready", check); clearTimeout(t); };
  }, []);

  /* ────────── Local storage ────────── */
  useEffect(() => {
    try {
      const subs = JSON.parse(localStorage.getItem(SUBS_KEY) || "{}");
      setSubscriptions(subs);
      const notifs = JSON.parse(localStorage.getItem(NOTIFS_KEY) || "[]");
      setNotifications(notifs);
      if (typeof Notification !== "undefined") setBrowserPerm(Notification.permission);
    } catch { /* ignore */ }
  }, []);

  /* ────────── Deep-link support (?open=<slug>) ────────── */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const openSlug = params.get("open");
    if (openSlug && state?.events) {
      const ev = state.events.find(e => e.slug === openSlug);
      if (ev) setDetail(ev);
    }
  }, [state]);

  const saveSubs = useCallback((subs: Record<string, Subscription>) => {
    setSubscriptions(subs);
    localStorage.setItem(SUBS_KEY, JSON.stringify(subs));
  }, []);

  const saveNotifs = useCallback((notifs: Change[]) => {
    const trimmed = notifs.slice(-100);
    setNotifications(trimmed);
    localStorage.setItem(NOTIFS_KEY, JSON.stringify(trimmed));
  }, []);

  /* ────────── Change detection + notifications ────────── */
  const detectChanges = (prev: Event[], curr: Event[]): Change[] => {
    const prevBySlug = new Map(prev.map(e => [e.slug, e]));
    const changes: Change[] = [];
    const ts = Math.floor(Date.now() / 1000);
    for (const ev of curr) {
      if (ev.error) continue;
      const p = prevBySlug.get(ev.slug);
      if (!p) continue;
      const delta = ev.total_remaining - p.total_remaining;
      if (delta !== 0) {
        changes.push({
          slug: ev.slug, title: ev.title, ts,
          type: delta > 0 ? "tickets_added" : "tickets_sold",
          details: { before: p.total_remaining, after: ev.total_remaining, delta },
        });
      }
      if (p.urgency !== ev.urgency) {
        changes.push({
          slug: ev.slug, title: ev.title, ts, type: "status_change",
          details: { from: p.urgency, to: ev.urgency },
        });
      }
      const prevCats = new Map(p.categories.map(c => [c.name, c]));
      for (const c of ev.categories) {
        const pc = prevCats.get(c.name);
        if (!pc) continue;
        if (pc.sold_out && !c.sold_out) {
          changes.push({
            slug: ev.slug, title: ev.title, ts, type: "back_in_stock",
            details: { category: c.name, remaining: c.remaining },
          });
        } else if (!pc.sold_out && c.sold_out) {
          changes.push({
            slug: ev.slug, title: ev.title, ts, type: "category_sold_out",
            details: { category: c.name },
          });
        }
      }
    }
    return changes;
  };

  const handleChanges = useCallback((changes: Change[]) => {
    if (!changes.length) return;
    const newNotifs: Change[] = [];
    for (const ch of changes) {
      const sub = subscriptions[ch.slug];
      if (!sub?.enabled) continue;
      if (!sub.triggers.includes(ch.type)) continue;
      newNotifs.push(ch);

      // Browser notification
      if (browserPerm === "granted" && typeof Notification !== "undefined") {
        const icon = changeIcon(ch.type);
        try {
          new Notification(`${icon} ${changeLabel(ch.type)}`, {
            body: `${ch.title}\n${formatDetails(ch)}`,
            tag: ch.slug,
            icon: "/icon.svg",
          });
        } catch { /* ignore */ }
      }
    }
    if (newNotifs.length) saveNotifs([...notifications, ...newNotifs]);
  }, [subscriptions, browserPerm, notifications, saveNotifs]);

  /* ────────── Save snapshot to localStorage (per-event history) ────────── */
  const saveHistory = (events: Event[], ts: number) => {
    for (const e of events) {
      if (e.error) continue;
      const key = HISTORY_KEY_PREFIX + e.slug;
      try {
        const raw = localStorage.getItem(key);
        const arr = raw ? JSON.parse(raw) : [];
        arr.push({ ts, remaining: e.total_remaining, capacity: e.total_capacity,
                   urgency: e.urgency,
                   cats: e.categories.map(c => ({ n: c.name, r: c.remaining, q: c.quantity })) });
        if (arr.length > HISTORY_MAX) arr.splice(0, arr.length - HISTORY_MAX);
        localStorage.setItem(key, JSON.stringify(arr));
      } catch { /* ignore quota errors */ }
    }
  };

  /* ────────── Fetch + poll loop ────────── */
  const fetchState = useCallback(async () => {
    try {
      const r = await fetch("/api/events", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: StateSnapshot = await r.json();
      if (prevEventsRef.current.length) {
        const changes = detectChanges(prevEventsRef.current, data.events);
        if (changes.length) handleChanges(changes);
      }
      saveHistory(data.events, data.last_updated);
      setState(data);
      prevEventsRef.current = data.events;
      setError(null);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [handleChanges]);

  useEffect(() => {
    fetchState();
    const id = setInterval(fetchState, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchState]);

  useEffect(() => {
    const tick = () => {
      if (!state) { setAgoText("—"); return; }
      const s = Math.floor(Date.now() / 1000 - state.last_updated);
      setStale(s > 90);
      if (s < 10) setAgoText("just now");
      else if (s < 60) setAgoText(`${s}s ago`);
      else if (s < 3600) setAgoText(`${Math.floor(s / 60)}m ago`);
      else setAgoText(`${Math.floor(s / 3600)}h ago`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state]);

  /* ────────── Filtering / sorting ────────── */
  const filtered = useMemo(() => {
    if (!state) return [];
    let evs = state.events.filter(e => !e.error);
    const q = search.trim().toLowerCase();
    if (q) {
      evs = evs.filter(e =>
        (e.title || "").toLowerCase().includes(q) ||
        (e.venue || "").toLowerCase().includes(q) ||
        (e.city || "").toLowerCase().includes(q)
      );
    }
    if (stageFilter) evs = evs.filter(e => e.stage === stageFilter);
    if (urgencyFilter) evs = evs.filter(e => e.urgency === urgencyFilter);
    if (subscribedOnly) evs = evs.filter(e => subscriptions[e.slug]?.enabled);
    const arr = [...evs];
    if (sortBy === "date") arr.sort((a, b) => (a.date_unix || 0) - (b.date_unix || 0));
    else if (sortBy === "remaining") arr.sort((a, b) => (b.total_remaining || 0) - (a.total_remaining || 0));
    else if (sortBy === "pct_sold") arr.sort((a, b) => (b.pct_sold || 0) - (a.pct_sold || 0));
    else if (sortBy === "match_number") arr.sort((a, b) => (a.match_number || 0) - (b.match_number || 0));
    return arr;
  }, [state, search, stageFilter, urgencyFilter, sortBy, subscribedOnly, subscriptions]);

  /* ────────── Subscribe helpers ────────── */
  const toggleSub = (slug: string) => {
    const next = { ...subscriptions };
    if (next[slug]?.enabled) {
      next[slug] = { ...next[slug], enabled: false };
    } else {
      next[slug] = { enabled: true, triggers: getDefaultTriggers() };
    }
    saveSubs(next);
  };

  const isSubscribed = (slug: string) => !!subscriptions[slug]?.enabled;
  const subscribedCount = Object.values(subscriptions).filter(s => s.enabled).length;

  const requestNotifPerm = async () => {
    if (typeof Notification === "undefined") {
      alert("Browser doesn't support notifications.");
      return;
    }
    const perm = await Notification.requestPermission();
    setBrowserPerm(perm);
    if (perm === "granted") {
      new Notification("🎫 AFC Monitor", {
        body: "Notifications enabled! You'll get pinged when subscribed matches change.",
      });
    }
  };

  const getDefaultTriggers = (): ChangeType[] => {
    try {
      const stored = localStorage.getItem("afc.defaultTriggers");
      if (stored) return JSON.parse(stored);
    } catch {/* */}
    return DEFAULT_TRIGGERS;
  };

  /* ────────── Render ────────── */
  return (
    <div className="min-h-screen">
      {/* HEADER */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-slate-950/60 border-b border-white/5">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-3 sm:gap-6">
          <div className="flex items-center gap-3">
            <div className="text-3xl">🎫</div>
            <div>
              <div className="text-base sm:text-xl font-bold tracking-tight">
                AFC Asian Cup 2027
              </div>
              <div className="text-[10px] sm:text-xs text-slate-400">
                Live ticket monitor · 51 matches
              </div>
            </div>
          </div>
          <div className="hidden sm:block flex-1" />
          <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm ml-auto">
            <Link
              href="/forecast"
              className="px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium bg-yellow-500/10 text-yellow-300 border border-yellow-500/30 hover:bg-yellow-500/20 transition-colors flex items-center gap-1.5"
              title="Tournament forecast"
            >
              <Crown className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Forecast</span>
            </Link>
            <Link
              href="/buy-queue"
              className="px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-500/15 text-indigo-200 border border-indigo-500/40 hover:bg-indigo-500/25 transition-colors flex items-center gap-1.5"
              title="Buy queue (your bot)"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Bot</span>
            </Link>
            <Link
              href="/compare"
              className="px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium bg-pink-500/10 text-pink-300 border border-pink-500/30 hover:bg-pink-500/20 transition-colors flex items-center gap-1.5"
              title="Compare matches side-by-side"
            >
              <GitCompare className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Compare</span>
            </Link>
            <Link
              href="/scrape-status"
              className="px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700/40 text-slate-300 border border-slate-600/30 hover:bg-slate-700/60 transition-colors flex items-center gap-1.5"
              title="Scrape health monitor"
            >
              <Activity className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Monitor</span>
            </Link>
            <Link
              href="/health"
              className="px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors flex items-center gap-1.5"
              title="System status"
            >
              <Server className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Status</span>
            </Link>
            <div className="flex items-center gap-2 text-slate-400">
              <span className={`inline-block w-2 h-2 rounded-full ${stale ? "bg-red-500" : "bg-green-500"} animate-pulse`} />
              <span>{agoText}</span>
            </div>
            <button
              onClick={requestNotifPerm}
              className={
                "px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border " +
                (browserPerm === "granted"
                  ? "bg-green-500/15 text-green-300 border-green-500/30"
                  : "bg-slate-700/40 text-slate-300 border-slate-600/30 hover:bg-slate-700/60")
              }
              title="Browser notifications"
            >
              {browserPerm === "granted" ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => setShowSubs(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-500/15 text-indigo-200 border border-indigo-500/30 hover:bg-indigo-500/25 transition-colors flex items-center gap-1.5"
            >
              <Bell className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Subs</span>
              <span className="px-1.5 py-0.5 bg-indigo-500/30 rounded text-[10px]">
                {subscribedCount}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* HERO STATS */}
      <section className="max-w-[1600px] mx-auto px-4 sm:px-6 pt-6">
        {loading && !state && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="glass rounded-xl p-3 h-[68px] animate-pulse">
                  <div className="h-2.5 w-1/2 bg-slate-700/40 rounded" />
                  <div className="h-6 w-2/3 bg-slate-700/30 rounded mt-2.5" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="glass rounded-2xl p-5 h-[270px] animate-pulse">
                  <div className="h-2 w-12 bg-slate-700/40 rounded mb-3" />
                  <div className="h-4 w-3/4 bg-slate-700/40 rounded mb-2" />
                  <div className="h-2 w-1/2 bg-slate-700/30 rounded mb-1" />
                  <div className="h-2 w-2/3 bg-slate-700/30 rounded mb-6" />
                  <div className="h-1.5 w-full bg-slate-700/30 rounded mb-6" />
                  <div className="space-y-2">
                    <div className="h-2 w-full bg-slate-700/20 rounded" />
                    <div className="h-2 w-5/6 bg-slate-700/20 rounded" />
                    <div className="h-2 w-4/6 bg-slate-700/20 rounded" />
                  </div>
                </div>
              ))}
            </div>
            <div className="sr-only">Loading ticket data…</div>
          </>
        )}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-xl p-4 mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" /> Failed to load: {error}
          </div>
        )}
        {state && (
          <motion.div
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          >
            <StatCard label="Matches"        value={state.summary.total_events} />
            <StatCard label="🟢 Available"   value={state.summary.events_available}   tone="green" />
            <StatCard label="🟡 Selling fast" value={state.summary.events_selling_fast} tone="yellow" />
            <StatCard label="🟠 Almost gone"  value={state.summary.events_almost_gone}  tone="orange" />
            <StatCard label="🔴 Sold out"     value={state.summary.events_sold_out}     tone="red" />
            <StatCard label="Tickets left"   value={state.summary.total_remaining.toLocaleString()} sub={`${state.summary.pct_sold}% sold`} />
          </motion.div>
        )}

        {/* EXTENSION-MISSING BANNER */}
        {extState === "missing" && (
          <div className="mt-4 rounded-2xl border border-amber-500/40 bg-gradient-to-r from-amber-500/10 to-yellow-500/5 p-3 flex items-center gap-3 text-xs">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="flex-1">
              <span className="text-amber-200 font-semibold">Ahlan Auto-Buy extension not detected.</span>
              <span className="text-slate-400 ml-1">
                Buy clicks will still queue, but no Chrome/Edge tab will auto-open.{" "}
                <a href="/debug" className="underline hover:text-amber-300">Run diagnostics</a> · or in Edge: <code className="bg-slate-800/60 px-1 rounded">edge://extensions</code> → enable / reload Ahlan Auto-Buy → hard-refresh this page (Ctrl+Shift+R).
              </span>
            </div>
          </div>
        )}

        {/* BULK-SALE ALERT BANNER */}
        {state?.recent_changes && (() => {
          const cutoff = Math.floor(Date.now() / 1000) - 3600;
          const bulks = state.recent_changes
            .filter(c => c.type === "bulk_sale" && c.ts >= cutoff)
            .slice(0, 3);
          if (bulks.length === 0) return null;
          return (
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
              className="mt-4 rounded-2xl border border-red-500/40 bg-gradient-to-r from-red-500/15 to-orange-500/10 p-4"
            >
              <div className="flex items-start gap-3">
                <AlertOctagon className="w-5 h-5 text-red-400 shrink-0 mt-0.5 animate-pulse" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-red-200 mb-1">
                    Bulk-sale activity detected in last hour
                  </div>
                  <div className="space-y-1">
                    {bulks.map(b => (
                      <button key={b.id}
                        onClick={() => {
                          const ev = state.events.find(e => e.slug === b.slug);
                          if (ev) setDetail(ev);
                        }}
                        className="block text-left text-xs text-slate-200 hover:text-white">
                        <span className="font-medium">{b.title}</span>
                        <span className="text-red-300 mx-1.5">·</span>
                        <span className="text-red-300 font-semibold">{b.details?.tickets_lost ?? "?"} tickets</span>
                        <span className="text-slate-400"> in one scrape interval</span>
                        <span className="text-slate-500 ml-1.5">
                          ({Math.floor((Date.now() / 1000 - b.ts) / 60)}m ago)
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })()}
      </section>

      {/* FILTERS */}
      {state && (
        <section className="max-w-[1600px] mx-auto px-4 sm:px-6 pt-6 pb-2">
          <div className="glass rounded-2xl p-3 sm:p-4 flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search match, venue, city..."
                className="w-full bg-slate-800/40 border border-white/5 rounded-lg pl-9 pr-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50 transition-colors"
              />
            </div>
            <Select value={stageFilter} onChange={setStageFilter} options={[
              ["", "All stages"], ["Group", "Group stage"], ["Round of 16", "Round of 16"],
              ["Quarterfinal", "Quarterfinals"], ["Semifinal", "Semifinals"], ["FINAL", "Final"]
            ]} />
            <Select value={urgencyFilter} onChange={setUrgencyFilter} options={[
              ["", "All statuses"],
              ["available", "🟢 Available"], ["selling_fast", "🟡 Selling fast"],
              ["almost_gone", "🟠 Almost gone"], ["sold_out", "🔴 Sold out"],
            ]} />
            <Select value={sortBy} onChange={setSortBy} options={[
              ["date", "Sort: Match date"], ["remaining", "Sort: Tickets left ↓"],
              ["pct_sold", "Sort: % sold ↓"], ["match_number", "Sort: Match #"],
            ]} />
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer px-2">
              <input type="checkbox" checked={subscribedOnly} onChange={e => setSubscribedOnly(e.target.checked)} className="rounded" />
              <span className="text-xs sm:text-sm">Subscribed only</span>
            </label>
          </div>
        </section>
      )}

      {/* MATCHES GRID */}
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
          layout
        >
          <AnimatePresence>
            {filtered.map((ev, i) => (
              <motion.div
                key={ev.slug}
                layout
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: Math.min(i * 0.015, 0.3), duration: 0.3 }}
              >
                <EventCard
                  event={ev}
                  subscribed={isSubscribed(ev.slug)}
                  onToggleSubscribe={() => toggleSub(ev.slug)}
                  onClick={() => setDetail(ev)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>

        {state && filtered.length === 0 && (
          <div className="text-center py-16 text-slate-500">
            <Filter className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <div className="font-medium">No matches found with these filters.</div>
            <button
              onClick={() => { setSearch(""); setStageFilter(""); setUrgencyFilter(""); setSubscribedOnly(false); }}
              className="mt-3 text-xs px-3 py-1.5 rounded-lg bg-slate-700/40 hover:bg-slate-700/60 text-slate-300 border border-slate-600/30"
            >
              Clear all filters
            </button>
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer className="max-w-[1600px] mx-auto px-6 py-8 text-xs text-slate-500 text-center border-t border-white/5">
        <div className="flex items-center justify-center gap-2">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Live data from ahlan.sa · Updates every 30s · Not affiliated with AFC or ahlan.sa</span>
        </div>
      </footer>

      {/* MODALS */}
      <AnimatePresence>
        {detail && (
          <DetailModal
            event={detail}
            subscribed={isSubscribed(detail.slug)}
            onToggleSubscribe={() => toggleSub(detail.slug)}
            onClose={() => setDetail(null)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showSubs && state && (
          <SubsPanel
            events={state.events}
            subscriptions={subscriptions}
            saveSubs={saveSubs}
            notifications={notifications}
            clearNotifs={() => saveNotifs([])}
            browserPerm={browserPerm}
            requestNotifPerm={requestNotifPerm}
            onClose={() => setShowSubs(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ────────── Small helpers ────────── */
function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="bg-slate-800/40 border border-white/5 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500/50 transition-colors cursor-pointer"
    >
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function changeIcon(t: ChangeType): string {
  return ({ back_in_stock: "🟢", tickets_added: "📈", tickets_sold: "📉",
           category_sold_out: "🔴", status_change: "⚡", new_event: "✨",
           bulk_sale: "⚠️" } as Record<ChangeType, string>)[t] || "•";
}
function changeLabel(t: ChangeType): string {
  return ({ back_in_stock: "Back in stock!", tickets_added: "Tickets added",
           tickets_sold: "Tickets sold", category_sold_out: "Category sold out",
           status_change: "Status changed", new_event: "New match",
           bulk_sale: "Bulk sale!" } as Record<ChangeType, string>)[t] || t;
}
function formatDetails(ch: Change): string {
  const d = ch.details || {};
  if (ch.type === "tickets_added" || ch.type === "tickets_sold") {
    return `${d.before} → ${d.after} (${d.delta > 0 ? "+" : ""}${d.delta})`;
  }
  if (ch.type === "back_in_stock") return `${d.category}: ${d.remaining} available`;
  if (ch.type === "category_sold_out") return `${d.category} just sold out`;
  if (ch.type === "status_change") return `${d.from} → ${d.to}`;
  return JSON.stringify(d);
}
