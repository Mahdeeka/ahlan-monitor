/**
 * background.js — service worker for the Ahlan Auto-Buy extension.
 *
 * Responsibilities:
 *   1. Poll the dashboard's /api/buy/queue every minute (chrome.alarms).
 *   2. For each pending order: claim it, open a tab to the right ahlan.sa
 *      event page, hand off to content.js for the in-page automation.
 *   3. When content.js reports back the cart state, POST /api/buy/complete.
 *   4. Fire OS notifications: "cart parked at payment", "logged out — log in first", etc.
 *
 * Settings live in chrome.storage.local. See options.js.
 */

const DEFAULT_SETTINGS = {
  dashboardUrl: "https://ahlanweb.vercel.app",
  workerToken: "",
  enabled: true,
  workerId: "chrome-ext",
};

/* ─── settings ────────────────────────────────────────────────────────── */
async function getSettings() {
  const s = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...s };
}

/* ─── HTTP helpers ────────────────────────────────────────────────────── */
async function api(path, opts = {}) {
  const s = await getSettings();
  const url = s.dashboardUrl.replace(/\/+$/, "") + path;
  const headers = { ...(opts.headers || {}) };
  if (s.workerToken) headers.Authorization = `Bearer ${s.workerToken}`;
  return fetch(url, { ...opts, headers, cache: "no-store" });
}

async function fetchQueue() {
  const r = await api("/api/buy/queue");
  if (r.status === 401) throw new Error("unauthorized — token missing or wrong");
  if (!r.ok) throw new Error(`queue HTTP ${r.status}`);
  const data = await r.json();
  return data.orders || [];
}

