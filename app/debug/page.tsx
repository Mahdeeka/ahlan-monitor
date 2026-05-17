"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

type Probe = {
  has_window_ahlanExt: boolean;
  ext_installed: any;
  ext_version: any;
  has_openTabFor: boolean;
  has_sendBuyEnqueued: boolean;
  user_agent: string;
  is_edge: boolean;
  is_chrome: boolean;
  url: string;
  origin: string;
  cookies_count: number;
  enqueue_status?: string;
  push_attempted?: boolean;
  push_received?: boolean;
};

export default function DebugPage() {
  const [p, setP] = useState<Probe | null>(null);
  const [eventsApi, setEventsApi] = useState<string>("…");
  const [pushTrace, setPushTrace] = useState<string>("not tried");

  useEffect(() => {
    const w = window as any;
    const probe: Probe = {
      has_window_ahlanExt: !!w.__ahlanExt,
      ext_installed: w.__ahlanExt?.installed ?? null,
      ext_version: w.__ahlanExt?.version ?? null,
      has_openTabFor: typeof w.__ahlanExt?.openTabFor === "function",
      has_sendBuyEnqueued: typeof w.__ahlanExt?.sendBuyEnqueued === "function",
      user_agent: navigator.userAgent,
      is_edge: navigator.userAgent.includes("Edg/"),
      is_chrome: navigator.userAgent.includes("Chrome/") && !navigator.userAgent.includes("Edg/"),
      url: location.href,
      origin: location.origin,
      cookies_count: document.cookie.split("; ").filter(Boolean).length,
    };
    setP(probe);
    fetch("/api/events?nocache=1").then(r => setEventsApi(`HTTP ${r.status} ✓`)).catch(e => setEventsApi(`FAIL ${e.message}`));

    // Listen for the bridge to see if it appears LATE
    function check() {
      if ((window as any).__ahlanExt && !probe.has_window_ahlanExt) {
        probe.has_window_ahlanExt = true;
        probe.ext_version = (window as any).__ahlanExt.version;
        setP({ ...probe });
      }
    }
    window.addEventListener("ahlan-ext-ready", check);
    const t = setTimeout(check, 1000);
    const t2 = setTimeout(check, 3000);
    return () => { window.removeEventListener("ahlan-ext-ready", check); clearTimeout(t); clearTimeout(t2); };
  }, []);

  async function testPush() {
    setPushTrace("trying…");
    const w = window as any;
    if (!w.__ahlanExt) { setPushTrace("FAIL: window.__ahlanExt is undefined"); return; }
    if (typeof w.__ahlanExt.openTabFor !== "function") { setPushTrace("FAIL: openTabFor missing"); return; }

    // Listen for window.postMessage to verify the bridge is forwarding
    let postMsgFired = false;
    const handler = (e: MessageEvent) => {
      if (e.data?.source === "ahlan-dashboard") postMsgFired = true;
    };
    window.addEventListener("message", handler);
    try {
      w.__ahlanExt.openTabFor("afc-cup-27-irn-vs-chn-6");
      await new Promise(r => setTimeout(r, 200));
      setPushTrace(postMsgFired
        ? "✓ openTabFor fired, postMessage received → check Edge for a new ahlan.sa tab"
        : "openTabFor called but no postMessage in 200ms (might still work, bridge could be MAIN-world only)");
    } finally {
      window.removeEventListener("message", handler);
    }
  }

  async function testEnqueue() {
    setPushTrace("enqueueing test order…");
    try {
      const r = await fetch("/api/buy/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: "afc-cup-27-irn-vs-chn-6",
          title: "DEBUG TEST — Iran vs China",
          category: "CAT 2",
          qty: 1,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setPushTrace(`enqueue FAILED: ${d.error || r.status}`); return; }
      // Fire the bridge push
      const w = window as any;
      if (w.__ahlanExt?.sendBuyEnqueued) {
        w.__ahlanExt.sendBuyEnqueued(d.id, "afc-cup-27-irn-vs-chn-6");
        setPushTrace(`✓ Order #${d.id} queued + push fired. Watch for a new ahlan.sa tab to open. Cancel via /buy-queue if you don't want it to actually fire.`);
      } else {
        setPushTrace(`Order #${d.id} queued in DB, but bridge not loaded — extension polling alarm will pick it up in <30s. Cancel via /buy-queue.`);
      }
    } catch (e: any) {
      setPushTrace(`FAIL: ${e.message}`);
    }
  }

  if (!p) return <div className="p-8">Probing…</div>;

  const ok = (b: boolean) => b
    ? <CheckCircle2 className="inline w-4 h-4 text-emerald-400" />
    : <XCircle className="inline w-4 h-4 text-red-400" />;

  return (
    <div className="min-h-screen p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-slate-400 hover:text-white"><ArrowLeft className="w-5 h-5" /></Link>
        <h1 className="text-xl font-bold">🔬 Extension diagnostic</h1>
      </div>

      <section className="glass rounded-2xl p-5 mb-4 space-y-2 text-sm">
        <h2 className="text-base font-semibold mb-2 text-indigo-300">Browser & page</h2>
        <Row k="Browser is Edge"        v={p.is_edge}    />
        <Row k="Browser is Chrome"      v={p.is_chrome}  />
        <Row k="User agent"             vText={p.user_agent.slice(0, 100)} />
        <Row k="URL"                    vText={p.url}    />
        <Row k="Cookies count"          vText={String(p.cookies_count)} />
        <Row k="Dashboard /api/events"  vText={eventsApi} />
      </section>

      <section className="glass rounded-2xl p-5 mb-4 space-y-2 text-sm">
        <h2 className="text-base font-semibold mb-2 text-pink-300">Extension bridge</h2>
        <Row k="window.__ahlanExt exists"   v={p.has_window_ahlanExt} />
        <Row k="ext.installed flag"          vText={JSON.stringify(p.ext_installed)} />
        <Row k="ext.version"                 vText={String(p.ext_version)} />
        <Row k="openTabFor() function"       v={p.has_openTabFor} />
        <Row k="sendBuyEnqueued() function"  v={p.has_sendBuyEnqueued} />
        {!p.has_window_ahlanExt && (
          <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded p-3 text-xs text-red-200">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold mb-1">Bridge NOT loaded.</div>
                <div className="space-y-1">
                  <div>1. Open <code className="bg-slate-800/60 px-1 rounded">edge://extensions</code></div>
                  <div>2. Find <strong>Ahlan Auto-Buy</strong>. Is it there?</div>
                  <div>3. Is it <strong>enabled</strong> (toggle on)?</div>
                  <div>4. What version does it show? Expected: <strong>0.3.0</strong></div>
                  <div>5. Click the 🔄 <strong>reload</strong> icon on the card</div>
                  <div>6. Hard-refresh THIS page (Ctrl+Shift+R)</div>
                </div>
              </div>
            </div>
          </div>
        )}
        {p.has_window_ahlanExt && p.ext_version !== "0.3.0" && (
          <div className="mt-3 bg-yellow-500/10 border border-yellow-500/30 rounded p-3 text-xs text-yellow-200">
            ⚠ Bridge loaded but old version ({p.ext_version}). Reload the extension in <code>edge://extensions</code>.
          </div>
        )}
      </section>

      <section className="glass rounded-2xl p-5 mb-4 space-y-2 text-sm">
        <h2 className="text-base font-semibold mb-2 text-emerald-300">Live tests</h2>
        <div className="flex gap-2">
          <button onClick={testPush}
            className="px-3 py-2 bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 rounded text-xs hover:bg-indigo-500/30">
            Test openTabFor (no order created)
          </button>
          <button onClick={testEnqueue}
            className="px-3 py-2 bg-pink-500/20 border border-pink-500/40 text-pink-200 rounded text-xs hover:bg-pink-500/30">
            Enqueue real test order + push
          </button>
        </div>
        <div className="mt-2 text-xs text-slate-300 bg-slate-800/40 rounded p-3 font-mono break-words">
          {pushTrace}
        </div>
      </section>

      <div className="text-xs text-slate-500 mt-6">
        Screenshot this page and paste it back so I can see exactly what's wrong.
      </div>
    </div>
  );
}

function Row({ k, v, vText }: { k: string; v?: boolean; vText?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 pb-1.5">
      <span className="text-slate-400">{k}</span>
      <span className="font-mono text-xs">
        {v !== undefined ? (v
          ? <CheckCircle2 className="inline w-4 h-4 text-emerald-400" />
          : <XCircle className="inline w-4 h-4 text-red-400" />)
          : <span className="text-slate-200">{vText || "—"}</span>}
      </span>
    </div>
  );
}
