/**
 * POST /api/buy/complete/[id]
 *
 * Worker reports the outcome of a buy attempt.
 * Auth: Bearer BUY_WORKER_TOKEN
 * Body: {
 *   status: "success" | "failed" | "sold_out" | "auth_error" | "skipped",
 *   error_msg?: string,
 *   receipt_url?: string,
 *   notes?: string,
 * }
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set(["success", "failed", "sold_out", "auth_error", "skipped"]);

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
  const status = String(body.status || "");
  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: `status must be one of ${Array.from(VALID_STATUSES).join(",")}` }, { status: 400 });
  }

  const { sql } = await import("@vercel/postgres");
  const now = Math.floor(Date.now() / 1000);
  const r = await sql`
    UPDATE buy_orders
    SET status = ${status},
        result = ${status},
        error_msg = ${body.error_msg || null},
        receipt_url = ${body.receipt_url || null},
        notes = ${body.notes || null},
        completed_at = ${now}
    WHERE id = ${id}
    RETURNING id, status, completed_at
  `;
  if (r.rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, order: r.rows[0] });
}
