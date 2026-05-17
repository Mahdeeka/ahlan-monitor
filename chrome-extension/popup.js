async function refresh() {
  const s = await chrome.storage.local.get([
    "enabled", "dashboardUrl", "workerToken", "lastPollOk", "lastError", "activity", "lastTiming",
  ]);
  const enabled = s.enabled !== false;
  document.getElementById("enabled").checked = enabled;

  const status = document.getElementById("status");
  if (!s.workerToken) {
    status.className = "status err";
    status.textContent = "⚠ Token not set — open Settings";
  } else if (s.lastError) {
    status.className = "status err";
    status.textContent = "⚠ " + s.lastError;
  } else if (s.lastPollOk) {
    const ago = Math.floor((Date.now() - s.lastPollOk) / 1000);
    status.className = "status ok";
    status.textContent = `✓ Last poll OK ${ago}s ago${enabled ? "" : " · DISABLED"}`;
  } else {
    status.className = "status warn";
    status.textContent = enabled ? "Waiting for first poll…" : "Polling disabled";
  }

  // Timing breakdown of the most recent order
  const tDiv = document.getElementById("timing");
  if (s.lastTiming && s.lastTiming.tStart) {
    const t = s.lastTiming;
    const seg = (label, from, to) => {
      const f = t[from], tt = t[to];
      if (!f || !tt) return "";
      return `<div class="row"><span>${label}</span><span class="time">${tt - f}ms</span></div>`;
    };
    tDiv.innerHTML = `
      <div style="font-size:10px; color:#94a3b8; margin: 8px 0 4px;">
        ⏱ Last order #${t.id || "?"} timing
      </div>
      ${seg("push → tab open",       "tStart",        "tTab")}
      ${seg("├ claim API",           "tStart",        "tClaim")}
      ${seg("├ tab create",          "tClaim",        "tTab")}
      ${seg("tab open → content fire","tTab",          "tContentStart")}
      ${seg("Find Tickets click",    "tContentStart", "tFindClick")}
      ${seg("queue-token wait",      "tFindClick",    "tQueueToken")}
      ${seg("eventDetail fetch",     "tContentStart", "tEventDetail")}
      ${seg("nonSeatedCheckout API", "tCheckoutStart","tCheckoutDone")}
      ${seg("──── total ────",       "tStart",        "tPayUrl")}
    `;
  } else {
    tDiv.innerHTML = "";
  }

  const list = s.activity || [];
  const html = list.slice(0, 15).map(a => {
    const ago = Math.floor((Date.now() - a.ts) / 1000);
    const t = ago < 60 ? `${ago}s` : ago < 3600 ? `${Math.floor(ago/60)}m` : `${Math.floor(ago/3600)}h`;
    const tag = a.id ? `#${a.id} ` : "";
    return `<div class="row"><span>${tag}<b>${a.status||"?"}</b> ${a.msg||""}</span><span class="time">${t}</span></div>`;
  }).join("");
  document.getElementById("activity").innerHTML = html || "<div style='color:#64748b; padding:8px 0;'>No activity yet.</div>";
}

document.getElementById("enabled").addEventListener("change", async (e) => {
  await chrome.storage.local.set({ enabled: e.target.checked });
  refresh();
});
document.getElementById("pollNow").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "poll_now" });
  setTimeout(refresh, 600);
});
document.getElementById("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.getElementById("openDashboard").addEventListener("click", async () => {
  const { dashboardUrl } = await chrome.storage.local.get(["dashboardUrl"]);
  chrome.tabs.create({ url: (dashboardUrl || "https://ahlanweb.vercel.app") + "/buy-queue" });
});

refresh();
setInterval(refresh, 2000);
