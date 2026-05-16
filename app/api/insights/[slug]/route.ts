/**
 * GET /api/insights/[slug]
 *
 * Returns enriched per-match info for the detail modal:
 *   - event           : latest snapshot from DB
 *   - stadium         : {name, city, capacity}
 *   - teams           : {home, away} (group matches only) — codes/flags/strength
 *   - matchups        : top KO matchup probabilities (knockout only)
 *   - team_reach_prob : per-team prob of appearing in this slot (knockout only)
 *   - buy_score       : Buy Score {score, label, recommendation, breakdown}
 *   - history_summary : compact 24h summary (count, opened-at-snapshot, latest)
 */
import { NextResponse } from "next/server";
import { stadiumInfo } from "@/lib/stadiums";
import { teamsForSlug } from "@/lib/teams";
import { SLUG_BRACKET, topMatchupsForSlug, teamReachProbForSlug } from "@/lib/probabilities";
import { computeBuyScore, type HistoryPoint } from "@/lib/demand";
import type { Event } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { slug: string } }) {
  const slug = params.slug;
  const { sql } = await import("@vercel/postgres");

  // 1) Latest snapshot
  const latest = await sql`SELECT data, updated_at FROM events_latest WHERE slug = ${slug}`;
  if (latest.rows.length === 0) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  const r0 = latest.rows[0];
  const event: Event = typeof r0.data === "string" ? JSON.parse(r0.data) : (r0.data as Event);
  const last_update = r0.updated_at as number;

  // 2) Recent history (last 7 days, max 2000 points). Pull categories too so
  //    we can compute per-category sellout predictions.
  const cutoff = Math.floor(Date.now() / 1000) - 7 * 86400;
  const hist = await sql`
    SELECT ts, total_remaining, total_capacity, categories
    FROM snapshots
    WHERE slug = ${slug} AND ts >= ${cutoff}
    ORDER BY ts ASC
    LIMIT 2000
  `;
  const history: HistoryPoint[] = hist.rows.map(row => ({
    ts: row.ts as number,
    total_remaining: row.total_remaining as number,
    total_capacity: row.total_capacity as number,
  }));

  // Per-category history → per-cat velocity → per-cat sellout prediction
  const perCatHistory: Map<string, Array<{ ts: number; remaining: number; quantity: number }>> = new Map();
  for (const row of hist.rows) {
    const cats = typeof row.categories === "string" ? JSON.parse(row.categories) : (row.categories as any[]);
    if (!Array.isArray(cats)) continue;
    for (const c of cats) {
      if (!perCatHistory.has(c.name)) perCatHistory.set(c.name, []);
      perCatHistory.get(c.name)!.push({
        ts: row.ts as number,
        remaining: c.remaining as number,
        quantity: c.quantity as number,
      });
    }
  }

  const nowTs = Math.floor(Date.now() / 1000);
  const catPredictions = event.categories.map(c => {
    const h = perCatHistory.get(c.name) || [];
    // velocity over last 24h
    const cutoff24 = nowTs - 86400;
    const recent = h.filter(p => p.ts >= cutoff24);
    let velocity_per_hour: number | null = null;
    let predicted_sellout_ts: number | null = null;
    let predicted_sellout_str: string | null = null;
    if (recent.length >= 2) {
      const first = recent[0]; const last = recent[recent.length - 1];
      const hours = Math.max(0.001, (last.ts - first.ts) / 3600);
      const sold = first.remaining - last.remaining;
      velocity_per_hour = sold / hours;
      if (velocity_per_hour > 0 && c.remaining > 0) {
        const hoursLeft = c.remaining / velocity_per_hour;
        predicted_sellout_ts = nowTs + Math.round(hoursLeft * 3600);
        if (hoursLeft < 1)        predicted_sellout_str = `~${Math.round(hoursLeft * 60)}m`;
        else if (hoursLeft < 24)  predicted_sellout_str = `~${Math.round(hoursLeft)}h`;
        else                       predicted_sellout_str = `~${Math.round(hoursLeft / 24)}d`;
      } else if (c.sold_out) {
        predicted_sellout_str = "sold out";
      } else if (velocity_per_hour === 0) {
        predicted_sellout_str = "no movement";
      }
    }
    return {
      name: c.name,
      remaining: c.remaining,
      quantity: c.quantity,
      sold_out: c.sold_out,
      price: c.price,
      is_hospitality: (c as any).is_hospitality === true ||
        ((c as any).is_hospitality === undefined && c.name.toUpperCase().startsWith("MATCH")),
      velocity_per_hour,
      velocity_per_day: velocity_per_hour != null ? velocity_per_hour * 24 : null,
      predicted_sellout_ts,
      predicted_sellout_str,
    };
  });

  // 3) Stadium + teams
  const stadium = stadiumInfo(event.venue);
  const teams = teamsForSlug(slug);
  const bracket = SLUG_BRACKET[slug] || null;
  const isKO = !!bracket;

  // 4) Knockout matchup forecasts (cached after first call)
  const matchups = isKO ? topMatchupsForSlug(slug, 6) : [];
  const team_reach_prob = isKO ? teamReachProbForSlug(slug) : [];

  // 5) Buy Score
  const buy_score = computeBuyScore(event, history);

  // 6) Summary insights
  const insights: Array<{ icon: string; text: string }> = [];

  // Allocated-vs-stadium
  if (stadium.capacity > 0 && event.total_capacity > 0) {
    const allocation = (event.total_capacity / stadium.capacity) * 100;
    insights.push({
      icon: "📐",
      text: `${event.total_capacity.toLocaleString()} tickets on sale = ${allocation.toFixed(0)}% of ${stadium.name}'s ${stadium.capacity.toLocaleString()}-seat capacity`,
    });
  }
  // Sold so far
  const sold = event.total_capacity - event.total_remaining;
  if (sold > 0) {
    insights.push({
      icon: "🎟️",
      text: `${sold.toLocaleString()} tickets sold, ${event.total_remaining.toLocaleString()} remaining`,
    });
  }
  // Most expensive cat
  if (event.categories.length > 0) {
    const prices = event.categories.filter(c => c.price > 0);
    if (prices.length > 0) {
      const cheap = prices.reduce((m, c) => (c.price < m.price ? c : m), prices[0]);
      const expensive = prices.reduce((m, c) => (c.price > m.price ? c : m), prices[0]);
      insights.push({
        icon: "💰",
        text: `Prices range from SAR ${cheap.price} (${cheap.name}) to SAR ${expensive.price} (${expensive.name})`,
      });
    }
  }
  // Sold out categories
  const soldOutCats = event.categories.filter(c => c.sold_out);
  if (soldOutCats.length > 0) {
    insights.push({
      icon: "🔴",
      text: `${soldOutCats.length} of ${event.categories.length} categories sold out: ${soldOutCats.map(c => c.name).join(", ")}`,
    });
  }
  // Velocity comment
  if (buy_score.velocity_per_day != null && buy_score.velocity_per_day > 0) {
    insights.push({
      icon: "📈",
      text: `Selling ${Math.round(buy_score.velocity_per_day).toLocaleString()} tickets/day in the last 24h`,
    });
  }
  // Time-to-match
  if (buy_score.days_to_match != null) {
    const d = Math.floor(buy_score.days_to_match);
    const h = Math.floor((buy_score.hours_to_match || 0) % 24);
    insights.push({
      icon: "⏰",
      text: d > 0 ? `${d} days, ${h} hours until kickoff` : `Less than ${Math.ceil(buy_score.hours_to_match!)} hours until kickoff`,
    });
  }

  return NextResponse.json({
    event,
    last_update,
    stadium,
    teams,
    bracket,
    is_knockout: isKO,
    matchups,
    team_reach_prob,
    buy_score,
    insights,
    category_predictions: catPredictions,
  }, { headers: { "Cache-Control": "no-store" } });
}
