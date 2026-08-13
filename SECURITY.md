# Security policy

## Scope

GhostFrame is defensive tooling *for* defensive understanding: authorized red-team engagements, ad-verification, multi-account management, privacy research, and QA. It is not an anonymity guarantee and does not hide you from your ISP, law enforcement, or your own operational mistakes.

## Threat model & guarantees

- **JS fingerprint surface**: designed to pass mainstream detectors (see README → Verified results). This is an arms race; detectors evolve.
- **TLS/HTTP transport**: JA3/JA4 pinning is close, but uTLS's packaged specs lag the newest Chrome; version vs handshake drift is a known residual signal.
- **IP/espresso geo**: out of scope for this codebase. Your egress IP is your responsibility — pair it coherently with the profile's region/locale.
- **Behavioral scoring**: not addressed. Mouse/keyboard/timing ML is deliberately a separate future module.

## Secrets

- Your API key is stored at `~/.ghostframe/api-key` (mode 0600) by default; never commit it.
- `data/proxies.txt` is git-ignored for a reason — add it to your personal setup, not to the repo.
- Profile JSON files contain **no secrets** but DO describe your identity base; review before sharing.

## Reporting vulnerabilities

If you find a security issue (auth bypass, secret leakage into artifacts, the injection leaking into in-page code in a way that reveals its presence), please open a **private** GitHub security advisory rather than a public issue. We triage promptly.

## Dependency hygiene

`npm audit` before releases; Go deps are vendored-free but version-pinned via `netlayer/go.sum`.
