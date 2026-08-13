# Contributing

Thanks for the interest — especially for detectors you want passed and net-layer PRs.

## Getting set up

```bash
npm install
go --version          # 1.24+  (only needed for netlayer work)
cd netlayer && go build ./... && go vet ./...
npm run verify        # build + unit tests + profile coherence + lint
```

## The quality gate (runs in CI; run it before you push)

1. `npm run build` — tsc + two-pass esbuild (Worker embed) → `dist/inject.js`
2. `npm test` — vitest (spoof-surface hardening, native-signature checks, seeded determinism)
3. `npm run validate-profiles` — 13 JSON profiles, OS/GPU/font/tz/mobile coherence + `tls.ja3 === md5(ja3Full)`
4. `npm run lint` — typed eslint
5. `npx tsx tests/detection/run.ts win11-chrome-151` — 31/31 must pass, 0 critical lies
6. `cd netlayer && gofmt -l . == empty && go vet ./... && go build ./...`

## Design invariants (do not break)

- **One profile, one coherent identity.** Every fingerprint value flows from a `DeviceProfile`.
- **No native-detector tells.** Overrides must be method-shorthand (no own `prototype`), correct `.name`/`.length`, receiver-checked getters, `Function.prototype.toString` interception, and seeded-stable noise per profile.
- **Worker coverage. If you add a spoof module and it can matter in a worker context, it must work there too.
- **Silent failure.** A busted spoof module must never break the page.

## PR guidance

- Keep reviews focused: one detector or one layer per PR.
- If your change touches a spoof surface, add/adjust a regression check in `tests/detection/run.ts` (and if possible a unit test).
- For net changes: include a JA3/JA4 evidence snippet (before/after) from `tls.peet.ws` or similar.
- Profiles must pass `validate-profiles.ts` on first run.

## Detector targets we're actively tracking

creepjs · ipfighter · browserleaks (canvas/webgl/audio) · fingerprintjs-community · pixelscan · deviceandbrowser

Open an issue if a detector starts flagging something it didn't before — the regression suite exists for exactly this.
