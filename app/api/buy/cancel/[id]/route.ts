/**
 * POST /api/buy/cancel/[id]
 *
 * Cancel a pending order before any worker claims it. Public — anyone with
 * the order id can cancel (they could just refuse to buy too).
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const { sql } = await import("@vercel/postgres");
  const now = Math.floor(Date.now() / 1000);
  const r = await sql`
    UPDATE buy_orders
    SET status = 'cancelled', completed_at = ${now}
    WHERE id = ${id} AND status = 'pending'
    RETURNING id, status
  `;
  if (r.rows.length === 0) {
    return NextResponse.json({ ok: false, error: "already_claimed_or_completed" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, order: r.rows[0] });
}
