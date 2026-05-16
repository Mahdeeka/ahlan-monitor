import { NextResponse } from "next/server";
import { normalizeEvent } from "@/lib/normalize";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const BASE = "https://www.ahlan.sa";

export async function GET(_: Request, { params }: { params: { slug: string } }) {
  try {
    const r = await fetch(
      `${BASE}/api/ticketing/eventDetail?slug=${params.slug}&language=en`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "application/json",
          "Referer": `${BASE}/events`,
        },
        cache: "no-store",
      }
    );
    if (!r.ok) {
      return NextResponse.json({ error: `HTTP ${r.status}` }, { status: r.status });
    }
    const data = await r.json();
    return NextResponse.json(
      { event: normalizeEvent(params.slug, data), raw: data },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
