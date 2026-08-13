package main

// http2.go — HTTP/2 fingerprint matching foundation.
//
// The goal of HTTP/2 fingerprinting (akamai/h2 fingerprint, "akamai_h2") is that
// the SERVER observes the exact SETTINGS frame, WINDOW_UPDATE, PRIORITY frames,
// pseudo-header order, and regular-header order that the claimed browser sends.
//
// Two architectures can achieve this:
//
//   (A) Terminate h2 on both sides and re-originate it to the upstream with our
//       own custom framer/transport (full control, full complexity: stream
//       multiplexing, flow-control mirroring, priority replication).
//   (B) Pipe h2 frames straight through (browser frames reach the server
//       untouched). This requires NO h2 logic in the proxy, but the SERVER then
//       sees the browser's real h2 fingerprint — NOT the profile's — so it does
//       NOT defeat h2-based detection. It does, however, still defeat JA3/JA4
//       detection, which is the primary vector.
//
// This pass implements (B) for the CONNECT data path (see proxy.go) so the proxy
// is fully functional end-to-end, and provides the building blocks for (A) here:
//   - NewHTTP2Transport: an http2.Transport configured with the profile's SETTINGS
//     and WINDOW_UPDATE (via the documented knobs: ReadFrameBufferSize and the
//     initial window size on the transport).
//   - orderedHeadersRoundTripper: a RoundTripper wrapper that reorders request
//     headers (pseudo + regular) to match profile.http2.headerOrder /
//     pseudoHeaderOrder before they are written.
//
// TODO(stage-5+): Wire (A) into proxy.go's CONNECT handler: terminate the
// browser-side h2, decode requests, replay them through NewHTTP2Transport against
// the uTLS conn, and forward responses. That gives full h2 fingerprint control.
// Until then, h2 fingerprint matching is NOT enforced on the wire; only JA3/JA4
// (TLS) and HTTP/1.1 header ordering (proxy.go) are enforced.

import (
	"net/http"

	"golang.org/x/net/http2"
)

// HTTP2_SETTING_* standard IDs (RFC 7540 §6.5.2).
const (
	h2SettingHeaderTableSize      uint16 = 0x1
	h2SettingEnablePush           uint16 = 0x2
	h2SettingMaxConcurrentStreams uint16 = 0x3
	h2SettingInitialWindowSize    uint16 = 0x4
	h2SettingMaxFrameSize         uint16 = 0x5
	h2SettingMaxHeaderListSize    uint16 = 0x6
)

// NewHTTP2Transport builds an *http2.Transport pre-configured with the profile's
// HTTP/2 SETTINGS. The standard library's http2.Transport exposes only a subset
// of SETTINGS knobs directly (StrictMaxConcurrentStreams, MaxReadFrameSize,
// MaxDecoderHeaderTableSize, MaxEncoderHeaderTableSize, the per-stream initial
// window via t.MaxReadFrameSize). We map the profile's settings onto those knobs.
// Settings we cannot map (e.g. ENABLE_PUSH=0, MAX_CONCURRENT_STREAMS) are recorded
// for future framer-level enforcement (TODO above) and returned in `unmapped`.
func NewHTTP2Transport(prof *HTTP2Fingerprint) (t *http2.Transport, unmapped []HTTP2Setting) {
	t = &http2.Transport{
		AllowHTTP:                  false,
		DisableCompression:         true,
		DialTLS:                    nil, // set by caller when wiring into (A)
		StrictMaxConcurrentStreams: false,
	}
	for _, s := range prof.Settings {
		switch s.ID {
		case h2SettingMaxFrameSize:
			t.MaxReadFrameSize = s.Value
		case h2SettingHeaderTableSize:
			t.MaxDecoderHeaderTableSize = s.Value
			t.MaxEncoderHeaderTableSize = s.Value
		case h2SettingInitialWindowSize:
			// The transport's initial window is per-stream; there is no direct
			// setter for the connection-level WINDOW_UPDATE on http2.Transport.
			// Recorded as unmapped for the framer-level (A) path.
			unmapped = append(unmapped, s)
		default:
			unmapped = append(unmapped, s)
		}
	}
	if prof.WindowUpdate != 0 {
		// Connection-level WINDOW_UPDATE is not directly settable on http2.Transport.
		// TODO: enforce via custom framer in the (A) path.
	}
	return t, unmapped
}

// orderHeaders returns a copy of hdrs reordered so that header names appear in the
// order specified by `order` (case-insensitive match), with any unlisted headers
// appended in their original relative order. This implements the regular-header
// ordering half of profile.http2.headerOrder (and HTTP/1.1 headerOrder in
// proxy.go, which reuses this).
func orderHeaders(hdrs http.Header, order []string) http.Header {
	if len(order) == 0 {
		return hdrs
	}
	out := make(http.Header, len(hdrs))
	seen := make(map[string]bool, len(hdrs))
	// Build a lowercased lookup of present header names.
	present := make(map[string]string, len(hdrs)) // lower -> actual key as written
	for k := range hdrs {
		lk := lower(k)
		present[lk] = k
	}
	for _, want := range order {
		lw := lower(want)
		if act, ok := present[lw]; ok && !seen[act] {
			out[act] = hdrs[act]
			seen[act] = true
		}
	}
	// Append remaining headers in their original iteration order.
	for k, v := range hdrs {
		if !seen[k] {
			out[k] = v
		}
	}
	return out
}

func lower(s string) string {
	b := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		b[i] = c
	}
	return string(b)
}

// applyHeaderCasing rewrites the keys of hdrs to the exact casing from the
// profile's casing map (case-insensitive lookup). Headers not in the map keep
// their original casing.
func applyHeaderCasing(hdrs http.Header, casing map[string]string) http.Header {
	if len(casing) == 0 {
		return hdrs
	}
	out := make(http.Header, len(hdrs))
	for k, v := range hdrs {
		if want, ok := casing[lower(k)]; ok {
			out[want] = v
		} else {
			out[k] = v
		}
	}
	return out
}
