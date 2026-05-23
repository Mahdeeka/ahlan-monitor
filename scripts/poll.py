#!/usr/bin/env python3
"""
poll.py — single-pass AFC 2027 ticket poller.

PRIMARY PATH (default): direct backend
  https://afc-api.webook.com/api/v2/event-detail/{slug}?lang=en&visible_in=afc
  with header `token: <hardcoded webook app token>`.
  No proxies needed, no Vercel WAF, much faster (~410ms/slug).

FALLBACK PATH: proxied ahlan.sa
  https://www.ahlan.sa/api/ticketing/eventDetail?slug=X&language=en
  via Webshare residential proxies. Only used if direct backend rate-limits
  us repeatedly. The fallback is invisibly invoked per-slug when direct fails.

Modes:
  all       (default)  Scrape every event — used by the 10-min slow workflow.
  priority             Scrape only the slugs returned by /api/priority-slugs
                       (sold-out events + events with premium categories sold
                       out). Used by the 3-min fast workflow.

Workflow:
  1. Build slug list:
       - mode=all      → discover via afc-api.webook.com bulk + canonical fallback
       - mode=priority → fetch list from {VERCEL_URL}/api/priority-slugs
  2. Fetch event-detail for each slug in parallel via direct backend (proxies
     are kept as a fallback only).
  3. POST {events: [...], source: "github-actions-<mode>"} to /api/snapshot.

Env:
  VERCEL_URL          (required) e.g. https://ahlanweb.vercel.app
  SNAPSHOT_SECRET     (required) shared secret with Vercel side
  WEBSHARE_PROXIES    (optional) "host:port:user:pass" lines — kept as fallback
  POLL_MODE           (optional) "all" or "priority" — defaults to "all"
  DISABLE_DIRECT      (optional, debug) set to "1" to force the old proxy path
"""
import os
import sys
import json
import time
import random
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

VERCEL_URL    = (os.environ.get("VERCEL_URL") or "").rstrip("/")
SECRET        = os.environ.get("SNAPSHOT_SECRET", "")
ORG_SLUG      = "afc-asiancup-2027"
PROXIES_RAW   = os.environ.get("WEBSHARE_PROXIES", "")
DISABLE_DIRECT = os.environ.get("DISABLE_DIRECT") == "1"

if not VERCEL_URL:
    print("ERROR: VERCEL_URL env var is required", file=sys.stderr)
    sys.exit(1)

# ── DIRECT BACKEND (primary path) ──────────────────────────────────────────────
# afc-api.webook.com is webook.com's Laravel backend, dedicated to AFC events.
# The token is the public Webook app token, hardcoded in their browser bundle.
# Same value works whether the request comes from webook.com, ahlan.sa, or our
# bot — webook only checks Origin + Referer headers for CORS routing.
DIRECT_BASE  = "https://afc-api.webook.com/api/v2"
DIRECT_TOKEN = "e9aac1f2f0b6c07d6be070ed14829de684264278359148d6a582ca65a50934d2"
DIRECT_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/130.0.0.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "token": DIRECT_TOKEN,
    "Origin": "https://www.ahlan.sa",
    "Referer": "https://www.ahlan.sa/",
}

# ── FALLBACK: proxied ahlan.sa (legacy path) ──────────────────────────────────
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/130.0.0.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.ahlan.sa/events",
}

# Parse Webshare proxies: lines of "host:port:user:pass"
ALL_PROXIES: list[str] = []
if PROXIES_RAW:
    for raw in PROXIES_RAW.replace(",", "\n").splitlines():
        raw = raw.strip().lstrip("﻿")  # strip BOM if any
        if not raw or raw.startswith("#"):
            continue
        try:
            h, p, u, pw = raw.split(":")
            ALL_PROXIES.append(f"http://{u}:{pw}@{h}:{p}")
        except ValueError:
            print(f"  ⚠ skipping malformed proxy line: {raw[:40]}")

