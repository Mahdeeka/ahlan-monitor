import { NextResponse } from "next/server";
import { getHistory } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { slug: string } }
) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "2000");
  try {
    const history = await getHistory(params.slug, Math.min(limit, 10000));
    return NextResponse.json({ slug: params.slug, history });
  } catch (e: any) {
    return NextResponse.json({ slug: params.slug, history: [], error: String(e) }, { status: 500 });
  }
}
