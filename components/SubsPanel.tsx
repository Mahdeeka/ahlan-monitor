"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, Bell, BellOff } from "lucide-react";
import clsx from "clsx";
import type { Event, Subscription, Change, ChangeType } from "@/lib/types";

const ALL_TRIGGERS: { key: ChangeType; label: string }[] = [
  { key: "back_in_stock", label: "🟢 A sold-out category becomes available" },
  { key: "tickets_added", label: "📈 New tickets released (count goes up)" },
  { key: "tickets_sold",  label: "📉 Tickets sold (count goes down)" },
  { key: "status_change", label: "⚡ Match status changes (e.g. → Almost gone)" },
];

const DEFAULT_TRIGGERS: ChangeType[] = ["back_in_stock", "tickets_added", "status_change"];

export function SubsPanel({
  events, subscriptions, saveSubs, notifications, clearNotifs,
  browserPerm, requestNotifPerm, onClose,
}: {
  events: Event[];
  subscriptions: Record<string, Subscription>;
  saveSubs: (s: Record<string, Subscription>) => void;
  notifications: Change[];
  clearNotifs: () => void;
  browserPerm: string;
  requestNotifPerm: () => void;
  onClose: () => void;
}) {
  const [triggers, setTriggers] = useState<Record<ChangeType, boolean>>(() => {
    try {
      const stored = localStorage.getItem("afc.defaultTriggers");
      if (stored) {
        const arr: ChangeType[] = JSON.parse(stored);
        return Object.fromEntries(ALL_TRIGGERS.map(t => [t.key, arr.includes(t.key)])) as any;
      }
    } catch {/* */}
    return Object.fromEntries(ALL_TRIGGERS.map(t => [t.key, DEFAULT_TRIGGERS.includes(t.key)])) as any;
  });

  useEffect(() => {
    const enabled = Object.keys(triggers).filter(k => triggers[k as ChangeType]) as ChangeType[];
    localStorage.setItem("afc.defaultTriggers", JSON.stringify(enabled));
    // apply to existing subs
    const next = { ...subscriptions };
    let changed = false;
    for (const slug of Object.keys(next)) {
      if (next[slug].enabled) {
        next[slug] = { ...next[slug], triggers: enabled };
        changed = true;
      }
    }
    if (changed) saveSubs(next);
  }, [triggers]);

  const subscribed = Object.entries(subscriptions).filter(([_, v]) => v.enabled);
  const eventTitle = (slug: string) => events.find(e => e.slug === slug)?.title || slug;

  const unsubscribe = (slug: string) => {
    saveSubs({ ...subscriptions, [slug]: { ...subscriptions[slug], enabled: false } });
  };

  const sendTest = () => {
    if (browserPerm === "granted" && typeof Notification !== "undefined") {
      new Notification("🎫 AFC Monitor — Test", {
        body: "Notifications are working! You'll get alerted on subscribed matches.",
      });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex justify-end"
      onClick={onClose}
    >
      <motion.aside
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 24, stiffness: 200 }}
        onClick={e => e.stopPropagation()}
        className="bg-slate-950/95 backdrop-blur-xl w-full max-w-md h-full overflow-y-auto p-6 border-l border-white/5"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Bell className="w-5 h-5" /> Your subscriptions
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Permission status */}
        <div className={clsx(
          "mb-6 p-4 rounded-xl",
          browserPerm === "granted"
            ? "bg-green-500/10 border border-green-500/20"
            : "bg-orange-500/10 border border-orange-500/20"
        )}>
          <div className="text-sm font-semibold mb-1">
            {browserPerm === "granted" ? "✓ Notifications enabled" : "⚠ Notifications disabled"}
          </div>
          <div className="text-xs text-slate-400 mb-2">
            {browserPerm === "granted"
              ? "Browser will pop up when subscribed matches change."
              : "Click below to enable browser notifications."}
          </div>
          {browserPerm === "granted" ? (
            <button onClick={sendTest} className="text-xs underline text-slate-300">
              Send test notification
            </button>
          ) : (
            <button
              onClick={requestNotifPerm}
              className="text-xs px-3 py-1.5 rounded bg-orange-500/20 border border-orange-500/30 text-orange-200"
            >
              Enable browser notifications
            </button>
          )}
        </div>

        {/* Triggers */}
        <div className="mb-6">
          <div className="text-xs uppercase text-slate-500 mb-3 tracking-wider font-semibold">Notify me when</div>
          <div className="space-y-2">
            {ALL_TRIGGERS.map(t => (
              <label key={t.key} className="flex items-center gap-3 text-sm p-2 rounded-lg hover:bg-white/5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={triggers[t.key]}
                  onChange={e => setTriggers({ ...triggers, [t.key]: e.target.checked })}
                  className="rounded"
                />
                <span>{t.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Subscribed matches */}
        <div className="mb-6">
          <div className="text-xs uppercase text-slate-500 mb-3 tracking-wider font-semibold">
            Subscribed matches ({subscribed.length})
          </div>
          {subscribed.length === 0 && (
            <div className="text-sm text-slate-500 italic py-2">
              Click "Notify me" on any match card to subscribe.
            </div>
          )}
          <div className="space-y-1">
            {subscribed.map(([slug]) => (
              <div key={slug} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/5">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{eventTitle(slug)}</div>
                  <div className="text-[10px] text-slate-500 font-mono">{slug}</div>
                </div>
                <button onClick={() => unsubscribe(slug)} className="text-xs text-red-300 hover:text-red-200 px-2">
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Recent notifications */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs uppercase text-slate-500 tracking-wider font-semibold">
              Recent notifications ({notifications.length})
            </div>
            {notifications.length > 0 && (
              <button onClick={clearNotifs} className="text-xs text-slate-400 hover:text-white">Clear</button>
            )}
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto scroll-fade">
            {notifications.length === 0 && (
              <div className="text-sm text-slate-500 italic py-2">No notifications yet.</div>
            )}
            {notifications.slice().reverse().slice(0, 30).map((n, i) => (
              <div key={i} className="glass rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm">{notifIcon(n.type)}</span>
                  <span className="text-xs font-medium text-slate-300">{notifLabel(n.type)}</span>
                  <span className="text-[10px] text-slate-500 ml-auto">{timeAgo(n.ts)}</span>
                </div>
                <div className="text-sm font-medium">{n.title}</div>
                <div className="text-xs text-slate-400 mt-0.5">{formatDetails(n)}</div>
              </div>
            ))}
          </div>
        </div>
      </motion.aside>
    </motion.div>
  );
}

function notifIcon(t: ChangeType): string {
  return ({ back_in_stock: "🟢", tickets_added: "📈", tickets_sold: "📉",
           category_sold_out: "🔴", status_change: "⚡", new_event: "✨",
           bulk_sale: "⚠️" } as Record<ChangeType, string>)[t] || "•";
}
function notifLabel(t: ChangeType): string {
  return ({ back_in_stock: "Back in stock!", tickets_added: "Tickets added",
           tickets_sold: "Tickets sold", category_sold_out: "Category sold out",
           status_change: "Status changed", new_event: "New match",
           bulk_sale: "Bulk sale!" } as Record<ChangeType, string>)[t] || t;
}
function formatDetails(n: Change): string {
  const d = n.details || {};
  if (n.type === "tickets_added" || n.type === "tickets_sold") {
    return `${d.before} → ${d.after} (${d.delta > 0 ? "+" : ""}${d.delta})`;
  }
  if (n.type === "back_in_stock") return `${d.category}: ${d.remaining} available`;
  if (n.type === "category_sold_out") return `${d.category} just sold out`;
  if (n.type === "status_change") return `${d.from} → ${d.to}`;
  return JSON.stringify(d);
}
function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
