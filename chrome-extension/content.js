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
// content.js loads on every ahlan.sa page. Two ways it can be told to act:
//   (a) Background already had an order assigned to this tab when we loaded
//       → content_ready returns the order → fire immediately.
//   (b) Background gets the order AFTER we load (pre-arm tab pattern)
//       → background calls chrome.tabs.sendMessage(tabId, {type:"process_order"})
//       → our onMessage listener fires processOrder.
// If neither happens in 60s, we sit quietly (user might just be browsing).

if (!window.__ahlan_ext_loaded) {
  window.__ahlan_ext_loaded = true;

  let _orderProcessing = false;
  const tContentLoad = Date.now();

  function processOrder(order) {
    if (_orderProcessing) return;
    _orderProcessing = true;
    runBuyFlow(order).catch(e => {
      console.error("[Ahlan Ext] runBuyFlow exception:", e);
      try {
        chrome.runtime.sendMessage({
          type: "content_status",
          status: "failed",
          error_msg: `exception: ${String(e?.message || e).slice(0, 200)}`,
        });
      } catch {}
    });
  }

  // Listener: background pushes orders that arrive after we loaded
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "process_order" && msg.order) {
      console.log("[Ahlan Ext] order pushed from background:", msg.order);
      processOrder(msg.order);
      sendResponse({ ok: true });
    }
    return true;
  });

  // On load: ask background if it already has an order for us
  (async () => {
    try {
      const r = await chrome.runtime.sendMessage({ type: "content_ready" });
      if (r?.order) {
        console.log("[Ahlan Ext] order already present:", r.order);
        processOrder(r.order);
      } else {
        console.log("[Ahlan Ext] loaded, no order yet — waiting for push");
      }
    } catch (e) { /* extension context invalidated */ }
  })();
}

