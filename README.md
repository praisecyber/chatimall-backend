# Chatimall — Backend

Node + Express + MongoDB backend for Chatimall (API, realtime sockets, auth, voice-note translation pipeline).

The frontend source is included under `frontend/` for the combined Render deployment. The separate frontend repository remains useful for local development or a separate Vercel deployment.

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

## Deploy frontend and API together to Render

The frontend is built as part of this backend repository and served by Express from the same origin. The browser uses same-origin `/api` and Socket.IO requests.

In the Render dashboard for `chatimall-backend`, set the build and start commands:

| Setting | Value |
|---|---|
| Root Directory | blank (repository root) |
| Build Command | `npm install --no-audit --no-fund && npm --prefix frontend ci --no-audit --no-fund && npm run build:frontend` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

Keep the existing environment variables on the service. At minimum, `NODE_VERSION=20`, `MONGODB_URI`, and `JWT_SECRET` are required. Redeploy after saving the build command. The deploy log should show the frontend Vite build succeeding before the server starts.

Wait for the deploy log to show:
```
vite v... building for production...
✓ built in ...
MongoDB connected
Chatimall server listening on :10000   (Render sets PORT internally — the exact number varies)
Node.js version: v20.x.x
```
The service root serves the Chatimall UI; `/api/health` remains the backend health check.

## Deploy (Render Blueprint via the meta repo)

The root `chatimall` repository is an architecture/docs repository. For the combined frontend and API service, connect Render to `chatimall-backend` and use the commands above.
