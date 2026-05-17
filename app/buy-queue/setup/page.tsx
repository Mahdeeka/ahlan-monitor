"use client";

import Link from "next/link";
import { ArrowLeft, Terminal, ShoppingCart, AlertTriangle, CheckCircle2, PlayCircle } from "lucide-react";

export default function SetupPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-slate-950/60 border-b border-white/5">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <Link href="/buy-queue" className="text-slate-400 hover:text-white"><ArrowLeft className="w-5 h-5" /></Link>
          <Terminal className="w-6 h-6 text-indigo-400" />
          <div>
            <div className="text-base sm:text-xl font-bold tracking-tight">Worker setup guide</div>
            <div className="text-[10px] sm:text-xs text-slate-400">2-minute setup — wires dashboard clicks to your ahlan_bot</div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6 text-sm">

        <section className="glass rounded-2xl p-5 space-y-3">
          <h2 className="text-base font-bold flex items-center gap-2 text-emerald-300">
            <ShoppingCart className="w-4 h-4" />
            What happens when you click Buy
          </h2>
          <ol className="space-y-1.5 text-slate-300 list-decimal list-inside">
            <li>Dashboard inserts a row into the buy queue (Postgres).</li>
            <li>Worker on your PC polls every 2s, claims the order.</li>
            <li>Worker subprocesses <code className="text-indigo-300 bg-slate-800/60 px-1 rounded">ahlan_bot/ahlan_bot_invoke.py &lt;slug&gt;</code>.</li>
            <li>Your bot opens a Chrome window, picks the best available category,
                logs in with a fresh empty account, adds max tickets to cart,
                <strong> parks at the payment page</strong>.</li>
            <li>You confirm the Visa payment manually (1 click).</li>
          </ol>
          <div className="text-xs text-slate-400 leading-relaxed border-l-2 border-emerald-500/30 pl-3 mt-2">
            Your ahlan.sa creds never leave your machine. The dashboard only sees
            the order metadata (slug + category + qty). Payment is always human.
          </div>
        </section>

        <section className="glass rounded-2xl p-5 space-y-3">
          <h2 className="text-base font-bold flex items-center gap-2 text-yellow-300">
            <CheckCircle2 className="w-4 h-4" />
            What's already done
          </h2>
          <ul className="space-y-1.5 text-slate-300 list-disc list-inside text-sm">
            <li><code className="bg-slate-800/60 px-1 rounded">ahlan_bot/ahlan_bot_invoke.py</code> — one-shot wrapper that calls your existing bot's <code className="bg-slate-800/60 px-1 rounded">run_one_session()</code>.</li>
            <li><code className="bg-slate-800/60 px-1 rounded">ahlan_bot/start_worker.bat</code> — double-click launcher with all env vars set.</li>
            <li><code className="bg-slate-800/60 px-1 rounded">ahlan_bot/start_worker_dry.bat</code> — same, but with DRY_RUN=1 (logs only, no real bot launch).</li>
            <li><code className="bg-slate-800/60 px-1 rounded">BUY_WORKER_TOKEN</code> stored on Vercel + baked into the .bat files.</li>
            <li><code className="bg-slate-800/60 px-1 rounded">/api/buy/*</code> endpoints live on the dashboard.</li>
          </ul>
        </section>

        <section className="glass rounded-2xl p-5 space-y-3 border border-pink-500/30">
          <h2 className="text-base font-bold flex items-center gap-2 text-pink-300">
            🌐 Alternative: use the Chrome extension (recommended)
          </h2>
          <p className="text-slate-300 text-xs leading-relaxed">
            Skip the Python bot entirely. The Chrome extension polls the queue,
            opens ahlan.sa in your already-logged-in browser, auto-fills the
            cart, and stops at payment for you to confirm. Faster, no install
            beyond Chrome.
          </p>
          <ol className="text-xs space-y-1 text-slate-400 list-decimal list-inside">
            <li>Open Chrome → <code className="bg-slate-800/60 px-1 rounded">chrome://extensions</code></li>
            <li>Toggle <strong>Developer mode</strong> (top-right)</li>
            <li>Click <strong>Load unpacked</strong> → select{" "}
              <code className="bg-slate-800/60 px-1 rounded">C:\Users\mahdi\OneDrive\Documents\ahlan_web\chrome-extension</code></li>
            <li>Click the 🛒 icon → Settings → paste your worker token → Save</li>
            <li>Make sure you're logged into ahlan.sa once in this browser</li>
            <li>Click <strong>Buy</strong> in the dashboard. The extension takes care of the rest.</li>
          </ol>
          <div className="text-[11px] text-slate-500 mt-2">
            Cart will park at the payment page; you confirm Visa manually. Chrome
            notification fires when ready.
          </div>
        </section>

        <section className="glass rounded-2xl p-5 space-y-3 border border-emerald-500/20">
          <h2 className="text-base font-bold flex items-center gap-2 text-emerald-300">
            <PlayCircle className="w-4 h-4" />
            Alternative: how to start the local Python worker
          </h2>
          <div className="text-slate-300 space-y-2">
            <div>
              <div className="text-xs text-slate-400 mb-1">First time — test with no real buys</div>
              <pre className="bg-slate-900/60 border border-white/5 rounded-lg p-3 text-xs overflow-x-auto"><code>Double-click  C:\Users\mahdi\OneDrive\Documents\ahlan_bot\start_worker_dry.bat</code></pre>
              <div className="text-[11px] text-slate-500 mt-1">
                In the dashboard, open any match → Buy → check{" "}
                <Link href="/buy-queue" className="underline text-indigo-300">/buy-queue</Link> for "skipped (DRY_RUN=1)".
              </div>
            </div>
            <div className="pt-2">
              <div className="text-xs text-slate-400 mb-1">Real mode — actually launch ahlan_bot</div>
              <pre className="bg-slate-900/60 border border-white/5 rounded-lg p-3 text-xs overflow-x-auto"><code>Double-click  C:\Users\mahdi\OneDrive\Documents\ahlan_bot\start_worker.bat</code></pre>
              <div className="text-[11px] text-slate-500 mt-1">
                The console will log activity. When you click Buy in the dashboard, a Chrome
                window pops up with the bot doing its thing.
              </div>
            </div>
          </div>
        </section>

        <section className="glass rounded-2xl p-5 space-y-3 border border-amber-500/30">
          <h2 className="text-base font-bold flex items-center gap-2 text-amber-300">
            <AlertTriangle className="w-4 h-4" />
            Important behavior to know
          </h2>
          <ul className="space-y-2 text-slate-300 list-disc list-inside text-xs leading-relaxed">
            <li><strong>One click = one full max-qty cart.</strong> Your bot maxes out
              <code className="bg-slate-800/60 px-1 rounded">max_per_order</code> on the best
              available category. The dashboard's qty field controls how many <em>accounts</em> to use:
              qty 1-4 = 1 account, qty 5-8 = 2 accounts, etc. (configurable via
              <code className="bg-slate-800/60 px-1 rounded">ACCOUNTS_PER_QTY</code> env var).</li>
            <li><strong>Category preference is honored.</strong> If you click Buy on "CAT 2"
              specifically, the bot is restricted to CAT 2 (won't sneak you a Premium).
              If you don't specify, default priority is Premium → CAT 1 → CAT 2.</li>
            <li><strong>Browsers stay open for 20 min</strong> after the bot finishes parking
              tickets in the cart, giving you time to pay. After that they auto-close.</li>
            <li><strong>Empty-account pool matters.</strong> The bot uses an account only if it
              has no existing tickets. Make sure <code className="bg-slate-800/60 px-1 rounded">ahlan_accounts.txt</code>
              has more accounts than the qty you're buying — otherwise you'll see
              "no_empty_accounts" failures in the queue.</li>
            <li><strong>Multiple clicks queue up.</strong> If you click Buy 3 times in a row,
              the worker handles them one at a time. The order page shows their status live.</li>
            <li><strong>Auto-buy on restock</strong> isn't enabled yet — the
              <code className="bg-slate-800/60 px-1 rounded">auto_buy_rules</code> table exists
              but no rules will fire until I build the rule UI. Say the word when you want it.</li>
          </ul>
        </section>

        <section className="glass rounded-2xl p-5 space-y-3">
          <h2 className="text-base font-bold text-cyan-300">Run unattended (optional)</h2>
          <p className="text-slate-300 text-xs leading-relaxed">
            To keep the worker running 24/7 even when you're not logged in:
          </p>
          <ol className="text-xs space-y-1 text-slate-400 list-decimal list-inside">
            <li>Open <code className="bg-slate-800/60 px-1 rounded">taskschd.msc</code></li>
            <li>Create Basic Task → "ahlan worker" → Trigger: At log on → Action: Start a program → Browse to start_worker.bat</li>
            <li>Properties → Conditions: uncheck "Start only if on AC power" → Settings: check "If the task fails, restart every 1 minute"</li>
            <li>Right-click → Run. It now survives reboots.</li>
          </ol>
        </section>

        <Link href="/buy-queue" className="block text-center text-xs text-indigo-300 hover:text-indigo-200 underline pb-8">
          ← Back to buy queue
        </Link>
      </main>
    </div>
  );
}
