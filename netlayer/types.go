package main

// types.go — Go mirrors of the netlayer-relevant subset of GhostFrame's DeviceProfile.
// Source of truth: /home/onyx/ghostframe/src/types/profile.ts (TLSFingerprint,
// HTTP2Fingerprint, HTTPHeaderSpec, ProxySpec). Only the fields the network layer
// consumes are mirrored here; json tags match the TS field names exactly so a full
// DeviceProfile JSON can be unmarshaled (extra fields are ignored).

// TLSFingerprint mirrors src/types/profile.ts TLSFingerprint.
type TLSFingerprint struct {
	ClientHelloId       string   `json:"clientHelloId"` // uTLS spec id, e.g. "HelloChrome_120"
	Ja3                 string   `json:"ja3"`           // expected JA3 hash (for validation)
	Ja3Full             string   `json:"ja3Full"`       // full JA3 string
	Ja4                 string   `json:"ja4"`           // expected JA4 string
	CipherSuites        []uint16 `json:"cipherSuites"`
	Extensions          []uint16 `json:"extensions"`
	Curves              []uint16 `json:"curves"`
	SignatureAlgorithms []uint16 `json:"signatureAlgorithms"`
	ALPN                []string `json:"alpn"`
}

// HTTP2Setting mirrors one entry of HTTP2Fingerprint.settings.
type HTTP2Setting struct {
	ID    uint16 `json:"id"`
	Value uint32 `json:"value"`
}

// HTTP2Priority mirrors one entry of HTTP2Fingerprint.priority.
// Weight is the LOGICAL HTTP/2 weight (1-256); the on-wire byte is weight-1.
// It is uint16 (not uint8) so 256 deserializes without overflow.
type HTTP2Priority struct {
	StreamId    uint32 `json:"streamId"`
	Weight      uint16 `json:"weight"`
	Exclusive   bool   `json:"exclusive"`
	DepStreamId uint32 `json:"depStreamId"`
}

// HTTP2Fingerprint mirrors src/types/profile.ts HTTP2Fingerprint.
type HTTP2Fingerprint struct {
	Settings          []HTTP2Setting  `json:"settings"`
	WindowUpdate      uint32          `json:"windowUpdate"`
	HeaderOrder       []string        `json:"headerOrder"`
	PseudoHeaderOrder []string        `json:"pseudoHeaderOrder"`
	Priority          []HTTP2Priority `json:"priority"`
}

// HTTPHeaderSpec mirrors src/types/profile.ts HTTPHeaderSpec.
type HTTPHeaderSpec struct {
	Order  []string          `json:"order"`
	Casing map[string]string `json:"casing"`
}

// ProxySpec mirrors src/types/profile.ts ProxySpec.
type ProxySpec struct {
	Type     string `json:"type"` // "http" | "socks5" | "direct"
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
}

// IsDirect reports whether this proxy spec means "no upstream proxy".
// Used so callers can treat a nil pointer and a {"type":"direct"} spec identically.
func (p *ProxySpec) IsDirect() bool {
	return p == nil || p.Type == "" || p.Type == "direct"
}

// DeviceProfile is the minimal subset of the TS DeviceProfile that the network
// layer consumes. Extra fields in the JSON (canvas, audio, gpu, ...) are ignored.
type DeviceProfile struct {
	ID             string `json:"id"`
	Label          string `json:"label"`
	OS             string `json:"os"`
	Browser        string `json:"browser"`
	BrowserVersion string `json:"browserVersion"`
	UserAgent      string `json:"userAgent"`

	TLS         TLSFingerprint   `json:"tls"`
	HTTP2       HTTP2Fingerprint `json:"http2"`
	HTTPHeaders HTTPHeaderSpec   `json:"httpHeaders"`
	Proxy       *ProxySpec       `json:"proxy"`
}
