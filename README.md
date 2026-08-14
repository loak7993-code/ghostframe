<p align="center">
  <img src="docs/assets/icon-128.png" width="96" alt="GhostFrame"/>
</p>

<h1 align="center">GhostFrame</h1>

<p align="center"><strong>Coherent-fingerprint browser automation. One identity drives every layer: JS, TLS/JA3, network, storage.</strong></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License"/></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-brightgreen" alt="Node"/>
  <img src="https://img.shields.io/badge/go-1.24%2B-brightgreen" alt="Go"/>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#features">Features</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#verified-results">Verified results</a> ·
  <a href="#limitations">Limitations</a>
</p>

---

## What is GhostFrame?

Browser fingerprint tracking combines hundreds of signals — canvas, WebGL, fonts, the TLS handshake, headers, timezone, hardware hints — into one unique ID. Anti-detect setups usually get caught because a change leaks somewhere: an override that `toString`s wrong, a `prototype` accidentally exposed, a macOS font under a Windows User-Agent.

GhostFrame drives **every** fingerprint surface from a single coherent device profile: the JavaScript layer (canvas / WebGL / audio / fonts / navigator / Client Hints / screen / permissions / geolocation / battery / WebRTC), worker contexts (init-script reach is a known bypass), and the transport layer (TLS ClientHello + header order via a Go proxy). Profiles are coherence-checked so the identities never contradict themselves.

Three faces: a CLI, a REST API, an Electron desktop app — plus an Android companion app.

## Download (no building)

