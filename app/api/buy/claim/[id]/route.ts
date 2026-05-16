/**
 * POST /api/buy/claim/[id]
 *
 * Worker claims an order. Atomic — only one worker wins.
 * Auth: Bearer BUY_WORKER_TOKEN
 * Body: { worker_id?: string }
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const need = process.env.BUY_WORKER_TOKEN;
  if (need) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${need}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const id = parseInt(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const workerId = (body.worker_id || "default").slice(0, 60);

  const { sql } = await import("@vercel/postgres");
  const now = Math.floor(Date.now() / 1000);
  // Atomic claim: only if currently pending or stale-claimed
  const r = await sql`
    UPDATE buy_orders
    SET status = 'claimed', worker_id = ${workerId}, claimed_at = ${now}
    WHERE id = ${id}
      AND (status = 'pending' OR (status = 'claimed' AND claimed_at < ${now - 120}))
    RETURNING id, slug, title, category, qty, max_price_sar, status
  `;
  if (r.rows.length === 0) {
    return NextResponse.json({ ok: false, error: "already_claimed_or_completed" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, order: r.rows[0] });
}
