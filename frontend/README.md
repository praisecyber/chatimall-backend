# Chatimall — Frontend

React + TypeScript + Vite frontend for Chatimall. Deploy target: **Vercel**. Also builds to Android via Capacitor (see [ANDROID.md](file:///C:/Users/PRAISECYBER/Desktop/chatimall_full/frontend/ANDROID.md)).

Sibling repos:
- `chatimall-backend` — Node/Express + MongoDB API server (chats, users, auth, sockets) → Render
- `chatimall-translate-service` — Python/ML voice-note translation microservice → its own VPS/instance (needs ≥ 4 GB RAM)

## Local development

```bash
npm install
cp .env.example .env         # if .env.example exists; otherwise create frontend/.env and leave empty for local dev
npm run dev                  # Vite dev server on http://localhost:5173
```

Vite automatically proxies API + socket calls to the backend at `http://localhost:4000` when running locally — no `VITE_API_URL` needed for development.

Other commands:

```bash
npm run build                # Production build to dist/
npm run typecheck            # TypeScript checks (tsc --noEmit)
npm run lint                 # ESLint
npm run preview              # Serve the built dist/ locally
```

## Deploy → Vercel

1. Push this repo to GitHub.
2. In Vercel: **New Project** → import repo. Vercel reads [vercel.json](file:///C:/Users/PRAISECYBER/Desktop/chatimall_full/frontend/vercel.json) automatically.
3. Set one **environment variable**:
   - `VITE_API_URL` = your backend's full URL (e.g. `https://chatimall-backend.onrender.com`)
4. Deploy.

## Android APK (Capacitor)

App ID is pre-configured as `com.chatimall.app` in [capacitor.config.json](file:///C:/Users/PRAISECYBER/Desktop/chatimall_full/frontend/capacitor.config.json). On a machine with Android Studio installed:

```bash
npm install
npm run build                # IMPORTANT: build the web assets FIRST, and make sure VITE_API_URL is set to your real backend
npx cap add android          # first time only
npx cap sync android
npx cap open android
```

Then in Android Studio: **Build → Generate Signed Bundle / APK** (create a keystore the first time if you don't have one).

## Environment variables

| Variable | Local dev | Production (Vercel / Android build) |
|---|---|---|
| `VITE_API_URL` | Unset (Vite proxies to localhost:4000) | **Required** — full backend base URL (no trailing slash) |
