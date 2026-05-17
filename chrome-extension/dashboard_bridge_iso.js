/**
 * Isolated-world bridge content script: forwards messages from the page
 * MAIN world (where window.__ahlanExt lives) to the extension's background
 * service worker.
 */
window.addEventListener("message", (e) => {
  if (e.source !== window) return;
  const d = e.data;
  if (!d || d.source !== "ahlan-dashboard") return;
  try {
    if (d.type === "open_order") {
      chrome.runtime.sendMessage({ type: "open_order", url: d.url, order: d.order });
    } else if (d.type === "open_url") {
      chrome.runtime.sendMessage({ type: "open_url", url: d.url });
    }
  } catch (err) { /* extension context invalidated */ }
});
