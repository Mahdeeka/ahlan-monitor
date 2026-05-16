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

  // 2) Recent history (last 7 days, max 2000 points)
  const cutoff = Math.floor(Date.now() / 1000) - 7 * 86400;
  const hist = await sql`
    SELECT ts, total_remaining, total_capacity
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
  }, { headers: { "Cache-Control": "no-store" } });
}
