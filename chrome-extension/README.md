# Ahlan Auto-Buy — Chrome extension

Bridges the AFC ticket dashboard (`ahlanweb.vercel.app`) to your own
logged-in Chrome session on `ahlan.sa`. When you click **Buy** on the
dashboard, this extension:

1. Polls the dashboard's `/api/buy/queue` every minute.
2. When a pending order shows up, opens a new tab to the right ahlan.sa
   event page using your existing login.
3. Auto-clicks **Find Tickets** once (to obtain a queue-token).
4. **Calls ahlan.sa's checkout API directly** with the queue-token —
   no clicking through category, qty, or "add to cart" buttons.
5. Lands you on the PayTabs payment page with the cart pre-filled.
6. You enter Visa and submit. Done.

Result: ~3 seconds from dashboard click → PayTabs payment page open in
Chrome. Your credentials never leave your machine. The extension never
clicks Pay/Submit — that's your one tap.

---

## Install (Developer Mode)

1. **Open Chrome** → URL bar → `chrome://extensions`
2. Toggle **Developer mode** (top-right) ON.
3. Click **Load unpacked**.
4. Browse to `C:\Users\mahdi\OneDrive\Documents\ahlan_web\chrome-extension`
   and click **Select Folder**.
5. The extension icon (🛒 cart) appears next to the URL bar. Pin it.

## First-time setup

1. Click the extension icon → **Settings** (or `chrome://extensions` →
   Details → Extension options).
2. Paste your **Worker token** (same value as `BUY_WORKER_TOKEN` env on
   Vercel — copy from `C:\Users\mahdi\AppData\Local\Temp\buy_token.txt`
   if you used the auto-generated one).
3. Save.

## Make sure you're logged into ahlan.sa

Open https://www.ahlan.sa once and sign in. Your cookies persist;
the extension uses that session.

## Test it

1. **Dashboard** → open any match → click **Buy 1 · queue bot** on a
   category.
2. **Within 60 seconds** (next poll tick) the extension fires:
   - A new ahlan.sa tab opens.
   - Cart fills automatically.
   - Chrome notification: "Cart ready · go pay!"
3. **You** complete payment on the ahlan.sa tab manually.

For instant response (no 60s wait) — click the extension icon → **Poll
now** after queueing.

## Auto-buy on restock — not yet wired

The `auto_buy_rules` DB table exists; the extension just doesn't read it
yet. If you want a rule like "FINAL Premium restocks → auto-fire qty 2",
say so and I'll build the rule editor + trigger.

## Permissions explained

- `https://www.ahlan.sa/*` — to inject content.js (the auto-click logic)
- `https://ahlanweb.vercel.app/*` — to poll the queue
- `alarms` — for periodic polling
- `notifications` — to ping you when cart is ready
- `tabs`, `scripting`, `storage` — to open tabs & remember settings

The extension talks to ONLY those two domains. No analytics.
