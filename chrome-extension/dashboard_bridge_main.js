/**
 * dashboard_bridge_main.js — runs in MAIN world on dashboard pages.
 *
 * Exposes window.__ahlanExt so the React app can ask the extension to
 * open a Buy tab. We pass the order details directly via the call —
 * no polling, no IPC race conditions.
 */
(function () {
  if (window.__ahlanExt) return;
  window.__ahlanExt = {
    installed: true,
    version: "1.0.0",
    /**
     * Open an ahlan.sa tab with the order encoded in the URL hash.
     * The extension's content.js reads it from there. No race condition,
     * no message passing, no storage timing.
     */
    openOrder(order) {
      const payload = btoa(unescape(encodeURIComponent(JSON.stringify(order))));
      const url = `https://www.ahlan.sa/events/details?event=${encodeURIComponent(order.slug)}#__ahlan_buy=${payload}`;
      window.postMessage({ source: "ahlan-dashboard", type: "open_order", url, order }, "*");
    },
    /** Legacy method names — kept for old dashboard versions */
    openTabFor(slug) {
      const url = `https://www.ahlan.sa/events/details?event=${encodeURIComponent(slug)}`;
      window.postMessage({ source: "ahlan-dashboard", type: "open_url", url }, "*");
    },
    sendBuyEnqueued() { /* deprecated — openOrder above carries order itself */ },
  };
  window.dispatchEvent(new CustomEvent("ahlan-ext-ready"));
})();
