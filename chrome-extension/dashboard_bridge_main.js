/**
 * dashboard_bridge_main.js — runs in the MAIN world of dashboard pages.
 * Exposes window.__ahlanExt so the React app can push events directly
 * to the extension (zero polling delay).
 */
(function () {
  if (window.__ahlanExt) return;
  window.__ahlanExt = {
    installed: true,
    version: "0.3.0",
    /** Open the ahlan.sa event tab IMMEDIATELY — call this on click, in
     *  parallel with the enqueue POST. The tab is "pre-armed" and starts
     *  loading ahlan.sa before the order even exists. */
    openTabFor(slug) {
      window.postMessage({ source: "ahlan-dashboard", type: "prearm_tab", slug, ts: Date.now() }, "*");
    },
    /** Tell the extension the order ID — content.js can now finish. */
    sendBuyEnqueued(orderId, slug) {
      window.postMessage({ source: "ahlan-dashboard", type: "order_enqueued", orderId, slug, ts: Date.now() }, "*");
    },
  };
  window.dispatchEvent(new CustomEvent("ahlan-ext-ready"));
})();