// ─────────── Buy flow (called once per page load when an order arrives) ─────
async function runBuyFlow(order) {
  const tContentStart = Date.now();

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
        account_email: opts.account_email, account_name: opts.account_name,
      });
    } catch (e) {/* */}
  };
  function hasTokenCookie() {
    return document.cookie.split("; ").some(c => c.startsWith("token=") && c.length > 10);
  }
  function getTokenCookie() {
    const c = document.cookie.split("; ").find(c => c.startsWith("token="));
    return c ? c.slice("token=".length) : null;
  }
  function detectAccount() {
    // 1) Try JWT decode from token cookie
    const tok = getTokenCookie();
    if (tok && tok.split(".").length >= 2) {
      try {
        const payload = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        const email = payload.email || payload.user_email || payload.sub || null;
        const name = payload.name || payload.full_name || payload.firstName || null;
        if (email && email.includes("@")) return { email, name };
      } catch (e) {/* not a JWT */}
    }
    // 2) Try persist:nextjs-sitecore-root → user.email
    try {
      const raw = localStorage.getItem("persist:nextjs-sitecore-root");
      if (raw) {
        const root = JSON.parse(raw);
        const candidates = ["user", "auth", "profile", "account"];
        for (const k of candidates) {
          if (!root[k]) continue;
          const obj = typeof root[k] === "string" ? JSON.parse(root[k]) : root[k];
          const email = obj.email || obj.user_email || obj?.user?.email || null;
          const name = obj.name || obj?.user?.name || obj?.user?.first_name || null;
          if (email && String(email).includes("@")) return { email, name };
        }
      }
    } catch (e) {/* */}
    // 3) Try other localStorage keys
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const v = localStorage.getItem(key);
        if (v && /"email"\s*:\s*"[^"]+@[^"]+"/.test(v)) {
          const m = v.match(/"email"\s*:\s*"([^"]+@[^"]+)"/);
          const n = v.match(/"(?:name|full_name|first_name)"\s*:\s*"([^"]+)"/);
          if (m) return { email: m[1], name: n ? n[1] : null };
        }
      }
    } catch (e) {/* */}
    return { email: null, name: null };
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

  // ── 0. Auth detection via REAL signals, not cookie sniffing ────────────
  // The old `hasTokenCookie()` check was unreliable because ahlan.sa sets
  // its token as HttpOnly (invisible to JS). Sometimes it leaked, sometimes
  // it didn't — explaining "auth_error" for users who were clearly logged in.
  //
  // New approach: only treat auth as broken if (a) we're sitting on /Signin
  // right now, or (b) the actual API calls below return 401, or (c) the
  // page bounces to /Signin mid-flow. Otherwise, assume logged in and try.
  if (location.pathname.toLowerCase().includes("/signin") ||
      location.pathname.toLowerCase().includes("/login")) {
    report("auth_error", {
      error_msg: "Bounced to /Signin — not logged in to ahlan.sa",
      notes: "Open https://www.ahlan.sa once in this browser, sign in, then re-queue.",
    });
    return;
  }
  // Watch for mid-flow auth redirect
  let _authBounced = false;
  const _origPush = history.pushState.bind(history);
  history.pushState = function (...args) {
    const url = String(args[2] || "").toLowerCase();
    if (url.includes("/signin") || url.includes("/login")) _authBounced = true;
    return _origPush(...args);
  };

  // ── PARALLEL: kick off eventDetail fetch RIGHT NOW (doesn't need queue-token) ──
  const eventDetailPromise = fetch(
    `/api/ticketing/eventDetail?slug=${encodeURIComponent(order.slug)}&language=en`,
    { credentials: "include", headers: { Accept: "application/json" } }
  ).then(async r => {
    if (r.status === 401 || r.status === 403) return { _error: `HTTP ${r.status}`, _auth: true };
    if (!r.ok) return { _error: `HTTP ${r.status}` };
    return r.json();
  }).catch(e => ({ _error: e.message }));

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
  // If Find Tickets click bounced us to /Signin or we see no token, treat as auth
  const queueToken = await waitFor(() => {
    if (_authBounced || location.pathname.toLowerCase().includes("/signin")) return "__AUTH_BOUNCE__";
    return readQueueToken();
  }, { timeout: 10000, interval: 40 });
  const tQueueToken = Date.now();
  sendTiming({ tQueueToken });
  if (queueToken === "__AUTH_BOUNCE__") {
    report("auth_error", {
      error_msg: "Find Tickets click bounced to sign-in",
      notes: "Session expired or not logged in — sign in to ahlan.sa and re-queue.",
    });
    return;
  }
  if (!queueToken) {
    // Could be slow page OR could be unauthenticated. Check URL.
    if (location.pathname.toLowerCase().includes("/signin")) {
      report("auth_error", { error_msg: "Bounced to sign-in after Find Tickets click" });
      return;
    }
    report("failed", {
      error_msg: "queue-token never appeared (10s timeout)",
      notes: "Find Tickets clicked but the SPA didn't generate a queue-token. Try refreshing ahlan.sa to verify you're really logged in.",
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
    if (eventDetail._auth) {
      report("auth_error", { error_msg: `eventDetail ${eventDetail._error} — not authenticated` });
    } else {
      report("failed", { error_msg: `eventDetail fetch failed: ${eventDetail._error}` });
    }
    return;
  }

  // Pick the right ticket — STRICT match to what the user clicked. We do
  // NOT silently fall back to a different category, because that's how
  // people end up with Premium when they wanted CAT 2.
  const tickets = eventDetail.event_tickets || [];
  const wanted = (order.category || "").trim().toLowerCase();
  let pick = null;

  if (wanted) {
    // Whitespace-tolerant exact match (case-insensitive)
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
    pick = tickets.find(t => norm(t.title) === norm(wanted));
    if (!pick) {
      // List what we actually saw so the user can tell us if ahlan changed naming
      const seen = tickets.map(t => `"${(t.title || "").trim()}"`).join(", ");
      report("failed", {
        error_msg: `Category "${order.category}" not found in event tickets`,
        notes: `ahlan returned: ${seen || "(none)"}. NOT auto-picking a different one — re-queue with the exact category name.`,
      });
      return;
    }
    if ((Number(pick.remaining) || 0) === 0) {
      report("sold_out", {
        error_msg: `${order.category} just sold out`,
        notes: `Try a different category. (We deliberately don't auto-switch — that's how people get surprised by Premium charges.)`,
      });
      return;
    }
  } else {
    // No category specified — only then do we apply priority
    const PRIORITY = ["Premium", "CAT 1", "CAT 2"];
    for (const name of PRIORITY) {
      const c = tickets.find(t => (t.title || "").trim() === name);
      if (c && (Number(c.remaining) || 0) > 0) { pick = c; break; }
    }
    if (!pick) {
      report("sold_out", { error_msg: "No public categories available",
                           notes: "All Premium/CAT 1/CAT 2 sold out (no category was specified)." });
      return;
    }
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
      if (r.status === 401 || r.status === 403) {
        report("auth_error", {
          error_msg: `checkout HTTP ${r.status} — session expired`,
          notes: "Re-login to ahlan.sa and re-queue.",
        });
      } else {
        report("failed", { error_msg: `checkout HTTP ${r.status}`, notes: bodyStr.slice(0, 200) });
      }
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
  // Detect the logged-in account email so the order is forever tied to it
  const acc = detectAccount();
  console.log("[Ahlan Ext] account detected:", acc);
  report("success", {
    notes: `Cart created · ${catName} × ${qty}${orderId ? ` · order ${String(orderId).slice(-8)}` : ""} · ${tPayUrl - tContentStart}ms in-tab`,
    account_email: acc.email,
    account_name: acc.name,
  });
  // Ask the background worker to bring this tab to the front — it's now ready for human.
  try { chrome.runtime.sendMessage({ type: "focus_tab" }); } catch {/* */}
  document.title = `🟢 PAY NOW · ${catName} ×${qty}`;
  // Redirect immediately — no artificial sleep
  window.location.href = paymentUrl;
}
