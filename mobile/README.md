# GhostFrame Mobile (Android)

Native Android app (Capacitor) that talks to the GhostFrame REST API running on your server.
The app is a thin, polished client — the actual browser runs on the machine; the phone controls profiles, sessions, and live fingerprint verification.

## APK

**`ghostframe.apk`** (4.0 MB, debug-signed) — ready to install.

## Install

```bash
# via adb over USB
adb install -r ghostframe.apk

# or copy to the phone and tap the file (allow "install unknown apps" for your file manager/browser)
```

## First run: connect to the API

1. On the GhostFrame server: `npm run api`  (prints the API key, also saved at `~/.ghostframe/api-key`)
2. In the app → **Settings** → paste:
   - **Server URL**: `http://<server-lan-ip>:8420`  (both devices must be on the same LAN, or expose the API on LAN)
   - **API key**: the printed key
3. Tap **Save** — the status pill turns green ("connected") and Profiles load.

> Note: the app ships cleartext HTTP support for the http:// local API; put it behind TLS if you ever expose it beyond LAN.

## What the app does

- **Profiles**: search, open detail sections (Identity / Hardware / Network & TLS / Software surface / Fonts), duplicate, delete
- **Launch**: starts a browser session on the server (headless) from any profile
- **Sessions**: live list, one-tap fingerprint verify, close
- **Verify Fingerprint** (bottom sheet): launches a headless browser server-side, reads the live fingerprint, compares expected-vs-actual across UA / platform / languages / timezone / hardware / WebGL / WebRTC with green/red per-check verdict + canvas and audio hashes
- **Connection pill**: API reachability at a glance

## Rebuild

```bash
./build-apk.sh
```

It auto-installs the Android SDK (`~/android-sdk`) and portable JDK 21 (`/tmp/jdk21`) if missing, syncs the web assets, regenerates adaptive icons, and drops the result at `ghostframe.apk`.

Layout: `www/` (app source: index.html, styles.css, api.js REST client, app.js controller), `android/` (generated platform), `tools/gen-icons.mjs` (icon generation from the desktop ghost icon), `capacitor.config.ts` (`com.ghostframe.app`, cleartext LAN HTTP allowed).
