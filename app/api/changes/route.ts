import { NextResponse } from "next/server";
import { getRecentChanges } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "200");
  try {
    const changes = await getRecentChanges(Math.min(limit, 1000));
    return NextResponse.json({ changes });
  } catch (e) {
    return NextResponse.json({ changes: [], error: String(e) }, { status: 500 });
  }
}
