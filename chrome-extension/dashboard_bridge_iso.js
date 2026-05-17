/**
 * dashboard_bridge_iso.js — isolated-world content script on dashboard pages.
 * Listens for window.postMessage events from the main-world bridge and
 * forwards them to the background service worker.
 */
window.addEventListener("message", (e) => {
  if (e.source !== window) return;
  const d = e.data;
  if (!d || d.source !== "ahlan-dashboard") return;
  if (d.type === "order_enqueued") {
    try {
      chrome.runtime.sendMessage({ type: "order_enqueued", orderId: d.orderId });
    } catch (err) { /* extension context invalidated */ }
  }
});