# Working pool — populated by pre-warm step. Bad proxies get removed on
# 402/407/timeout/connection-refused during scraping.
HEALTHY_PROXIES: list[str] = list(ALL_PROXIES)
PROXY_FAILURES: dict[str, int] = {p: 0 for p in ALL_PROXIES}
PROXY_KILL_THRESHOLD = 2   # after this many consecutive failures, blacklist
PROXY_FATAL_CODES = {402, 407}  # auth / payment-required = whole proxy dead


def _label(p: str) -> str:
    """Extract host:port for log clarity (don't log creds)."""
    try:
        # http://user:pass@host:port
        return p.split("@")[-1]
    except Exception:
        return p


def mark_proxy_bad(proxy_url: str, reason: str, fatal: bool = False):
    """Record a proxy failure. Blacklist after threshold (or instantly if fatal)."""
    if proxy_url not in PROXY_FAILURES:
        return
    PROXY_FAILURES[proxy_url] += 1
    if fatal or PROXY_FAILURES[proxy_url] >= PROXY_KILL_THRESHOLD:
        if proxy_url in HEALTHY_PROXIES:
            HEALTHY_PROXIES.remove(proxy_url)
            tag = "FATAL" if fatal else f"{PROXY_FAILURES[proxy_url]}× fails"
            print(f"  🚫 blacklisting {_label(proxy_url)} ({tag} — {reason[:60]})")


def mark_proxy_ok(proxy_url: str):
    """Reset failure counter on success."""
    if proxy_url in PROXY_FAILURES:
        PROXY_FAILURES[proxy_url] = 0


def prewarm_proxies():
    """Quick parallel ping of all proxies — keep only ones returning 200 from a tiny endpoint.
    Falls back to ALL_PROXIES if every test fails (so we still try during the main run).
    Skipped entirely if direct backend is the primary path (proxies are only fallback)."""
    if not ALL_PROXIES:
        print("ℹ No WEBSHARE_PROXIES configured — direct backend only (no ahlan.sa fallback available)")
        return
    if not DISABLE_DIRECT:
        # Direct backend is primary; proxies are fallback. Skip the expensive
        # parallel ping — they'll be lazily validated on demand if direct fails.
        print(f"ℹ {len(ALL_PROXIES)} proxies available as fallback (direct backend is primary)")
        return
    # Old path: direct disabled, proxies are primary. Pre-warm them.
    test_url = "https://www.ahlan.sa/"
    print(f"🔌 Pre-warming {len(ALL_PROXIES)} proxies against {test_url} ...")

    def _test(proxy_url: str) -> tuple[str, str]:
        try:
            r = requests.get(test_url, headers=HEADERS,
                             proxies={"http": proxy_url, "https": proxy_url},
                             timeout=8, allow_redirects=False)
            if r.status_code in (200, 301, 302, 304, 403):  # 403 = ahlan WAF says no but proxy works
                return (proxy_url, f"OK {r.status_code}")
            if r.status_code in PROXY_FATAL_CODES:
                return (proxy_url, f"FATAL {r.status_code}")
            return (proxy_url, f"HTTP {r.status_code}")
        except requests.exceptions.ProxyError as e:
            msg = str(e)
            if "402" in msg: return (proxy_url, "FATAL 402 bandwidth")
            if "407" in msg: return (proxy_url, "FATAL 407 auth")
            return (proxy_url, f"proxy_err: {msg[:50]}")
        except Exception as e:
            return (proxy_url, f"err: {type(e).__name__}")

    healthy: list[str] = []
    with ThreadPoolExecutor(max_workers=min(len(ALL_PROXIES), 10)) as ex:
        for proxy_url, status in ex.map(_test, ALL_PROXIES):
            if status.startswith("OK"):
                healthy.append(proxy_url)
                print(f"   ✓ {_label(proxy_url):26}  {status}")
            else:
                fatal = status.startswith("FATAL")
                tag = "🚫" if fatal else "✗"
                print(f"   {tag} {_label(proxy_url):26}  {status}")

    HEALTHY_PROXIES.clear()
    if healthy:
        HEALTHY_PROXIES.extend(healthy)
        print(f"🎯 Using {len(HEALTHY_PROXIES)} / {len(ALL_PROXIES)} healthy proxies for this run")
    else:
        # All failed — fall back to trying ALL_PROXIES during scraping anyway
        HEALTHY_PROXIES.extend(ALL_PROXIES)
        print(f"⚠ Pre-warm: zero working proxies! Will still try all {len(ALL_PROXIES)} during scrape.")

