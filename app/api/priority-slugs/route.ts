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
 *   5. **Low capacity drip** — events with public cap ≤ 50 (drip-restocked).
 *   6. **Always-priority high-value events** — KSA matches + Follow-My-Team
 *      packs + FINAL. These are the highest-value targets regardless of
 *      current state (SAR 5.6M of hospitality value is concentrated here).
 *   7. **High hospitality value** — events where hospitality_value_sar ≥ 250K
 *      (top-10 by SAR open inventory).
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

/**
 * Always-priority slugs — the highest-value AFC targets that scalpers will
 * watch hardest. We poll these every 3 min regardless of current inventory
 * state because (a) restocks of these go fast and (b) SAR 5.6M of MATCH
 * hospitality is concentrated here.
 *
 * Ranking based on Round 3 recon report (afc27/AFC27_REPORT.md §2):
 *   afc-cup-27-ksa-pack       SAR 999,170 hospitality
 *   afc-cup-27-omn-vs-ksa-13  SAR 617,665
 *   afc-cup-27-ksa-vs-pls-1   SAR 603,520 (opening match!)
 *   afc-cup-27-ksa-vs-kuw-27  SAR 396,060
 *   afc-cup-27-final-50       FINAL itself — 72,000-seat stadium
 *   afc-cup-27-chn-pack       SAR 281,342
 *   afc-cup-27-uae-pack       SAR  13,724
 */
const ALWAYS_PRIORITY_SLUGS = new Set([
  "afc-cup-27-ksa-pack",
  "afc-cup-27-omn-vs-ksa-13",
  "afc-cup-27-ksa-vs-pls-1",
  "afc-cup-27-ksa-vs-kuw-27",
  "afc-cup-27-final-50",
  "afc-cup-27-chn-pack",
  "afc-cup-27-uae-pack",
  // Also include the "duplicate" KSA-PLS that ahlan maintains under match 7
  "afc-cup-27-ksa-vs-pls-7",
]);

/** SAR threshold above which an event is auto-priority for its hospitality value. */
const HIGH_HOSPITALITY_VALUE_SAR = 250000;

export async function GET() {
  const events = await readAllEvents();

  const priority: Array<{
    slug: string;
    reasons: string[];
    pct_sold: number;
    urgency: string;
    hospitality_value_sar?: number;
  }> = [];
  for (const ev of events) {
    const reasons: string[] = [];

    if (ev.urgency === "sold_out") reasons.push("event_sold_out");
    if (typeof ev.pct_sold === "number" && ev.pct_sold >= 95) reasons.push("pct_sold_95plus");

    // Always-priority high-value events (Saudi matches + packs + FINAL).
    if (ALWAYS_PRIORITY_SLUGS.has(ev.slug)) reasons.push("high_value_target");

    // High-hospitality-value events (top by SAR open inventory). Catches any
    // event with ≥ 250K SAR sitting in MATCH packages — KSA matches, packs,
    // FINAL — even when we haven't hardcoded them above.
    const hospVal = Number((ev as any).hospitality_value_sar) || 0;
    if (hospVal >= HIGH_HOSPITALITY_VALUE_SAR) reasons.push("high_hospitality_value");

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
        hospitality_value_sar: hospVal || undefined,
      });
    }
  }

  // Sort: always-priority first, then by hospitality_value desc, then pct_sold desc
  priority.sort((a, b) => {
    const aAlways = a.reasons.includes("high_value_target") ? 1 : 0;
    const bAlways = b.reasons.includes("high_value_target") ? 1 : 0;
    if (aAlways !== bAlways) return bAlways - aAlways;
    const aHosp = a.hospitality_value_sar || 0;
    const bHosp = b.hospitality_value_sar || 0;
    if (aHosp !== bHosp) return bHosp - aHosp;
    return b.pct_sold - a.pct_sold;
  });

  return NextResponse.json({
    count: priority.length,
    slugs: priority.map(p => p.slug),
    details: priority,
    generated_at: Math.floor(Date.now() / 1000),
  }, { headers: { "Cache-Control": "no-store" } });
}
