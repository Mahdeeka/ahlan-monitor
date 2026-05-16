#!/usr/bin/env python3
"""
poll.py — single-pass ahlan.sa AFC 2027 ticket poller.

Workflow:
  1. Discover all event slugs via /api/ticketing/eventList  (auto-finds new events
     like the FINAL the moment they are published).
  2. Fetch eventDetail for each slug in parallel.
  3. Normalise to the same Event shape the Vercel app expects.
  4. POST {events: [...], secret: "..."} to {VERCEL_URL}/api/snapshot

Env:
  VERCEL_URL          (required) e.g. https://ahlanweb.vercel.app
  SNAPSHOT_SECRET     (optional) shared secret if Vercel side has one
"""
import os
import sys
import json
import time
import random
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

VERCEL_URL    = (os.environ.get("VERCEL_URL") or "").rstrip("/")
SECRET        = os.environ.get("SNAPSHOT_SECRET", "")
ORG_SLUG      = "afc-asiancup-2027"
PROXIES_RAW   = os.environ.get("WEBSHARE_PROXIES", "")

if not VERCEL_URL:
    print("ERROR: VERCEL_URL env var is required", file=sys.stderr)
    sys.exit(1)

# Parse Webshare proxies: lines of "host:port:user:pass"
PROXIES: list[str] = []
if PROXIES_RAW:
    for raw in PROXIES_RAW.replace(",", "\n").splitlines():
        raw = raw.strip()
        if not raw or raw.startswith("#"):
            continue
        try:
            h, p, u, pw = raw.split(":")
            PROXIES.append(f"http://{u}:{pw}@{h}:{p}")
        except ValueError:
            print(f"  ⚠ skipping malformed proxy line: {raw[:40]}")
if PROXIES:
    print(f"🔌 Loaded {len(PROXIES)} Webshare proxies for ahlan.sa rotation")
else:
    print("⚠ No WEBSHARE_PROXIES configured — going direct (likely to get 429)")


def pick_proxy():
    if not PROXIES:
        return None
    p = random.choice(PROXIES)
    return {"http": p, "https": p}

# Fallback slugs if discovery fails (canonical 51 events verified via eventList API)
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
]

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/130.0.0.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.ahlan.sa/events",
}


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


def normalize(slug: str, data: dict) -> dict:
    if not data or "_error" in data:
        return {"slug": slug, "error": (data or {}).get("_error", "unknown")}
    tickets = data.get("event_tickets") or []
    cats = []
    total_rem = 0; total_cap = 0
    for t in tickets:
        rem = safe_int(t.get("remaining")); qty = safe_int(t.get("quantity"))
        cats.append({
            "name": (t.get("title") or "").strip(),
            "remaining": rem, "quantity": qty,
            "price": safe_int(t.get("price")),
            "max_per_order": safe_int(t.get("max_per_order")),
            "sold_out": rem == 0,
        })
        total_rem += rem; total_cap += qty
    pct = ((total_cap - total_rem) / total_cap * 100) if total_cap else 0
    if total_cap == 0: urgency = "unknown"
    elif total_rem == 0: urgency = "sold_out"
    elif pct >= 90: urgency = "almost_gone"
    elif pct >= 70: urgency = "selling_fast"
    else: urgency = "available"
    num_s = slug.split("-")[-1]
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
        "total_remaining": total_rem,
        "total_capacity": total_cap,
        "pct_sold": round(pct, 1),
        "urgency": urgency,
        "poster": data.get("poster") or "",
        "logo": data.get("logo") or "",
    }


def fetch_with_retry(url: str, max_attempts: int = 4, timeout: int = 20):
    """Fetch ahlan.sa via a random Webshare proxy; rotate on 429/error."""
    last_err = "no attempt"
    for attempt in range(1, max_attempts + 1):
        proxies = pick_proxy()
        try:
            r = requests.get(url, headers=HEADERS, proxies=proxies, timeout=timeout)
            if r.status_code == 429:
                last_err = "HTTP 429"
                if attempt < max_attempts:
                    time.sleep(1 + attempt)
                    continue
                return {"_error": last_err}
            if r.status_code == 404:
                # Slug doesn't exist (event not yet published) — don't keep retrying
                return {"_error": "HTTP 404"}
            if not r.ok:
                last_err = f"HTTP {r.status_code}"
                if attempt < max_attempts:
                    time.sleep(1)
                    continue
                return {"_error": last_err}
            return r.json()
        except Exception as e:
            last_err = str(e)[:120]
            if attempt < max_attempts:
                time.sleep(1)
                continue
            return {"_error": last_err}
    return {"_error": last_err}


def discover_slugs():
    """Hit eventList API to get every published slug.

    Returns the union of (a) what the API returns now and (b) the canonical
    fallback list — that way we never *lose* an event if discovery returns
    fewer than expected (e.g. transient API hiccup), and we *gain* events the
    moment ahlan.sa publishes them.
    """
    discovered: list[str] = []
    # API caps per_page at 100; paginate just in case (currently only ~51 events)
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
            break  # no more pages

    if not discovered:
        print(f"  ⚠ eventList returned no slugs — using {len(FALLBACK_SLUGS)} fallback only")
        return FALLBACK_SLUGS

    # Union with fallback so a transient miss never drops an event
    merged = list(dict.fromkeys([*discovered, *FALLBACK_SLUGS]))
    new_in_discovery = [s for s in discovered if s not in FALLBACK_SLUGS]
    if new_in_discovery:
        print(f"  ✓ Discovered {len(discovered)} via API; {len(new_in_discovery)} NEW: {new_in_discovery}")
    else:
        print(f"  ✓ Discovered {len(discovered)} via API; merged to {len(merged)} with fallback")
    return merged


def main():
    t0 = time.time()
    print(f"📡 Poll started at {time.strftime('%H:%M:%S UTC', time.gmtime())}")

    slugs = discover_slugs()

    # Fetch all events in parallel
    events = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        futures = {
            ex.submit(fetch_with_retry,
                      f"https://www.ahlan.sa/api/ticketing/eventDetail?slug={s}&language=en"): s
            for s in slugs
        }
        for fut in as_completed(futures):
            slug = futures[fut]
            try:
                data = fut.result()
                events.append(normalize(slug, data))
            except Exception as e:
                events.append(normalize(slug, {"_error": str(e)[:80]}))

    ok_count = sum(1 for e in events if "error" not in e)
    err_count = len(events) - ok_count
    print(f"  Fetched {ok_count}/{len(events)} events  (errors: {err_count})  in {time.time()-t0:.1f}s")

    # Post to Vercel
    # Send ALL events (including ones with errors) so the dashboard's monitor
    # can tell which slugs are failing.
    if not events:
        print("  ❌ No events at all — aborting POST")
        sys.exit(1)
    if ok_count == 0:
        print(f"  ❌ ALL {len(events)} events errored — aborting POST")
        sys.exit(1)
    body = {"events": events, "source": "github-actions"}
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
