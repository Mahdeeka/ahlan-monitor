"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Mail, Loader2, CheckCircle2, XCircle, ExternalLink, AlertTriangle, Copy,
} from "lucide-react";
import clsx from "clsx";

type Order = {
  id: number;
  slug: string; title: string | null; category: string;
  qty: number;
  status: string;
  receipt_url: string | null;
  account_email: string | null;
  account_name: string | null;
  created_at: number;
  completed_at: number | null;
  error_msg: string | null;
  notes: string | null;
};
type Account = {
  email: string;
  name: string;
  total_orders: number;
  success_count: number;
  pending_count: number;
  failed_count: number;
  last_purchase_ts: number;
  tickets_total_qty: number;
  orders: Order[];
};
type Data = {
  now: number;
  accounts: Account[];
  unknown: Order[];
  summary: { total_accounts: number; total_successful_tickets: number; total_orders: number };
};

function fmtAge(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m`;
  if (s < 86400) return `${Math.floor(s/3600)}h`;
  return `${Math.floor(s/86400)}d`;
}
function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function ByAccountPage() {
  const [data, setData] = useState<Data | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string>("");

  useEffect(() => {
    const fetcher = () => fetch("/api/buy/by-account", { cache: "no-store" })
      .then(r => r.json()).then(setData).catch(() => {});
    fetcher();
    const id = setInterval(fetcher, 5_000);
    return () => clearInterval(id);
  }, []);

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(text); setTimeout(() => setCopied(""), 1500);
    });
  }

  if (!data) return <div className="min-h-screen flex items-center justify-center">
    <Loader2 className="w-8 h-8 animate-spin text-emerald-400" /></div>;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-slate-950/60 border-b border-white/5">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <Link href="/buy-queue" className="text-slate-400 hover:text-white"><ArrowLeft className="w-5 h-5" /></Link>
          <Mail className="w-6 h-6 text-emerald-400" />
          <div>
            <div className="text-base sm:text-xl font-bold tracking-tight">Purchases by account</div>
            <div className="text-[10px] sm:text-xs text-slate-400">
              {data.summary.total_accounts} account(s) · {data.summary.total_successful_tickets} ticket(s) bought · {data.summary.total_orders} total orders
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-3">

        {/* Accounts */}
        {data.accounts.length === 0 && data.unknown.length === 0 && (
          <div className="glass rounded-2xl p-10 text-center text-slate-500 text-sm">
            No purchases recorded yet. Buy your first ticket — the email will be captured automatically.
          </div>
        )}

        {data.accounts.map(acc => {
          const isOpen = !!expanded[acc.email];
          return (
            <div key={acc.email} className="glass rounded-2xl border border-emerald-500/20 overflow-hidden">
              <button
                onClick={() => setExpanded({ ...expanded, [acc.email]: !isOpen })}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-emerald-500/5 text-left"
              >
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{acc.email}</div>
                  <div className="text-[11px] text-slate-400 flex items-center gap-3">
                    <span className="text-emerald-300 font-semibold">{acc.tickets_total_qty} tickets</span>
                    <span>{acc.success_count} successful · {acc.pending_count} pending · {acc.failed_count} failed</span>
                    {acc.last_purchase_ts > 0 && <span>last: {fmtAge(data.now - acc.last_purchase_ts)} ago</span>}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); copy(acc.email); }}
                  className="text-xs px-2 py-1 rounded bg-slate-700/40 hover:bg-slate-700/60 text-slate-300 border border-slate-600/30 flex items-center gap-1"
                  title="Copy email"
                >
                  {copied === acc.email ? "Copied!" : <><Copy className="w-3 h-3" /> Copy</>}
                </button>
                <span className="text-slate-500 text-xs">{isOpen ? "▼" : "▶"}</span>
              </button>

              {isOpen && (
                <div className="border-t border-white/5 divide-y divide-white/5">
                  {acc.orders.map(o => (
                    <div key={o.id} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                      <span className={clsx(
                        "px-1.5 py-0.5 rounded text-[10px] font-bold border shrink-0",
                        o.status === "success" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                        : o.status === "failed" || o.status === "auth_error" ? "bg-red-500/20 text-red-300 border-red-500/40"
                        : o.status === "pending" || o.status === "claimed" ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/40"
                        : "bg-slate-700/40 text-slate-400 border-slate-600/30"
                      )}>{o.status.toUpperCase()}</span>
                      <Link href={`/?open=${encodeURIComponent(o.slug)}`}
                        className="flex-1 min-w-0 truncate hover:text-emerald-300">
                        <span className="font-medium">{o.title || o.slug}</span>
                        <span className="text-slate-500 mx-1.5">·</span>
                        <span className="text-slate-400">{o.category} × {o.qty}</span>
                      </Link>
                      <span className="text-slate-500 text-[10px] shrink-0">{fmtDate(o.created_at)}</span>
                      {o.receipt_url && (
                        <a href={o.receipt_url} target="_blank" rel="noopener"
                          className="px-2 py-0.5 rounded text-[10px] bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 flex items-center gap-1 shrink-0">
                          <ExternalLink className="w-2.5 h-2.5" /> Receipt
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Unknown-email orders */}
        {data.unknown.length > 0 && (
          <div className="glass rounded-2xl p-4 border border-amber-500/30">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <div className="text-sm font-semibold text-amber-200">
                Orders without an email recorded ({data.unknown.length})
              </div>
            </div>
            <div className="text-[11px] text-slate-400 mb-2">
              These are older orders or ones where the extension couldn't detect a logged-in account.
              Future orders will record the email automatically.
            </div>
            <div className="space-y-1">
              {data.unknown.slice(0, 20).map(o => (
                <div key={o.id} className="flex items-center gap-2 text-xs px-2 py-1.5 bg-slate-800/30 rounded">
                  <span className="text-slate-500">#{o.id}</span>
                  <span className={clsx(
                    "px-1.5 py-0.5 rounded text-[9px] font-bold border",
                    o.status === "success" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                    : "bg-slate-700/30 text-slate-400 border-slate-600/30"
                  )}>{o.status}</span>
                  <span className="flex-1 truncate text-slate-300">{o.title || o.slug}</span>
                  <span className="text-slate-500 text-[10px]">{o.category} × {o.qty}</span>
                  <span className="text-slate-500 text-[10px]">{fmtAge(data.now - o.created_at)} ago</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-[10px] text-slate-500 pt-2 pb-8 text-center">
          Auto-refreshes every 5s. Emails are captured from the extension (JWT decode of the
          ahlan.sa session cookie) or from the bot worker (which knows its own account).
        </div>
      </main>
    </div>
  );
}
