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

export async function GET() {
  const { sql } = await import("@vercel/postgres");
  const rows = await sql`SELECT slug, data FROM events_latest`;
  const events: Event[] = rows.rows.map(r =>
    typeof r.data === "string" ? JSON.parse(r.data) : (r.data as Event)
  );

  const priority: Array<{ slug: string; reasons: string[]; pct_sold: number; urgency: string }> = [];
  for (const ev of events) {
    const reasons: string[] = [];

    if (ev.urgency === "sold_out") reasons.push("event_sold_out");
    if (typeof ev.pct_sold === "number" && ev.pct_sold >= 95) reasons.push("pct_sold_95plus");

    if (Array.isArray(ev.categories) && ev.categories.length > 0) {
      // Sort by price descending so [0] is the priciest
      const byPrice = [...ev.categories].sort((a, b) => (b.price || 0) - (a.price || 0));
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
