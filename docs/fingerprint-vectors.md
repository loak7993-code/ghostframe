# Fingerprint vectors

What GhostFrame masks, where each override lives, and how it's repeatedly verified in the regression suite.

## JavaScript surface (`src/inject/`)

| Vector | Module | Technique | Stability |
|---|---|---|---|
| Canvas 2D / offscreen | `canvas.ts` | render to an offscreen, inject seeded per-pixel noise before `toDataURL`/`toBlob`/`getImageData` returns | deterministic per profile |
| WebGL / WebGL2 | `webgl.ts` | vendor, renderer, unmasked params, numeric limits, extension list, context attrs | fixed by profile |
| Audio (AnalyserNode) | `audio.ts` | seeded noise into time-domain/frequency reads | deterministic per profile |
| Audio (OfflineAudioContext) | `audio.ts` | `startRendering` output is perturbed before resolve | deterministic per profile |
| Fonts (measurement probes) | `fonts.ts` | `measureText` feed controlled by profile presence set | matched to OS font census |
| navigator (9 props) | `navigator.ts` | UA, platform, language(s), hardwareConcurrency, deviceMemory, vendor, cookieEnabled, maxTouchPoints, doNotTrack | fixed by profile |
| navigator.userAgentData | `navigator.ts` | brands/platform/mobile + `getHighEntropyValues` returning the high-entropy set | fixed by profile |
| Plugins / mimeTypes | `navigator.ts` | plugin array shape; **empty** on mobile profiles (Android truth) | fixed by profile |
| Screen / window metrics | `screen-window.ts` | width/height/avail/colorDepth/pixelDepth/dpr/orientation | fixed by profile |
| Timezone (`Intl`,`Date`) | `timezone.ts` | `resolvedOptions().timeZone`, `getTimezoneOffset` computed from ICU for the profile TZ | DST-correct always |
| Temporal | `timezone.ts` | patched too — modern detectors read it | n/a |
| Permissions | `permissions.ts` | `query()` states + `Notification.permission` coherence | fixed by profile |
| Geolocation | `geolocation.ts` | `getCurrentPosition`/`watchPosition` resolve with deterministic jitter around the profile coords | fixed by profile ± small jitter |
| Battery | `battery.ts` | `getBattery()` resolves profile-level values | fixed by profile |
| Media devices | `media.ts` | `enumerateDevices()` profile-shaped (counts + labels), stable hashed deviceIds | fixed by profile |
| Speech voices | `speech.ts` | profile-shaped voice array | fixed by profile |
| WebRTC | `webrtc.ts` | ICE candidates rewritten to a fixture fake local IP; relay-hardened | fixed by profile |
| performance.now | `performance.ts` | quantized to profile resolution | fixed by profile |
| Math / CPU precision | `math.ts` | native-preserving; perf-now matches profile class | fixed by profile |
| chrome.runtime / window.chrome | `chrome.ts` | injected full surface (app/csi/loadTimes/runtime) matching the claimed platform | fixed by profile |
| HTTP Client Hints | `navigator.ts` (`userAgentData`) | brands/platform/mobile aligned with `Sec-CH-UA*` headers role | fixed by profile |

## Worker contexts (`src/inject/worker.ts`)

JavaScript blobs passed to `URL.createObjectURL` are given the entire injection bundle + the profile as a prefix, so detector tests run inside `new Worker(...)` get the same spoofed world as the main thread. Confirmed with `scripts/` probes: canvas inside a Worker is noise-perturbed the same way; `chrome` present; timezone matches.

## Transport (`netlayer/`)

- **JA3/JA4** — ClientHello pinned via uTLS per profile (cipher lists, extension order, curves, sig algs, ALPN).
- **HTTP headers** — order and casing once profile-matched.
- **HTTP/2 foundation** — `http2.go` contains transport + ordering building blocks; not yet forced onto the wire (roadmap).
- **Upstream** — SOCKS5/HTTP chaining with per-profile persistence.
- **WebRTC external** — SDP/ICE hygiene removes local IP exposure at the JS layer; `ghostproxy` itself passes TCP/TLS.

## Coherence guarantees (CI-enforced)

`validate-profiles.ts` refuses to pass a profile whose values contradict each other:

- `navigator.platform` ↔ `os`
- user-agent platform token ↔ `os`
- `userAgentData.platform` ↔ `os`, and a profile browser brand must appear in brands
- `timezone.locale` ↔ `languages[0]`
- GPU backend family ↔ OS (D3D on Windows, Metal/OpenGL on macOS, OpenGL on Linux)
- mobile profiles must have `mobile: true`, touch points > 0, and **zero** desktop PDF plugins
- `navigator.webdriver === false`
- `tls.ja3 === md5(tls.ja3Full)`

## Regression probes (`tests/detection/run.ts`)

Each run launches a profile headless and asserts across the live page. Highlights: `navigator.webdriver===false`, UA/platform match, timezone match, `userAgentData` mobile/bbrand coherence, `chrome.runtime` presence, override signatures look native (`name`, `length`, no `prototype` own-property), permission `query` coherence, no WebRTC host-IP leak, canvas stability across renders, and OS-token ∈ UA.
