/**
 * GET /api/health
 *
 * System-wide diagnostic snapshot — used by the public /health status page.
 * Returns scraper uptime, last successful run, proxy health (inferred from
 * recent run patterns + slug_errors), DB connectivity, deployment metadata.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { sql } = await import("@vercel/postgres");
  const now = Math.floor(Date.now() / 1000);
  const out: any = { now, ok: true, components: {} };

  // ── DB connectivity
  try {
    const t0 = Date.now();
    await sql`SELECT 1`;
    out.components.database = { ok: true, latency_ms: Date.now() - t0 };
  } catch (e) {
    out.ok = false;
    out.components.database = { ok: false, error: String(e).slice(0, 200) };
  }

  // ── Scrape run stats over time windows
  try {
    const cutoff5m = now - 300, cutoff1h = now - 3600, cutoff24h = now - 86400;
    const stats = await sql`
      SELECT
        SUM(CASE WHEN ts >= ${cutoff5m}  THEN 1 ELSE 0 END)::int AS runs_5m,
        SUM(CASE WHEN ts >= ${cutoff1h}  THEN 1 ELSE 0 END)::int AS runs_1h,
        SUM(CASE WHEN ts >= ${cutoff24h} THEN 1 ELSE 0 END)::int AS runs_24h,
        SUM(CASE WHEN ts >= ${cutoff1h}  AND source = 'github-actions-priority' THEN 1 ELSE 0 END)::int AS p_runs_1h,
        SUM(CASE WHEN ts >= ${cutoff1h}  AND source = 'github-actions-all'      THEN 1 ELSE 0 END)::int AS a_runs_1h,
        SUM(CASE WHEN ts >= ${cutoff24h} THEN error_count ELSE 0 END)::int AS errors_24h,
        SUM(CASE WHEN ts >= ${cutoff24h} THEN ok_count    ELSE 0 END)::int AS ok_24h,
        AVG(CASE WHEN ts >= ${cutoff1h}  THEN elapsed_ms ELSE NULL END)::int AS avg_latency_1h,
        MAX(ts) AS last_run_ts,
        MIN(ts) AS first_run_ts,
        COUNT(*)::int AS total_runs_alltime
      FROM scrape_runs
    `;
    const s = stats.rows[0] || {};
    const lastRunAgo = s.last_run_ts ? now - (s.last_run_ts as number) : null;
    const expectedPriority = 20;  // every 3 min = 20 per hour
    const expectedAll = 6;        //  every 10 min = 6 per hour
    const priorityHealth = Math.min(1, (s.p_runs_1h || 0) / expectedPriority);
    const allHealth      = Math.min(1, (s.a_runs_1h || 0) / expectedAll);
    out.components.scraper = {
      ok: lastRunAgo != null && lastRunAgo < 900,  // <15 min stale
      last_run_ts: s.last_run_ts || null,
      last_run_seconds_ago: lastRunAgo,
      runs_5m: s.runs_5m || 0,
      runs_1h: s.runs_1h || 0,
      runs_24h: s.runs_24h || 0,
      runs_alltime: s.total_runs_alltime || 0,
      ok_24h: s.ok_24h || 0,
      errors_24h: s.errors_24h || 0,
      avg_latency_1h: s.avg_latency_1h || null,
      priority_lane: {
        runs_1h: s.p_runs_1h || 0,
        expected_per_hour: expectedPriority,
        health: Math.round(priorityHealth * 100),
      },
      standard_lane: {
        runs_1h: s.a_runs_1h || 0,
        expected_per_hour: expectedAll,
        health: Math.round(allHealth * 100),
      },
      first_run_ts: s.first_run_ts || null,
      uptime_hours: s.first_run_ts ? (now - (s.first_run_ts as number)) / 3600 : 0,
    };
    if (!out.components.scraper.ok) out.ok = false;
  } catch (e) {
    out.ok = false;
    out.components.scraper = { ok: false, error: String(e).slice(0, 200) };
  }

  // ── Slug errors (proxy / WAF failure surface)
  try {
    const cutoff1h = now - 3600;
    const errs = await sql`
      SELECT
        COUNT(*)::int                                              AS total_failed_slugs,
        SUM(CASE WHEN consecutive_failures >= 1 THEN 1 ELSE 0 END)::int AS currently_failing,
        SUM(CASE WHEN last_error_ts >= ${cutoff1h} THEN 1 ELSE 0 END)::int AS failed_last_hour,
        MAX(consecutive_failures)::int                             AS max_consecutive
      FROM slug_errors
    `;
    const e0 = errs.rows[0] || {};
    out.components.slug_errors = {
      ok: (e0.currently_failing || 0) === 0,
      currently_failing: e0.currently_failing || 0,
      failed_last_hour: e0.failed_last_hour || 0,
      max_consecutive: e0.max_consecutive || 0,
      total_ever_failed: e0.total_failed_slugs || 0,
    };
    if (!out.components.slug_errors.ok && (e0.currently_failing || 0) > 3) out.ok = false;
  } catch (e) {
    out.components.slug_errors = { ok: false, error: String(e).slice(0, 200) };
  }

  // ── Proxy health inference (from scraper error patterns)
  try {
    const cutoff24h = now - 86400;
    const proxyHealth = await sql`
      SELECT
        SUM(CASE WHEN error_count > 0 AND error_count = received_count THEN 1 ELSE 0 END)::int AS total_failures_24h,
        SUM(CASE WHEN error_count > 0 THEN 1 ELSE 0 END)::int AS partial_failures_24h,
        COUNT(*)::int AS runs_24h
      FROM scrape_runs
      WHERE ts >= ${cutoff24h}
    `;
    const p = proxyHealth.rows[0] || {};
    const successRate = p.runs_24h
      ? Math.round((((p.runs_24h as number) - (p.total_failures_24h as number)) / (p.runs_24h as number)) * 100)
      : 100;
    out.components.proxies = {
      ok: successRate >= 90,
      success_rate_24h: successRate,
      total_failures_24h: p.total_failures_24h || 0,
      partial_failures_24h: p.partial_failures_24h || 0,
      note: "Inferred from scrape_runs: 100%-fail runs likely = all proxies blacklisted; partial failures likely = WAF / individual slug 404s.",
    };
    if (!out.components.proxies.ok) out.ok = false;
  } catch (e) {
    out.components.proxies = { ok: false, error: String(e).slice(0, 200) };
  }

  // ── Events freshness — use multi-reader to dodge Neon pool isolation
  try {
    let bestNewest = 0, bestOldest = 0, bestTotal = 0;
    // Path 1: static-import sql
    try {
      const r = await sql`
        SELECT COUNT(*)::int AS total, MIN(updated_at) AS oldest, MAX(updated_at) AS newest
        FROM events_latest
      `;
      const e0 = r.rows[0] || {};
      if (e0.total > 0 && (e0.newest as number) > bestNewest) {
        bestNewest = e0.newest as number;
        bestOldest = e0.oldest as number;
        bestTotal = e0.total as number;
      }
    } catch {/* */}
    // Path 2: dedicated client (often sees fresher data after a recent write)
    try {
      const vpg = await import("@vercel/postgres");
      const client = vpg.createClient();
      await client.connect();
      try {
        const r = await client.sql`
          SELECT COUNT(*)::int AS total, MIN(updated_at) AS oldest, MAX(updated_at) AS newest
          FROM events_latest
        `;
        const e0 = r.rows[0] || {};
        if (e0.total > 0 && (e0.newest as number) > bestNewest) {
          bestNewest = e0.newest as number;
          bestOldest = e0.oldest as number;
          bestTotal = e0.total as number;
        }
      } finally { await client.end(); }
    } catch {/* */}

    // Threshold = max of (standard-lane interval + 5 min buffer) = 15 min
    const STALE_OK = 15 * 60;
    out.components.events = {
      ok: bestTotal > 0 && (now - bestNewest) < STALE_OK,
      total_tracked: bestTotal,
      oldest_update_ts: bestOldest || null,
      newest_update_ts: bestNewest || null,
      oldest_age_seconds: bestOldest ? now - bestOldest : null,
      newest_age_seconds: bestNewest ? now - bestNewest : null,
    };
    if (!out.components.events.ok) out.ok = false;
  } catch (e) {
    out.components.events = { ok: false, error: String(e).slice(0, 200) };
  }

  // ── Deployment / runtime metadata
  out.components.runtime = {
    vercel_region: process.env.VERCEL_REGION || "unknown",
    deployment_id: process.env.VERCEL_DEPLOYMENT_ID || null,
    deployment_url: process.env.VERCEL_URL || null,
    node_version: process.version,
  };

  return NextResponse.json(out, {
    status: out.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
