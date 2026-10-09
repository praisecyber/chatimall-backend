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

## Deploy (Render Blueprint)

The root `chatimall` repo contains `render.yaml` you can use with Render Blueprint. For a standalone backend deploy, use this repo's `package.json` — the start command is `npm start` (runs `node src/index.js`).
