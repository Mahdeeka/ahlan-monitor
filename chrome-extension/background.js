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
const inFlight = new Set(); // tab ids actively working an order

async function handleOrder(order) {
  if (inFlight.has(order.id)) return;
  inFlight.add(order.id);

  await logActivity({ id: order.id, slug: order.slug, status: "claiming", msg: `claiming order #${order.id}` });
  const settings = await getSettings();
  const claimed = await claimOrder(order.id, settings.workerId);
  if (!claimed) {
    await logActivity({ id: order.id, status: "skipped", msg: "already claimed by another worker" });
    inFlight.delete(order.id);
    return;
  }

  const url = `https://www.ahlan.sa/events/details?event=${encodeURIComponent(order.slug)}`;
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: true });
  } catch (e) {
    await completeOrder(order.id, { status: "failed", error_msg: `tab open: ${e.message}` });
    await logActivity({ id: order.id, status: "failed", msg: `tab open failed: ${e.message}` });
    inFlight.delete(order.id);
    return;
  }

  notify(`Order #${order.id} opening`, `${order.title || order.slug} · ${order.category} × ${order.qty}`);
  await logActivity({ id: order.id, slug: order.slug, status: "claimed", msg: `tab ${tab.id} opened` });

  // Stash order context on the tab — content.js will message us back when ready
  await chrome.storage.session.set({ [`order_${tab.id}`]: order });
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
      const { status, error_msg, notes } = msg;
      await completeOrder(order.id, { status, error_msg, notes });
      await logActivity({ id: order.id, status, msg: notes || error_msg || "" });
      if (status === "success") {
        notify(`Cart ready · #${order.id}`, `${order.title || order.slug} parked at payment — go pay!`, "alert");
      } else if (status === "auth_error") {
        notify(`Login required`, `Sign in to ahlan.sa to process order #${order.id}`, "alert");
      } else {
        notify(`Order #${order.id} ${status}`, error_msg || notes || "");
      }
      inFlight.delete(order.id);
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
async function runPoll() {
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
      await handleOrder(o);
    }
  } catch (e) {
    await chrome.storage.local.set({ lastError: String(e).slice(0, 200) });
  }
}

/* ─── alarms ──────────────────────────────────────────────────────────── */
chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create("poll-queue", { periodInMinutes: 1 });
  await chrome.storage.local.set({ installedAt: Date.now() });
  await logActivity({ status: "installed", msg: "extension installed" });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("poll-queue", { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "poll-queue") await runPoll();
});

// Kick off an immediate poll on service-worker wake
runPoll().catch(() => {});
