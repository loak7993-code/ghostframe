package main

// dialer.go — builds the upstream connection.
//
// Responsibilities:
//   1. Resolve the profile's clientHelloId string to a utls.ClientHelloID.
//   2. Dial the target host:port, optionally chaining through an upstream SOCKS5
//      or HTTP CONNECT proxy described by profile.proxy (golang.org/x/net/proxy
//      for SOCKS5; manual CONNECT for HTTP).
//   3. Wrap the raw conn in a utls.UConn using the chosen ClientHelloID, set SNI
//      and ALPN from the profile, and perform the spoofed TLS handshake.
//   4. Extract the constructed JA3 from the marshaled ClientHello
//      (uconn.HandshakeState.Hello.Raw) BEFORE the handshake so it can be logged
//      and validated even if the remote never speaks back.

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	utls "github.com/refraction-networking/utls"
	"golang.org/x/net/proxy"
)

// pinJA3, when true, reorders the uTLS canned ClientHello's extensions to match
// the profile's recorded tls.extensions order (GREASE positions preserved). This
// defeats uTLS's per-build ShuffleChromeTLSExtensions, giving a STABLE JA3 that
// matches md5(profile.tls.ja3Full). Set from the -pin-ja3 flag in main.go.
var pinJA3 = true

// ClientHelloIDFromName maps the profile's tls.clientHelloId string to a utls
// ClientHelloID. Unknown / empty values fall back to HelloChrome_120 (the most
// common real-world fingerprint). Note: HelloIOS_16_0 is not present in
// refraction-networking/utls@v1.8.2 (latest iOS spec is 14); it is mapped to
// HelloIOS_14 and the substitution is logged by the caller.
func ClientHelloIDFromName(name string) utls.ClientHelloID {
	switch name {
	case "", "HelloChrome_Auto", "HelloChrome_120":
		return utls.HelloChrome_120
	case "HelloChrome_120_PQ":
		return utls.HelloChrome_120_PQ
	case "HelloFirefox_Auto", "HelloFirefox_120":
		return utls.HelloFirefox_120
	case "HelloSafari_Auto", "HelloSafari_16_0":
		return utls.HelloSafari_16_0
	case "HelloIOS_Auto", "HelloIOS_14", "HelloIOS_16_0": // 16_0 unavailable → fall back
		return utls.HelloIOS_14
	case "HelloEdge_Auto", "HelloEdge_85":
		return utls.HelloEdge_85
	case "HelloEdge_106":
		return utls.HelloEdge_106
	case "HelloRandomized":
		return utls.HelloRandomized
	case "HelloRandomizedALPN":
		return utls.HelloRandomizedALPN
	default:
		return utls.HelloChrome_120
	}
}

// httpProxyDialer implements proxy.Dialer by issuing an HTTP CONNECT to the
// upstream proxy for the requested target.
type httpProxyDialer struct {
	proxyAddr string
	auth      *proxy.Auth
	timeout   time.Duration
}

func (d *httpProxyDialer) Dial(network, addr string) (net.Conn, error) {
	return d.DialContext(context.Background(), network, addr)
}

func (d *httpProxyDialer) DialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	deadline, ok := ctx.Deadline()
	var timeout time.Duration
	if ok {
		timeout = time.Until(deadline)
	} else if d.timeout > 0 {
		timeout = d.timeout
	} else {
		timeout = 30 * time.Second
	}
	nc, err := net.DialTimeout("tcp", d.proxyAddr, timeout)
	if err != nil {
		return nil, fmt.Errorf("http-proxy dial %s: %w", d.proxyAddr, err)
	}
	if timeout > 0 {
		_ = nc.SetDeadline(time.Now().Add(timeout))
	}
	req := "CONNECT " + addr + " HTTP/1.1\r\nHost: " + addr + "\r\n"
	if d.auth != nil {
		// RFC 7617 Basic auth.
		creds := d.auth.User + ":" + d.auth.Password
		req += "Proxy-Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte(creds)) + "\r\n"
	}
	req += "\r\n"
	if _, err := nc.Write([]byte(req)); err != nil {
		nc.Close()
		return nil, fmt.Errorf("http-proxy write CONNECT: %w", err)
	}
	br := bufio.NewReader(nc)
	line, err := br.ReadString('\n')
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("http-proxy read status: %w", err)
	}
	if !strings.HasPrefix(strings.TrimSpace(line), "HTTP/1.1 200") &&
		!strings.HasPrefix(strings.TrimSpace(line), "HTTP/1.0 200") {
		nc.Close()
		return nil, fmt.Errorf("http-proxy CONNECT failed: %q", strings.TrimSpace(line))
	}
	// Drain remaining response headers up to the blank line.
	for {
		l, err := br.ReadString('\n')
		if err != nil {
			nc.Close()
			return nil, fmt.Errorf("http-proxy read headers: %w", err)
		}
		if l == "\r\n" || l == "\n" {
			break
		}
	}
	_ = nc.SetDeadline(time.Time{}) // clear deadline; caller manages timeouts
	return nc, nil
}