# Fallback slugs if discovery fails (canonical 54 events verified via eventList API + bulk endpoint)
FALLBACK_SLUGS = [
    # Group stage 1-36
    "afc-cup-27-ksa-vs-pls-1", "afc-cup-27-kuw-vs-oma-2", "afc-cup-27-bhr-vs-prk-3",
    "afc-cup-27-uzb-vs-jor-4", "afc-cup-27-syr-vs-kgz-5", "afc-cup-27-irn-vs-chn-6",
    "afc-cup-27-ksa-vs-pls-7", "afc-cup-27-tjk-vs-irq-8", "afc-cup-27-kor-vs-tbd-9",
    "afc-cup-27-uae-vs-vie-10", "afc-cup-27-qat-vs-tha-11", "afc-cup-27-jap-vs-idn-12",
    "afc-cup-27-omn-vs-ksa-13", "afc-cup-27-kor-vs-uzb-14", "afc-cup-27-pal-vs-kuw-15",
    "afc-cup-27-kyr-vs-irn-16", "afc-cup-27-jor-vs-bhr-17", "afc-cup-27-iraq-vs-aus-18",
    "afc-cup-27-sgp-vs-tjk-19", "afc-cup-27-china-vs-syria-20", "afc-cup-27-uae-vs-tbc-21",
    "afc-cup-27-vie-vs-kor-22", "afc-cup-27-tha-vs-jap-23", "afc-cup-27-ind-vs-aqt-24",
    "afc-cup-27-oma-vs-ple-25", "afc-cup-27-prk-vs-jor-26", "afc-cup-27-ksa-vs-kuw-27",
    "afc-cup-27-uzb-vs-bhr-28", "afc-cup-27-irn-vs-syr-29", "afc-cup-27-kgz-vs-chn-30",
    "afc-cup-27-aus-tjk-31", "afc-cup-27-iraq-vs-sing-32", "afc-cup-27-kor-vs-uae-33",
    "afc-cup-27-jpn-vs-qtr-34", "afc-cup-27-tha-vs-idn-35", "afc-cup-27-vie-vs-tbc-36",
    # R16 (note irregular slugs)
    "afc-cup-27-1b-vs-3acd-38", "afc-cup-27-1d-vsbef-39", "afc-cup-27-1a-vs-3cde-40",
    "afc-cup-27-1f-vs-2e-41", "afc-cup-2b-v-2f-42", "afc-cup-27-1e-vs-2d-43",
    "afc-cup-27-1c-vs-3abf-44", "afc-cup-2a-vs-2c",
    # QF
    "afc-cup-27-w37-v-w39-45", "afc-cup-27-w38-v-w41-46",
    "afc-cup-27-w44-v-w43-47", "afc-cup-27-w40-v-w42-48",
    # SF
    "afc-cup-27-w45-v-w46-49", "afc-cup-27-w47-v-w48-50",
    # FINAL
    "afc-cup-27-final-50",
    # Match packs (bundle products added by ahlan after our initial list)
    "afc-cup-27-chn-pack",
    "afc-cup-27-ksa-pack",
    "afc-cup-27-uae-pack",
]


def safe_int(v):
    try: return int(v or 0)
    except: return 0


def classify_stage(slug: str) -> str:
    s = (slug or "").lower()
    if "final" in s and "3rd" not in s: return "FINAL"
    if "3rd" in s: return "3rd Place"
    num = s.split("-")[-1]
    try:
        n = int(num)
        if n <= 36: return "Group"
        if n in (49, 50): return "Semifinal"
        if 45 <= n <= 48: return "Quarterfinal"
        if 37 <= n <= 44: return "Round of 16"
    except: pass
    return "—"


