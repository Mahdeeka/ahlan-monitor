import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.ahlan.sa/events",
  "Origin": "https://www.ahlan.sa",
};

/**
 * GET /api/admin/discover
 *
 * Hits ahlan.sa's eventList API (which lists ALL slugs) from Vercel's IP
 * rather than the local IP. Returns the canonical list of AFC 2027 slugs.
 */
export async function GET() {
  const url = "https://www.ahlan.sa/api/ticketing/eventList?organizationSlug=afc-asiancup-2027&language=en&page=1&per_page=200";
  try {
    const r = await fetch(url, { headers: HEADERS, cache: "no-store" });
    if (!r.ok) {
      return NextResponse.json(
        { error: `HTTP ${r.status}`, body: await r.text().then(t => t.slice(0, 500)) },
        { status: r.status }
      );
    }
    const data = await r.json();
    const events = (data.data || []) as any[];
    const slugs = events.map(e => ({
      slug: e.slug,
      title: e.title,
      start: e.start_date_time_str,
      stadium: (e.venue || {}).name,
      city: (e.venue || {}).city,
    }));
    slugs.sort((a, b) => {
      const na = parseInt((a.slug || "").split("-").pop() || "999");
      const nb = parseInt((b.slug || "").split("-").pop() || "999");
      return na - nb;
    });
    return NextResponse.json({ total: slugs.length, slugs });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
