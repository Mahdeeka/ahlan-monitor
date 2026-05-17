const KEYS = ["dashboardUrl", "workerToken", "workerId", "enabled"];

(async () => {
  const s = await chrome.storage.local.get(KEYS);
  document.getElementById("dashboardUrl").value = s.dashboardUrl || "https://ahlanweb.vercel.app";
  document.getElementById("workerToken").value = s.workerToken || "";
  document.getElementById("workerId").value = s.workerId || "chrome-ext";
  document.getElementById("enabled").checked = s.enabled !== false;
})();

document.getElementById("save").addEventListener("click", async () => {
  const data = {
    dashboardUrl: document.getElementById("dashboardUrl").value.trim().replace(/\/+$/, ""),
    workerToken:  document.getElementById("workerToken").value.trim(),
    workerId:     document.getElementById("workerId").value.trim() || "chrome-ext",
    enabled:      document.getElementById("enabled").checked,
  };
  await chrome.storage.local.set(data);
  const m = document.getElementById("msg");
  m.textContent = "✓ Saved. Extension will use these settings on the next poll.";
  setTimeout(() => { m.textContent = ""; }, 3000);
});
