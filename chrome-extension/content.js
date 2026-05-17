/**
 * content.js — runs on every ahlan.sa page. Reads the order from the URL
 * hash (#__ahlan_buy=<base64>) if present, then drives the cart flow with
 * a VISIBLE STATUS BANNER so the user can always see what's happening.
 *
 * v1.0 — simpler, no IPC race, recovers from sign-in interstitial.
 */

// ────────────────────────────────────────────────────────────────────────
// CRITICAL: this script must run at document_start (per manifest) so we
// can capture the URL hash BEFORE ahlan.sa's Next.js SPA hydrates and
// calls history.replaceState — which strips the hash and erases the order.
// ────────────────────────────────────────────────────────────────────────
console.log("[ahlan-ext] content.js loaded at", location.href, "readyState:", document.readyState);

(function bootstrap() {
  if (window.__ahlan_ext_loaded) return;
  window.__ahlan_ext_loaded = true;

  // Step 1: read hash IMMEDIATELY before SPA can strip it
  const hashKey = "__ahlan_buy=";
  let order = null;
  const idx = location.hash.indexOf(hashKey);
  if (idx >= 0) {
    try {
      const b64 = location.hash.slice(idx + hashKey.length).split("&")[0];
      order = JSON.parse(decodeURIComponent(escape(atob(b64))));
      console.log("[ahlan-ext] captured order from hash:", order);
      // Stash to sessionStorage so we survive any /Signin redirect
      try { sessionStorage.setItem("__ahlan_pending_order", JSON.stringify(order)); } catch {}
    } catch (e) {
      console.warn("[ahlan-ext] hash payload parse failed:", e, location.hash.slice(0, 100));
    }
  } else {
    // No hash — maybe a sessionStorage-stashed order from before a redirect
    try {
      const cached = sessionStorage.getItem("__ahlan_pending_order");
      if (cached) {
        order = JSON.parse(cached);
        console.log("[ahlan-ext] resumed order from sessionStorage:", order);
      }
    } catch {}
  }

  if (!order) {
    console.log("[ahlan-ext] no order for this tab — user is just browsing.");
    return;
  }

  // Step 2: figure out where we are. ahlan can drop us in lots of places
  // after a sign-in (homepage, /user-profile, etc.) so we may need to
  // navigate ourselves to the right event page.
  const path = location.pathname.toLowerCase();
  const onSigninPage = /\/(signin|login)/i.test(path);
  const onEventDetailPage = /\/events\/details/i.test(path);
  const isHomeOrOther = !onSigninPage && !onEventDetailPage;

  if (isHomeOrOther && order.slug) {
    // We're somewhere weird (probably right after a successful login that
    // redirected to home or profile). Navigate to the event page so the
    // buy flow can continue.
    console.log("[ahlan-ext] not on event page — navigating to event for order", order.id);
    const targetUrl = `https://www.ahlan.sa/events/details?event=${encodeURIComponent(order.slug)}`;
    location.replace(targetUrl);
    return;
  }

  // Step 3: wait for DOM ready, then drive the flow
  function startWhenReady() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => runFlow(order), { once: true });
    } else {
      runFlow(order);
    }
  }
  startWhenReady();
})();

