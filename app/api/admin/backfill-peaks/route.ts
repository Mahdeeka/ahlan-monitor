/**
 * POST /api/admin/backfill-peaks
 *
 * One-shot backfill: scans the entire `snapshots` history table and
 * populates `slug_peak_capacity` with the TRUE max capacity ever observed
 * per slug. Use this when peak_capacity is showing stale drip-mode values
 * (3-18) for events whose history actually saw thousands of tickets at
 * some point.
 *
 * Why this is needed: ahlan oscillates between two API modes —
 *   • drip mode: returns 3-6 tickets per category (placeholder)
 *   • full mode: returns the real allocation (sometimes thousands)
 * Our peak_capacity table was created after the API had already shifted
 * to drip mode, so it never saw the historic 8,000+ snapshots.
 *
 * Auth: requires SNAPSHOT_SECRET header (same shared secret as /api/snapshot).
 * Idempotent — only ever raises peaks, never lowers them.
 */
import { NextResponse } from "next/server";
import { backfillPeakCapacityFromHistory, initSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorize(req: Request, body: any): boolean {
  const need = process.env.SNAPSHOT_SECRET;
  if (!need) return true; // dev mode — no secret set, allow
  const hdr = req.headers.get("authorization") || "";
  if (hdr === `Bearer ${need}`) return true;
  if (body?.secret === need) return true;
  // Also accept query-string for convenience: ?secret=...
  try {
    const u = new URL(req.url);
    if (u.searchParams.get("secret") === need) return true;
  } catch { /* */ }
  return false;
}

async function handle(req: Request) {
  let body: any = null;
  try { body = await req.json(); } catch { /* */ }
  if (!authorize(req, body)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await initSchema();
  try {
    const stats = await backfillPeakCapacityFromHistory();
    return NextResponse.json({ ok: true, ...stats });
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message || e).slice(0, 300) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) { return handle(req); }
// GET is also allowed for easy curl from a browser — auth check still runs.
export async function GET(req: Request)  { return handle(req); }
