const SETTINGS_KEYS = ["dashboardUrl", "workerToken", "workerId", "enabled", "autoLogin"];
const MAX_ACCOUNTS = 10;

async function load() {
  const s = await chrome.storage.local.get([...SETTINGS_KEYS, "ahlan_accounts"]);
  document.getElementById("dashboardUrl").value = s.dashboardUrl || "https://ahlanweb.vercel.app";
  document.getElementById("workerToken").value = s.workerToken || "";
  document.getElementById("workerId").value = s.workerId || "chrome-ext";
  document.getElementById("enabled").checked = s.enabled !== false;
  document.getElementById("autoLogin").checked = s.autoLogin !== false; // default ON
  renderCreds(s.ahlan_accounts || []);
}

function renderCreds(accounts) {
  // Pad to MAX_ACCOUNTS rows
  while (accounts.length < MAX_ACCOUNTS) accounts.push({ email: "", password: "" });
  if (accounts.length > MAX_ACCOUNTS) accounts.length = MAX_ACCOUNTS;

  const tbody = document.getElementById("credsBody");
  tbody.innerHTML = "";
  let avail = 0, used = 0, fail = 0;

  accounts.forEach((acc, i) => {
    const tr = document.createElement("tr");
    let statusHtml = `<span class="status-badge status-avail">Available</span>`;
    if (!acc.email && !acc.password) statusHtml = `<span class="status-badge status-used" style="opacity:0.4">Empty slot</span>`;
    else if (acc.used_at) {
      const when = new Date(acc.used_at).toLocaleString();
      statusHtml = `<span class="status-badge status-used" title="${when}${acc.used_for?.length ? ` · order(s) ${acc.used_for.join(", ")}` : ""}">Used</span>`;
      used++;
    } else if (acc.failed_at) {
      statusHtml = `<span class="status-badge status-fail" title="${acc.failed_reason || ""}">Failed</span>`;
      fail++;
    } else if (acc.email) {
      avail++;
    }
    tr.innerHTML = `
      <td style="color:#64748b; width:24px;">${i + 1}</td>
      <td><input type="email" data-idx="${i}" data-field="email" value="${escapeHtml(acc.email || "")}" placeholder="email@example.com" style="width:100%;"></td>
      <td><input type="password" data-idx="${i}" data-field="password" value="${escapeHtml(acc.password || "")}" placeholder="password" style="width:100%;"></td>
      <td>${statusHtml}</td>
      <td><button class="small danger row-reset" data-idx="${i}" title="Reset just this account's status">↻</button></td>
    `;
    tbody.appendChild(tr);
  });

  const stats = document.getElementById("stats");
  const total = accounts.filter(a => a.email).length;
  stats.innerHTML = `<strong>${avail}</strong> available · <strong>${used}</strong> used · <strong>${fail}</strong> failed · ${total}/${MAX_ACCOUNTS} slots filled`;

  // Per-row reset
  tbody.querySelectorAll(".row-reset").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const fresh = collectAccounts();
      if (fresh[idx]) {
        delete fresh[idx].used_at;
        delete fresh[idx].used_for;
        delete fresh[idx].failed_at;
        delete fresh[idx].failed_reason;
      }
      await chrome.storage.local.set({ ahlan_accounts: fresh });
      renderCreds(fresh);
      showMsg("✓ Row reset");
    });
  });
}

function collectAccounts() {
  const inputs = document.querySelectorAll("#credsBody input");
  const out = Array.from({ length: MAX_ACCOUNTS }, () => ({ email: "", password: "" }));
  inputs.forEach(inp => {
    const i = parseInt(inp.dataset.idx, 10);
    out[i][inp.dataset.field] = inp.value.trim();
  });
  // Preserve status fields from current storage
  return out;
}

async function mergeWithExisting(fresh) {
  const { ahlan_accounts: existing = [] } = await chrome.storage.local.get("ahlan_accounts");
  return fresh.map((f, i) => {
    const old = existing[i];
    // If email changed → clear status
    if (!old || old.email !== f.email) return f;
    return { ...f, used_at: old.used_at, used_for: old.used_for, failed_at: old.failed_at, failed_reason: old.failed_reason };
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function showMsg(text) {
  const m = document.getElementById("msg");
  m.textContent = text;
  setTimeout(() => { m.textContent = ""; }, 3000);
}

// ─── Event handlers ───
document.getElementById("save").addEventListener("click", async () => {
  const data = {
    dashboardUrl: document.getElementById("dashboardUrl").value.trim().replace(/\/+$/, ""),
    workerToken:  document.getElementById("workerToken").value.trim(),
    workerId:     document.getElementById("workerId").value.trim() || "chrome-ext",
    enabled:      document.getElementById("enabled").checked,
    autoLogin:    document.getElementById("autoLogin").checked,
    ahlan_accounts: await mergeWithExisting(collectAccounts()),
  };
  await chrome.storage.local.set(data);
  renderCreds(data.ahlan_accounts);
  showMsg("✓ Saved.");
});

document.getElementById("addRow").addEventListener("click", () => {
  showMsg("All 10 rows are already shown — just fill in the empty ones.");
});

document.getElementById("bulkPaste").addEventListener("click", () => {
  const ta = document.getElementById("bulkArea");
  ta.style.display = ta.style.display === "none" ? "block" : "none";
  if (ta.style.display === "block") ta.focus();
});

document.getElementById("bulkArea").addEventListener("change", async () => {
  const lines = document.getElementById("bulkArea").value.split("\n")
    .map(l => l.trim()).filter(l => l && l.includes(":"));
  if (lines.length === 0) return;
  const parsed = lines.slice(0, MAX_ACCOUNTS).map(l => {
    const [email, ...pw] = l.split(":");
    return { email: email.trim(), password: pw.join(":").trim() };
  });
  // Fill empty slots first, then overwrite
  const existing = collectAccounts();
  let next = 0;
  for (let i = 0; i < MAX_ACCOUNTS && next < parsed.length; i++) {
    if (!existing[i].email) {
      existing[i] = parsed[next++];
    }
  }
  // If still leftover, overwrite from the start
  while (next < parsed.length) {
    if (next < MAX_ACCOUNTS) existing[next] = parsed[next];
    next++;
  }
  await chrome.storage.local.set({ ahlan_accounts: await mergeWithExisting(existing) });
  document.getElementById("bulkArea").value = "";
  document.getElementById("bulkArea").style.display = "none";
  load();
  showMsg(`✓ Added ${parsed.length} account(s).`);
});

document.getElementById("resetUsage").addEventListener("click", async () => {
  if (!confirm("Reset usage status for ALL accounts? They'll be marked Available again.")) return;
  const { ahlan_accounts = [] } = await chrome.storage.local.get("ahlan_accounts");
  const reset = ahlan_accounts.map(a => ({ email: a.email, password: a.password }));
  await chrome.storage.local.set({ ahlan_accounts: reset });
  load();
  showMsg("✓ All accounts marked Available.");
});

document.getElementById("clearAll").addEventListener("click", async () => {
  if (!confirm("Delete ALL stored accounts? This cannot be undone.")) return;
  await chrome.storage.local.set({ ahlan_accounts: [] });
  load();
  showMsg("✓ All accounts cleared.");
});

load();
