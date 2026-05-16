/**
 * POST /api/buy/enqueue
 *
 * Body: { slug: string, category: string, qty: number, max_price_sar?: number, title?: string }
 *
 * Creates a pending buy_orders row. The user's buy_worker.py polls /api/buy/queue
 * and processes it. Dashboard never holds payment credentials.
 */
import { NextResponse } from "next/server";
import { initSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QTY = 6;
const MAX_PER_HOUR = 30;  // soft rate limit per slug

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });

  const { slug, category, qty, max_price_sar, title, auto_rule_id } = body;
  if (typeof slug !== "string" || !slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
  if (typeof category !== "string" || !category) return NextResponse.json({ error: "category required" }, { status: 400 });
  const q = Math.max(1, Math.min(MAX_QTY, parseInt(String(qty || 1)) || 1));
  const maxPrice = max_price_sar ? parseInt(String(max_price_sar)) : null;

  await initSchema();
  const { sql } = await import("@vercel/postgres");
  const now = Math.floor(Date.now() / 1000);

  // Soft rate limit: too many pending/recent orders on the same slug?
  const recent = await sql`
    SELECT COUNT(*)::int AS n
    FROM buy_orders
    WHERE slug = ${slug}
      AND created_at > ${now - 3600}
  `;
  if (((recent.rows[0]?.n as number) ?? 0) >= MAX_PER_HOUR) {
    return NextResponse.json({
      error: "rate_limited",
      message: `Too many orders for this match in the last hour (>${MAX_PER_HOUR}).`,
    }, { status: 429 });
  }

  const ins = await sql`
    INSERT INTO buy_orders (slug, title, category, qty, max_price_sar, status, created_at, auto_rule_id)
    VALUES (${slug}, ${title || null}, ${category}, ${q}, ${maxPrice}, 'pending', ${now}, ${auto_rule_id || null})
    RETURNING id
  `;
  const id = ins.rows[0]?.id as number;

  return NextResponse.json({
    ok: true,
    id,
    status: "pending",
    slug, category, qty: q, max_price_sar: maxPrice,
    created_at: now,
  });
}
