# REST API

Base URL: `http://<host>:8420`  ·  Auth: every request carries `x-api-key: <key>`  ·  The server prints the key on first start (persisted at `~/.ghostframe/api-key`).

All responses are JSON. Errors are `{ "error": string, "detail"?: string }` with a matching status code.

## Health

`GET /health` — no auth needed. `{ ok, service, sessions, profilesDirReady }`.

## Profiles

| Method | Path | Query/Body | Returns |
|---|---|---|---|
| `GET` | `/profiles` | — | `{ count, profiles: [{id,label,os,osVersion,browser,browserVersion,userAgent,timezone}] }` |
| `GET` | `/profiles/:id` | — | full `DeviceProfile` JSON |
| `POST` | `/profiles` | partial profile body | created `DeviceProfile` (`201`) |
| `DELETE` | `/profiles/:id` | — | `{ ok: true, id }` |

`GET /profiles/:id/fingerprint?proxy=<url>` — headless one-shot readback: boots a profile, reads the live fingerprint, returns a `FingerprintReadback`:

```json
{
  "profileId": "win11-chrome-151",
  "userAgent": "Mozilla/5.0 ...",
  "platform": "Win32",
  "languages": ["en-US"],
  "timezone": "America/New_York",
  "hardwareConcurrency": 12,
  "deviceMemory": 16,
  "canvasHash": "2184bd12...",
  "webglVendor": "Google Inc. (NVIDIA)",
  "webglRenderer": "ANGLE ...",
  "audioHash": "...",
  "webrtcLocalIP": ""
}
```

## Sessions (live browser contexts)

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/sessions` | `{ profileId, headless?, useGhostProxy?, proxyOverride? }` | `{ sessionId, profileId, label, os, browser, proxy, headless }` |
| `GET` | `/sessions` | — | `{ count, sessions: [...] }` |
| `GET` | `/sessions/:id` | — | session info |
| `POST` | `/sessions/:id/navigate` | `{ url }` | `{ ok: true, url, title }` |
| `GET` | `/sessions/:id/fingerprint` | — | live `FingerprintReadback` |
| `DELETE` | `/sessions/:id` | — | closes the browser context |

## Proxy pool

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/proxy/pool` | — | `{ count, pool }` |
| `POST` | `/proxy/pool` | `{ url }` (`http://user:pass@host:port` or `socks5://...`) | `{ ok: true, added }` |
| `GET` | `/proxy/check/:id` | — | `{ profileId, proxy, reachable }` |

## Errors

- `401` — missing/incorrect API key
- `404` — profile/session not found
- `500` — browser launch or fingerprint failed (detail included)

## Examples

```bash
# list profiles
curl -s -H "x-api-key: $KEY" http://127.0.0.1:8420/profiles

# launch a session
curl -s -H "x-api-key: $KEY" -X POST -H "content-type: application/json" \
  -d '{"profileId":"android13-chrome-151-mobile","headless":true}' \
  http://127.0.0.1:8420/sessions

# verify a session's fingerprint
curl -s -H "x-api-key: $KEY" http://127.0.0.1:8420/sessions/<sid>/fingerprint

# close it
curl -s -X DELETE -H "x-api-key: $KEY" http://127.0.0.1:8420/sessions/<sid>
```
