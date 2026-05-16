/**
 * GET /api/buy/orders
 *
 * Public read-only list of recent buy orders for the dashboard's /buy-queue page.
 * No PII — just slug, category, qty, status, timestamps.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { sql } = await import("@vercel/postgres");
  const now = Math.floor(Date.now() / 1000);
  const r = await sql`
    SELECT id, slug, title, category, qty, max_price_sar, status, worker_id,
           result, error_msg, receipt_url, notes,
           created_at, claimed_at, completed_at, auto_rule_id
    FROM buy_orders
    ORDER BY created_at DESC
    LIMIT 200
  `;

  // Health: worker is "online" if any order was claimed/completed in last 60s
  const ww = await sql`
    SELECT MAX(claimed_at) AS last_claimed, MAX(completed_at) AS last_completed
    FROM buy_orders
  `;
  const lastClaim = (ww.rows[0]?.last_claimed as number) || 0;
  const lastComplete = (ww.rows[0]?.last_completed as number) || 0;
  const lastActivity = Math.max(lastClaim, lastComplete);
  const workerActive = lastActivity > 0 && (now - lastActivity) < 30;

  // Aggregate stats
  const stats = await sql`
    SELECT
      SUM(CASE WHEN status = 'pending'    THEN 1 ELSE 0 END)::int AS pending,
      SUM(CASE WHEN status = 'claimed'    THEN 1 ELSE 0 END)::int AS claimed,
      SUM(CASE WHEN status = 'success'    THEN 1 ELSE 0 END)::int AS success,
      SUM(CASE WHEN status = 'failed'     THEN 1 ELSE 0 END)::int AS failed,
      SUM(CASE WHEN status = 'sold_out'   THEN 1 ELSE 0 END)::int AS sold_out,
      SUM(CASE WHEN status = 'auth_error' THEN 1 ELSE 0 END)::int AS auth_error,
      SUM(CASE WHEN status = 'cancelled'  THEN 1 ELSE 0 END)::int AS cancelled,
      SUM(CASE WHEN status = 'skipped'    THEN 1 ELSE 0 END)::int AS skipped,
      COUNT(*)::int AS total
    FROM buy_orders
  `;

  return NextResponse.json({
    now,
    orders: r.rows,
    stats: stats.rows[0] || {},
    worker: {
      online: workerActive,
      last_activity_seconds_ago: lastActivity ? now - lastActivity : null,
      last_activity_ts: lastActivity || null,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
