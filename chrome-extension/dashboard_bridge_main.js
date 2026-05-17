/**
 * dashboard_bridge_main.js — runs in the MAIN world of dashboard pages.
 * Exposes window.__ahlanExt so the React app can push events directly
 * to the extension (zero polling delay).
 */
(function () {
  if (window.__ahlanExt) return;
  window.__ahlanExt = {
    installed: true,
    sendBuyEnqueued(orderId) {
      window.postMessage(
        { source: "ahlan-dashboard", type: "order_enqueued", orderId },
        "*"
      );
    },
  };
  window.dispatchEvent(new CustomEvent("ahlan-ext-ready"));
})();
