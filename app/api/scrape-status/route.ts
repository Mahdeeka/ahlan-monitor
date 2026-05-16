/**
 * GET /api/scrape-status
 *
 * Returns scrape health data for the monitoring page:
 *   - per_event:    [{slug, title, last_seen_ts, age_seconds, urgency, is_stale, last_error?}]
 *   - recent_runs:  last 50 rows from scrape_runs
 *   - summary:      counts + scrape rate over last 1h, 24h, 7d
 */
import { NextResponse } from "next/server";
import { AFC_2027_SLUGS } from "@/lib/slugs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Run a SELECT through three different sql instances and return whichever
 * yields the most rows. Works around an observed Neon serverless connection-
 * pool isolation quirk where different sql singletons in the same request
 * see different row counts (this happens even when both should hit the
 * same primary).
 */
async function maxRowsSelect<T>(
  build: (sqlTag: any) => Promise<{ rows: any[] }>
): Promise<T[]> {
  const tries: any[][] = [];
  // Path 1: dynamic import (re-bundled per call)
  try {
    const { sql } = await import("@vercel/postgres");
    tries.push((await build(sql)).rows);
  } catch {/* */}
  // Path 2: lib/db's static-imported sql (often the highest-row reader)
  try {
    const dbMod = await import("@/lib/db");
    // We don't have a generic exported sql; use a fresh createClient (path 3)
    // and skip dbMod here — dbMod is consulted by the events route for events_latest.
    void dbMod;
  } catch {/* */}
  // Path 3: dedicated client
  try {
    const vpg = await import("@vercel/postgres");
    const client = vpg.createClient();
    await client.connect();
    try {
      tries.push((await build(client.sql.bind(client))).rows);
    } finally {
      await client.end();
    }
  } catch {/* */}

  let best: any[] = [];
  for (const t of tries) if (t.length > best.length) best = t;
  return best as T[];
}