async function claimOrder(id, workerId) {
  const r = await api(`/api/buy/claim/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worker_id: workerId }),
  });
  if (r.status === 409) return null; // someone else got it
  if (!r.ok) throw new Error(`claim HTTP ${r.status}`);
  const data = await r.json();
  return data.order;
}

async function completeOrder(id, payload) {
  return api(`/api/buy/complete/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/* ─── notifications ───────────────────────────────────────────────────── */
function notify(title, message, kind = "basic") {
  chrome.notifications.create("", {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/128.png"),
    title, message,
    priority: kind === "alert" ? 2 : 1,
    requireInteraction: kind === "alert",
  });
}

/* ─── activity log (popup reads this) ─────────────────────────────────── */
async function logActivity(entry) {
  const { activity = [] } = await chrome.storage.local.get(["activity"]);
  activity.unshift({ ts: Date.now(), ...entry });
  await chrome.storage.local.set({ activity: activity.slice(0, 50) });
}

/* ─── core: handle one order ──────────────────────────────────────────── */
const inFlight = new Set();           // order ids actively being processed
const prearmedTabs = new Map();       // slug → { tabId, ts } — tabs opened before the order even exists
const timings = new Map();            // orderId → { tStart, tPrearm, tClaim, tTab, tToken, tCheckout, tPay }

async function prearmTab(slug, ts) {
  // If we already have a fresh prearmed tab for this slug, reuse it
  const existing = prearmedTabs.get(slug);
  if (existing && Date.now() - existing.ts < 60_000) {
    try {
      const t = await chrome.tabs.get(existing.tabId);
      if (t && !t.discarded) return existing.tabId;
    } catch {/* tab closed */}
    prearmedTabs.delete(slug);
  }
  const url = `https://www.ahlan.sa/events/details?event=${encodeURIComponent(slug)}`;
  try {
    // active:true — user just clicked Buy, they WANT to see the tab open.
    // (Earlier active:false was meant to "not steal focus" but made it look
    // like nothing was happening.)
    const tab = await chrome.tabs.create({ url, active: true });
    prearmedTabs.set(slug, { tabId: tab.id, ts: Date.now() });
    await logActivity({ slug, status: "prearm", msg: `opened tab ${tab.id} for ${slug}` });
    return tab.id;
  } catch (e) {
    await logActivity({ slug, status: "prearm_err", msg: e.message });
    return null;
  }
}

async function handleOrder(order, pushedAt) {
  if (inFlight.has(order.id)) return;
  inFlight.add(order.id);
  const t0 = pushedAt || Date.now();
  timings.set(order.id, { tStart: t0 });

  await logActivity({ id: order.id, slug: order.slug, status: "claiming",
                       msg: `claiming order #${order.id}` });
  const settings = await getSettings();
  const claimed = await claimOrder(order.id, settings.workerId);
  const tClaim = Date.now();
  timings.set(order.id, { ...timings.get(order.id), tClaim });
  if (!claimed) {
    await logActivity({ id: order.id, status: "skipped", msg: "already claimed by another worker" });
    inFlight.delete(order.id);
    return;
  }

  // Reuse pre-armed tab if one exists for this slug
  let tab;
  let wasPrearmed = false;
  const arm = prearmedTabs.get(order.slug);
  if (arm) {
    try {
      tab = await chrome.tabs.get(arm.tabId);
      prearmedTabs.delete(order.slug);
      wasPrearmed = true;
      // Bring it to front — user is waiting for visible progress
      try { await chrome.tabs.update(arm.tabId, { active: true }); } catch {}
    } catch { tab = null; }
  }
  if (!tab) {
    const url = `https://www.ahlan.sa/events/details?event=${encodeURIComponent(order.slug)}`;
    try {
      tab = await chrome.tabs.create({ url, active: true });
    } catch (e) {
      await completeOrder(order.id, { status: "failed", error_msg: `tab open: ${e.message}` });
      await logActivity({ id: order.id, status: "failed", msg: `tab open failed: ${e.message}` });
      inFlight.delete(order.id);
      return;
    }
  }
  const tTab = Date.now();
  timings.set(order.id, { ...timings.get(order.id), tTab });

  notify(`Order #${order.id} firing`,
         `${order.title || order.slug} · ${order.category} × ${order.qty} (${tTab - t0}ms to tab)`);
  await logActivity({ id: order.id, slug: order.slug, status: "tab_open",
                       msg: `tab ${tab.id} ready in ${tTab - t0}ms` });

  // Stash order context — content.js asks for it on load
  await chrome.storage.session.set({ [`order_${tab.id}`]: { ...order, _tStart: t0 } });
}

/* ─── content.js → background message bridge ──────────────────────────── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "content_ready") {
      const tabId = sender.tab?.id;
      if (tabId == null) return sendResponse({});
      const { [`order_${tabId}`]: order } = await chrome.storage.session.get([`order_${tabId}`]);
      sendResponse({ order: order || null });
      return;
    }
    if (msg?.type === "content_status") {
      const tabId = sender.tab?.id;
      const { [`order_${tabId}`]: order } = await chrome.storage.session.get([`order_${tabId}`]);
      if (!order) return sendResponse({});
      const { status, error_msg, notes, account_email, account_name } = msg;
      await completeOrder(order.id, { status, error_msg, notes, account_email, account_name });
      await logActivity({
        id: order.id, status,
        msg: (account_email ? `[${account_email}] ` : "") + (notes || error_msg || ""),
      });
      if (status === "success") {
        notify(`Cart ready · #${order.id}`,
               `${order.title || order.slug}${account_email ? ` (${account_email})` : ""} — go pay!`, "alert");
      } else if (status === "auth_error") {
        notify(`Login required`, `Sign in to ahlan.sa to process order #${order.id}`, "alert");
      } else {
        notify(`Order #${order.id} ${status}`, error_msg || notes || "");
      }
      inFlight.delete(order.id);
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "prearm_tab") {
      await prearmTab(msg.slug, msg.ts);
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "order_enqueued") {
      // Direct push from dashboard — fire immediately, no alarm wait
      await logActivity({ id: msg.orderId, status: "pushed",
                          msg: `direct push (slug=${msg.slug || "?"})` });
      // If we have a fresh queue order from /api/buy/queue, handleOrder it.
      // Otherwise just kick off a poll which finds + handles it.
      await runPoll(msg.ts);
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "focus_tab") {
      // content.js is done — bring its tab to front so user can pay
      const tabId = sender.tab?.id;
      if (tabId != null) {
        try {
          await chrome.tabs.update(tabId, { active: true });
          const tab = await chrome.tabs.get(tabId);
          if (tab.windowId != null) {
            try { await chrome.windows.update(tab.windowId, { focused: true }); } catch {}
          }
        } catch {}
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "content_timing") {
      // content.js telling us per-step durations
      const tabId = sender.tab?.id;
      const { [`order_${tabId}`]: order } = await chrome.storage.session.get([`order_${tabId}`]);
      if (order) {
        const prior = timings.get(order.id) || {};
        timings.set(order.id, { ...prior, ...msg.timing });
        await chrome.storage.local.set({ lastTiming: { id: order.id, slug: order.slug, ...prior, ...msg.timing } });
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "poll_now") {
      await runPoll();
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: "unknown type" });
  })();
  return true; // async response
});

/* ─── periodic poll ───────────────────────────────────────────────────── */
async function runPoll(pushedAt) {
  const s = await getSettings();
  if (!s.enabled) return;
  if (!s.workerToken) {
    await chrome.storage.local.set({ lastError: "Token not configured — open extension options" });
    return;
  }
  try {
    const orders = await fetchQueue();
    await chrome.storage.local.set({ lastPollOk: Date.now(), lastError: null });
    for (const o of orders) {
      await handleOrder(o, pushedAt);
    }
  } catch (e) {
    await chrome.storage.local.set({ lastError: String(e).slice(0, 200) });
  }
}

/* ─── alarms ──────────────────────────────────────────────────────────── */
// MV3 minimum granularity is 30s (= 0.5 min). When dashboard is open and
// pushes directly via window.postMessage, polling is irrelevant — this is
// only the fallback for closed-dashboard scenarios (e.g. an auto-buy rule
// firing while you're not looking at the tab).
const POLL_PERIOD_MIN = 0.5;

chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create("poll-queue", { periodInMinutes: POLL_PERIOD_MIN });
  await chrome.storage.local.set({ installedAt: Date.now() });
  await logActivity({ status: "installed", msg: "extension installed (v0.2 — push-enabled)" });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("poll-queue", { periodInMinutes: POLL_PERIOD_MIN });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "poll-queue") await runPoll();
});

// Kick off an immediate poll on service-worker wake
runPoll().catch(() => {});
