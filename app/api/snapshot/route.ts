/**
 * POST /api/snapshot
 * Accepts a full event snapshot from an external poller (e.g. user's local
 * machine where ahlan.sa is not IP-blocked). Stores in Postgres, detects
 * changes vs previous snapshot.
 *
 * Body: { secret: string, events: Event[] }
 *
 * Header alternative: Authorization: Bearer <SNAPSHOT_SECRET>
 */
import { NextResponse } from "next/server";
import {
  initSchema, getLatestEvents, recordSnapshot, recordChange,
  recordScrapeRun, markSlugError, clearSlugError,
} from "@/lib/db";
import type { Event } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function detectChanges(prev: Event[], curr: Event[]) {
  const prevBySlug = new Map(prev.map(e => [e.slug, e]));
  const out: Array<{ slug: string; title: string; type: string; details: any }> = [];
  for (const ev of curr) {
    if (ev.error) continue;
    const p = prevBySlug.get(ev.slug);
    if (!p) continue;
    const delta = ev.total_remaining - p.total_remaining;
    if (delta !== 0) {
      out.push({
        slug: ev.slug, title: ev.title,
        type: delta > 0 ? "tickets_added" : "tickets_sold",
        details: { before: p.total_remaining, after: ev.total_remaining, delta },
      });
    }
    if (p.urgency !== ev.urgency) {
      out.push({
        slug: ev.slug, title: ev.title, type: "status_change",
        details: { from: p.urgency, to: ev.urgency },
      });
    }
    const prevCats = new Map(p.categories.map(c => [c.name, c]));
    for (const c of ev.categories) {
      const pc = prevCats.get(c.name);
      if (!pc) continue;
      if (pc.sold_out && !c.sold_out) {
        out.push({ slug: ev.slug, title: ev.title, type: "back_in_stock",
                   details: { category: c.name, remaining: c.remaining } });
      } else if (!pc.sold_out && c.sold_out) {
        out.push({ slug: ev.slug, title: ev.title, type: "category_sold_out",
                   details: { category: c.name } });
      }
    }
  }
  return out;
}

function hasChanged(prev: Event | undefined, curr: Event) {
  if (!prev) return true;
  if (prev.total_remaining !== curr.total_remaining) return true;
  if (prev.urgency !== curr.urgency) return true;
  const prevCats = new Map(prev.categories.map(c => [c.name, c]));
  for (const c of curr.categories) {
    const pc = prevCats.get(c.name);
    if (!pc) return true;
    if (pc.remaining !== c.remaining || pc.sold_out !== c.sold_out) return true;
  }
  return false;
}

function authorize(req: Request, body: any): boolean {
  const need = process.env.SNAPSHOT_SECRET;
  if (!need) return true; // no secret set → allow (dev mode)
  const hdr = req.headers.get("authorization") || "";
  if (hdr === `Bearer ${need}`) return true;
  if (body?.secret === need) return true;
  return false;
}

export async function POST(req: Request) {
  const t0 = Date.now();
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  if (!authorize(req, body)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const events: Event[] = Array.isArray(body?.events) ? body.events : [];
  if (events.length === 0) {
    return NextResponse.json({ error: "no events in body" }, { status: 400 });
  }

  await initSchema();
  const { events: prevEvents } = await getLatestEvents();
  const changes = prevEvents.length ? detectChanges(prevEvents, events) : [];
  const ts = Math.floor(Date.now() / 1000);
  const prevBySlug = new Map(prevEvents.map(e => [e.slug, e]));

  let inserted = 0;
  let okCount = 0;
  let errCount = 0;
  await Promise.all(events.map(async ev => {
    if (ev.error) {
      errCount++;
      try { await markSlugError(ev.slug, ts, ev.error); } catch {/* */}
      return;
    }
    okCount++;
    const changed = hasChanged(prevBySlug.get(ev.slug), ev);
    await recordSnapshot(ev, ts, changed);
    try { await clearSlugError(ev.slug); } catch {/* */}
    if (changed) inserted++;
  }));
  for (const ch of changes) {
    await recordChange(ts, ch.slug, ch.title, ch.type, ch.details);
  }

  // Record this scrape pass for the monitoring page
  const source = (typeof body?.source === "string" && body.source) ||
                 (req.headers.get("user-agent") || "").includes("GitHub")
                   ? "github-actions"
                   : "external";
  try {
    await recordScrapeRun({
      ts, source,
      received: events.length, ok: okCount, errors: errCount, changes: changes.length,
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
      ua: req.headers.get("user-agent")?.slice(0, 200) || undefined,
      elapsedMs: Date.now() - t0,
    });
  } catch (e) { console.warn("recordScrapeRun failed:", e); }

  return NextResponse.json({
    ok: true, ts,
    received: events.length,
    ok_count: okCount,
    error_count: errCount,
    snapshots_inserted: inserted,
    changes_detected: changes.length,
    sample_changes: changes.slice(0, 5),
  });
}

export async function GET() {
  return NextResponse.json({
    info: "POST snapshots here. Body: { events: Event[], secret?: string }",
    requires_secret: !!process.env.SNAPSHOT_SECRET,
  });
}
