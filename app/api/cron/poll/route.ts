import { NextResponse } from "next/server";
import { AFC_2027_SLUGS } from "@/lib/slugs";
import { normalizeEvent } from "@/lib/normalize";
import {
  initSchema, getLatestEvents, recordSnapshot, recordChange,
} from "@/lib/db";
import type { Event } from "@/lib/types";

// Node runtime (required for @vercel/postgres connection pooling)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BASE = "https://www.ahlan.sa";
const REAL_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": `${BASE}/events`,
  "Origin": BASE,
  "sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130", "Not.A/Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};

async function fetchOne(slug: string, attempt = 1): Promise<any> {
  try {
    const r = await fetch(
      `${BASE}/api/ticketing/eventDetail?slug=${slug}&language=en`,
      { headers: REAL_HEADERS, cache: "no-store" }
    );
    if (r.status === 429 && attempt < 3) {
      await new Promise(res => setTimeout(res, 800 * attempt));
      return fetchOne(slug, attempt + 1);
    }
    if (!r.ok) return { _error: `HTTP ${r.status}` };
    return await r.json();
  } catch (e) {
    return { _error: String(e) };
  }
}

function detectChanges(prev: Event[], curr: Event[]) {
  const prevBySlug = new Map(prev.map(e => [e.slug, e]));
  const changes: Array<{ slug: string; title: string; type: string; details: any }> = [];
  for (const ev of curr) {
    if (ev.error) continue;
    const p = prevBySlug.get(ev.slug);
    if (!p) continue;
    const delta = ev.total_remaining - p.total_remaining;
    if (delta !== 0) {
      changes.push({
        slug: ev.slug, title: ev.title,
        type: delta > 0 ? "tickets_added" : "tickets_sold",
        details: { before: p.total_remaining, after: ev.total_remaining, delta },
      });
    }
    if (p.urgency !== ev.urgency) {
      changes.push({
        slug: ev.slug, title: ev.title, type: "status_change",
        details: { from: p.urgency, to: ev.urgency },
      });
    }
    const prevCats = new Map(p.categories.map(c => [c.name, c]));
    for (const c of ev.categories) {
      const pc = prevCats.get(c.name);
      if (!pc) continue;
      if (pc.sold_out && !c.sold_out) {
        changes.push({
          slug: ev.slug, title: ev.title, type: "back_in_stock",
          details: { category: c.name, remaining: c.remaining },
        });
      } else if (!pc.sold_out && c.sold_out) {
        changes.push({
          slug: ev.slug, title: ev.title, type: "category_sold_out",
          details: { category: c.name },
        });
      }
    }
  }
  return changes;
}

function hasChanged(prev: Event | undefined, curr: Event) {
  if (!prev) return true;
  if (prev.total_remaining !== curr.total_remaining) return true;
  if (prev.urgency !== curr.urgency) return true;
  // per-category remaining/sold_out check
  const prevCats = new Map(prev.categories.map(c => [c.name, c]));
  for (const c of curr.categories) {
    const pc = prevCats.get(c.name);
    if (!pc) return true;
    if (pc.remaining !== c.remaining || pc.sold_out !== c.sold_out) return true;
  }
  return false;
}

/** Verify request comes from Vercel Cron (or local dev) */
function isAuthorized(req: Request): boolean {
  // In production, Vercel Cron sends a header with the secret
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret) return auth === `Bearer ${secret}`;
  // No secret configured → allow (development mode)
  return true;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();
  await initSchema();

  // Get previous state (so we can detect changes)
  const { events: prevEvents } = await getLatestEvents();

  // Fetch all 51 events from ahlan.sa in parallel
  const raw = await Promise.all(AFC_2027_SLUGS.map(fetchOne));
  const curr = AFC_2027_SLUGS.map((s, i) => normalizeEvent(s, raw[i]));

  // Detect changes vs previous snapshot
  const changes = prevEvents.length ? detectChanges(prevEvents, curr) : [];

  const ts = Math.floor(Date.now() / 1000);
  const prevBySlug = new Map(prevEvents.map(e => [e.slug, e]));

  // Store snapshots (only insert history row if changed)
  let inserted = 0;
  await Promise.all(curr.map(async ev => {
    if (ev.error) return;
    const changed = hasChanged(prevBySlug.get(ev.slug), ev);
    await recordSnapshot(ev, ts, changed);
    if (changed) inserted++;
  }));

  // Store changes log
  for (const ch of changes) {
    await recordChange(ts, ch.slug, ch.title, ch.type, ch.details);
  }

  return NextResponse.json({
    ok: true,
    ts,
    elapsed_ms: Date.now() - t0,
    events_fetched: curr.length,
    events_ok: curr.filter(e => !e.error).length,
    snapshots_inserted: inserted,
    changes_detected: changes.length,
    sample_changes: changes.slice(0, 5),
  });
}
