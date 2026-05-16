# 🎫 AFC Asian Cup 2027 — Live Ticket Monitor (Persistent History)

Beautiful Next.js dashboard that monitors ticket availability for **all 51 matches** of the AFC Asian Cup Saudi Arabia 2027. Backed by **Vercel Postgres** for full historical data + **Vercel Cron** for server-side polling every minute.

## ✨ Features

- 🔴 **Server-side polling** every 1 minute via Vercel Cron (works even when no one's viewing)
- 💾 **Full historical data** in Postgres — every change preserved forever (with optional 90-day cleanup)
- 📉 **Trend charts** with 24h / 7d / 30d / all time ranges
- ⚡ **Live deltas** — server detects every change (tickets sold, added, back in stock, status flip)
- 🔔 **Browser notifications** when subscribed matches change
- 🎴 Beautiful glassmorphism UI · responsive · dark theme
- 🔍 Search · filter by stage/status · sort by date/availability/% sold
- 📱 Mobile-friendly

## 🚀 Deploy to Vercel (5 minutes, fully automated)

### Step 1 — Install Vercel CLI

```powershell
npm install -g vercel
```

### Step 2 — Deploy + create Postgres + link

```powershell
cd C:\Users\mahdi\OneDrive\Documents\ahlan_web

# Login (opens browser)
vercel login

# Deploy to Vercel — first time will prompt to create/link project
vercel

# Create a Postgres database on Vercel Pro (uses Neon under the hood)
vercel postgres create afc-monitor-db

# Link it to your project (sets all POSTGRES_* env vars automatically)
vercel link  # if not already linked
vercel env pull .env.development.local  # for local dev

# Deploy to production
vercel --prod
```

You'll get a URL like `https://ahlan-monitor.vercel.app`. **Open it.** Cron starts polling every minute automatically.

### Step 3 — Initialize the database schema

Just visit once:
```
https://your-app.vercel.app/api/init
```
Returns `{"ok":true,"message":"Schema initialized"}`. From now on, the cron writes to Postgres every minute.

(The schema also auto-initializes on first cron run, so this is optional.)

### Step 4 (optional) — Add a CRON_SECRET

Generate one and add as env var to prevent random visitors from triggering the cron:
```powershell
vercel env add CRON_SECRET production
# Paste a long random string when prompted
vercel --prod
```

Vercel Cron automatically sends `Authorization: Bearer $CRON_SECRET`. Random visitors will get 401.

---

## 🗄️ Database schema

`/api/init` creates these tables:

| Table | Purpose |
|-------|---------|
| `events_latest` | Latest snapshot per event (upserted every poll) |
| `snapshots` | Time-series — one row per event per change (history forever) |
| `changes` | Detected events: back_in_stock, tickets_added, sold_out, etc. |
| `subscriptions` | Per-device notification prefs (future) |

The cron handler only inserts a `snapshots` row when something *actually changed*, so storage stays small (~50 KB/day for the whole tournament if traffic is normal).

## 🏗 Architecture

```
                            ┌────────────────────────────────┐
       Vercel Cron ─────────│  /api/cron/poll  (every 1 min) │
                            └────────────────┬───────────────┘
                                             │ fetch 51 events from ahlan.sa
                                             │ detect changes vs last snapshot
                                             │ INSERT into snapshots + changes
                                             ▼
                            ┌────────────────────────────────┐
                            │   Vercel Postgres (Neon)       │
                            │   events_latest                │
                            │   snapshots (full history)     │
                            │   changes                      │
                            └────────────────┬───────────────┘
                                             │
   Browser ─── /api/events ──────────────────┤  latest snapshot
   Browser ─── /api/history/[slug] ─────────┤  full time-series
   Browser ─── /api/changes ─────────────────┘  recent changes
```

## 📁 Project layout

```
ahlan_web/
├── app/
│   ├── api/
│   │   ├── cron/
│   │   │   ├── poll/route.ts        # cron handler, polls + writes DB
│   │   │   └── cleanup/route.ts     # daily 3am cleanup (prunes >90d)
│   │   ├── events/route.ts          # current snapshot (from DB)
│   │   ├── event/[slug]/route.ts    # one event detail (live from ahlan.sa)
│   │   ├── history/[slug]/route.ts  # full time-series for an event
│   │   ├── changes/route.ts         # recent change log
│   │   └── init/route.ts            # one-time schema initializer
│   ├── globals.css                  # Tailwind + custom theme
│   ├── layout.tsx
│   ├── page.tsx                     # main dashboard
│   └── favicon.ico
├── components/
│   ├── EventCard.tsx                # match card with categories + progress
│   ├── DetailModal.tsx              # trend chart (1d/7d/30d/all) + category table
│   ├── SubsPanel.tsx                # slide-out subscriptions panel
│   └── StatCard.tsx                 # hero stat tiles
├── lib/
│   ├── slugs.ts                     # all 51 match slugs
│   ├── normalize.ts                 # API response → typed Event
│   ├── db.ts                        # Postgres client + queries
│   └── types.ts                     # TypeScript types
├── public/icon.svg
├── package.json
├── next.config.mjs
├── tailwind.config.ts
├── tsconfig.json
├── vercel.json                      # cron config
└── README.md
```

## 🛠 Local development

```powershell
cd C:\Users\mahdi\OneDrive\Documents\ahlan_web
npm install
vercel env pull .env.development.local   # only needed if using DB locally
npm run dev                              # http://localhost:3000
```

Without `vercel env pull`, the app falls back to live-fetching ahlan.sa per request.

## 💰 Cost on Vercel Pro ($20/mo)

| Resource | Usage | Limit | Cost |
|----------|-------|-------|------|
| Function invocations | ~43,200 cron runs/month + user requests | 1M included on Pro | included |
| Bandwidth | < 1 GB / 10 users / month | 1 TB on Pro | included |
| Postgres storage | ~5 MB/month at typical change rate | 256 MB Hobby included | included |
| Cron jobs | 2 (poll every 1m, cleanup daily) | unlimited on Pro | included |

**Effective cost: $0 above your $20/mo Pro plan.**

## 🔔 Notifications

1. Click the **bell icon** in the header → grant browser permission
2. On any match card, click **🔕 Notify me** to subscribe
3. Open the **Subs panel** to set default triggers
4. Browser pops a notification when anything changes on subscribed matches

> Subscriptions are per-device (localStorage). The tab must be open (background is fine).

## 📡 API endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/events` | Latest snapshot of all 51 events + summary + recent changes |
| `GET /api/history/[slug]?limit=2000` | Time-series for one event |
| `GET /api/changes?limit=100` | Recent detected changes |
| `GET /api/cron/poll` | Cron trigger (rate-limited via CRON_SECRET) |
| `GET /api/cron/cleanup` | Delete snapshots > 90 days |
| `GET /api/init` | Initialize DB schema (idempotent) |

## 🎨 Customization

- **Polling frequency**: edit `vercel.json` cron schedule
- **History retention**: edit `pruneOldSnapshots(90)` in `lib/db.ts`
- **Region**: change `"regions": ["fra1"]` in `vercel.json` (closer to ahlan.sa = faster)

## 🧰 Tech stack

- Next.js 14 (App Router) + TypeScript
- @vercel/postgres (Neon)
- Vercel Cron
- Tailwind CSS + Framer Motion + Recharts + Lucide
- 100% serverless

## 📜 Notes

- Not affiliated with AFC or ahlan.sa
- Data comes from ahlan.sa's public `eventDetail` API
- All historical snapshots are stored — see trends from day 1 of monitoring

## ❤️ License

MIT