def is_hospitality(cat_name: str) -> bool:
    """MATCH Hospitality packages (SAR 1900-5600 add-ons) aren't public tickets.
    When CAT 1/CAT 2/Premium are all sold out, the event is effectively sold out
    even though hospitality packages may still be on sale."""
    return (cat_name or "").upper().startswith("MATCH")


def normalize(slug: str, data: dict) -> dict:
    if not data or "_error" in data:
        return {"slug": slug, "error": (data or {}).get("_error", "unknown")}
    tickets = data.get("event_tickets") or []
    cats = []
    # Totals counted ONLY across public categories — hospitality packages
    # are excluded so 'sold out' actually means sold out for normal fans.
    public_rem = 0; public_cap = 0
    public_count = 0; public_sold_out_count = 0
    # Sum of (price + vat) × quantity across hospitality categories — the
    # SAR value sitting open in MATCH packages right now. Surfaces high-value
    # events (KSA matches, packs, FINAL) on the dashboard.
    hosp_value_sar = 0
    for t in tickets:
        name = (t.get("title") or "").strip()
        rem = safe_int(t.get("remaining")); qty = safe_int(t.get("quantity"))
        # Trust ahlan's sold_out flag — they sometimes return remaining>0 while
        # marking the category sold_out (drip restock between releases). If
        # the API doesn't include it, fall back to remaining==0.
        api_sold_out = bool(t.get("sold_out"))
        sold_out = api_sold_out or (rem == 0 and qty > 0)
        # If the API says sold out, treat remaining as 0 for total counting —
        # those "remaining" tickets aren't actually buyable.
        effective_rem = 0 if api_sold_out else rem
        cats.append({
            "name": name,
            "remaining": effective_rem,
            "quantity": qty,
            "price": safe_int(t.get("price")),
            "max_per_order": safe_int(t.get("max_per_order")),
            "sold_out": sold_out,
            "is_hospitality": is_hospitality(name),
        })
        if not is_hospitality(name):
            public_rem += effective_rem
            public_cap += qty
            public_count += 1
            if sold_out: public_sold_out_count += 1
        else:
            # Compute hosp value (price + vat) × full quantity even if sold out
            # so we can show the historic max value scale for this event.
            price = safe_int(t.get("price"))
            vat   = safe_int(t.get("vat"))
            hosp_value_sar += (price + vat) * qty

    pct = ((public_cap - public_rem) / public_cap * 100) if public_cap else 0
    if public_count == 0 and public_cap == 0:
        urgency = "unknown"
    elif public_count > 0 and public_sold_out_count == public_count:
        # All public categories sold out → SOLD OUT (regardless of hospitality)
        urgency = "sold_out"
    elif public_cap > 0 and public_rem == 0:
        urgency = "sold_out"
    elif pct >= 90: urgency = "almost_gone"
    elif pct >= 70: urgency = "selling_fast"
    else: urgency = "available"
    num_s = slug.split("-")[-1]
    # Hospitality totals — exposed separately for the UI but NOT part of the
    # headline numbers.
    hosp_cats  = [c for c in cats if c.get("is_hospitality")]
    hosp_rem   = sum(c["remaining"] for c in hosp_cats)
    hosp_cap   = sum(c["quantity"]  for c in hosp_cats)
    return {
        "slug": slug,
        "id": data.get("_id", ""),
        "title": data.get("title") or slug,
        "date": data.get("start_date_time_str") or "",
        "date_unix": safe_int(data.get("start_date_time")),
        "venue": data.get("venue_name") or "",
        "city": data.get("city") or "",
        "stage": classify_stage(slug),
        "match_number": int(num_s) if num_s.isdigit() else 0,
        "categories": cats,
        # Headline totals: PUBLIC tickets only (CAT/Premium), excluding MATCH hospitality
        "total_remaining": public_rem,
        "total_capacity":  public_cap,
        "pct_sold":        round(pct, 1),
        "urgency":         urgency,
        # Hospitality side-totals for the modal
        "hospitality_remaining": hosp_rem,
        "hospitality_capacity":  hosp_cap,
        "hospitality_value_sar": hosp_value_sar,
        # Configuration flags worth watching for flips. Today all false for
        # AFC 27; when any flips to true, the snapshot endpoint logs a
        # change_event so the dashboard can alert.
        "enable_primary_resell": bool(data.get("enable_primary_resell")),
        "has_resale_tickets":    bool(data.get("has_resale_tickets")),
        "enable_notify_me":      bool(data.get("enable_notify_me")),
        "poster": data.get("poster") or "",
        "logo": data.get("logo") or "",
    }


