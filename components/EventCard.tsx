"use client";

import { Bell, BellOff, ArrowRight } from "lucide-react";
import clsx from "clsx";
import type { Event, Urgency } from "@/lib/types";

const URGENCY_LABEL: Record<Urgency, string> = {
  available:    "AVAILABLE",
  selling_fast: "SELLING FAST",
  almost_gone:  "ALMOST GONE",
  sold_out:     "SOLD OUT",
  unknown:      "—",
};

export function EventCard({
  event, subscribed, onToggleSubscribe, onClick,
}: {
  event: Event;
  subscribed: boolean;
  onToggleSubscribe: () => void;
  onClick: () => void;
}) {
  const realCats = event.categories.filter(c => !c.name.toUpperCase().startsWith("MATCH"));
  return (
    <div
      onClick={onClick}
      className="glass glass-hover rounded-2xl p-5 cursor-pointer transition-all relative group"
    >
      {/* header: badges + title */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/40 text-slate-300 border border-slate-600/30 font-medium">
              {event.stage}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">#{event.match_number}</span>
          </div>
          <h3 className="text-sm sm:text-base font-semibold text-white leading-tight tracking-tight">
            {event.title}
          </h3>
        </div>
        <span className={clsx("text-[10px] px-2 py-1 rounded-md font-bold whitespace-nowrap tracking-wide", `badge-${event.urgency}`)}>
          {URGENCY_LABEL[event.urgency]}
        </span>
      </div>

      <div className="text-[11px] text-slate-400 mb-1 truncate">{event.date}</div>
      <div className="text-[11px] text-slate-500 mb-4 truncate">
        {event.venue}{event.city ? ` · ${event.city}` : ""}
      </div>

      {/* progress */}
      <div className="mb-4">
        <div className="flex justify-between items-baseline text-xs mb-1.5">
          <span className="text-slate-300">
            <span className="font-semibold text-white">{event.total_remaining.toLocaleString()}</span>
            <span className="text-slate-500"> / {event.total_capacity.toLocaleString()}</span>
          </span>
          <span className={clsx("font-bold text-xs", `urgency-${event.urgency}`)}>{event.pct_sold}% sold</span>
        </div>
        <div className="bg-slate-700/30 rounded-full h-1.5 overflow-hidden">
          <div
            className={clsx("h-full rounded-full transition-all duration-500", barClass(event.urgency))}
            style={{ width: `${Math.max(2, event.pct_sold)}%` }}
          />
        </div>
      </div>

      {/* categories */}
      <div className="space-y-1 text-xs">
        {realCats.length === 0 && (
          <div className="text-slate-500 italic text-[11px]">No ticket data available</div>
        )}
        {realCats.map(c => (
          <div key={c.name} className="flex items-center justify-between">
            <span className="text-slate-400">{c.name}</span>
            <span className={c.sold_out ? "text-red-400 font-medium" : "text-slate-200"}>
              {c.sold_out
                ? "SOLD OUT"
                : <><span className="font-medium">{c.remaining.toLocaleString()}</span>
                    <span className="text-slate-500"> / {c.quantity.toLocaleString()}</span>
                    {c.price > 0 && <span className="text-slate-500"> · SAR {c.price}</span>}
                  </>
              }
            </span>
          </div>
        ))}
      </div>

      {/* footer */}
      <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
        <button
          onClick={e => { e.stopPropagation(); onToggleSubscribe(); }}
          className={clsx(
            "text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors flex items-center gap-1.5",
            subscribed
              ? "bg-indigo-500/20 text-indigo-200 border-indigo-400/30 hover:bg-indigo-500/30"
              : "bg-slate-700/30 text-slate-400 border-slate-600/30 hover:bg-slate-700/50 hover:text-slate-200"
          )}
        >
          {subscribed ? <Bell className="w-3 h-3" /> : <BellOff className="w-3 h-3" />}
          {subscribed ? "Subscribed" : "Notify me"}
        </button>
        <span className="text-[11px] text-slate-400 group-hover:text-white transition-colors flex items-center gap-1">
          View trend <ArrowRight className="w-3 h-3" />
        </span>
      </div>
    </div>
  );
}

function barClass(u: Urgency): string {
  switch (u) {
    case "sold_out":    return "bg-gradient-to-r from-red-500 to-red-600";
    case "almost_gone": return "bg-gradient-to-r from-orange-500 to-amber-500";
    case "selling_fast":return "bg-gradient-to-r from-yellow-500 to-amber-400";
    case "available":   return "bg-gradient-to-r from-green-500 to-emerald-400";
    default:            return "bg-gradient-to-r from-slate-500 to-slate-400";
  }
}