Pre-built desktop installers live in [Releases](https://github.com/loak7993-code/ghostframe/releases):

| Platform | Artifact | Install |
|---|---|---|
| **Windows** | [`GhostFrame-Setup-x64.exe`](https://github.com/loak7993-code/ghostframe/releases/latest/download/GhostFrame-Setup-x64.exe) | double-click, pick a folder, done |
| **macOS** (Apple Silicon) | [`GhostFrame-arm64.dmg`](https://github.com/loak7993-code/ghostframe/releases/latest/download/GhostFrame-arm64.dmg) | drag to /Applications |
| **macOS** (Apple Silicon, plain) | [`GhostFrame-arm64.zip`](https://github.com/loak7993-code/ghostframe/releases/latest/download/GhostFrame-arm64.zip) | unzip & run |
| **Linux** (any) | [`GhostFrame-x86_64.AppImage`](https://github.com/loak7993-code/ghostframe/releases/latest/download/GhostFrame-x86_64.AppImage) | `chmod +x && ./GhostFrame-x86_64.AppImage` |
| **Linux** (Debian/Ubuntu) | [`GhostFrame-amd64.deb`](https://github.com/loak7993-code/ghostframe/releases/latest/download/GhostFrame-amd64.deb) | `sudo dpkg -i GhostFrame-amd64.deb` |
| **Android** | companion client source | `mobile/README.md` |

> macOS note: the binaries are unsigned for now — the first run needs **right-click → Open** → Open (Gatekeeper), once. Windows may show a SmartScreen prompt on first run (click More info → Run anyway); signing is a TODO item on the roadmap.

## Quickstart (from source)

If you want to hack on it instead:

```bash
npm install
npm run build            # two-pass build → dist/inject.js (includes the Worker embed)
npm run validate-profiles
npm test
```

**CLI**

```bash
npx tsx src/cli/index.ts profile list
npx tsx src/cli/index.ts fingerprint win11-chrome-151   # live readback
npx tsx src/cli/index.ts launch win11-chrome-151 --headless
```

**API** — `npm run api`, port 8420, auth'd by key

```bash
curl -s -H "x-api-key: KEY" http://127.0.0.1:8420/profiles
curl -s -H "x-api-key: KEY" http://127.0.0.1:8420/sessions \
  -X POST -H "content-type: application/json" \
  -d '{"profileId":"win11-chrome-151","headless":true}'
curl -s -H "x-api-key: KEY" http://127.0.0.1:8420/sessions/<sess_id>/fingerprint
```

**Desktop (Electron)** — profile grid, tabbed details, per-check fingerprint verification modal with expected-vs-actual values, one-click launch and duplication:

```bash
npm run gui
```

**Android** — companion client with fingerprint verification in a tap:

```bash
cd mobile && ./build-apk.sh   # → ghostframe.apk
```

## Verified results

| Check (run locally) | Result |
|---|---|
| `npm test` | 8/8 — hardening, native-signature, seeded determinism |
| `npm run validate-profiles` | 13/13 profiles coherent |
| `npx tsx tests/detection/run.ts <profile>` | 31/31 (android, windows), 30/30 (safari) |
| Live detector — ipfighter.com/browser-fingerprint | 100 score, masking: not detected, automation: none |
| `go vet ./... && go build ./...` (netlayer) | clean |

## Features

- **Full JS surface coverage** — canvas, WebGL/WebGL2, AudioContext (AnalyserNode + OfflineAudioContext.startRendering), fonts via `measureText` probes, navigator + `userAgentData` with high-entropy hints, screen/window metrics, timezone (`Intl`, `Date`, `Temporal`), permissions, geolocation, battery, media devices, speech voices, plugins/mimeTypes, WebRTC ICE hygiene, performance.now resolution.
- **Detection-hardened overrides** — method-shorthand wrappers carry no own `prototype`, correct `.name`/`.length`, receiver-type-checked getters that throw `TypeError` like natives, and a single `Function.prototype.toString` trap returning `[native code]` for registered functions.
- **Worker contexts** — the same engine self-injects into JavaScript blobs handed to `URL.createObjectURL`, so checks run from `new Worker()` get spoofed values too.
- **Transport control** — `ghostproxy` pins the TLS ClientHello (JA3/JA4) per profile and chains through upstream SOCKS5/HTTP with header-order control.
- **State isolation** — per-profile persistent Chromium user-data dirs; profiles are portable JSON identities.
- **Automation hardening** — `navigator.webdriver` suppressed, `chrome.runtime` present where a Chromium UA implies it, notification-permission coherence, first-page re-init so no document starts unpatched.

## How it works

```
Electron GUI / CLI / REST API / Android app
                    │
        DeviceProfileDB (coherent identities, JSON)
                    │
   FingerprintEngine ──two-pass esbuild──► dist/inject.js
                    │      (CDP addScriptToEvaluateOnNewDocument
                    │       + self-injection into JS Blob workers)
                    ▼
   Playwright ── isolated --user-data-dir ── first-page re-init
                    │
   ghostproxy (Go, uTLS) ── TLS pinning ── header order ── upstream proxy
                    ▼
                target site
```

<details>
<summary>What each layer covers</summary>

| Layer | Vectors |
|---|---|
| JavaScript | canvas 2D + offscreen, WebGL vendor/renderer + parameters, AudioContext + OfflineAudioContext, fonts, navigator (9 props + Client Hints), screen/window, timezone (`Intl`, `Date`, `Temporal`), permissions, geolocation, battery, media devices, speech voices, plugins/mimeTypes, WebRTC, performance.now |
| Workers | same engine prepended into JS blobs given to `URL.createObjectURL` |
| Transport | JA3/JA4 (uTLS ClientHelloID), ALPN, header order/casing, HTTP2 foundation, upstream SOCKS5/HTTP chaining, first-party CA MITM |
| Coherence | profile validator enforces OS ↔ platform ↔ UA token ↔ GPU backend ↔ fonts ↔ timezone ↔ mobile flags ↔ version-era consistency |

</details>

## Limitations

- **Chrome engine only.** The bundled engine is current Playwright Chromium and profiles claim its version. Firefox/Safari profile data skips the version-consistency probe, but engine-level tells can still exist under adversarial review. A true Firefox basis is on the roadmap.
- **uTLS spec lag.** uTLS's latest packaged spec is `HelloChrome_120`; there's a small declared-version vs real-handshake drift. JA3-savvy detectors comparing them may notice. See `ROADMAP.md`.
- **Egress geography.** Browser values can't fix your IP. Match the proxy region to the profile's region/locale — the tool treats this as a profile setting, not a code problem.
- **HTTP/2 framing fingerprint** is not yet forced onto the wire. The building blocks exist in `netlayer/http2.go`.

## Docs

- `ROADMAP.md` — what's next and how to help
- `SECURITY.md` — threat model, reporting, responsible use
- `CONTRIBUTING.md` — workflow + quality gates
- `docs/architecture.md`, `docs/fingerprint-vectors.md`, `docs/api.md`
- `mobile/README.md` — Android app build + network setup
- `gui/README.md` — Electron GUI notes

## License

[MIT](LICENSE)