// dialUpstream returns a raw TCP conn to host:port, optionally tunneled through
// the profile's upstream proxy. The returned conn is NOT yet TLS-wrapped.
func dialUpstream(ctx context.Context, host string, port int, ps *ProxySpec) (net.Conn, error) {
	target := net.JoinHostPort(host, strconv.Itoa(port))
	if ps.IsDirect() {
		d := &net.Dialer{Timeout: 30 * time.Second}
		return d.DialContext(ctx, "tcp", target)
	}
	proxyAddr := net.JoinHostPort(ps.Host, strconv.Itoa(ps.Port))
	switch ps.Type {
	case "socks5":
		var auth *proxy.Auth
		if ps.Username != "" || ps.Password != "" {
			auth = &proxy.Auth{User: ps.Username, Password: ps.Password}
		}
		d, err := proxy.SOCKS5("tcp", proxyAddr, auth, &net.Dialer{Timeout: 30 * time.Second})
		if err != nil {
			return nil, fmt.Errorf("socks5 dialer init: %w", err)
		}
		if dc, ok := d.(proxy.ContextDialer); ok {
			return dc.DialContext(ctx, "tcp", target)
		}
		return d.Dial("tcp", target)
	case "http":
		var auth *proxy.Auth
		if ps.Username != "" || ps.Password != "" {
			auth = &proxy.Auth{User: ps.Username, Password: ps.Password}
		}
		d := &httpProxyDialer{proxyAddr: proxyAddr, auth: auth, timeout: 30 * time.Second}
		return d.DialContext(ctx, "tcp", target)
	default:
		return nil, fmt.Errorf("unsupported upstream proxy type %q", ps.Type)
	}
}

// DialResult is returned by DialUTLS.
type DialResult struct {
	UConn  *utls.UConn
	JA3    string // classic JA3 hash (md5 hex)
	JA3Str string // classic JA3 full string
	JA3Sig string // spec-variant JA3 hash (signature_algorithms in 5th field)
	ALPN   string // negotiated ALPN with the upstream ("h2" / "http/1.1" / "")
}

// DialUTLS dials host:port (optionally through profile.proxy), performs a uTLS
// handshake using the profile's ClientHelloID, and returns the established UConn
// along with the constructed JA3. SNI is set to `host`. ALPN is offered from
// profile.tls.alpn (falling back to ["h2","http/1.1"]).
//
// The JA3 is derived from the marshaled ClientHello bytes BEFORE the handshake,
// so it reflects exactly what we send on the wire and is available even if the
// upstream never responds.
func DialUTLS(ctx context.Context, host string, port int, prof *DeviceProfile) (*DialResult, error) {
	raw, err := dialUpstream(ctx, host, port, prof.Proxy)
	if err != nil {
		return nil, err
	}

	alpn := prof.TLS.ALPN
	if len(alpn) == 0 {
		alpn = []string{"h2", "http/1.1"}
	}

	cfg := &utls.Config{
		ServerName:         host,
		NextProtos:         alpn,
		InsecureSkipVerify: false,
	}
	helloID := ClientHelloIDFromName(prof.TLS.ClientHelloId)
	uconn := utls.UClient(raw, cfg, helloID)

	// Build the ClientHello once so we can extract the marshaled bytes for JA3.
	// BuildHandshakeState (loadSession=true) is the same path HandshakeContext
	// takes; calling it first sets build status so HandshakeContext won't redo it
	// (and JA3 stays stable across the two marshals since dynamic fields — random,
	// session_id — are excluded from JA3).
	if err := uconn.BuildHandshakeState(); err != nil {
		raw.Close()
		return nil, fmt.Errorf("utls build handshake state: %w", err)
	}

	// Optionally pin the extension order to the profile's recorded order so the
	// JA3 is STABLE and matches md5(profile.tls.ja3Full). uTLS's canned Chrome
	// (and other recent) specs call ShuffleChromeTLSExtensions on every build,
	// which makes the JA3 vary per connection — useless for anti-detect. Pinning
	// reorders the already-built extensions (which carry correct per-extension
	// DATA from the canned spec) to the profile order while keeping GREASE
	// extensions in their original relative positions. Re-marshal so Hello.Raw
	// reflects the new order before we compute JA3. HandshakeContext later sees
	// build status == BuildByUtls, skips the preset (no re-shuffle), and only
	// re-marshals (preserving our order) — so the wire JA3 equals our computed one.
	if pinJA3 && len(prof.TLS.Extensions) > 0 {
		reorderExtensions(uconn, prof.TLS.Extensions)
		if err := uconn.MarshalClientHello(); err != nil {
			raw.Close()
			return nil, fmt.Errorf("utls re-marshal after pin: %w", err)
		}
	}

	res := &DialResult{UConn: uconn}
	if rawHello := uconn.HandshakeState.Hello.Raw; len(rawHello) > 0 {
		if s, h, err := JA3FromRaw(rawHello); err == nil {
			res.JA3Str = s
			res.JA3 = h
		}
		if _, h, err := JA3SigAlgsFromRaw(rawHello); err == nil {
			res.JA3Sig = h
		}
	}

	if err := uconn.HandshakeContext(ctx); err != nil {
		raw.Close()
		return nil, fmt.Errorf("utls handshake to %s:%d: %w", host, port, err)
	}
	res.ALPN = uconn.ConnectionState().NegotiatedProtocol
	return res, nil
}