def fetch_direct(slug: str, timeout: int = 12) -> dict:
    """Fetch event detail via webook backend (primary path).

    Returns the inner `data` object (matches ahlan.sa's response shape).
    On error, returns {"_error": "..."} so callers can fall through to the
    proxy fallback.
    """
    url = f"{DIRECT_BASE}/event-detail/{slug}?lang=en&visible_in=afc"
    try:
        r = requests.get(url, headers=DIRECT_HEADERS, timeout=timeout)
        if r.status_code == 429:
            return {"_error": "direct 429"}
        if r.status_code == 404:
            return {"_error": "HTTP 404"}
        if not r.ok:
            return {"_error": f"direct HTTP {r.status_code}"}
        body = r.json()
        if body.get("status") != "success":
            return {"_error": f"direct status={body.get('status')!r}"}
        return body.get("data") or {"_error": "direct empty data"}
    except requests.exceptions.Timeout:
        return {"_error": "direct timeout"}
    except Exception as e:
        return {"_error": f"direct exc: {str(e)[:80]}"}


def fetch_proxied(slug: str, max_attempts: int = 4, timeout: int = 15) -> dict:
    """Fallback: hit ahlan.sa via a healthy Webshare proxy."""
    url = f"https://www.ahlan.sa/api/ticketing/eventDetail?slug={slug}&language=en"
    last_err = "no attempt"
    used: set[str] = set()
    for attempt in range(1, max_attempts + 1):
        if not HEALTHY_PROXIES:
            return {"_error": "no healthy proxies"}
        candidates = [p for p in HEALTHY_PROXIES if p not in used] or HEALTHY_PROXIES
        proxy_url = random.choice(candidates)
        used.add(proxy_url)
        proxies = {"http": proxy_url, "https": proxy_url}
        try:
            r = requests.get(url, headers=HEADERS, proxies=proxies, timeout=timeout)
            if r.status_code == 429:
                last_err = "HTTP 429"
                mark_proxy_bad(proxy_url, "HTTP 429", fatal=False)
                if attempt < max_attempts:
                    time.sleep(0.5 + attempt * 0.5)
                    continue
                return {"_error": last_err}
            if r.status_code == 404:
                mark_proxy_ok(proxy_url)
                return {"_error": "HTTP 404"}
            if r.status_code in PROXY_FATAL_CODES:
                mark_proxy_bad(proxy_url, f"HTTP {r.status_code}", fatal=True)
                last_err = f"HTTP {r.status_code}"
                if attempt < max_attempts: continue
                return {"_error": last_err}
            if not r.ok:
                last_err = f"HTTP {r.status_code}"
                mark_proxy_bad(proxy_url, last_err, fatal=False)
                if attempt < max_attempts:
                    time.sleep(0.5)
                    continue
                return {"_error": last_err}
            mark_proxy_ok(proxy_url)
            return r.json()
        except requests.exceptions.ProxyError as e:
            msg = str(e)[:120]
            last_err = msg
            fatal = "402" in msg or "407" in msg or "Unable to connect" in msg
            mark_proxy_bad(proxy_url, msg, fatal=fatal)
            if attempt < max_attempts: continue
            return {"_error": last_err}
        except requests.exceptions.Timeout:
            last_err = "timeout"
            mark_proxy_bad(proxy_url, "timeout", fatal=False)
            if attempt < max_attempts: continue
            return {"_error": last_err}
        except Exception as e:
            last_err = str(e)[:120]
            mark_proxy_bad(proxy_url, last_err, fatal=False)
            if attempt < max_attempts:
                time.sleep(0.5)
                continue
            return {"_error": last_err}
    return {"_error": last_err}


