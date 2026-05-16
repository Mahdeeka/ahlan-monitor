import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { AFC_2027_SLUGS } from "@/lib/slugs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/cleanup
 *
 * Removes events from the DB that aren't in the canonical AFC_2027_SLUGS list.
 * This deletes test data and stale slugs from earlier wrong guesses.
 */
export async function POST() {
  const validSlugs = new Set(AFC_2027_SLUGS);
  const before = await sql`SELECT slug FROM events_latest`;
  const toDelete = before.rows
    .map(r => r.slug as string)
    .filter(s => !validSlugs.has(s));

  if (toDelete.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0, kept: before.rows.length });
  }

  // Delete from both tables
  for (const slug of toDelete) {
    await sql`DELETE FROM events_latest WHERE slug = ${slug}`;
    await sql`DELETE FROM snapshots WHERE slug = ${slug}`;
    await sql`DELETE FROM changes WHERE slug = ${slug}`;
  }

  const after = await sql`SELECT slug FROM events_latest`;
  return NextResponse.json({
    ok: true,
    deleted: toDelete.length,
    removed_slugs: toDelete,
    kept: after.rows.length,
  });
}

export async function GET() {
  return NextResponse.json({
    info: "POST here to remove stale/test slugs from DB",
  });
}
