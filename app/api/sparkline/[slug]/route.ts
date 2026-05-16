/**
 * GET /api/sparkline/[slug]
 *
 * Compact 24-hour history for an event — used by the tiny chart on each
 * homepage card. Returns up to ~80 sample points (≈18 min spacing) so the
 * payload stays under 2 KB.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { slug: string } }) {
  const { sql } = await import("@vercel/postgres");
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - 24 * 3600;

  const r = await sql`
    SELECT ts, total_remaining, total_capacity
    FROM snapshots
    WHERE slug = ${params.slug} AND ts >= ${cutoff}
    ORDER BY ts ASC
  `;
  // Downsample to ≤80 points
  const rows = r.rows;
  const TARGET = 80;
  let points: Array<{ t: number; r: number; q: number }> = [];
  if (rows.length <= TARGET) {
    points = rows.map(x => ({ t: x.ts as number, r: x.total_remaining as number, q: x.total_capacity as number }));
  } else {
    const step = rows.length / TARGET;
    for (let i = 0; i < TARGET; i++) {
      const x = rows[Math.floor(i * step)];
      points.push({ t: x.ts as number, r: x.total_remaining as number, q: x.total_capacity as number });
    }
    // Always include the latest point
    const last = rows[rows.length - 1];
    points.push({ t: last.ts as number, r: last.total_remaining as number, q: last.total_capacity as number });
  }

  return NextResponse.json({
    slug: params.slug,
    window_seconds: 24 * 3600,
    points,
  }, { headers: { "Cache-Control": "no-store" } });
}
