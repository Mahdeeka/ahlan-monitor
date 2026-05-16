"use client";

import Link from "next/link";
import { ArrowLeft, Terminal, Key, ShoppingCart, AlertTriangle, ExternalLink } from "lucide-react";

export default function SetupPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-slate-950/60 border-b border-white/5">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <Link href="/buy-queue" className="text-slate-400 hover:text-white"><ArrowLeft className="w-5 h-5" /></Link>
          <Terminal className="w-6 h-6 text-indigo-400" />
          <div>
            <div className="text-base sm:text-xl font-bold tracking-tight">Worker setup guide</div>
            <div className="text-[10px] sm:text-xs text-slate-400">Wire up your local bot to the dashboard buy queue</div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6 text-sm">

        <section className="glass rounded-2xl p-5 space-y-3">
          <h2 className="text-base font-bold flex items-center gap-2 text-emerald-300">
            <ShoppingCart className="w-4 h-4" />
            How it works
          </h2>
          <ol className="space-y-1.5 text-slate-300 list-decimal list-inside">
            <li>You click <code className="text-indigo-300 bg-slate-800/60 px-1 rounded">Buy</code> in a match's detail modal.</li>
            <li>Dashboard inserts an order into the queue (Postgres).</li>
            <li>Your local <code className="text-indigo-300 bg-slate-800/60 px-1 rounded">buy_worker.py</code> polls every 2s, claims the order, and calls your existing <code className="text-indigo-300 bg-slate-800/60 px-1 rounded">ahlan_multi_bot.py</code>.</li>
            <li>Bot reports outcome back; status appears live on the queue page.</li>
          </ol>
          <div className="text-xs text-slate-400 leading-relaxed border-l-2 border-emerald-500/30 pl-3 mt-2">
            Your ahlan.sa credentials never leave your machine. The dashboard
            only knows what slug + category + qty you asked for.
          </div>
        </section>

        <section className="glass rounded-2xl p-5 space-y-3">
          <h2 className="text-base font-bold flex items-center gap-2 text-yellow-300">
            <Key className="w-4 h-4" />
            Step 1 — Add the shared token
          </h2>
          <p className="text-slate-300">
            On Vercel (Project Settings → Environment Variables), add:
          </p>
          <pre className="bg-slate-900/60 border border-white/5 rounded-lg p-3 text-xs overflow-x-auto"><code>BUY_WORKER_TOKEN={"<a-long-random-string>"}</code></pre>
          <p className="text-slate-400 text-xs">
            Pick anything secret, e.g. <code className="bg-slate-800/60 px-1 rounded">openssl rand -hex 32</code> output.
            Then redeploy.
          </p>
        </section>

        <section className="glass rounded-2xl p-5 space-y-3">
          <h2 className="text-base font-bold flex items-center gap-2 text-indigo-300">
            <Terminal className="w-4 h-4" />
            Step 2 — Run the worker on your PC
          </h2>
          <p className="text-slate-300">
            Get the worker script from the repo (<code className="bg-slate-800/60 px-1 rounded">scripts/buy_worker.py</code>),
            then in PowerShell / Terminal:
          </p>
          <pre className="bg-slate-900/60 border border-white/5 rounded-lg p-3 text-xs overflow-x-auto"><code>{`# Windows PowerShell
$env:DASHBOARD_URL = "https://ahlanweb.vercel.app"
$env:BUY_WORKER_TOKEN = "the same long string"
$env:WORKER_ID = "$env:COMPUTERNAME"
python scripts/buy_worker.py

# macOS / Linux
export DASHBOARD_URL=https://ahlanweb.vercel.app
export BUY_WORKER_TOKEN=...
export WORKER_ID=$(hostname)
python scripts/buy_worker.py`}</code></pre>
          <p className="text-slate-400 text-xs">
            You should see <code className="bg-slate-800/60 px-1 rounded">🛒 buy_worker started</code> followed by polling logs.
          </p>
        </section>

        <section className="glass rounded-2xl p-5 space-y-3">
          <h2 className="text-base font-bold text-pink-300">Step 3 — Wire it to your bot</h2>
          <p className="text-slate-300">
            Open <code className="bg-slate-800/60 px-1 rounded">scripts/buy_worker.py</code> and edit the <code className="bg-slate-800/60 px-1 rounded">call_bot()</code> function:
          </p>
          <pre className="bg-slate-900/60 border border-white/5 rounded-lg p-3 text-xs overflow-x-auto"><code>{`def call_bot(slug, category, qty, max_price=None):
    # Replace this stub with a call into your ahlan_multi_bot
    from ahlan_multi_bot import purchase
    result = purchase(
        slug=slug, category=category, qty=qty,
        max_price_sar=max_price,
    )
    return {
        "status": result.ok and "success" or "failed",
        "receipt_url": result.receipt_url,
        "notes": result.message,
    }`}</code></pre>
          <p className="text-slate-400 text-xs">
            Your bot's <code className="bg-slate-800/60 px-1 rounded">purchase()</code> just needs to accept slug + category + qty and return outcome.
            Recognized status values: <code className="bg-slate-800/60 px-1 rounded">success</code>, <code className="bg-slate-800/60 px-1 rounded">failed</code>, <code className="bg-slate-800/60 px-1 rounded">sold_out</code>, <code className="bg-slate-800/60 px-1 rounded">auth_error</code>, <code className="bg-slate-800/60 px-1 rounded">skipped</code>.
          </p>
        </section>

        <section className="glass rounded-2xl p-5 space-y-3">
          <h2 className="text-base font-bold flex items-center gap-2 text-amber-300">
            <AlertTriangle className="w-4 h-4" />
            Safety best-practices
          </h2>
          <ul className="space-y-1.5 text-slate-300 list-disc list-inside text-xs">
            <li>Run the worker in the same OS user account as your saved browser session — easier auth.</li>
            <li>Always pass a <code className="bg-slate-800/60 px-1 rounded">max_price_sar</code> when you queue, so a price-tier swap can't blindside you.</li>
            <li>Cancel pending orders any time from the queue page (worker won't claim them).</li>
            <li>The worker re-claims stale orders (claimed but not completed in 2 min) — safe to crash & restart.</li>
            <li>If you want to disable buying entirely, remove the <code className="bg-slate-800/60 px-1 rounded">BUY_WORKER_TOKEN</code> env on Vercel and the queue refuses to be polled.</li>
            <li>This whole pipeline is for personal use against tickets you intend to use — automated bulk purchasing for resale likely violates ahlan.sa ToS and is your responsibility.</li>
          </ul>
        </section>

        <section className="glass rounded-2xl p-5 space-y-3">
          <h2 className="text-base font-bold text-cyan-300">Optional — Auto-buy on restock</h2>
          <p className="text-slate-300 text-xs leading-relaxed">
            Want the bot to fire WITHOUT you clicking? Coming next: create a rule like
            <em> &ldquo;If FINAL Premium restocks AND price &lt; SAR 250, auto-queue qty 2&rdquo;</em>.
            Tell me when you want this and I&apos;ll wire it up — table already exists
            (<code className="bg-slate-800/60 px-1 rounded">auto_buy_rules</code>).
          </p>
        </section>

        <Link href="/buy-queue" className="block text-center text-xs text-indigo-300 hover:text-indigo-200 underline pb-8">
          ← Back to buy queue
        </Link>
      </main>
    </div>
  );
}