// hostFromURL extracts the host and port (defaulting 80/443) from a request URL.
func hostPortFromURL(u *url.URL) (string, int) {
	host := u.Hostname()
	portStr := u.Port()
	port, err := strconv.Atoi(portStr)
	if err != nil || port == 0 {
		if u.Scheme == "https" {
			port = 443
		} else {
			port = 80
		}
	}
	return host, port
}

// extID marshals a uTLS extension just enough to read its 2-byte type ID. The
// extension's Read is a non-stateful full-marshal (returns io.EOF), so calling it
// here does not corrupt the extension for the later real marshal.
func extID(ext utls.TLSExtension) uint16 {
	buf := make([]byte, ext.Len())
	n, _ := ext.Read(buf)
	if n < 2 {
		return 0
	}
	return binary.BigEndian.Uint16(buf[:2])
}

// reorderExtensions reorders uconn.Extensions so the NON-GREASE extensions appear
// in the order given by wantOrder, while GREASE extensions stay in their original
// relative positions (to keep the interleaving that real Chrome uses). Any
// non-GREASE extension NOT listed in wantOrder is DROPPED — this makes the non-
// GREASE presence+order exactly match the profile, so the JA3 (which strips
// GREASE) equals md5(profile.tls.ja3Full). Dropping is safe for a faithful
// profile (it records all JA3-relevant extensions); the canned HelloChrome_120
// spec's extra ECH (65037) and padding (21) extensions are exactly the ones this
// removes to align with a real Chrome capture. If a profile is incomplete and a
// dropped extension is needed for the handshake, disable -pin-ja3.
func reorderExtensions(uconn *utls.UConn, wantOrder []uint16) {
	type slot struct {
		ext     utls.TLSExtension
		id      uint16
		greased bool
	}
	slots := make([]slot, 0, len(uconn.Extensions))
	for _, e := range uconn.Extensions {
		id := extID(e)
		slots = append(slots, slot{ext: e, id: id, greased: isGREASE16(id)})
	}

	byID := make(map[uint16]utls.TLSExtension)
	for _, s := range slots {
		if !s.greased {
			if _, ok := byID[s.id]; !ok {
				byID[s.id] = s.ext
			}
		}
	}

	ordered := make([]utls.TLSExtension, 0, len(wantOrder))
	used := make(map[uint16]bool, len(byID))
	for _, id := range wantOrder {
		if ext, ok := byID[id]; ok && !used[id] {
			ordered = append(ordered, ext)
			used[id] = true
		}
	}

	// Re-interleave: walk original slots; GREASE keeps its GREASE ext; non-GREASE
	// pops the next entry from the profile-ordered list. Non-listed non-GREASE
	// extensions are simply not emitted (dropped).
	result := make([]utls.TLSExtension, 0, len(slots))
	oi := 0
	for _, s := range slots {
		if s.greased {
			result = append(result, s.ext)
		} else {
			if oi < len(ordered) {
				result = append(result, ordered[oi])
				oi++
			}
		}
	}
	uconn.Extensions = result
}
