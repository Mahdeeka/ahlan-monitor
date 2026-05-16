import { NextResponse } from "next/server";
import { pruneOldSnapshots } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const deleted = await pruneOldSnapshots(90); // keep last 90 days
  return NextResponse.json({ ok: true, deleted });
}