# Track direct path success/failure for the run report
_DIRECT_OK = 0
_DIRECT_FAIL = 0
_PROXY_OK = 0
_PROXY_FAIL = 0


def fetch_event(slug: str) -> dict:
    """Try direct backend first, fall back to proxied ahlan.sa on failure.
    Returns the inner event-data dict (or {"_error": "..."} if both fail)."""
    global _DIRECT_OK, _DIRECT_FAIL, _PROXY_OK, _PROXY_FAIL
    if not DISABLE_DIRECT:
        data = fetch_direct(slug)
        if "_error" not in data:
            _DIRECT_OK += 1
            return data
        _DIRECT_FAIL += 1
        # Direct failed; if we have proxies, fall through to old path
        if HEALTHY_PROXIES:
            data2 = fetch_proxied(slug)
            if "_error" not in data2:
                _PROXY_OK += 1
                return data2
            _PROXY_FAIL += 1
            # Return the more informative of the two errors
            return data2
        return data  # no proxies; return direct error
    # Direct disabled — proxy only
    data = fetch_proxied(slug)
    if "_error" in data:
        _PROXY_FAIL += 1
    else:
        _PROXY_OK += 1
    return data


def fetch_with_retry(url: str, max_attempts: int = 4, timeout: int = 12) -> dict:
    """Generic GET via direct (no proxy) then proxied fallback. Used for the
    eventList discovery call. Direct backend doesn't have eventList so this
    always uses the proxied ahlan.sa path."""
    last_err = "no attempt"
    used: set[str] = set()
    for attempt in range(1, max_attempts + 1):
        # If we have no proxies, just try a single direct hit
        if not HEALTHY_PROXIES:
            try:
                r = requests.get(url, headers=HEADERS, timeout=timeout)
                if r.status_code == 429: return {"_error": "HTTP 429 direct"}
                if r.status_code == 404: return {"_error": "HTTP 404"}
                if not r.ok: return {"_error": f"HTTP {r.status_code}"}
                return r.json()
            except Exception as e:
                return {"_error": f"direct exc: {str(e)[:80]}"}
        candidates = [p for p in HEALTHY_PROXIES if p not in used] or HEALTHY_PROXIES
        proxy_url = random.choice(candidates)
        used.add(proxy_url)
        proxies = {"http": proxy_url, "https": proxy_url}
        try:
            r = requests.get(url, headers=HEADERS, proxies=proxies, timeout=timeout)
            if r.status_code == 429:
                last_err = "HTTP 429"
                mark_proxy_bad(proxy_url, "HTTP 429", fatal=False)
                if attempt < max_attempts:
                    time.sleep(0.5 + attempt * 0.5)
                    continue
                return {"_error": last_err}
            if r.status_code == 404:
                mark_proxy_ok(proxy_url)
                return {"_error": "HTTP 404"}
            if r.status_code in PROXY_FATAL_CODES:
                mark_proxy_bad(proxy_url, f"HTTP {r.status_code}", fatal=True)
                last_err = f"HTTP {r.status_code}"
                if attempt < max_attempts: continue
                return {"_error": last_err}
            if not r.ok:
                last_err = f"HTTP {r.status_code}"
                mark_proxy_bad(proxy_url, last_err, fatal=False)
                if attempt < max_attempts:
                    time.sleep(0.5)
                    continue
                return {"_error": last_err}
            mark_proxy_ok(proxy_url)
            return r.json()
        except requests.exceptions.ProxyError as e:
            msg = str(e)[:120]
            last_err = msg
            fatal = "402" in msg or "407" in msg or "Unable to connect" in msg
            mark_proxy_bad(proxy_url, msg, fatal=fatal)
            if attempt < max_attempts: continue
            return {"_error": last_err}
        except requests.exceptions.Timeout:
            last_err = "timeout"
            mark_proxy_bad(proxy_url, "timeout", fatal=False)
            if attempt < max_attempts: continue
            return {"_error": last_err}
        except Exception as e:
            last_err = str(e)[:120]
            mark_proxy_bad(proxy_url, last_err, fatal=False)
            if attempt < max_attempts:
                time.sleep(0.5)
                continue
            return {"_error": last_err}
    return {"_error": last_err}


