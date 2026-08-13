# Architecture

## Overview

GhostFrame is built as three independent layers, all coordinated by a single coherent device profile. The profile JSON is the contract between every component — it carries every value each layer must present, from the user agent to the TLS ClientHello layout to the GPU string to the canvas-seed integers.

```
┌──────────────────────────────────────────────────┐
│              Interfaces                            │
│  CLI    REST API (Fastify)    Electron GUI    Android │
└──────────────┬───────────────────────────────┬───┘
               │                               │
      ┌────────▼─────────┐         ┌──────────▼──────┐
      │  DeviceProfileDB │         │  Session manager │
      │  data/profiles/  │         └──────────────────┘
      └────────┬─────────┘
               │
   ┌───────────▼────────────┐
   │   FingerprintEngine    │  two-pass esbuild bundle
   │   src/inject/*         │  incl. Worker/Blob injection
   └───────────┬────────────┘
               │  CDP addScriptToEvaluateOnNewDocument
   ┌───────────▼────────────┐
   │  Playwright / Chromium │  isolated --user-data-dir per profile
   └───────────┬────────────┘
               │  proxy
   ┌───────────▼────────────┐
   │  ghostproxy (Go, uTLS) │  JA3/JA4 pinning, header order,
   │  netlayer/*            │  upstream SOCKS5/HTTP chaining
   └───────────┬────────────┘
               ▼
          target site
```

## Components

**src/types/profile.ts** — the `DeviceProfile` schema. Every fingerprint vector the platform manages lives here; modules only read from this type.

**src/profile/** — profile registry (`listProfiles`, `getProfile`, `createProfile`, `deleteProfile`) plus the default-profile builder for blank creates.

**src/inject/** — the spoofing engine. Each module overrides one surface family, hardened via `harden.ts` (method-shorthand wrappers, receiver-checked getters, `Function.prototype.toString` trap, seeded PRNG shared canvas/audio noise).

**src/browser/** — Playwright launcher with profile-mapped flags, isolated user-data dirs, and a first-page re-init so the persistent context's initial `about:blank` couldn't run unpatched.

**src/proxy/** — upstream pool (SOCKS5/HTTP), health checks, per-profile route decisions.

**src/api/** — Fastify REST API (key auth, sessions as long-lived browser contexts with navigate/fingerprint endpoints).

**gui/** — Electron app: profile list, tabbed detail, live fingerprint verification modal against the expected profile, JSON viewer.

**mobile/** — Capacitor Android client with the same feature surface against the REST API.

**netlayer/** — Go MITM `ghostproxy`: terminates TLS, pins ClientHello via uTLS per profile, chains to upstream proxies, logs JA3 evidence. `http2.go` holds the framing-fingerprint building blocks.

**tests/detection/run.ts** — the regression suite for tells (webdriver, native-signature checks, worker leaks, plugins/mobile coherence, chrome surface, permission states, seeded hash determinism). 25+ probes; a new tell lands as a failing check here.

**scripts/** — `validate-profiles.ts` (coherence CI), `gen-profiles.ts` (DB regen), `live-check.ts` (live detector scrape).

## Persistence & trust boundaries

- Profiles are JSON on disk in `data/profiles`; browser state lives in `profiles-state/<id>` (isolated Chromium dirs).
- API auth is a bearer key (env-loaded at startup) — never committed, stored in `~/.ghostframe/api-key` (0600).
- The API listens on 0.0.0.0 by default; protect it on LAN (design is single-operator).
