# Building the Android app (APK) with push notifications

Requirements on your PC: Node 18+, **JDK 17**, and **Android Studio** (it installs the Android SDK).
Set `ANDROID_HOME` if Gradle cannot find the SDK.

## 1. One-command debug APK
```
npm install
npm run apk:debug
```
This installs Capacitor if missing, builds the web app, creates the `android/` project, adds the
mic/camera/notification permissions, syncs, and runs Gradle. The APK ends up at
`android/app/build/outputs/apk/debug/app-debug.apk`. Copy it to a phone and install it.
(`.env` must exist first, because `VITE_API_URL` is baked into the build.)

To work in Android Studio instead: `npm run android:sync` then `npm run android:open`.

## 2. Test on your phone
Enable "Install unknown apps" for your file manager/browser, open the APK, sign in.
Allow microphone, camera and notifications when asked.

## 3. Point the app at your server
The APK cannot use `localhost`. Deploy the server (see SETUP.md, section 6) and put its **https** address
in the project's `.env`:
```
VITE_API_URL=https://your-chatimall-server.example.com
```
Then rebuild the APK. If you set `CLIENT_ORIGINS` on the server, include `https://localhost` (the origin the
Android app uses).

## 4. Push notifications (Firebase Cloud Messaging – free)
1. console.firebase.google.com → create a project → **Add Android app** with package name
   `com.chatimall.app` → download `google-services.json` → put it in `android/app/`.
2. Project settings → **Service accounts** → **Generate new private key** (a JSON file).
3. On your server host set `FCM_SERVICE_ACCOUNT` to that JSON (whole file as one line, or a path to it).
   The server then sends a push for new messages and incoming calls whenever the receiver is not connected.
4. Rebuild the APK (`npm run apk:debug`) so it includes `google-services.json`.

Never commit the service-account JSON or `google-services.json` to a public repo.

## 5. Release APK / Play Store
A debug APK is fine for testing and sharing. For the Play Store you need a signed **release**
build (an AAB): in Android Studio use *Build → Generate Signed Bundle / APK*, create a keystore,
and **back it up** – if you lose it you can never update the app. Add an icon and splash screen
first (`npx @capacitor/assets generate`).

**Light/dark splash screen:** `assets/splash.png` (light) and `assets/splash-dark.png` (dark) are
already in place. `@capacitor/assets generate` reads both and creates a `drawable-night-*` set
automatically, so Android shows the dark splash on a phone in dark mode and the light one
otherwise — this follows the phone's own setting, not a clock, so there's nothing else to wire up.
After running it, open `android/app/src/main/res/` and confirm both a `drawable-*` and a
`drawable-night-*` splash image exist before you build — I can't run this generator myself (it
needs the Android SDK), so this one check matters.

## 6. Calls on mobile data
Add a TURN server in `.env` (see `.env.example`), rebuild, and test a call between two phones on
different networks. Without TURN, roughly one call in five between mobile networks can fail.
