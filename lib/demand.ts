/**
 * Buy Score (0-100): how urgent is it to buy a ticket for this match.
 *
 * Inputs:
 *   - pct_sold           : current % of seats sold (the bigger, the more demand)
 *   - velocity_per_day   : tickets sold per day over last 24h (sales pressure)
 *   - days_to_match      : how many days until the match
 *   - stage              : "FINAL" / "Semifinal" / "Quarterfinal" / "Round of 16" / "Group"
 *   - urgency            : the snapshot's pre-computed bucket
 *
 * The output is a 0-100 number with a verbal label, a one-line recommendation,
 * and a small breakdown so the UI can show "why".
 */
import type { Event } from "./types";

export type BuyScore = {
  score: number;            // 0-100
  label: string;            // e.g. "BUY NOW", "Strong buy", "No rush", ...
  recommendation: string;   // single-line human advice
  tone: "red" | "orange" | "yellow" | "green" | "slate";
  breakdown: Array<{ factor: string; impact: number; note: string }>;
  velocity_per_day: number | null;
  velocity_per_hour: number | null;
  days_to_match: number | null;
  hours_to_match: number | null;
};

export type HistoryPoint = {
  ts: number;                // unix seconds
  total_remaining: number;
  total_capacity: number;
};

function clamp(v: number, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }

function stageMultiplier(stage: string): number {
  switch (stage) {
    case "FINAL":        return 1.25;
    case "Semifinal":    return 1.15;
    case "Quarterfinal": return 1.10;
    case "Round of 16":  return 1.05;
    case "3rd Place":    return 1.05;
    default:             return 1.0;
  }
}

/** Compute velocity (tickets sold per day) from the recent history points. */
function velocityFromHistory(history: HistoryPoint[]): { perDay: number | null; perHour: number | null; windowH: number } {
  if (!history || history.length < 2) return { perDay: null, perHour: null, windowH: 0 };
  // Sort oldest→newest, then take the points covering up to last 24 hours
  const sorted = [...history].sort((a, b) => a.ts - b.ts);
  const now = sorted[sorted.length - 1].ts;
  const cutoff = now - 24 * 3600;
  const window = sorted.filter(p => p.ts >= cutoff);
  if (window.length < 2) {
    // Fall back to all history
    const first = sorted[0]; const last = sorted[sorted.length - 1];
    const hours = Math.max(0.0001, (last.ts - first.ts) / 3600);
    const sold = first.total_remaining - last.total_remaining;
    return { perDay: (sold / hours) * 24, perHour: sold / hours, windowH: hours };
  }
  const first = window[0]; const last = window[window.length - 1];
  const hours = Math.max(0.0001, (last.ts - first.ts) / 3600);
  const sold = first.total_remaining - last.total_remaining;
  return { perDay: (sold / hours) * 24, perHour: sold / hours, windowH: hours };
}

export function computeBuyScore(ev: Event, history: HistoryPoint[], now: number = Math.floor(Date.now() / 1000)): BuyScore {
  const breakdown: Array<{ factor: string; impact: number; note: string }> = [];

  // 1. % sold contributes the bulk
  const pctSold = ev.total_capacity ? ((ev.total_capacity - ev.total_remaining) / ev.total_capacity) * 100 : 0;
  const pctScore = clamp(pctSold * 0.55, 0, 55); // up to 55 pts
  breakdown.push({
    factor: "Tickets already sold",
    impact: Math.round(pctScore),
    note: `${pctSold.toFixed(1)}% of ${ev.total_capacity.toLocaleString()} seats taken`,
  });

  // 2. Velocity (sales rate) — boost if tickets moving fast
  const vel = velocityFromHistory(history);
  let velScore = 0;
  if (vel.perDay != null && vel.perDay > 0 && ev.total_remaining > 0) {
    // Convert: at current rate, days until sold out
    const daysToSellOut = ev.total_remaining / vel.perDay;
    if (daysToSellOut < 1)        velScore = 25;
    else if (daysToSellOut < 3)   velScore = 20;
    else if (daysToSellOut < 7)   velScore = 15;
    else if (daysToSellOut < 30)  velScore = 8;
    else                          velScore = 3;
    breakdown.push({
      factor: "Sales velocity",
      impact: velScore,
      note: `${Math.round(vel.perDay).toLocaleString()} sold/day · sells out in ~${
        daysToSellOut < 1 ? `${Math.round(daysToSellOut * 24)}h`
        : `${Math.round(daysToSellOut)}d`
      } at this rate`,
    });
  } else if (vel.perDay === 0) {
    breakdown.push({
      factor: "Sales velocity",
      impact: 0,
      note: "No movement in last 24h",
    });
  }

  // 3. Time pressure
  let timeScore = 0;
  let daysToMatch: number | null = null;
  let hoursToMatch: number | null = null;
  if (ev.date_unix && ev.date_unix > now) {
    hoursToMatch = (ev.date_unix - now) / 3600;
    daysToMatch = hoursToMatch / 24;
    if (daysToMatch < 1)        timeScore = 12;
    else if (daysToMatch < 7)   timeScore = 10;
    else if (daysToMatch < 30)  timeScore = 7;
    else if (daysToMatch < 90)  timeScore = 4;
    else                        timeScore = 1;
    breakdown.push({
      factor: "Time until match",
      impact: timeScore,
      note: daysToMatch < 1
        ? `Less than 24h to go`
        : `${Math.round(daysToMatch)} days away`,
    });
  }

  // 4. Stage multiplier (caps raw signal, then multiplied)
  const stageMult = stageMultiplier(ev.stage);
  const raw = pctScore + velScore + timeScore;
  const adjusted = clamp(raw * stageMult, 0, 100);
  if (stageMult > 1) {
    breakdown.push({
      factor: "Stage importance",
      impact: Math.round((adjusted - raw)),
      note: `${ev.stage} matches see surge demand`,
    });
  }

  // Already sold out → cap at 100 with a special label
  if (ev.urgency === "sold_out") {
    return {
      score: 100,
      label: "SOLD OUT",
      recommendation: "All categories are gone. Watch for restocks or try resale channels.",
      tone: "red",
      breakdown,
      velocity_per_day: vel.perDay,
      velocity_per_hour: vel.perHour,
      days_to_match: daysToMatch, hours_to_match: hoursToMatch,
    };
  }

  let label: string, tone: BuyScore["tone"], recommendation: string;
  const s = Math.round(adjusted);
  if (s >= 85)      { label = "BUY NOW";       tone = "red";    recommendation = "Demand is extreme — likely to sell out very soon."; }
  else if (s >= 70) { label = "Strong buy";    tone = "orange"; recommendation = "Tickets are moving fast. Don't wait more than a few days."; }
  else if (s >= 50) { label = "Buy soon";      tone = "yellow"; recommendation = "Good demand. Solid time to lock in your seats."; }
  else if (s >= 30) { label = "No rush";       tone = "green";  recommendation = "Plenty of seats. Compare prices and pick your spot."; }
  else              { label = "Wide open";     tone = "slate";  recommendation = "Lowest pressure. You can wait if you want better tickets to open up."; }

  return {
    score: s, label, recommendation, tone,
    breakdown,
    velocity_per_day: vel.perDay,
    velocity_per_hour: vel.perHour,
    days_to_match: daysToMatch,
    hours_to_match: hoursToMatch,
  };
}
