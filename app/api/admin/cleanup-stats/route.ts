/**
 * POST /api/admin/cleanup-stats
 *
 * One-shot cleanup of stale data in monitoring tables:
 *   - Removes scrape_runs rows from the old failed vercel-cron-* attempts
 *     (back when we tried to scrape direct from Vercel via proxies — ahlan
 *     WAF blocked them, leaving rows with 100% error count that pollute
 *     the 24h success-rate stat).
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { sql } = await import("@vercel/postgres");

  const r = await sql`
    DELETE FROM scrape_runs
    WHERE source LIKE 'vercel-cron-%' AND ok_count = 0
    RETURNING id
  `;

  return NextResponse.json({ ok: true, deleted: r.rowCount });
}

export async function GET() {
  return NextResponse.json({ info: "POST to delete stale vercel-cron-* failed rows" });
}
