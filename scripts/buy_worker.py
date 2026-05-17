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


# ─────────── ahlan_bot integration ──────────────────────────────────────
import subprocess, json as _json

# Path to the user's ahlan_bot directory. Override with env if it lives somewhere else.
AHLAN_BOT_DIR = os.environ.get("AHLAN_BOT_DIR", r"C:\Users\mahdi\OneDrive\Documents\ahlan_bot")
AHLAN_BOT_INVOKE = os.path.join(AHLAN_BOT_DIR, "ahlan_bot_invoke.py")
# How many accounts to use per dashboard order. Each account adds max-per-order
# tickets to its own cart. qty=1 → 1 account, qty=8 → 2 accounts (~4 each), etc.
ACCOUNTS_PER_QTY = float(os.environ.get("ACCOUNTS_PER_QTY", "4"))

def call_bot(slug: str, category: str, qty: int, max_price_sar: Optional[int]) -> dict:
    """Hand off to ahlan_bot/ahlan_bot_invoke.py and parse its __BUY_RESULT__ line."""
    if DRY_RUN:
        print(f"  🧪 DRY_RUN: would buy {qty}x {category!r} of {slug!r} cap={max_price_sar}")
        return {"status": "skipped", "notes": "DRY_RUN=1"}

    if not os.path.exists(AHLAN_BOT_INVOKE):
        return {
            "status": "failed",
            "error_msg": f"ahlan_bot_invoke.py not found at {AHLAN_BOT_INVOKE}. Set AHLAN_BOT_DIR env var.",
        }

    # Compute # accounts based on qty (round up). 1 account per ~4 tickets.
    num_users = max(1, int((qty + ACCOUNTS_PER_QTY - 1) // ACCOUNTS_PER_QTY))

    args = [sys.executable, AHLAN_BOT_INVOKE, slug, str(num_users)]
    if category:
        args.append(category)

    print(f"  ▶ launching: {' '.join(args[1:])}  (cwd={AHLAN_BOT_DIR})")

    # Run the bot. Don't capture stdout (let the user see the live logs in
    # their terminal). Instead we tee — capture too so we can parse the
    # __BUY_RESULT__ marker line at the end.
    try:
        proc = subprocess.Popen(
            args,
            cwd=AHLAN_BOT_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
    except Exception as e:
        return {"status": "failed", "error_msg": f"subprocess.Popen: {e}"}

    result_line = None
    # Stream output to our stdout AND capture result line
    for line in proc.stdout:
        sys.stdout.write(line)
        sys.stdout.flush()
        if line.startswith("__BUY_RESULT__"):
            result_line = line[len("__BUY_RESULT__"):].strip()
            # Once we have the result line, we don't need to wait for the
            # bot's payment-hold sleep — leave the process running so the
            # browser stays open for the human to pay, but report success NOW.
            break

    # Don't wait() — bot will hold browsers open. Return result immediately.
    # The browsers parked at the payment page are now the user's responsibility.

    if not result_line:
        # Process exited without emitting result line — wait briefly for exit code
        try:
            rc = proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            rc = "running"
        return {
            "status": "failed",
            "error_msg": f"bot exited without __BUY_RESULT__ (rc={rc})",
        }

    try:
        data = _json.loads(result_line)
    except Exception as e:
        return {"status": "failed", "error_msg": f"bad result JSON: {e} :: {result_line[:200]}"}

    # Translate to the worker's status vocabulary
    bot_status = data.get("status", "failed")
    note_parts = []
    if data.get("successes"):
        note_parts.append(f"{data['successes']} account(s) parked at payment page")
    if data.get("category"):
        note_parts.append(f"category: {data['category']}")
    if data.get("failures"):
        note_parts.append(f"{data['failures']} failed")

    return {
        "status":    "success" if bot_status == "success" else "failed",
        "error_msg": data.get("error") if bot_status != "success" else None,
        "notes":     " · ".join(note_parts) or None,
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
