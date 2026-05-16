import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/admin/scrape
 *
 * Grabs the ahlan.sa /events page HTML and extracts all AFC 2027 event slugs.
 * Bypasses the API rate-limit by hitting a public page instead.
 */
export async function GET() {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };
  try {
    const r = await fetch("https://www.ahlan.sa/events", { headers, cache: "no-store" });
    if (!r.ok) return NextResponse.json({ error: `HTTP ${r.status}` }, { status: r.status });
    const html = await r.text();
    const slugMatches = html.matchAll(/event=([a-z0-9-]+)/g);
    const slugs = Array.from(new Set(Array.from(slugMatches, m => m[1])));
    const afcSlugs = slugs.filter(s => s.startsWith("afc-cup-27"));
    afcSlugs.sort((a, b) => {
      const na = parseInt(a.split("-").pop() || "999");
      const nb = parseInt(b.split("-").pop() || "999");
      return na - nb;
    });
    return NextResponse.json({
      total_afc: afcSlugs.length,
      all_slugs_count: slugs.length,
      afc_slugs: afcSlugs,
      html_length: html.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