export async function GET() {
  const now = Math.floor(Date.now() / 1000);
  // "Stale" defined differently per match priority:
  //   priority (3-min poll cadence)  → stale if >6 min old
  //   normal   (10-min poll cadence) → stale if >15 min old
  const STALE_PRIORITY = 6 * 60;
  const STALE_NORMAL   = 15 * 60;
  const STALE_THRESHOLD = STALE_NORMAL; // exposed in summary

  // 1. Per-event last-seen — multi-reader to dodge Neon pool isolation quirk
  const latestRows = await maxRowsSelect<{ slug: string; data: any; updated_at: number }>(
    sqlTag => sqlTag`SELECT slug, data, updated_at FROM events_latest ORDER BY updated_at DESC`
  );
  const latestBySlug = new Map<string, { data: any; updated_at: number }>();
  for (const row of latestRows) {
    latestBySlug.set(row.slug as string, {
      data: typeof row.data === "string" ? JSON.parse(row.data) : row.data,
      updated_at: row.updated_at as number,
    });
  }

  // Per-slug errors (small table, single read is fine but use the same helper)
  const errRows = await maxRowsSelect<any>(
    sqlTag => sqlTag`SELECT slug, last_error_ts, last_error_msg, consecutive_failures FROM slug_errors`
  );
  const errBySlug = new Map<string, any>();
  for (const row of errRows) errBySlug.set(row.slug as string, row);

  // Combine: canonical slug list + any extra slugs we've seen in DB
  const allSlugs = new Set<string>(AFC_2027_SLUGS);
  latestBySlug.forEach((_v, k) => allSlugs.add(k));
  const per_event = Array.from(allSlugs).map(slug => {
    const row = latestBySlug.get(slug);
    const err = errBySlug.get(slug);
    const last_seen_ts = row?.updated_at || 0;
    const age = last_seen_ts ? now - last_seen_ts : null;
    const ev: any = row?.data || {};

    // Priority detection — must match /api/priority-slugs logic
    const reasons: string[] = [];
    if (ev.urgency === "sold_out") reasons.push("event_sold_out");
    if (typeof ev.pct_sold === "number" && ev.pct_sold >= 95) reasons.push("pct_sold_95plus");
    if (Array.isArray(ev.categories) && ev.categories.length > 0) {
      const byPrice = [...ev.categories].sort((a: any, b: any) => (b.price || 0) - (a.price || 0));
      if (byPrice[0]?.sold_out) reasons.push("top_cat_sold_out");
      const halfIdx = Math.max(1, Math.floor(byPrice.length / 2));
      const topHalfSold = byPrice.slice(0, halfIdx).some((c: any) => c.sold_out);
      if (topHalfSold && !reasons.includes("top_cat_sold_out"))
        reasons.push("premium_cat_sold_out");
    }
    const isPriority = reasons.length > 0;
    const stale_thresh = isPriority ? STALE_PRIORITY : STALE_NORMAL;

    return {
      slug,
      title: ev.title || slug,
      stage: ev.stage || "—",
      venue: ev.venue || "",
      date: ev.date || "",
      last_seen_ts,
      age_seconds: age,
      is_stale: age == null || age > stale_thresh,
      stale_threshold_seconds: stale_thresh,
      is_canonical: AFC_2027_SLUGS.includes(slug),
      is_priority: isPriority,
      priority_reasons: reasons,
      poll_cadence: isPriority ? "3min" : "10min",
      urgency: ev.urgency || "unknown",
      total_remaining: ev.total_remaining ?? null,
      total_capacity: ev.total_capacity ?? null,
      last_error: err ? {
        ts: err.last_error_ts as number,
        msg: err.last_error_msg as string,
        consecutive_failures: err.consecutive_failures as number,
      } : null,
    };
  }).sort((a, b) => {
    // Stale first, then priority, then by age
    if (a.is_stale !== b.is_stale) return a.is_stale ? -1 : 1;
    if (a.is_priority !== b.is_priority) return a.is_priority ? -1 : 1;
    return (b.age_seconds ?? 0) - (a.age_seconds ?? 0);
  });

  // 2. Recent scrape runs (multi-reader for the same reason)
  const runRows = await maxRowsSelect<any>(
    sqlTag => sqlTag`
      SELECT id, ts, source, received_count, ok_count, error_count, changes_count, elapsed_ms
      FROM scrape_runs
      ORDER BY ts DESC
      LIMIT 50
    `
  );

  // 3. Summary stats over time windows
  const cutoff1h  = now - 3600;
  const cutoff24h = now - 86400;
  const cutoff7d  = now - 7 * 86400;
  const statsRows = await maxRowsSelect<any>(
    sqlTag => sqlTag`
      SELECT
        SUM(CASE WHEN ts >= ${cutoff1h}  THEN 1 ELSE 0 END)::int AS runs_1h,
        SUM(CASE WHEN ts >= ${cutoff24h} THEN 1 ELSE 0 END)::int AS runs_24h,
        SUM(CASE WHEN ts >= ${cutoff7d}  THEN 1 ELSE 0 END)::int AS runs_7d,
        SUM(CASE WHEN ts >= ${cutoff1h}  THEN ok_count    ELSE 0 END)::int AS ok_1h,
        SUM(CASE WHEN ts >= ${cutoff24h} THEN ok_count    ELSE 0 END)::int AS ok_24h,
        SUM(CASE WHEN ts >= ${cutoff1h}  THEN error_count ELSE 0 END)::int AS err_1h,
        SUM(CASE WHEN ts >= ${cutoff24h} THEN error_count ELSE 0 END)::int AS err_24h,
        MAX(ts) AS last_run_ts,
        MIN(ts) AS first_run_ts
      FROM scrape_runs
    `
  );
  const s = statsRows[0] || {};

  const canonical_count = AFC_2027_SLUGS.length;
  const tracked_count = per_event.length;
  const stale_count = per_event.filter(e => e.is_stale).length;
  const fresh_count = tracked_count - stale_count;
  const priority_count = per_event.filter(e => e.is_priority).length;
  const normal_count = tracked_count - priority_count;

  // Per-source run counts (so the UI can distinguish all/priority cadences)
  const priorityRunsRows = await maxRowsSelect<any>(
    sqlTag => sqlTag`
      SELECT
        SUM(CASE WHEN ts >= ${cutoff1h}  AND source = 'github-actions-priority' THEN 1 ELSE 0 END)::int AS p_1h,
        SUM(CASE WHEN ts >= ${cutoff24h} AND source = 'github-actions-priority' THEN 1 ELSE 0 END)::int AS p_24h,
        SUM(CASE WHEN ts >= ${cutoff1h}  AND source = 'github-actions-all'      THEN 1 ELSE 0 END)::int AS a_1h,
        SUM(CASE WHEN ts >= ${cutoff24h} AND source = 'github-actions-all'      THEN 1 ELSE 0 END)::int AS a_24h
      FROM scrape_runs
    `
  );
  const ps = priorityRunsRows[0] || {};

  return NextResponse.json({
    now,
    summary: {
      canonical_slug_count: canonical_count,
      tracked_event_count: tracked_count,
      fresh_event_count: fresh_count,
      stale_event_count: stale_count,
      priority_event_count: priority_count,
      normal_event_count: normal_count,
      stale_threshold_seconds: STALE_THRESHOLD,
      stale_threshold_priority_seconds: STALE_PRIORITY,
      last_run_ts: s.last_run_ts || null,
      seconds_since_last_run: s.last_run_ts ? now - (s.last_run_ts as number) : null,
      runs_1h:  s.runs_1h  || 0,
      runs_24h: s.runs_24h || 0,
      runs_7d:  s.runs_7d  || 0,
      events_ok_1h:  s.ok_1h  || 0,
      events_ok_24h: s.ok_24h || 0,
      events_err_1h: s.err_1h || 0,
      events_err_24h: s.err_24h || 0,
      priority_runs_1h:  ps.p_1h  || 0,
      priority_runs_24h: ps.p_24h || 0,
      all_runs_1h:       ps.a_1h  || 0,
      all_runs_24h:      ps.a_24h || 0,
    },
    per_event,
    recent_runs: runRows,
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