def discover_slugs_direct() -> list[str]:
    """Discover AFC slugs via the direct backend bulk endpoint.

    Note: webook's pagination on this endpoint has duplicates (returns ~32/54
    unique even when iterating all 14 advertised pages). We always UNION with
    the canonical FALLBACK_SLUGS to guarantee no missing events.
    """
    seen: set[str] = set()
    try:
        for page in range(1, 30):
            url = (f"{DIRECT_BASE}/organizations/{ORG_SLUG}/events"
                   f"?lang=en&visible_in=afc&page={page}")
            r = requests.get(url, headers=DIRECT_HEADERS, timeout=12)
            if not r.ok: break
            d = r.json().get("data", {}) or {}
            events = d.get("data", []) or []
            if not events: break
            for ev in events:
                if ev.get("slug"): seen.add(ev["slug"])
            last_page = d.get("last_page", 1) or 1
            if page >= last_page: break
        if not seen:
            return []
        return sorted(seen)
    except Exception as e:
        print(f"  ⚠ direct discovery failed: {e}")
        return []


def discover_slugs_proxied() -> list[str]:
    """Discover AFC slugs via ahlan.sa /api/ticketing/eventList (legacy)."""
    discovered: list[str] = []
    for page in (1, 2, 3):
        url = (f"https://www.ahlan.sa/api/ticketing/eventList"
               f"?organizationSlug={ORG_SLUG}&language=en&page={page}&per_page=100")
        data = fetch_with_retry(url, max_attempts=3)
        if "_error" in data:
            print(f"  ⚠ eventList discovery (page {page}) failed: {data['_error']}")
            break
        events = data.get("data") or []
        page_slugs = [e["slug"] for e in events if e.get("slug")]
        discovered.extend(page_slugs)
        if len(page_slugs) < 100:
            break
    return discovered


def discover_slugs():
    """Hit discovery API to get every published slug, union with fallback.

    Tries direct backend first (no proxy needed), falls back to proxied
    ahlan.sa if direct returns nothing. Always unions with FALLBACK_SLUGS so
    a transient discovery hiccup never drops an event.
    """
    discovered: list[str] = []
    if not DISABLE_DIRECT:
        discovered = discover_slugs_direct()
        if discovered:
            print(f"  ✓ Direct discovery: {len(discovered)} slugs from afc-api.webook.com")
        else:
            print(f"  ⚠ Direct discovery returned 0 — trying proxied fallback")
            discovered = discover_slugs_proxied()
    else:
        discovered = discover_slugs_proxied()

    if not discovered:
        print(f"  ⚠ All discovery failed — using {len(FALLBACK_SLUGS)} fallback only")
        return FALLBACK_SLUGS

    # Union with fallback so a transient miss never drops an event
    merged = list(dict.fromkeys([*discovered, *FALLBACK_SLUGS]))
    new_in_discovery = [s for s in discovered if s not in FALLBACK_SLUGS]
    if new_in_discovery:
        print(f"  ✓ Discovered {len(discovered)}; {len(new_in_discovery)} NEW slug(s): {new_in_discovery}")
    else:
        print(f"  ✓ Discovered {len(discovered)}; merged with fallback to {len(merged)}")
    return merged


