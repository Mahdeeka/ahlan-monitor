/**
 * GET /api/cron/poll
 *
 * Reliable heartbeat for the scraper. Vercel cron fires this every minute
 * (per vercel.json). Each tick checks the clock and triggers the right
 * GitHub Actions workflow:
 *
 *   - minute % 3 === 0  → dispatch Poll PRIORITY (3-min cadence)
 *   - minute % 10 === 0 → dispatch Poll ALL       (10-min cadence)
 *
 * Why this instead of scraping directly from Vercel?
 *   ahlan.sa's WAF blocks Vercel egress IPs even through Webshare proxies
 *   (the proxy provider leaks the source IP via Via/X-Forwarded-For
 *   headers or ahlan WAF fingerprints non-residential ASN paths).
 *   GitHub Actions runners come from a different egress that works.
 *
 *   GH Actions' own scheduled cron is unreliable (we've observed 1-4 hour
 *   gaps instead of the configured 3-min). Vercel cron IS reliable per
 *   minute on the Pro plan, so we use Vercel as the heartbeat and GH
 *   Actions as the worker.
 *
 * Requires: GH_DISPATCH_TOKEN env var = a personal access token with
 *           "actions: write" scope on the Mahdeeka/ahlan-monitor repo.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const REPO    = "Mahdeeka/ahlan-monitor";
const REF     = "main";
const WF_PRIO = "poll-priority.yml";
const WF_ALL  = "poll.yml";

function isAuthorized(req: Request): boolean {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret) return auth === `Bearer ${secret}`;
  return true;
}

async function dispatchWorkflow(workflow: string, token: string): Promise<{ ok: boolean; status: number; body?: string }> {
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "ahlan-monitor-cron",
      },
      body: JSON.stringify({ ref: REF }),
    }
  );
  return {
    ok: r.status === 204,   // GH returns 204 No Content on success
    status: r.status,
    body: r.status === 204 ? undefined : (await r.text()).slice(0, 200),
  };
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) {
    return NextResponse.json({
      ok: false,
      error: "GH_DISPATCH_TOKEN not configured",
    }, { status: 503 });
  }

  const t0 = Date.now();
  const now = new Date();
  const minute = now.getUTCMinutes();
  const url = new URL(req.url);
  const force = url.searchParams.get("force"); // "priority" | "all" | "both" | null

  const dispatched: Array<{ workflow: string; ok: boolean; status: number; body?: string }> = [];
  const skipped: string[] = [];

  const wantPriority = force === "priority" || force === "both" || minute % 3 === 0;
  const wantAll      = force === "all"      || force === "both" || minute % 10 === 0;

  if (wantPriority) {
    const r = await dispatchWorkflow(WF_PRIO, token);
    dispatched.push({ workflow: WF_PRIO, ...r });
  } else {
    skipped.push(WF_PRIO);
  }
  if (wantAll) {
    const r = await dispatchWorkflow(WF_ALL, token);
    dispatched.push({ workflow: WF_ALL, ...r });
  } else {
    skipped.push(WF_ALL);
  }

  return NextResponse.json({
    ok: true,
    ts: Math.floor(Date.now() / 1000),
    minute_utc: minute,
    elapsed_ms: Date.now() - t0,
    dispatched,
    skipped,
  }, { headers: { "Cache-Control": "no-store" } });
}
