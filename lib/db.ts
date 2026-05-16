import { sql } from "@vercel/postgres";
import type { Event } from "./types";

/** Create tables if they don't exist. Safe to call repeatedly. */
export async function initSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS snapshots (
      slug TEXT NOT NULL,
      ts INTEGER NOT NULL,
      total_remaining INTEGER NOT NULL,
      total_capacity INTEGER NOT NULL,
      urgency TEXT NOT NULL,
      pct_sold REAL NOT NULL,
      categories JSONB NOT NULL,
      PRIMARY KEY (slug, ts)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_snapshots_slug_ts ON snapshots(slug, ts DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON snapshots(ts DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS events_latest (
      slug TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS changes (
      id BIGSERIAL PRIMARY KEY,
      ts INTEGER NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      details JSONB NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_changes_ts ON changes(ts DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_changes_slug_ts ON changes(slug, ts DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS subscriptions (
      device_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      triggers TEXT[] NOT NULL DEFAULT ARRAY['back_in_stock','tickets_added','status_change'],
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (device_id, slug)
    )
  `;

  // Per-scrape-pass health log: one row per /api/snapshot call
  await sql`
    CREATE TABLE IF NOT EXISTS scrape_runs (
      id BIGSERIAL PRIMARY KEY,
      ts INTEGER NOT NULL,
      source TEXT NOT NULL,           -- "github-actions" | "local-monitor" | "vercel-cron" | "manual"
      received_count INTEGER NOT NULL,
      ok_count INTEGER NOT NULL,
      error_count INTEGER NOT NULL,
      changes_count INTEGER NOT NULL,
      ip TEXT,
      user_agent TEXT,
      elapsed_ms INTEGER
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_scrape_runs_ts ON scrape_runs(ts DESC)`;

  // Per-event scrape errors (so we can show "haven't seen slug X in N minutes")
  await sql`
    CREATE TABLE IF NOT EXISTS slug_errors (
      slug TEXT PRIMARY KEY,
      last_error_ts INTEGER NOT NULL,
      last_error_msg TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0
    )
  `;

  return { ok: true };
}

/** Append a row to scrape_runs (one per snapshot push). */
export async function recordScrapeRun(args: {
  ts: number; source: string; received: number; ok: number;
  errors: number; changes: number; ip?: string; ua?: string; elapsedMs?: number;
}) {
  await sql`
    INSERT INTO scrape_runs
      (ts, source, received_count, ok_count, error_count, changes_count, ip, user_agent, elapsed_ms)
    VALUES
      (${args.ts}, ${args.source}, ${args.received}, ${args.ok},
       ${args.errors}, ${args.changes}, ${args.ip || null},
       ${args.ua || null}, ${args.elapsedMs || null})
  `;
}

/** Mark a slug as failed (call when an event arrived with .error set). */
export async function markSlugError(slug: string, ts: number, msg: string) {
  await sql`
    INSERT INTO slug_errors (slug, last_error_ts, last_error_msg, consecutive_failures)
    VALUES (${slug}, ${ts}, ${msg.slice(0, 200)}, 1)
    ON CONFLICT (slug) DO UPDATE
    SET last_error_ts = EXCLUDED.last_error_ts,
        last_error_msg = EXCLUDED.last_error_msg,
        consecutive_failures = slug_errors.consecutive_failures + 1
  `;
}

/** Clear error state for a slug (call when it succeeds). */
export async function clearSlugError(slug: string) {
  await sql`
    UPDATE slug_errors SET consecutive_failures = 0 WHERE slug = ${slug}
  `;
}

/** Upsert latest snapshot for an event + append to history if changed. */
export async function recordSnapshot(ev: Event, ts: number, changedFromPrev: boolean) {
  // Always upsert "latest"
  await sql`
    INSERT INTO events_latest (slug, data, updated_at)
    VALUES (${ev.slug}, ${JSON.stringify(ev)}::jsonb, ${ts})
    ON CONFLICT (slug) DO UPDATE
    SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
  `;
  // Only insert history row if something changed (saves storage)
  if (changedFromPrev) {
    await sql`
      INSERT INTO snapshots (slug, ts, total_remaining, total_capacity, urgency, pct_sold, categories)
      VALUES (${ev.slug}, ${ts}, ${ev.total_remaining}, ${ev.total_capacity}, ${ev.urgency}, ${ev.pct_sold}, ${JSON.stringify(ev.categories)}::jsonb)
      ON CONFLICT (slug, ts) DO NOTHING
    `;
  }
}

/** Record a detected change (back_in_stock, tickets_added, etc.) */
export async function recordChange(
  ts: number,
  slug: string,
  title: string,
  type: string,
  details: any
) {
  await sql`
    INSERT INTO changes (ts, slug, title, type, details)
    VALUES (${ts}, ${slug}, ${title}, ${type}, ${JSON.stringify(details)}::jsonb)
  `;
}

/** Read latest snapshot for all events. */
export async function getLatestEvents(): Promise<{ events: Event[]; updated_at: number }> {
  const { rows } = await sql`
    SELECT data, updated_at FROM events_latest ORDER BY updated_at DESC
  `;
  const events = rows.map(r => r.data as Event);
  const updated_at = rows.length ? Math.max(...rows.map(r => r.updated_at as number)) : 0;
  return { events, updated_at };
}

/** History for one event. Returns array sorted oldest → newest. */
export async function getHistory(slug: string, limit = 2000) {
  const { rows } = await sql`
    SELECT ts, total_remaining, total_capacity, urgency, pct_sold, categories
    FROM snapshots
    WHERE slug = ${slug}
    ORDER BY ts DESC
    LIMIT ${limit}
  `;
  return rows.reverse();
}

/** Recent changes across all events */
export async function getRecentChanges(limit = 100) {
  const { rows } = await sql`
    SELECT id, ts, slug, title, type, details
    FROM changes
    ORDER BY ts DESC
    LIMIT ${limit}
  `;
  return rows;
}

/** Cleanup snapshots older than `days` */
export async function pruneOldSnapshots(days = 90) {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  const { rowCount } = await sql`DELETE FROM snapshots WHERE ts < ${cutoff}`;
  return rowCount;
}