// ────────────────────────────────────────────────────────────────────────
// Status HUD overlay — visible feedback for every step
// ────────────────────────────────────────────────────────────────────────
function ensureHud() {
  let el = document.getElementById("__ahlan_hud");
  if (el) return el;
  el = document.createElement("div");
  el.id = "__ahlan_hud";
  el.style.cssText = `
    position:fixed !important; top:12px !important; right:12px !important; z-index:2147483647 !important;
    width:340px; max-width:calc(100vw - 24px);
    background:rgba(15,23,42,0.97) !important; color:#e2e8f0 !important;
    border:1px solid rgba(99,102,241,0.5);
    border-radius:12px; padding:12px 14px;
    font:13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
    box-shadow:0 8px 24px rgba(0,0,0,0.35);
    backdrop-filter:blur(8px);
    pointer-events:auto;
  `;
  el.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
      <span style="font-size:18px;">🛒</span>
      <strong style="flex:1;">Ahlan Auto-Buy</strong>
      <button id="__ahlan_close" style="background:transparent;border:0;color:#94a3b8;cursor:pointer;font-size:16px;line-height:1;padding:0 4px;">×</button>
    </div>
    <div id="__ahlan_hud_status" style="font-size:12px;color:#cbd5e1;"></div>
    <div id="__ahlan_hud_steps" style="margin-top:8px;font-size:11px;line-height:1.6;color:#94a3b8;"></div>
    <div id="__ahlan_hud_action" style="margin-top:10px;"></div>
  `;
  const parent = document.body || document.documentElement;
  if (parent) parent.appendChild(el);
  const closeBtn = document.getElementById("__ahlan_close");
  if (closeBtn) closeBtn.onclick = () => el.remove();
  return el;
}
const steps = [];
function hudStatus(text, tone = "info") {
  const el = ensureHud();
  const s = el.querySelector("#__ahlan_hud_status");
  const colors = {
    info: "#cbd5e1", busy: "#a5b4fc", ok: "#86efac",
    warn: "#fde047", err: "#fca5a5",
  };
  s.style.color = colors[tone] || "#cbd5e1";
  s.textContent = text;
}
function hudStep(text, ok = "wait") {
  steps.push({ text, ok });
  const icons = { wait: "•", busy: "⏳", ok: "✓", err: "✗" };
  const colors = { wait: "#64748b", busy: "#a5b4fc", ok: "#86efac", err: "#fca5a5" };
  const el = ensureHud();
  el.querySelector("#__ahlan_hud_steps").innerHTML =
    steps.map(s => `<div style="color:${colors[s.ok]||"#94a3b8"};">${icons[s.ok]||"·"} ${s.text}</div>`).join("");
}
function hudUpdateLast(ok) {
  if (steps.length === 0) return;
  steps[steps.length - 1].ok = ok;
  hudStep("", null); // re-render
  steps.pop(); // remove the empty placeholder we just appended
  // Actually rebuild cleanly:
  const el = ensureHud();
  const icons = { wait: "•", busy: "⏳", ok: "✓", err: "✗" };
  const colors = { wait: "#64748b", busy: "#a5b4fc", ok: "#86efac", err: "#fca5a5" };
  el.querySelector("#__ahlan_hud_steps").innerHTML =
    steps.map(s => `<div style="color:${colors[s.ok]||"#94a3b8"};">${icons[s.ok]||"·"} ${s.text}</div>`).join("");
}
function hudAction(html) {
  ensureHud().querySelector("#__ahlan_hud_action").innerHTML = html;
}

