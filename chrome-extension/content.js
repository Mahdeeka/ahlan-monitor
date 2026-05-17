/**
 * content.js — runs in every ahlan.sa page.
 *
 * On load, asks background: "do you have an order for this tab?"
 *   - No order: do nothing (user is just browsing).
 *   - Order: API-direct checkout, then land on PayTabs payment page.
 *
 * Flow (API, not UI — same as ahlan_buy_max.buy_for_user_api):
 *   1. Confirm user is logged in (token cookie present).
 *   2. Click "Find Tickets" once (this triggers the SPA to issue a
 *      queue-token into localStorage). It's the only DOM step.
 *   3. Wait for `persist:nextjs-sitecore-root → event.queueToken`.
 *   4. fetch /api/ticketing/eventDetail?slug=<slug> → ticket_id matching
 *      the requested category (or best by priority), team_id, max_per_order.
 *   5. fetch POST /api/ticketing/nonSeatedCheckout with queue-token header
 *      → response.data.redirect_url is the PayTabs payment URL.
 *   6. window.location = redirect_url. User sees payment page, enters Visa.
 *
 * NEVER submits payment. The tab simply lands on PayTabs ready for human.
 */
(async () => {
  if (window.__ahlan_ext_loaded) return;
  window.__ahlan_ext_loaded = true;

  const tContentStart = Date.now();
  let order = null;
  try {
    const r = await chrome.runtime.sendMessage({ type: "content_ready" });
    order = r?.order || null;
  } catch (e) { return; }
  if (!order) return; // user is just browsing — don't interfere

  console.log("[Ahlan Ext] order received:", order);
  const sendTiming = (extra) => {
    try {
      chrome.runtime.sendMessage({
        type: "content_timing",
        timing: { tContentStart, ...extra },
      });
    } catch (e) {/* */}
  };

  // ── helpers ──────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const report = (status, opts = {}) => {
    try {
      chrome.runtime.sendMessage({
        type: "content_status", status,
        error_msg: opts.error_msg, notes: opts.notes,
      });
    } catch (e) {/* */}
  };
  function hasTokenCookie() {
    return document.cookie.split("; ").some(c => c.startsWith("token=") && c.length > 10);
  }
  function findFindTicketsBtn() {
    const all = document.querySelectorAll("a, button, [role='button']");
    for (const el of all) {
      const t = (el.textContent || "").trim().toLowerCase();
      if (t === "find tickets" || t.includes("find tickets")) return el;
    }
    return null;
  }
  function readQueueToken() {
    try {
      const raw = localStorage.getItem("persist:nextjs-sitecore-root");
      if (!raw) return null;
      const root = JSON.parse(raw);
      if (!root.event) return null;
      const ev = typeof root.event === "string" ? JSON.parse(root.event) : root.event;
      return ev.queueToken || null;
    } catch (e) { return null; }
  }
  async function waitFor(predicate, { timeout = 8000, interval = 100 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = predicate();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  // ── 0. Quick auth check (no fixed sleep — re-check below if early) ──
  if (location.pathname.toLowerCase().includes("/signin")) {
    report("auth_error", {
      error_msg: "Not logged in to ahlan.sa",
      notes: "Sign in once at https://www.ahlan.sa, then re-queue the order.",
    });
    return;
  }
  if (!hasTokenCookie()) {
    // Token cookie sometimes lands a beat after navigation finishes — wait briefly
    const cookieOk = await waitFor(hasTokenCookie, { timeout: 2000, interval: 100 });
    if (!cookieOk) {
      report("auth_error", { error_msg: "Not logged in to ahlan.sa" });
      return;
    }
  }

  // ── PARALLEL: kick off eventDetail fetch RIGHT NOW (doesn't need queue-token) ──
  const eventDetailPromise = fetch(
    `/api/ticketing/eventDetail?slug=${encodeURIComponent(order.slug)}&language=en`,
    { credentials: "include", headers: { Accept: "application/json" } }
  ).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
   .catch(e => ({ _error: e.message }));

  // ── 1. Click Find Tickets the moment it appears ─────────────────────
  let findBtn = await waitFor(findFindTicketsBtn, { timeout: 8000, interval: 50 });
  if (!findBtn) {
    report("failed", {
      error_msg: "Find Tickets button not found on page",
      notes: `URL: ${location.href}`,
    });
    return;
  }
  const tFindClick = Date.now();
  findBtn.click();
  sendTiming({ tFindClick });

  // ── 2. Wait for queue-token (poll every 40ms — usually appears in <300ms) ──
  const queueToken = await waitFor(readQueueToken, { timeout: 8000, interval: 40 });
  const tQueueToken = Date.now();
  sendTiming({ tQueueToken });
  if (!queueToken) {
    report("failed", {
      error_msg: "queue-token never appeared",
      notes: "Find Tickets click did not initialize the queue. Try refreshing.",
    });
    return;
  }
  console.log("[Ahlan Ext] queue-token:", queueToken.slice(0, 16) + "…",
              `(took ${tQueueToken - tFindClick}ms)`);

  // ── 3. Await the parallel eventDetail (likely already resolved) ─────
  const eventDetail = await eventDetailPromise;
  const tEventDetail = Date.now();
  sendTiming({ tEventDetail });
  if (eventDetail._error) {
    report("failed", { error_msg: `eventDetail fetch failed: ${eventDetail._error}` });
    return;
  }

  // Pick the right ticket. Prefer the dashboard-requested category, fall back
  // to Premium > CAT 1 > CAT 2.
  const tickets = eventDetail.event_tickets || [];
  const PRIORITY = ["Premium", "CAT 1", "CAT 2"];
  const wanted = (order.category || "").trim().toLowerCase();
  let pick = null;
  if (wanted) {
    pick = tickets.find(t => (t.title || "").trim().toLowerCase() === wanted);
    if (pick && (Number(pick.remaining) || 0) === 0) {
      report("sold_out", {
        error_msg: `${order.category} is sold out`,
        notes: `Other categories may be available — re-queue without specifying category to use priority.`,
      });
      return;
    }
  }
  if (!pick) {
    for (const name of PRIORITY) {
      const c = tickets.find(t => (t.title || "").trim() === name);
      if (c && (Number(c.remaining) || 0) > 0) { pick = c; break; }
    }
  }
  if (!pick) {
    report("sold_out", { error_msg: "No public categories available", notes: "All Premium/CAT 1/CAT 2 sold out." });
    return;
  }

  const ticketId = pick._id;
  const catName = (pick.title || "").trim();
  const maxPerOrder = Math.max(1, Number(pick.max_per_order) || 1);
  const remaining = Math.max(0, Number(pick.remaining) || 0);
  const requestedQty = Math.max(1, Number(order.qty) || 1);
  const qty = Math.min(requestedQty, maxPerOrder, remaining);

  const teamId = (eventDetail.home_team || {})._id;
  console.log("[Ahlan Ext] picked:", catName, "qty:", qty, "ticketId:", ticketId);

  // ── 4. POST nonSeatedCheckout ────────────────────────────────────────
  const payload = {
    event_id: order.slug,
    redirect: `${location.origin}/payment-success?payData=`,
    redirect_failed: `${location.origin}/ticket-summary?payData=`,
    lang: "en",
    payment_method: "credit_card",
    promo_code: "",
    favorite_team: teamId,
    booking_source: "afc-web",
    app_source: "afc",
    tickets: [{ id: ticketId, qty }],
  };

  let coResp;
  const tCheckoutStart = Date.now();
  try {
    const r = await fetch("/api/ticketing/nonSeatedCheckout", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "queue-token": queueToken,
      },
      body: JSON.stringify(payload),
    });
    const ct = r.headers.get("content-type") || "";
    const body = ct.includes("json") ? await r.json() : await r.text();
    if (!r.ok) {
      const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
      report("failed", { error_msg: `checkout HTTP ${r.status}`, notes: bodyStr.slice(0, 200) });
      return;
    }
    coResp = body;
  } catch (e) {
    report("failed", { error_msg: `checkout fetch failed: ${e.message}` });
    return;
  }
  const tCheckoutDone = Date.now();
  sendTiming({ tCheckoutStart, tCheckoutDone });
  console.log("[Ahlan Ext] checkout took", tCheckoutDone - tCheckoutStart, "ms");

  // ── 5. Extract payment URL + redirect ────────────────────────────────
  const data = coResp.data || coResp;
  const paymentUrl =
    data.redirect_url ||
    (data.response && data.response.redirect_url) ||
    null;
  const orderId =
    data.order_id ||
    (data.response && data.response.order_id) ||
    null;

  if (!paymentUrl) {
    report("failed", {
      error_msg: "no payment URL in checkout response",
      notes: JSON.stringify(coResp).slice(0, 200),
    });
    return;
  }

  const tPayUrl = Date.now();
  sendTiming({ tPayUrl });
  console.log("[Ahlan Ext] payment URL:", paymentUrl,
              `(total: ${tPayUrl - tContentStart}ms in content.js)`);
  report("success", {
    notes: `Cart created · ${catName} × ${qty}${orderId ? ` · order ${String(orderId).slice(-8)}` : ""} · ${tPayUrl - tContentStart}ms in-tab`,
  });
  document.title = `🟢 PAY NOW · ${catName} ×${qty}`;
  // Redirect immediately — no artificial sleep
  window.location.href = paymentUrl;
})();
