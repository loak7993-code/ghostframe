# Roadmap

A prioritized, contribution-friendly path from "works today" to "the reference anti-detect platform."

## Near term (highest leverage)

1. **HTTP/2 frame-fingerprint forcing** — terminate and re-originate HTTP/2 in ghostproxy so the wire-level h2 SETTINGS / pseudo-header order / header case precisely match the profile, not the browser's own implementation.  *Owner: netlayer/`http2.go`.*
2. **Fresh uTLS specs** — hand-craft or vendor ClientHelloSpecs for Chrome 150+; close the small declared-version ↔ real-handshake drift. *Owner: netlayer/`dialer.go`.*
3. **Profile-aware egress** — given a proxy, auto-pick a profile whose timezone/locale/languages match the egress geo (or vice-versa). *Owner: `src/proxy/` + profile registry.*
4. **Humanizer** — subtle input-profile jitter (mouse trajectory, scroll cadence, keystroke timing) to blunt behavioral-ML scoring; per-profile parameters. *New module `src/humanize/`.*

## Mid term

5. **CA trust done right** — install the ghostproxy CA into the profile's NSS cert DB instead of `--ignore-certificate-errors`; also remove the need for `ignoreHTTPSErrors`. *Owner: `src/browser/launcher.ts`.*
6. **Deeper worker coverage** — Service Workers + SharedWorkers (and URL-referenced workers where the origin allows rewriting the response body).
7. **Firefox/Safari basis** — a real Firefox build with an equivalent injection path so FF profiles carry a matching engine, not just matching strings.
8. **Detection radar** — scheduled runs against a detector canary list (creepjs dev, ipfighter, browserleaks subsets, pixelscan, device&browser); version-alert whenever any signal regresses.

## Longer term

9. **Mobile app: on-device relay** — run ghostproxy from the Android app itself so phone-controlled sessions ship network-spoofing without a server box.
10. **Native extension bridge** — optional extension for parity with real-Chrome surfaces that can only be reached from extension APIs.

Ideas, offers to help, or a detector we should pass: open an issue.
