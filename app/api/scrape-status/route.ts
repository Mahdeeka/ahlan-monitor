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

export async function GET() {
  const { sql } = await import("@vercel/postgres");
  const now = Math.floor(Date.now() / 1000);
  const STALE_THRESHOLD = 10 * 60; // 10 minutes

  // 1. Per-event last-seen
  const latest = await sql`
    SELECT slug, data, updated_at FROM events_latest ORDER BY updated_at DESC
  `;
  const latestBySlug = new Map<string, { data: any; updated_at: number }>();
  for (const row of latest.rows) {
    latestBySlug.set(row.slug as string, {
      data: typeof row.data === "string" ? JSON.parse(row.data) : row.data,
      updated_at: row.updated_at as number,
    });
  }

  // Per-slug errors
  const errs = await sql`SELECT slug, last_error_ts, last_error_msg, consecutive_failures FROM slug_errors`;
  const errBySlug = new Map<string, any>();
  for (const row of errs.rows) errBySlug.set(row.slug as string, row);

  // Combine: canonical slug list + any extra slugs we've seen in DB
  const allSlugs = new Set<string>(AFC_2027_SLUGS);
  latestBySlug.forEach((_v, k) => allSlugs.add(k));
  const per_event = Array.from(allSlugs).map(slug => {
    const row = latestBySlug.get(slug);
    const err = errBySlug.get(slug);
    const last_seen_ts = row?.updated_at || 0;
    const age = last_seen_ts ? now - last_seen_ts : null;
    return {
      slug,
      title: row?.data?.title || slug,
      stage: row?.data?.stage || "—",
      venue: row?.data?.venue || "",
      date: row?.data?.date || "",
      last_seen_ts,
      age_seconds: age,
      is_stale: age == null || age > STALE_THRESHOLD,
      is_canonical: AFC_2027_SLUGS.includes(slug),
      urgency: row?.data?.urgency || "unknown",
      total_remaining: row?.data?.total_remaining ?? null,
      total_capacity: row?.data?.total_capacity ?? null,
      last_error: err ? {
        ts: err.last_error_ts as number,
        msg: err.last_error_msg as string,
        consecutive_failures: err.consecutive_failures as number,
      } : null,
    };
  }).sort((a, b) => {
    // Stale first, then by age
    if (a.is_stale !== b.is_stale) return a.is_stale ? -1 : 1;
    return (b.age_seconds ?? 0) - (a.age_seconds ?? 0);
  });

  // 2. Recent scrape runs
  const runs = await sql`
    SELECT id, ts, source, received_count, ok_count, error_count, changes_count, elapsed_ms
    FROM scrape_runs
    ORDER BY ts DESC
    LIMIT 50
  `;

  // 3. Summary stats over time windows
  const cutoff1h  = now - 3600;
  const cutoff24h = now - 86400;
  const cutoff7d  = now - 7 * 86400;
  const stats = await sql`
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
  `;
  const s = stats.rows[0] || {};

  const canonical_count = AFC_2027_SLUGS.length;
  const tracked_count = per_event.length;
  const stale_count = per_event.filter(e => e.is_stale).length;
  const fresh_count = tracked_count - stale_count;

  return NextResponse.json({
    now,
    summary: {
      canonical_slug_count: canonical_count,
      tracked_event_count: tracked_count,
      fresh_event_count: fresh_count,
      stale_event_count: stale_count,
      stale_threshold_seconds: STALE_THRESHOLD,
      last_run_ts: s.last_run_ts || null,
      seconds_since_last_run: s.last_run_ts ? now - (s.last_run_ts as number) : null,
      runs_1h:  s.runs_1h  || 0,
      runs_24h: s.runs_24h || 0,
      runs_7d:  s.runs_7d  || 0,
      events_ok_1h:  s.ok_1h  || 0,
      events_ok_24h: s.ok_24h || 0,
      events_err_1h: s.err_1h || 0,
      events_err_24h: s.err_24h || 0,
    },
    per_event,
    recent_runs: runs.rows,
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
