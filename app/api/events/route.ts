import { NextResponse } from "next/server";
import { getLatestEvents, getRecentChanges, initSchema } from "@/lib/db";
import { computeSummary } from "@/lib/normalize";
import { AFC_2027_SLUGS } from "@/lib/slugs";
import { normalizeEvent } from "@/lib/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://www.ahlan.sa";
const REAL_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": `${BASE}/events`,
  "Origin": BASE,
};

async function fetchOne(slug: string): Promise<any> {
  try {
    const r = await fetch(
      `${BASE}/api/ticketing/eventDetail?slug=${slug}&language=en`,
      { headers: REAL_HEADERS, cache: "no-store" }
    );
    if (!r.ok) return { _error: `HTTP ${r.status}` };
    return await r.json();
  } catch (e) {
    return { _error: String(e) };
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";
  const debugInfo: any = {
    has_POSTGRES_URL: !!process.env.POSTGRES_URL,
    has_DATABASE_URL: !!process.env.DATABASE_URL,
    has_POSTGRES_PRISMA_URL: !!process.env.POSTGRES_PRISMA_URL,
  };

  let events: any[] | undefined;
  let updated_at = 0;
  let from_db = false;

  // Try DB first — use raw inline SQL (avoid library wrapper that's returning empty)
  const hasDbEnv = !!(process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL);
  if (hasDbEnv) {
    try {
      const { sql } = await import("@vercel/postgres");
      const result = await sql`
        SELECT data, updated_at FROM events_latest
        ORDER BY updated_at DESC
      `;
      const rows = result.rows;
      events = rows.map(r => {
        // JSONB may come back as string or object depending on driver version
        return typeof r.data === "string" ? JSON.parse(r.data) : r.data;
      });
      updated_at = rows.length ? Math.max(...rows.map(r => (r.updated_at as number) || 0)) : 0;
      from_db = events.length > 0;
      debugInfo.db_events_count = events.length;
      debugInfo.db_updated_at = updated_at;
      debugInfo.raw_first_row_keys = rows[0] ? Object.keys(rows[0]) : null;
      debugInfo.raw_first_data_type = rows[0] ? typeof rows[0].data : null;
    } catch (e: any) {
      debugInfo.db_error = String(e);
      console.error("DB read failed:", e);
    }
  }

  // Fallback to live fetch only if DB has truly NOTHING
  if (!events || events.length === 0) {
    debugInfo.fell_back_to_live = true;
    const raw = await Promise.all(AFC_2027_SLUGS.map(fetchOne));
    events = AFC_2027_SLUGS.map((s, i) => normalizeEvent(s, raw[i]));
    updated_at = Math.floor(Date.now() / 1000);
    from_db = false;
  }

  const summary = computeSummary(events);

  let recent_changes: any[] = [];
  if (from_db) {
    try { recent_changes = await getRecentChanges(50); } catch { /* */ }
  }

  const body: any = { last_updated: updated_at, events, summary, recent_changes, from_db };
  if (debug) body.debug = debugInfo;

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
