/**
 * GET /api/buy/queue
 *
 * Returns pending orders ready for the worker to claim. Auth: Bearer token
 * matching BUY_WORKER_TOKEN env var.
 *
 * Returned orders are ordered by created_at ascending (FIFO).
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorize(req: Request): boolean {
  const need = process.env.BUY_WORKER_TOKEN;
  if (!need) return true; // dev mode: allow if no token set
  const auth = req.headers.get("authorization") || "";
  return auth === `Bearer ${need}`;
}

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { sql } = await import("@vercel/postgres");
  // Take orders pending OR claimed-but-stale (>2 min) — recover from crashed worker
  const now = Math.floor(Date.now() / 1000);
  const r = await sql`
    SELECT id, slug, title, category, qty, max_price_sar, status, created_at, claimed_at
    FROM buy_orders
    WHERE status = 'pending'
       OR (status = 'claimed' AND claimed_at < ${now - 120})
    ORDER BY created_at ASC
    LIMIT 25
  `;
  return NextResponse.json({
    now,
    orders: r.rows,
    requires_token: !!process.env.BUY_WORKER_TOKEN,
  }, { headers: { "Cache-Control": "no-store" } });
}
