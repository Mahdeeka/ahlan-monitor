# Zeina's Birthday Page — Railway deploy

A standalone, zero-dependency site. Deploy just this folder:

1. Go to [railway.com/new](https://railway.com/new) → **Deploy from GitHub repo** → pick `Mahdeeka/ahlan-monitor` (branch `claude/birthday-website-creative-kc5fvs`, or `main` after merging).
2. In the service **Settings → Source**, set **Root Directory** to `birthday`.
3. **Settings → Networking → Generate Domain** — that URL is the shareable link.

No environment variables, no database, no build step. To personalize the
message, edit the `.letter` section in `index.html` and push — Railway
redeploys automatically.
