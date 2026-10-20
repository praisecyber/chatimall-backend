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
| `SMS_PROVIDER` | no (default `webhook`) | `twilio-verify` for managed OTPs, `twilio` for direct SMS, or `webhook` |
| `TWILIO_ACCOUNT_SID` | when using Twilio | Twilio Account SID; keep private |
| `TWILIO_AUTH_TOKEN` | when using Twilio | Twilio Auth Token; keep private |
| `TWILIO_VERIFY_SERVICE_SID` | when using `twilio-verify` | Verify Service SID from Twilio Console (starts with `VA`) |
| `TWILIO_FROM_NUMBER` | when using direct Twilio SMS | Twilio-enabled sender number in E.164 format |
| `TWILIO_MESSAGING_SERVICE_SID` | alternative direct Twilio sender | Twilio Messaging Service SID |
| `SMS_WEBHOOK_URL` | when using `webhook` | HTTPS endpoint for a custom SMS provider |
| `SMS_WEBHOOK_TOKEN` | optional | Bearer token for the SMS adapter |
| `EMAIL_PROVIDER` | no (default `webhook`) | `resend` to send sign-in codes using Resend, or `webhook` |
| `RESEND_API_KEY` | when using `resend` | Resend API key with permission to send mail; keep private |
| `EMAIL_FROM_ADDRESS` | when using `resend` | Sender address on a domain verified in Resend |
| `EMAIL_WEBHOOK_URL` | when using `webhook` | Email gateway endpoint |
| `EMAIL_WEBHOOK_TOKEN` | optional | Bearer token for the email gateway |

Twilio trial SMS is restricted by the account and destination country; trial console flows can be limited to pre-approved templates and verified recipient numbers. For app-generated phone OTPs, use Twilio Verify with a configured Verify Service, or a direct Twilio sender that is permitted for your trial. Keep all Twilio credentials in the deployment secret environment, never in `.env.example` or source control.

Resend email is configured separately from Twilio SMS. Verify a sending domain in Resend and create an API key, then set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and `EMAIL_FROM_ADDRESS` in the backend environment. Do not reuse the Twilio SMS Auth Token as the Resend API key.

## Deploy to Render (standalone backend repo)

Render recommends pinning Node versions with an **environment variable** — that overrides package.json engines and guarantees a stable runtime.

In the Render dashboard → `chatimall-backend` → Environment → add these:

| Variable | Value | Purpose |
|---|---|---|
| `NODE_VERSION` | `20` | **Always set this.** Tells Render to use Node.js 20 LTS (avoids picking bleeding-edge Node 22/26 which may crash on boot). |
| `MONGODB_URI` | `mongodb+srv://...` | MongoDB Atlas connection string (required) |
| `JWT_SECRET` | random 96-char hex | Auth signing secret — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `CLIENT_ORIGINS` | `https://chatimall-frontend-XXXX.vercel.app,https://*.vercel.app,http://localhost:5173` | CORS allowlist — set this to your live Vercel URL(s) or browser API calls fail |
| `SMS_PROVIDER` | `twilio` or `twilio-verify` | Select Twilio delivery; trial sending has account and recipient restrictions |
| `TWILIO_ACCOUNT_SID` | secret | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | secret | Twilio Auth Token |
| `TWILIO_FROM_NUMBER` | E.164 sender | Required for direct Twilio SMS; alternatively use `TWILIO_MESSAGING_SERVICE_SID` |
| `TWILIO_VERIFY_SERVICE_SID` | `VA...` | Required for Twilio Verify |
| `EMAIL_PROVIDER` | `resend` | Use Resend for sign-in code emails |
| `RESEND_API_KEY` | secret | Resend API key with mail-sending permission |
| `EMAIL_FROM_ADDRESS` | verified sender | Sender address on a domain verified in Resend |
| `DEV_OTP_ECHO` | `false` in production | Set `true` only for quick local smoke tests (returns the OTP in the HTTP response) |
| `TEST_PHONES` | leave unset in production | Fixed-code test phones are ignored in production |
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
