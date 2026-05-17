/**
 * GET /api/buy/by-account
 *
 * Aggregates buy_orders by account_email. Used by the dashboard's
 * "purchases by account" page so the user never loses track of which
 * email bought which ticket.
 *
 * Returns:
 *   accounts: [{
 *     email,
 *     name,
 *     total_orders, success_count, pending_count, failed_count,
 *     last_purchase_ts,
 *     tickets_total_qty,
 *     orders: [{ id, slug, title, category, qty, status, created_at, completed_at, receipt_url }]
 *   }]
 *   unknown: [...]  // orders with no account_email recorded
 *   total_successful_tickets: N
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { sql } = await import("@vercel/postgres");
  const rows = await sql`
    SELECT id, slug, title, category, qty, status,
           account_email, account_name, receipt_url,
           created_at, completed_at, error_msg, notes
    FROM buy_orders
    ORDER BY created_at DESC
    LIMIT 500
  `;
  const byEmail = new Map<string, any>();
  const unknown: any[] = [];

  for (const o of rows.rows) {
    const email = (o.account_email as string | null)?.toLowerCase() || null;
    if (!email) { unknown.push(o); continue; }
    let acc = byEmail.get(email);
    if (!acc) {
      acc = {
        email,
        name: (o.account_name as string | null) || email.split("@")[0],
        total_orders: 0, success_count: 0, pending_count: 0, failed_count: 0,
        last_purchase_ts: 0,
        tickets_total_qty: 0,
        orders: [],
      };
      byEmail.set(email, acc);
    }
    acc.total_orders++;
    if (o.status === "success") {
      acc.success_count++;
      acc.tickets_total_qty += (o.qty as number) || 0;
      const ct = (o.completed_at as number) || 0;
      if (ct > acc.last_purchase_ts) acc.last_purchase_ts = ct;
    } else if (o.status === "pending" || o.status === "claimed") {
      acc.pending_count++;
    } else {
      acc.failed_count++;
    }
    // Keep account_name updated if we get a more meaningful value later
    if (o.account_name && !acc.name) acc.name = o.account_name;
    acc.orders.push(o);
  }

  const accounts = Array.from(byEmail.values()).sort((a, b) => b.last_purchase_ts - a.last_purchase_ts);
  const total_successful_tickets = accounts.reduce((s, a) => s + a.tickets_total_qty, 0);

  return NextResponse.json({
    now: Math.floor(Date.now() / 1000),
    accounts,
    unknown,
    summary: {
      total_accounts: accounts.length,
      total_successful_tickets,
      total_orders: rows.rows.length,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
