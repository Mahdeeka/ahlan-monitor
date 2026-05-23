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

  // Read events_latest. We try multiple paths because of an observed
  // @vercel/postgres + Neon serverless pool isolation quirk where different
  // call sites in the same request see different row counts. We pick whichever
  // path returns the most rows.
  const hasDbEnv = !!(process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL);
  if (hasDbEnv) {
    type Row = { slug?: string; data: any; updated_at: number };
    const readers: Array<{ name: string; fn: () => Promise<Row[]> }> = [
      {
        name: "dynamic_import_sql",
        fn: async () => {
          const { sql } = await import("@vercel/postgres");
          const r = await sql`SELECT slug, data, updated_at FROM events_latest ORDER BY updated_at DESC`;
          return r.rows as Row[];
        },
      },
      {
        name: "lib_db_getLatestEvents",
        fn: async () => {
          const mod = await import("@/lib/db");
          const r = await mod.getLatestEvents();
          return r.events.map((e: any) => ({ slug: e.slug, data: e, updated_at: r.updated_at }));
        },
      },
      {
        name: "raw_pg_pool",
        fn: async () => {
          // Third path: import @vercel/postgres directly via createClient
          const vpg = await import("@vercel/postgres");
          const client = vpg.createClient();
          await client.connect();
          try {
            const r = await client.sql`SELECT slug, data, updated_at FROM events_latest ORDER BY updated_at DESC`;
            return r.rows as Row[];
          } finally {
            await client.end();
          }
        },
      },
    ];

    const attempts: Array<{ name: string; count: number; sample?: any; error?: string }> = [];
    let bestRows: Row[] = [];
    let bestName = "";
    for (const r of readers) {
      try {
        const rows = await r.fn();
        attempts.push({ name: r.name, count: rows.length, sample: rows.slice(0, 2).map(x => x.slug) });
        if (rows.length > bestRows.length) {
          bestRows = rows;
          bestName = r.name;
        }
      } catch (e: any) {
        attempts.push({ name: r.name, count: -1, error: String(e).slice(0, 200) });
      }
    }
    debugInfo.read_attempts = attempts;
    debugInfo.winning_reader = bestName;

    events = bestRows.map(r => (typeof r.data === "string" ? JSON.parse(r.data) : r.data));
    updated_at = bestRows.length ? Math.max(...bestRows.map(r => (r.updated_at as number) || 0)) : 0;
    from_db = events.length > 0;
    debugInfo.db_events_count = events.length;
    debugInfo.db_updated_at = updated_at;
  }

  // Fallback to live fetch only if DB has truly NOTHING
  if (!events || events.length === 0) {
    debugInfo.fell_back_to_live = true;
    const raw = await Promise.all(AFC_2027_SLUGS.map(fetchOne));
    events = AFC_2027_SLUGS.map((s, i) => normalizeEvent(s, raw[i]));
    updated_at = Math.floor(Date.now() / 1000);
    from_db = false;
  }

  // Attach peak capacity (highest capacity ever seen for each slug) so the UI
  // can show real stadium scale instead of ahlan's tiny drip-restock numbers.
  // getPeakCapacities() reads through multiple DB connection paths and picks
  // the MAX per slug — defends against pool-isolation lag where the pooled
  // `sql` template can return staler values than a direct client connection.
  try {
    const { getPeakCapacities } = await import("@/lib/db");
    const peaks = await getPeakCapacities();
    for (const e of events) {
      const p = peaks[e.slug];
      if (p && p.public > 0) {
        (e as any).peak_public_capacity = p.public;
        (e as any).peak_total_capacity = p.total;
      }
    }
  } catch (e: any) {
    debugInfo.peak_capacity_error = String(e).slice(0, 120);
  }

  // Attach real stadium capacity from the hardcoded venue map. We do this on
  // every read (not just at snapshot time) so existing DB rows get the value
  // immediately without waiting for a re-scrape.
  try {
    const { lookupVenue } = await import("@/lib/venues");
    for (const e of events) {
      if ((e as any).venue_capacity_real != null) continue; // already attached
      const v = lookupVenue((e as any).venue);
      if (v) {
        (e as any).venue_capacity_real = v.capacity;
        (e as any).venue_city_real = v.city;
      }
    }
  } catch (e: any) {
    debugInfo.venue_capacity_error = String(e).slice(0, 120);
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
