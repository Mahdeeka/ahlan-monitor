#!/usr/bin/env python3
"""
buy_worker.py — bridge between the AFC dashboard and your local ahlan bot.

Polls {DASHBOARD_URL}/api/buy/queue every POLL_INTERVAL seconds. For each
pending order:
  1. Claims it atomically (so two workers don't race).
  2. Calls call_bot(slug, category, qty, max_price_sar).
  3. Reports the outcome back via /api/buy/complete/<id>.

Your ahlan.sa credentials stay on this machine. The dashboard never sees
them — it just hands you a slug + category + qty.

Env vars (required):
  DASHBOARD_URL          e.g. https://ahlanweb.vercel.app
  BUY_WORKER_TOKEN       shared secret matching the Vercel env

Env vars (optional):
  WORKER_ID              human-readable id ("desktop", "pi", ...) — shown in UI
  POLL_INTERVAL          seconds between polls, default 2.0
  DRY_RUN                "1" to skip actual bot calls (returns "skipped")

USAGE:
  export DASHBOARD_URL=https://ahlanweb.vercel.app
  export BUY_WORKER_TOKEN='your-shared-secret-token'
  python scripts/buy_worker.py

To stop: Ctrl+C. To run unattended on Windows, use Task Scheduler with
"start when computer wakes up" + "restart on failure".
"""
import os
import sys
import time
import json
import socket
import traceback
from typing import Optional

import requests

# ─────────── Config ─────────────────────────────────────────────────────
DASHBOARD       = (os.environ.get("DASHBOARD_URL") or "").rstrip("/")
TOKEN           = os.environ.get("BUY_WORKER_TOKEN", "")
WORKER_ID       = (os.environ.get("WORKER_ID") or socket.gethostname())[:60]
POLL_INTERVAL   = float(os.environ.get("POLL_INTERVAL", "2.0"))
DRY_RUN         = os.environ.get("DRY_RUN") == "1"

if not DASHBOARD:
    print("ERROR: DASHBOARD_URL env var required", file=sys.stderr); sys.exit(1)
if not TOKEN:
    print("WARN: BUY_WORKER_TOKEN not set — will only work if Vercel side also has no token", file=sys.stderr)

HEADERS = {"Authorization": f"Bearer {TOKEN}"} if TOKEN else {}
S = requests.Session()
S.headers.update(HEADERS)


# ─────────── EDIT THIS — wire to your ahlan_multi_bot ───────────────────
def call_bot(slug: str, category: str, qty: int, max_price_sar: Optional[int]) -> dict:
    """
    Hand off to your local ahlan_multi_bot purchase function.

    Should return a dict like:
        {"status": "success" | "failed" | "sold_out" | "auth_error" | "skipped",
         "error_msg": str | None,
         "receipt_url": str | None,
         "notes": str | None}

    Default implementation is a SAFE STUB that just logs and returns "skipped".
    Replace it with a call into your ahlan_multi_bot:

        from ahlan_multi_bot import purchase
        result = purchase(slug=slug, category=category, qty=qty, max_price_sar=max_price_sar)
        return {
            "status":      "success" if result.ok else "failed",
            "error_msg":   getattr(result, "error", None),
            "receipt_url": getattr(result, "receipt_url", None),
            "notes":       getattr(result, "notes", None),
        }
    """
    if DRY_RUN:
        print(f"  🧪 DRY_RUN: would buy {qty}x {category!r} of {slug!r} cap={max_price_sar}")
        return {"status": "skipped", "notes": "DRY_RUN=1"}

    # ⚠️  STUB — replace the block below with your real bot integration.
    print(f"  ⚠️  STUB call_bot() — buy not actually performed.")
    print(f"       Replace call_bot() in {__file__} with your ahlan_multi_bot integration.")
    return {
        "status": "skipped",
        "notes":  "Worker stub — edit call_bot() to wire ahlan_multi_bot",
    }


# ─────────── Plumbing ───────────────────────────────────────────────────
def fetch_queue() -> list:
    r = S.get(f"{DASHBOARD}/api/buy/queue", timeout=10)
    if r.status_code == 401:
        print("  ❌ 401 unauthorized — check BUY_WORKER_TOKEN matches Vercel env", file=sys.stderr)
        return []
    r.raise_for_status()
    return (r.json() or {}).get("orders") or []


def claim_order(order_id: int) -> Optional[dict]:
    r = S.post(f"{DASHBOARD}/api/buy/claim/{order_id}",
               json={"worker_id": WORKER_ID}, timeout=10)
    if r.status_code == 409:
        return None  # already claimed by someone else
    r.raise_for_status()
    return (r.json() or {}).get("order")


def complete_order(order_id: int, payload: dict) -> None:
    r = S.post(f"{DASHBOARD}/api/buy/complete/{order_id}",
               json={"worker_id": WORKER_ID, **payload}, timeout=10)
    if not r.ok:
        print(f"  ❌ Failed to report completion for #{order_id}: HTTP {r.status_code} {r.text[:200]}")


# ─────────── Main loop ──────────────────────────────────────────────────
def main():
    print(f"🛒 buy_worker started")
    print(f"   dashboard   : {DASHBOARD}")
    print(f"   worker_id   : {WORKER_ID}")
    print(f"   poll every  : {POLL_INTERVAL}s")
    if DRY_RUN: print(f"   DRY_RUN     : YES (no actual purchases will happen)")
    print()

    seen_ids = set()  # to avoid spamming logs about the same pending order
    consecutive_errors = 0

    while True:
        try:
            orders = fetch_queue()
            consecutive_errors = 0
        except Exception as e:
            consecutive_errors += 1
            wait = min(60, POLL_INTERVAL * (2 ** min(consecutive_errors, 5)))
            print(f"  ⚠ poll error ({consecutive_errors}): {e} — backing off {wait:.0f}s")
            time.sleep(wait)
            continue

        for o in orders:
            oid = o["id"]
            slug = o["slug"]; cat = o["category"]; qty = o["qty"]; cap = o.get("max_price_sar")
            title = o.get("title") or slug
            print(f"  ▶ Order #{oid}: {title} · {cat} × {qty}" + (f" (cap SAR {cap})" if cap else ""))

            claimed = None
            try:
                claimed = claim_order(oid)
                if not claimed:
                    print(f"    ↩ already claimed by another worker — skipping")
                    continue
            except Exception as e:
                print(f"    ❌ claim error: {e}")
                continue

            try:
                result = call_bot(slug, cat, qty, cap)
                # Defensive: ensure status is a valid string
                status = str(result.get("status", "failed"))
                payload = {
                    "status":       status,
                    "error_msg":    result.get("error_msg"),
                    "receipt_url":  result.get("receipt_url"),
                    "notes":        result.get("notes"),
                }
                complete_order(oid, payload)
                marker = "✓" if status == "success" else "✗" if status in ("failed", "auth_error") else "·"
                print(f"    {marker} {status.upper()}" +
                      (f" — {result.get('notes')}" if result.get("notes") else ""))
            except Exception as e:
                tb = traceback.format_exc().splitlines()[-1]
                print(f"    ❌ bot exception: {tb}")
                try:
                    complete_order(oid, {"status": "failed", "error_msg": str(e)[:200]})
                except Exception:
                    pass

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n👋 buy_worker stopped (Ctrl+C)")
