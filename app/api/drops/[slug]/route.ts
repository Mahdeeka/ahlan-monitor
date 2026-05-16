/**
 * GET /api/drops/[slug]
 *
 * "Drops" = back-in-stock + ticket-added events for a single match. Also
 * surfaces bulk-sale events and category sold-outs so the user can see the
 * full lifecycle on a timeline.
 *
 * Output:
 *   { drops:    [{ts, category?, added?, remaining?, type}, ...] }
 *   { patterns: { by_hour: {0:n, 1:n, ...}, by_dow: {0:n, ...}, total: n } }
 *
 * `by_hour` is hour-of-day (0-23 UTC) histogram of drop events — useful for
 * spotting "ahlan releases new tickets every Tuesday 9am UTC" patterns.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { slug: string } }) {
  const { sql } = await import("@vercel/postgres");

  const r = await sql`
    SELECT id, ts, type, details
    FROM changes
    WHERE slug = ${params.slug}
      AND type IN ('back_in_stock', 'tickets_added', 'category_sold_out', 'bulk_sale')
    ORDER BY ts DESC
    LIMIT 500
  `;

  const drops = r.rows.map(row => {
    const d = typeof row.details === "string" ? JSON.parse(row.details) : row.details;
    return {
      id: row.id as number,
      ts: row.ts as number,
      type: row.type as string,
      ...d,
    };
  });

  // Pattern detection: hour-of-day + day-of-week histograms for back_in_stock + tickets_added
  const positives = drops.filter(d => d.type === "back_in_stock" || d.type === "tickets_added");
  const byHour: Record<number, number> = {};
  const byDow: Record<number, number> = {};
  for (let i = 0; i < 24; i++) byHour[i] = 0;
  for (let i = 0; i < 7; i++) byDow[i] = 0;
  for (const d of positives) {
    const date = new Date(d.ts * 1000);
    byHour[date.getUTCHours()]++;
    byDow[date.getUTCDay()]++;
  }

  return NextResponse.json({
    slug: params.slug,
    drops,
    patterns: { by_hour: byHour, by_dow: byDow, total: positives.length },
  }, { headers: { "Cache-Control": "no-store" } });
}
