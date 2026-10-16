# Chatimall — Backend

Node + Express + MongoDB backend for Chatimall (API, realtime sockets, auth, voice-note translation pipeline).

The frontend + translate-service + shared docs live in the sibling repo: `chatimall` (or whatever you named the root-level repo).

## Local setup

```bash
npm install
cp .env.example .env          # copy .env.example if present; otherwise copy .env and edit
# Edit .env — fill in MONGODB_URI and JWT_SECRET at minimum
npm run dev                   # listens on http://localhost:4000
# API docs: http://localhost:4000/api/docs
```

Run tests:
```bash
npm test
```

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `PORT` | no (default 4000) | HTTP listen port |
| `MONGODB_URI` | **yes** | MongoDB or Atlas connection string |
| `JWT_SECRET` | **yes** | Signing secret for auth tokens — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `CLIENT_ORIGINS` | recommended | Comma-separated CORS origins (e.g. `http://localhost:5173,https://chatimall.vercel.app`) |
| `TRANSLATE_SERVICE_URL` | no (default `http://localhost:8787`) | Python translate-service for voice-note transcription/translation; leave unset to disable |
| `FCM_SERVICE_ACCOUNT` | no | Firebase push notifications (JSON string) |
| `SMS_WEBHOOK_URL` | no | Real SMS OTP provider; dev-mode falls back to echoing the OTP to the response |

## Deploy to Render (standalone backend repo)

Render recommends pinning Node versions with an **environment variable** — that overrides package.json engines and guarantees a stable runtime.

In the Render dashboard → `chatimall-backend` → Environment → add these:

| Variable | Value | Purpose |
|---|---|---|
| `NODE_VERSION` | `20` | **Always set this.** Tells Render to use Node.js 20 LTS (avoids picking bleeding-edge Node 22/26 which may crash on boot). |
| `MONGODB_URI` | `mongodb+srv://...` | MongoDB Atlas connection string (required) |
| `JWT_SECRET` | random 96-char hex | Auth signing secret — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `CLIENT_ORIGINS` | `https://chatimall-frontend-XXXX.vercel.app,https://*.vercel.app,http://localhost:5173` | CORS allowlist — set this to your live Vercel URL(s) or browser API calls fail |
| `TEST_PHONES` | e.g. `+2348012345678:123456` | Comma-separated `phone:code` pairs — bypass real SMS for your first login during testing |
| `DEV_OTP_ECHO` | `false` in production | Set `true` only for quick local smoke tests (returns the OTP in the HTTP response) |
| `TRANSLATE_SERVICE_URL` | optional | URL of the Python translate-service; voice notes work fine without it, just no translation |

Render service settings (already defaults for Node, but double-check):

| Setting | Value |
|---|---|
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

Save env vars → Render auto-triggers a fresh deploy. Wait for the deploy log to show these three lines:
```
MongoDB connected
Chatimall server listening on :10000   (Render sets PORT internally — the exact number varies)
Node.js version: v20.x.x
```

## Deploy (Render Blueprint via the meta repo)

The root `chatimall` repo (https://github.com/praisecyber/chatimall) contains `render.yaml` which already sets NODE_VERSION=20, the correct build/start commands, and the health check path. Use Blueprint if you want Render to prompt for all env vars on first setup.
