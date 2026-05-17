/**
 * background.js — service worker for the Ahlan Auto-Buy extension v1.0.
 *
 * Massively simplified vs v0.x. No queue polling, no race conditions, no
 * IPC timing. The dashboard generates a URL with the order in the hash;
 * we just open the tab; content.js reads the hash and does the buy.
 *
 * Optional: keep a minimal queue poller as a SAFETY NET for orders that
 * weren't initiated from the dashboard (e.g. future auto-buy rules).
 */

const DEFAULT_SETTINGS = {
  dashboardUrl: "https://ahlanweb.vercel.app",
  workerToken: "",
  enabled: true,
  workerId: "chrome-ext",
};

async function getSettings() {
  const s = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...s };
}

async function api(path, opts = {}) {
  const s = await getSettings();
  const url = s.dashboardUrl.replace(/\/+$/, "") + path;
  const headers = { ...(opts.headers || {}) };
  if (s.workerToken) headers.Authorization = `Bearer ${s.workerToken}`;
  return fetch(url, { ...opts, headers, cache: "no-store" });
}

function notify(title, message, kind = "basic") {
  chrome.notifications.create("", {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/128.png"),
    title, message,
    priority: kind === "alert" ? 2 : 1,
    requireInteraction: kind === "alert",
  });
}

async function logActivity(entry) {
  const { activity = [] } = await chrome.storage.local.get(["activity"]);
  activity.unshift({ ts: Date.now(), ...entry });
  await chrome.storage.local.set({ activity: activity.slice(0, 50) });
}

/* ─── Open a tab for a buy order ──────────────────────────────────────── */
async function openOrderTab(url, order) {
  try {
    const tab = await chrome.tabs.create({ url, active: true });
    await logActivity({
      id: order?.id, slug: order?.slug, status: "opening",
      msg: `tab ${tab.id} opened`,
    });
    return tab;
  } catch (e) {
    await logActivity({ id: order?.id, status: "open_err", msg: e.message });
    notify("Buy failed", `Couldn't open tab: ${e.message}`);
    return null;
  }
}

/* ─── Message bridge ──────────────────────────────────────────────────── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "open_order") {
      await openOrderTab(msg.url, msg.order);
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "open_url") {
      try { await chrome.tabs.create({ url: msg.url, active: true }); }
      catch (e) { /* */ }
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "content_status") {
      const { status, error_msg, notes, account_email, account_name, order_id } = msg;
      if (order_id) {
        try {
          await api(`/api/buy/complete/${order_id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status, error_msg, notes, account_email, account_name }),
          });
        } catch (e) { console.warn("complete failed", e); }
      }
      await logActivity({
        id: order_id, status,
        msg: (account_email ? `[${account_email}] ` : "") + (notes || error_msg || ""),
      });
      if (status === "success") {
        notify(`Cart ready · #${order_id || "?"}`,
               `${msg.title || msg.slug || ""}${account_email ? ` (${account_email})` : ""} — pay now!`, "alert");
      } else if (status === "auth_error") {
        notify("Sign in to ahlan.sa",
               "The tab is waiting at the sign-in page. Log in, then we'll continue automatically.", "alert");
      } else if (status === "failed") {
        notify(`Order ${status}`, error_msg || notes || "");
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "focus_tab") {
      const tabId = sender.tab?.id;
      if (tabId != null) {
        try {
          await chrome.tabs.update(tabId, { active: true });
          const t = await chrome.tabs.get(tabId);
          if (t.windowId != null) {
            try { await chrome.windows.update(t.windowId, { focused: true }); } catch {}
          }
        } catch {}
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "poll_now") {
      // Manual poll button in popup — fall back to the old behavior so users
      // can fire orders queued without going through the dashboard bridge.
      await runFallbackPoll();
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: "unknown type" });
  })();
  return true;
});

/* ─── Safety-net poller for non-dashboard orders ─────────────────────── */
async function runFallbackPoll() {
  const s = await getSettings();
  if (!s.enabled) return;
  if (!s.workerToken) {
    await chrome.storage.local.set({ lastError: "Token not configured — open extension options" });
    return;
  }
  try {
    const r = await api("/api/buy/queue");
    if (r.status === 401) throw new Error("unauthorized");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    await chrome.storage.local.set({ lastPollOk: Date.now(), lastError: null });
    for (const o of (data.orders || [])) {
      const url = `https://www.ahlan.sa/events/details?event=${encodeURIComponent(o.slug)}#__ahlan_buy=${
        btoa(unescape(encodeURIComponent(JSON.stringify(o))))
      }`;
      await openOrderTab(url, o);
    }
  } catch (e) {
    await chrome.storage.local.set({ lastError: String(e).slice(0, 200) });
  }
}

async function seedDefaultAccountsIfEmpty() {
  try {
    const { ahlan_accounts = [] } = await chrome.storage.local.get("ahlan_accounts");
    const hasReal = ahlan_accounts.some(a => a?.email && a?.password);
    if (hasReal) return; // user already has accounts — don't overwrite
    // Try to load bundled defaults. The file is .gitignored — only present if
    // the user ran the seed script locally.
    try {
      importScripts(chrome.runtime.getURL("default_accounts.js"));
    } catch (e) {
      console.log("[ahlan-bg] no default_accounts.js bundled — user will add accounts via settings");
      return;
    }
    const defaults = self.DEFAULT_AHLAN_ACCOUNTS || [];
    if (defaults.length === 0) return;
    await chrome.storage.local.set({ ahlan_accounts: defaults, autoLogin: true });
    await logActivity({ status: "seeded", msg: `seeded ${defaults.length} default accounts from bundled file` });
    console.log(`[ahlan-bg] seeded ${defaults.length} default accounts`);
  } catch (e) {
    console.warn("[ahlan-bg] seed failed:", e);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create("safety-poll", { periodInMinutes: 5 });
  await chrome.storage.local.set({ installedAt: Date.now() });
  await seedDefaultAccountsIfEmpty();
  await logActivity({ status: "installed", msg: "extension installed (v1.1.1)" });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("safety-poll", { periodInMinutes: 5 });
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "safety-poll") await runFallbackPoll();
});