def fetch_priority_slugs() -> list[str]:
    """Ask the Vercel dashboard which slugs are currently 'priority' to poll fast."""
    url = f"{VERCEL_URL}/api/priority-slugs"
    try:
        r = requests.get(url, timeout=15)
        if not r.ok:
            print(f"  ⚠ priority-slugs HTTP {r.status_code} — fast pass aborted")
            return []
        data = r.json()
        slugs = data.get("slugs") or []
        details = data.get("details") or []
        print(f"  🎯 Priority list from Vercel: {len(slugs)} slug(s)")
        for d in details[:8]:
            print(f"      ▸ {d.get('slug'):35} {d.get('urgency'):12} {d.get('pct_sold'):>5.1f}% sold  reasons={d.get('reasons')}")
        if len(details) > 8:
            print(f"      ▸ ... and {len(details) - 8} more")
        return slugs
    except Exception as e:
        print(f"  ⚠ priority-slugs fetch failed: {e}")
        return []


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("all", "priority"),
                        default=os.environ.get("POLL_MODE", "all"),
                        help="all = scrape every event; priority = scrape only sold-out/almost-gone slugs")
    args = parser.parse_args()
    mode = args.mode

    t0 = time.time()
    print(f"📡 Poll started at {time.strftime('%H:%M:%S UTC', time.gmtime())}  mode={mode}")
    path_label = "PROXIED ahlan.sa (DISABLE_DIRECT=1)" if DISABLE_DIRECT else "DIRECT afc-api.webook.com"
    print(f"🎯 Primary path: {path_label}")

    # Pre-warm proxies only if we'll actually use them as primary
    prewarm_proxies()

    if mode == "priority":
        slugs = fetch_priority_slugs()
        if not slugs:
            print("  ⏭️  Nothing to do — no priority slugs right now. Exiting cleanly.")
            return
    else:
        slugs = discover_slugs()

    # Fetch chosen events in parallel
    events = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        futures = {ex.submit(fetch_event, s): s for s in slugs}
        for fut in as_completed(futures):
            slug = futures[fut]
            try:
                data = fut.result()
                events.append(normalize(slug, data))
            except Exception as e:
                events.append(normalize(slug, {"_error": str(e)[:80]}))

    ok_count = sum(1 for e in events if "error" not in e)
    err_count = len(events) - ok_count
    elapsed = time.time() - t0
    print(f"  Fetched {ok_count}/{len(events)} events  (errors: {err_count})  in {elapsed:.1f}s")
    print(f"    Direct: {_DIRECT_OK} ok / {_DIRECT_FAIL} fail   Proxy: {_PROXY_OK} ok / {_PROXY_FAIL} fail")

    # Post to Vercel — send ALL events (including ones with errors) so the
    # dashboard's monitor can tell which slugs are failing.
    if not events:
        print("  ❌ No events at all — aborting POST")
        sys.exit(1)
    if ok_count == 0:
        print(f"  ❌ ALL {len(events)} events errored — aborting POST")
        sys.exit(1)
    source_tag = f"github-actions-{mode}"
    body = {"events": events, "source": source_tag}
    if SECRET:
        body["secret"] = SECRET
    try:
        r = requests.post(f"{VERCEL_URL}/api/snapshot",
                          headers={"Content-Type": "application/json"},
                          data=json.dumps(body), timeout=30)
        if r.ok:
            resp = r.json()
            print(f"  ☁️  Pushed to Vercel: {resp.get('snapshots_inserted', 0)} new, "
                  f"{resp.get('changes_detected', 0)} changes  ({time.time()-t0:.1f}s)")
            if resp.get("sample_changes"):
                for ch in resp["sample_changes"][:5]:
                    print(f"      ▸ {ch.get('type')}  {ch.get('title')}  {ch.get('details')}")
        else:
            print(f"  ❌ Push failed HTTP {r.status_code}: {r.text[:200]}")
            sys.exit(1)
    except Exception as e:
        print(f"  ❌ Push exception: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