// ────────────────────────────────────────────────────────────────────────
// Buy flow
// ────────────────────────────────────────────────────────────────────────
async function runFlow(order) {
  hudStatus(`Order #${order.id || "?"} · ${order.category} × ${order.qty}`, "busy");
  hudStep(`Open match: ${order.title || order.slug}`, "ok");

  const report = (status, opts = {}) => {
    try {
      chrome.runtime.sendMessage({
        type: "content_status", status,
        error_msg: opts.error_msg, notes: opts.notes,
        account_email: opts.account_email, account_name: opts.account_name,
        order_id: order.id, slug: order.slug, title: order.title,
      });
    } catch (e) {/* */}
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  async function waitFor(predicate, { timeout = 12000, interval = 80 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = predicate();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }
  const findBtnByText = (text) => {
    text = text.toLowerCase().trim();
    const all = document.querySelectorAll("button, a, [role='button']");
    for (const el of all) {
      const t = (el.textContent || "").toLowerCase().trim();
      if (t === text || t.includes(text)) return el;
    }
    return null;
  };
  const onSignIn = () => /\/(signin|login)/i.test(location.pathname);
  const readQueueToken = () => {
    try {
      const raw = localStorage.getItem("persist:nextjs-sitecore-root");
      if (!raw) return null;
      const root = JSON.parse(raw);
      if (!root.event) return null;
      const ev = typeof root.event === "string" ? JSON.parse(root.event) : root.event;
      return ev.queueToken || null;
    } catch (e) { return null; }
  };
  function detectAccount() {
    const tok = document.cookie.split("; ").find(c => c.startsWith("token="));
    if (tok) {
      const v = tok.slice("token=".length);
      if (v.split(".").length >= 2) {
        try {
          const p = JSON.parse(atob(v.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
          if (p.email && p.email.includes("@")) return { email: p.email, name: p.name || p.full_name || null };
        } catch {}
      }
    }
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i); if (!k) continue;
        const v = localStorage.getItem(k);
        if (v && /"email"\s*:\s*"[^"]+@[^"]+"/.test(v)) {
          const m = v.match(/"email"\s*:\s*"([^"]+@[^"]+)"/);
          const n = v.match(/"(?:name|full_name|first_name)"\s*:\s*"([^"]+)"/);
          if (m) return { email: m[1], name: n ? n[1] : null };
        }
      }
    } catch {}
    return { email: null, name: null };
  }

  // ── Sign-in interstitial ─────────────────────────────────────────────
  if (onSignIn()) {
    hudStatus(`⚠️  Sign in below to buy ${order.title || order.slug}`, "warn");
    hudStep(`Order #${order.id}: ${order.category} × ${order.qty}`, "wait");
    hudStep("Waiting for you to log in", "busy");
    hudAction(`
      <div style="background:rgba(252,211,77,0.12);border:1px solid rgba(252,211,77,0.4);border-radius:6px;padding:8px 10px;color:#fde047;font-size:11px;line-height:1.5;">
        <strong>👇 Sign in to ahlan.sa below.</strong><br>
        As soon as you're logged in, this tab will jump back to the match page and finish your order automatically.<br>
        <em style="color:#94a3b8;">Don't close this tab.</em>
      </div>
    `);
    report("auth_error", { error_msg: "Not logged in to ahlan.sa", notes: "User on /Signin — HUD shown, watching for login" });

    // Watch for URL change away from /signin (covers SPA nav + hard nav)
    let lastUrl = location.href;
    const iv = setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (!onSignIn()) {
          clearInterval(iv);
          console.log("[ahlan-ext] sign-in finished, jumping back to event page for order", order.id);
          // Force navigation to the event page — don't rely on ahlan's url_redirect
          location.replace(`https://www.ahlan.sa/events/details?event=${encodeURIComponent(order.slug)}`);
        }
      }
    }, 500);
    return;
  }

  // ── 1. Click Find Tickets ────────────────────────────────────────────
  hudStep("Find Tickets", "busy");
  const findBtn = await waitFor(() => findBtnByText("Find Tickets"), { timeout: 10000 });
  if (!findBtn) {
    hudUpdateLast("err");
    hudStatus("Couldn't find the Find Tickets button. The match page didn't render normally.", "err");
    report("failed", { error_msg: "Find Tickets button not found", notes: `URL ${location.pathname}` });
    return;
  }
  findBtn.click();
  hudUpdateLast("ok");

  // ── 2. Wait for queue-token ──────────────────────────────────────────
  hudStep("Get queue-token from ahlan.sa", "busy");
  const queueToken = await waitFor(() => {
    if (onSignIn()) return "__AUTH__";
    return readQueueToken();
  }, { timeout: 12000, interval: 50 });

  if (queueToken === "__AUTH__") {
    hudUpdateLast("err");
    hudStatus(`⚠️  Sign in below to buy ${order.title || order.slug}`, "warn");
    hudAction(`
      <div style="background:rgba(252,211,77,0.12);border:1px solid rgba(252,211,77,0.4);border-radius:6px;padding:8px 10px;color:#fde047;font-size:11px;line-height:1.5;">
        <strong>👇 Sign in to ahlan.sa below.</strong><br>
        We clicked Find Tickets but you're not signed in. Log in and we'll auto-resume your order.<br>
        <em style="color:#94a3b8;">Don't close this tab.</em>
      </div>
    `);
    report("auth_error", { error_msg: "Find Tickets click bounced to /Signin" });
    let lastUrl = location.href;
    const iv = setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (!onSignIn()) {
          clearInterval(iv);
          location.replace(`https://www.ahlan.sa/events/details?event=${encodeURIComponent(order.slug)}`);
        }
      }
    }, 500);
    return;
  }
  if (!queueToken) {
    hudUpdateLast("err");
    hudStatus("Queue token never arrived (12s). ahlan.sa might be slow or your session is iffy.", "err");
    hudAction(`<div style="color:#fde047;font-size:11px;">Try refreshing this tab manually. If still broken, sign out of ahlan.sa and sign back in.</div>`);
    report("failed", { error_msg: "queue-token timeout (12s)" });
    return;
  }
  hudUpdateLast("ok");

  // ── 3. Fetch eventDetail ─────────────────────────────────────────────
  hudStep("Fetch event details", "busy");
  let eventDetail;
  try {
    const r = await fetch(
      `/api/ticketing/eventDetail?slug=${encodeURIComponent(order.slug)}&language=en`,
      { credentials: "include", headers: { Accept: "application/json" } }
    );
    if (r.status === 401 || r.status === 403) {
      hudUpdateLast("err");
      hudStatus(`Authentication error (HTTP ${r.status}). Sign in to ahlan.sa, then we'll retry.`, "err");
      report("auth_error", { error_msg: `eventDetail HTTP ${r.status}` });
      return;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    eventDetail = await r.json();
  } catch (e) {
    hudUpdateLast("err");
    hudStatus(`Failed to fetch event details: ${e.message}`, "err");
    report("failed", { error_msg: e.message });
    return;
  }
  hudUpdateLast("ok");

  // ── 4. Pick ticket (strict match — never silently swap category) ────
  const tickets = eventDetail.event_tickets || [];
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const wanted = (order.category || "").trim();
  let pick = null;
  if (wanted) {
    pick = tickets.find(t => norm(t.title) === norm(wanted));
    if (!pick) {
      const seen = tickets.map(t => `"${(t.title || "").trim()}"`).join(", ");
      hudStatus(`Category "${wanted}" not found. ahlan returned: ${seen}`, "err");
      report("failed", { error_msg: `category "${wanted}" not found`, notes: seen });
      return;
    }
    if ((Number(pick.remaining) || 0) === 0) {
      hudStatus(`${wanted} just sold out.`, "err");
      report("sold_out", { error_msg: `${wanted} sold out at API time` });
      return;
    }
  } else {
    const PRI = ["Premium", "CAT 1", "CAT 2"];
    for (const n of PRI) {
      const c = tickets.find(t => (t.title || "").trim() === n);
      if (c && (Number(c.remaining) || 0) > 0) { pick = c; break; }
    }
    if (!pick) { report("sold_out", { error_msg: "all public sold out" }); return; }
  }
  const cat = (pick.title || "").trim();
  const maxPo = Math.max(1, Number(pick.max_per_order) || 1);
  const qty = Math.min(Math.max(1, Number(order.qty) || 1), maxPo, Number(pick.remaining) || 1);
  hudStep(`Picked: ${cat} × ${qty}`, "ok");

  // ── 5. POST checkout ─────────────────────────────────────────────────
  hudStep("Submit checkout (ahlan API)", "busy");
  const payload = {
    event_id: order.slug,
    redirect: `${location.origin}/payment-success?payData=`,
    redirect_failed: `${location.origin}/ticket-summary?payData=`,
    lang: "en",
    payment_method: "credit_card",
    promo_code: "",
    favorite_team: (eventDetail.home_team || {})._id,
    booking_source: "afc-web",
    app_source: "afc",
    tickets: [{ id: pick._id, qty }],
  };
  let coBody;
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
    if (r.status === 401 || r.status === 403) {
      hudUpdateLast("err");
      hudStatus("Checkout API says you're not authenticated. Sign in and re-queue.", "err");
      report("auth_error", { error_msg: `checkout HTTP ${r.status}` });
      return;
    }
    if (!r.ok) {
      const s = typeof body === "string" ? body : JSON.stringify(body);
      hudUpdateLast("err");
      hudStatus(`Checkout failed HTTP ${r.status}: ${s.slice(0, 120)}`, "err");
      report("failed", { error_msg: `HTTP ${r.status}`, notes: s.slice(0, 200) });
      return;
    }
    coBody = body;
  } catch (e) {
    hudUpdateLast("err");
    hudStatus(`Checkout error: ${e.message}`, "err");
    report("failed", { error_msg: e.message });
    return;
  }
  hudUpdateLast("ok");

  // ── 6. Redirect to PayTabs ───────────────────────────────────────────
  const data = coBody.data || coBody;
  const paymentUrl = data.redirect_url || (data.response && data.response.redirect_url);
  const orderId = data.order_id || (data.response && data.response.order_id);
  if (!paymentUrl) {
    hudStatus("Checkout succeeded but no payment URL came back. Strange.", "err");
    report("failed", { error_msg: "no payment URL in response", notes: JSON.stringify(coBody).slice(0, 200) });
    return;
  }
  hudStep("Redirecting to PayTabs payment page", "ok");
  const acc = detectAccount();
  report("success", {
    notes: `Cart created · ${cat} × ${qty}${orderId ? ` · order ${String(orderId).slice(-8)}` : ""}`,
    account_email: acc.email,
    account_name: acc.name,
  });
  hudStatus(`✓ Cart ready as ${acc.email || "(unknown email)"} — redirecting to pay…`, "ok");
  // Clear the cached order (we're navigating away)
  try { sessionStorage.removeItem("__ahlan_pending_order"); } catch {}
  document.title = `🟢 PAY NOW · ${cat} ×${qty}`;
  try { chrome.runtime.sendMessage({ type: "focus_tab" }); } catch {}
  setTimeout(() => { location.href = paymentUrl; }, 600);
}
