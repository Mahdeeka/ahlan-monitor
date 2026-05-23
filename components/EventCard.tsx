"use client";

import { Bell, BellOff, ArrowRight, Zap, Calendar, MapPin } from "lucide-react";
import clsx from "clsx";
import type { Event, Urgency } from "@/lib/types";
import { teamsForSlug } from "@/lib/teams";
import { Sparkline } from "@/components/Sparkline";

const URGENCY_LABEL: Record<Urgency, string> = {
  available:    "AVAILABLE",
  selling_fast: "SELLING FAST",
  almost_gone:  "ALMOST GONE",
  sold_out:     "SOLD OUT",
  unknown:      "—",
};

function countdownText(unixTs: number): string | null {
  if (!unixTs) return null;
  const now = Math.floor(Date.now() / 1000);
  const diff = unixTs - now;
  if (diff <= 0) return "Live / past";
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  if (days >= 30) return `${Math.floor(days / 30)}mo ${days % 30}d`;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(diff / 60)}m`;
}

export function EventCard({
  event, subscribed, onToggleSubscribe, onClick,
}: {
  event: Event;
  subscribed: boolean;
  onToggleSubscribe: () => void;
  onClick: () => void;
}) {
  const realCats = event.categories.filter(c =>
    c.is_hospitality === false || (c.is_hospitality === undefined && !c.name.toUpperCase().startsWith("MATCH"))
  );
  const teams = teamsForSlug(event.slug);
  const countdown = countdownText(event.date_unix);
  // Priority signal — for the small ⚡ icon
  const topByPrice = [...event.categories].sort((a, b) => (b.price || 0) - (a.price || 0));
  const isHot = event.urgency === "sold_out" ||
                (event.pct_sold ?? 0) >= 95 ||
                (topByPrice[0]?.sold_out === true);
  const stageBg =
    event.stage === "FINAL"        ? "bg-purple-500/20 text-purple-300 border-purple-500/30"
    : event.stage === "Semifinal"  ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
    : event.stage === "Quarterfinal" ? "bg-blue-500/20 text-blue-300 border-blue-500/30"
    : event.stage === "Round of 16"  ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/30"
    : "bg-slate-700/40 text-slate-300 border-slate-600/30";
  return (
    <div
      onClick={onClick}
      className={clsx(
        "glass glass-hover rounded-2xl p-5 cursor-pointer transition-all duration-200 relative group hover:scale-[1.01] hover:shadow-lg hover:shadow-indigo-500/5",
        event.urgency === "sold_out" && "ring-1 ring-red-500/20",
      )}
    >
      {/* header: badges + title */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={clsx("text-[10px] px-2 py-0.5 rounded-full border font-medium", stageBg)}>
              {event.stage}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">#{event.match_number}</span>
            {isHot && (
              <span title="High demand — fast-poll lane" className="text-[10px] flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30">
                <Zap className="w-2.5 h-2.5" /> HOT
              </span>
            )}
          </div>
          <h3 className="text-sm sm:text-base font-semibold text-white leading-tight tracking-tight">
            {teams ? (
              <>
                <span className="mr-1">{teams.home.flag}</span> {teams.home.name}
                <span className="text-slate-500 mx-1.5 font-normal">vs</span>
                <span className="mr-1">{teams.away.flag}</span> {teams.away.name}
              </>
            ) : event.title}
          </h3>
        </div>
        <span className={clsx("text-[10px] px-2 py-1 rounded-md font-bold whitespace-nowrap tracking-wide", `badge-${event.urgency}`)}>
          {URGENCY_LABEL[event.urgency]}
        </span>
      </div>

      <div className="text-[11px] text-slate-400 mb-0.5 truncate flex items-center gap-1">
        <Calendar className="w-3 h-3 opacity-60 shrink-0" />
        {event.date}
        {countdown && <span className="ml-auto text-indigo-300 tabular-nums">in {countdown}</span>}
      </div>
      <div className="text-[11px] text-slate-500 mb-4 truncate flex items-center gap-1">
        <MapPin className="w-3 h-3 opacity-60 shrink-0" />
        {event.venue}{event.city ? ` · ${event.city}` : ""}
      </div>

      {/* progress */}
      {(() => {
        // The LIVE state from ahlan's API is the source of truth for "what
        // can I buy RIGHT NOW". Today ahlan drip-restocks (3-18 visible at a
        // time, often all marked sold_out). The peak is the historic max
        // allocation we've ever seen — useful context, NOT a substitute for
        // current remaining.
        const peak = (event as any).peak_public_capacity as number | undefined;
        const realCap = (event as any).venue_capacity_real as number | undefined;
        const isDrip = event.total_capacity > 0 && event.total_capacity <= 50;
        // Peak is "noteworthy" when much bigger than the current drop. This
        // signals to the user "ahlan has run thousands through here before;
        // it's a high-demand match worth watching for the next big drop".
        const peakIsNoteworthy = peak && peak > Math.max(50, event.total_capacity * 5);
        return (
          <div className="mb-3">
            {/* Headline: the LIVE state — what fans can actually buy now. */}
            <div className="flex justify-between items-baseline text-xs mb-1.5">
              <span className="text-slate-300">
                <span className="font-semibold text-white">{event.total_remaining.toLocaleString()}</span>
                <span className="text-slate-500"> / {event.total_capacity.toLocaleString()}</span>
                {isDrip && (
                  <span className="text-amber-400/80 ml-1.5 text-[10px] font-medium">in current drop</span>
                )}
              </span>
              <span className={clsx("font-bold text-xs", `urgency-${event.urgency}`)}>
                {event.pct_sold}% sold
              </span>
            </div>
            <div className="bg-slate-700/30 rounded-full h-1.5 overflow-hidden">
              <div
                className={clsx("h-full rounded-full transition-all duration-500", barClass(event.urgency))}
                style={{ width: `${Math.max(2, event.pct_sold)}%` }}
              />
            </div>
            {/* Context line — stadium + historic peak. Honest framing: peak
                is what ahlan has EVER allocated, not what's remaining now. */}
            {(realCap || peakIsNoteworthy) && (
              <div className="text-[10px] text-slate-500 mt-1 flex flex-wrap gap-x-2">
                {realCap && <span>Stadium {realCap.toLocaleString()}</span>}
                {peakIsNoteworthy && (
                  <span
                    className="text-emerald-400/70"
                    title={`ahlan has at some point exposed up to ${peak!.toLocaleString()} tickets for this match (real allocation). They're currently in drip-restock mode showing ${event.total_capacity}.`}
                  >
                    Real allocation seen: {peak!.toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* 24h sparkline */}
      <div className="mb-3">
        <Sparkline slug={event.slug} color={sparkColor(event.urgency)} height={28} />
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
                ? <span title="ahlan marked this category sold out (sold_out=true). New drops may appear later.">SOLD OUT</span>
                : <><span className="font-medium">{c.remaining.toLocaleString()}</span>
                    <span className="text-slate-500"> / {c.quantity.toLocaleString()}</span>
                    {c.price > 0 && <span className="text-slate-500"> · SAR {c.price}</span>}
                  </>
              }
            </span>
          </div>
        ))}
        {/* Hospitality value strip — MATCH packages (Gold/Silver/Platinum) sit
            alongside public tickets. Highlight the SAR value still sitting
            open so users see the high-value targets at a glance. */}
        {(() => {
          const hospVal = (event as any).hospitality_value_sar as number | undefined;
          const hospRem = (event as any).hospitality_remaining as number | undefined;
          if (!hospVal || hospVal <= 0) return null;
          return (
            <div className="flex items-center justify-between pt-1 mt-1 border-t border-white/5">
              <span className="text-amber-400/80 text-[10px] uppercase tracking-wide">Hospitality</span>
              <span className="text-amber-300/90 font-medium" title="MATCH Gold/Silver/Platinum hospitality packages still available">
                {hospRem != null && hospRem > 0 && (
                  <span className="text-slate-500">{hospRem} · </span>
                )}
                SAR {hospVal >= 1000 ? `${(hospVal / 1000).toFixed(0)}K` : hospVal.toLocaleString()}
              </span>
            </div>
          );
        })()}
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
          View detail <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
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

function sparkColor(u: Urgency): string {
  switch (u) {
    case "sold_out":    return "#ef4444";
    case "almost_gone": return "#f97316";
    case "selling_fast":return "#eab308";
    case "available":   return "#22c55e";
    default:            return "#818cf8";
  }
}
