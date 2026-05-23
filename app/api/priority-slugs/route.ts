/**
 * GET /api/priority-slugs
 *
 * Returns the list of event slugs that should be polled FREQUENTLY (every 3
 * minutes) instead of the default 10-minute cadence. A slug is "priority" if
 * any of the following holds:
 *
 *   1. The entire event is sold out (urgency = sold_out) — we want to catch
 *      restocks the second they happen.
 *   2. The highest-priced category is sold out — premium tickets are the
 *      ones with restock pressure.
 *   3. At least one category in the top-half by price is sold out.
 *   4. % sold >= 95 — the last few seats can vanish in minutes.
 *
 * Response: { count: N, slugs: [...], details: [{slug, reasons: [...]}, ...] }
 */
import { NextResponse } from "next/server";
import type { Event } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pick the freshest snapshot across all three reader paths.
 *  Serverless connection-pool isolation can serve stale data through one
 *  client even when another sees the latest write — pick the result with
 *  the most recent updated_at to dodge it. */
async function readAllEvents(): Promise<Event[]> {
  type Row = { slug: string; data: any; updated_at: number };
  const tries: Array<{ name: string; rows: Row[] }> = [];

  try {
    const { sql } = await import("@vercel/postgres");
    const r = await sql`SELECT slug, data, updated_at FROM events_latest`;
    tries.push({ name: "dynamic_sql", rows: r.rows as Row[] });
  } catch {/* */}
  try {
    const dbMod = await import("@/lib/db");
    const r = await dbMod.getLatestEvents();
    tries.push({
      name: "lib_db",
      rows: r.events.map((e: any) => ({ slug: e.slug, data: e, updated_at: r.updated_at })),
    });
  } catch {/* */}
  try {
    const vpg = await import("@vercel/postgres");
    const client = vpg.createClient();
    await client.connect();
    try {
      const r = await client.sql`SELECT slug, data, updated_at FROM events_latest`;
      tries.push({ name: "raw_client", rows: r.rows as Row[] });
    } finally { await client.end(); }
  } catch {/* */}

  // Pick the result with most rows AND highest max updated_at
  let best: Row[] = [];
  let bestScore = -1;
  for (const t of tries) {
    if (t.rows.length === 0) continue;
    const maxUpd = Math.max(...t.rows.map(r => r.updated_at || 0));
    // Score = (row count) * 1e10 + maxUpd (rows dominate, freshness breaks ties)
    const score = t.rows.length * 1e10 + maxUpd;
    if (score > bestScore) { bestScore = score; best = t.rows; }
  }
  return best.map(r => (typeof r.data === "string" ? JSON.parse(r.data) : (r.data as Event)));
}

export async function GET() {
  const events = await readAllEvents();

  const priority: Array<{ slug: string; reasons: string[]; pct_sold: number; urgency: string }> = [];
  for (const ev of events) {
    const reasons: string[] = [];

    if (ev.urgency === "sold_out") reasons.push("event_sold_out");
    if (typeof ev.pct_sold === "number" && ev.pct_sold >= 95) reasons.push("pct_sold_95plus");

    // NEW: low-capacity events are tiny drip restocks — they'll sell out
    // within minutes if anyone notices. We want to catch sellouts FAST so
    // we can immediately mark them as "alert" worthy for repeat polling.
    // Threshold tuned to ahlan's typical drip release size (3-50 per cat).
    const publicCats = Array.isArray(ev.categories)
      ? ev.categories.filter(c => !(c as any).is_hospitality && !(c.name || "").toUpperCase().startsWith("MATCH"))
      : [];
    const publicCap = publicCats.reduce((s, c) => s + (Number(c.quantity) || 0), 0);
    if (publicCap > 0 && publicCap <= 50) reasons.push("low_capacity_drip");

    if (publicCats.length > 0) {
      // Sort by price descending so [0] is the priciest
      const byPrice = [...publicCats].sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
      if (byPrice[0]?.sold_out) reasons.push("top_cat_sold_out");

      // Top-half by price = first half of sorted list
      const halfIdx = Math.max(1, Math.floor(byPrice.length / 2));
      const topHalfSold = byPrice.slice(0, halfIdx).some(c => c.sold_out);
      if (topHalfSold && !reasons.includes("top_cat_sold_out"))
        reasons.push("premium_cat_sold_out");
    }

    if (reasons.length > 0) {
      priority.push({
        slug: ev.slug,
        reasons,
        pct_sold: ev.pct_sold || 0,
        urgency: ev.urgency,
      });
    }
  }

  // Sort highest urgency first for readability
  priority.sort((a, b) => b.pct_sold - a.pct_sold);

  return NextResponse.json({
    count: priority.length,
    slugs: priority.map(p => p.slug),
    details: priority,
    generated_at: Math.floor(Date.now() / 1000),
  }, { headers: { "Cache-Control": "no-store" } });
}
