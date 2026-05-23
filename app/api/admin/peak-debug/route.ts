/**
 * GET /api/admin/peak-debug?secret=...
 *
 * Diagnostic dump of slug_peak_capacity raw rows for troubleshooting why
 * the backfill values aren't surfacing via /api/events. Reads through every
 * available DB path to detect connection-pool replication lag.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorize(req: Request): boolean {
  const need = process.env.SNAPSHOT_SECRET;
  if (!need) return true;
  const hdr = req.headers.get("authorization") || "";
  if (hdr === `Bearer ${need}`) return true;
  try {
    const u = new URL(req.url);
    if (u.searchParams.get("secret") === need) return true;
  } catch { /* */ }
  return false;
}

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const readers = [];
  // Reader 1: dynamic_import sql
  try {
    const { sql } = await import("@vercel/postgres");
    const r = await sql`SELECT slug, peak_public_capacity, observed_at FROM slug_peak_capacity ORDER BY peak_public_capacity DESC LIMIT 60`;
    readers.push({
      name: "dynamic_sql",
      count: r.rows.length,
      sample: r.rows.slice(0, 10),
    });
  } catch (e: any) {
    readers.push({ name: "dynamic_sql", error: String(e?.message || e).slice(0, 200) });
  }

  // Reader 2: raw client
  try {
    const vpg = await import("@vercel/postgres");
    const client = vpg.createClient();
    await client.connect();
    try {
      const r = await client.sql`SELECT slug, peak_public_capacity, observed_at FROM slug_peak_capacity ORDER BY peak_public_capacity DESC LIMIT 60`;
      readers.push({
        name: "raw_client",
        count: r.rows.length,
        sample: r.rows.slice(0, 10),
      });
    } finally { await client.end(); }
  } catch (e: any) {
    readers.push({ name: "raw_client", error: String(e?.message || e).slice(0, 200) });
  }

  // Reader 3: also check max from snapshots table (the SOURCE of truth)
  try {
    const { sql } = await import("@vercel/postgres");
    const r = await sql`SELECT slug, MAX(total_capacity) AS hist_max FROM snapshots GROUP BY slug ORDER BY MAX(total_capacity) DESC LIMIT 10`;
    readers.push({
      name: "snapshots_history_max",
      count: r.rows.length,
      sample: r.rows,
    });
  } catch (e: any) {
    readers.push({ name: "snapshots_history_max", error: String(e?.message || e).slice(0, 200) });
  }

  return NextResponse.json({ readers });
}
