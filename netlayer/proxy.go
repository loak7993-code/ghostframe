package main

// proxy.go — the local MITM proxy server.
//
// High-level flow for the common case (browser → https site via CONNECT):
//
//   browser ──TLS(leaf signed by our CA)── ghostproxy ──TLS(uTLS spoofed
//   ClientHello)── target
//
// We MUST terminate TLS on both sides. Tunnelling CONNECT transparently would let
// the browser do its own TLS to the target and we would have no way to control the
// JA3. So:
//   1. Parse CONNECT host:port.
//   2. Dial the target (optionally via profile.proxy) and complete a uTLS handshake
//      with the profile's ClientHelloID → this fixes JA3/JA4 to match the profile.
//   3. Generate (and cache) a leaf cert for the SNI hostname, signed by our CA.
//   4. Reply "200 Connection Established" to the browser.
//   5. Wrap the browser conn in tls.Server with the leaf cert and ALPN matching the
//      upstream's negotiated protocol, and complete the browser-side handshake.
//   6. Pipe decrypted bytes both ways (h2 frames or HTTP/1.1).
//
// The CA is an ed25519 self-signed cert generated on first run and persisted to
// ~/.ghostframe/ca.crt + ~/.ghostframe/ca.key. Stage 3 (the TS launcher) installs
// ca.crt into the browser profile's user-data-dir / NSS cert DB so the browser
// trusts our leaves without --ignore-certificate-errors.
//
// WebRTC / STUN de-leaking (point 6 of the Stage 4 spec): intentionally NOT
// implemented here. ghostproxy is transport-layer and speaks TLS, not the
// browser's JS — RTCPeerConnection ICE gathering (the actual local-IP leak) is
// handled by the JS inject layer (mangles ICE candidates / pins profile.webrtc).
// A STUN-packet strip hook could be added in pipeBoth by inspecting UDP-ish
// payloads, but since CONNECT only carries TCP/TLS, and the real defense is at
// the RTCPeerConnection API, this layer does not strip STUN. (TODO: optional
// outbound UDP STUN blackhole if a future stage routes UDP through us.)

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ---------- MITM CA + per-host leaf certs ----------

// mitmCA holds the signing CA and a per-hostname leaf cert cache.
type mitmCA struct {
	cert  *x509.Certificate
	caDER []byte
	priv  ed25519.PrivateKey

	leafMu sync.Mutex
	leafs  map[string]*tls.Certificate
}

// LoadOrCreateCA loads the CA from <dir>/ca.crt + ca.key, or generates a fresh
// ed25519 CA and persists it. dir defaults to ~/.ghostframe.
func LoadOrCreateCA(dir string) (*mitmCA, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create CA dir: %w", err)
	}
	crtPath := filepath.Join(dir, "ca.crt")
	keyPath := filepath.Join(dir, "ca.key")
	ca := &mitmCA{leafs: make(map[string]*tls.Certificate)}

	if certPEM, err := os.ReadFile(crtPath); err == nil {
		keyPEM, errK := os.ReadFile(keyPath)
		if errK == nil {
			kb, _ := pem.Decode(keyPEM)
			cb, _ := pem.Decode(certPEM)
			if kb != nil && cb != nil {
				pk, perr := x509.ParsePKCS8PrivateKey(kb.Bytes)
				if perr == nil {
					if ed, ok := pk.(ed25519.PrivateKey); ok {
						c, cerr := x509.ParseCertificate(cb.Bytes)
						if cerr == nil && c.IsCA {
							ca.cert, ca.caDER, ca.priv = c, c.Raw, ed
							logf("ghostproxy: loaded CA from %s", crtPath)
							return ca, nil
						}
					}
				}
			}
		}
	}

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("gen CA key: %w", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{Organization: []string{"GhostFrame"}, CommonName: "GhostFrame Root CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().AddDate(10, 0, 0),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign | x509.KeyUsageDigitalSignature,
		IsCA:                  true,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, pub, priv)
	if err != nil {
		return nil, fmt.Errorf("create CA cert: %w", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, err
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}), 0o600); err != nil {
		return nil, err
	}
	if err := os.WriteFile(crtPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o644); err != nil {
		return nil, err
	}
	ca.cert, ca.caDER, ca.priv = cert, der, priv
	logf("ghostproxy: generated new CA at %s — install ca.crt into the browser profile so leaves are trusted", crtPath)
	return ca, nil
}

// randomSerial returns a positive 128-bit serial suitable for a leaf cert.
func randomSerial() *big.Int {
	for {
		b := make([]byte, 16)
		_, _ = rand.Read(b)
		n := new(big.Int).SetBytes(b)
		if n.Sign() > 0 {
			return n
		}
	}
}

// Leaf returns a cached or freshly-generated TLS leaf certificate for host,
// signed by the CA. IP-literal hosts get an IP SAN; DNS hosts get a DNS SAN.
func (ca *mitmCA) Leaf(host string) (*tls.Certificate, error) {
	ca.leafMu.Lock()
	defer ca.leafMu.Unlock()
	if c, ok := ca.leafs[host]; ok {
		return c, nil
	}
	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	tmpl := &x509.Certificate{
		SerialNumber:          randomSerial(),
		Subject:               pkix.Name{Organization: []string{"GhostFrame"}, CommonName: host},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().AddDate(1, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	if ip := net.ParseIP(host); ip != nil {
		tmpl.IPAddresses = []net.IP{ip}
	} else {
		tmpl.DNSNames = []string{host}
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, ca.cert, &leafKey.PublicKey, ca.priv)
	if err != nil {
		return nil, err
	}
	leaf := &tls.Certificate{Certificate: [][]byte{der, ca.caDER}, PrivateKey: leafKey}
	ca.leafs[host] = leaf
	return leaf, nil
}

// ---------- proxy server ----------

// ProxyServer is the local HTTP/CONNECT proxy.
type ProxyServer struct {
	Addr    string
	Profile *DeviceProfile
	CA      *mitmCA
	Verbose bool
	ln      net.Listener
}

// ListenAndServe binds Addr and serves proxy connections.
func (s *ProxyServer) ListenAndServe() error {
	ln, err := net.Listen("tcp", s.Addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", s.Addr, err)
	}
	s.ln = ln
	logf("ghostproxy: listening on %s (clientHelloId=%s)", s.Addr, s.Profile.TLS.ClientHelloId)
	for {
		c, err := ln.Accept()
		if err != nil {
			return err
		}
		go s.handle(c)
	}
}

// handle dispatches one client connection to CONNECT or plain-HTTP handling.
func (s *ProxyServer) handle(c net.Conn) {
	defer c.Close()
	br := bufio.NewReaderSize(c, 8192)
	firstLine, err := br.ReadString('\n')
	if err != nil {
		return
	}
	firstLine = strings.TrimRight(firstLine, "\r\n")
	parts := strings.SplitN(firstLine, " ", 3)
	if len(parts) < 3 {
		return
	}
	method, target, _ := parts[0], parts[1], parts[2]

	// Read and discard request headers (we re-derive what we need).
	if err := readHeaders(br); err != nil {
		return
	}

	switch method {
	case "CONNECT":
		s.handleConnect(c, target)
	default:
		// Plain HTTP proxy request with absolute URI (e.g. "GET http://host/path").
		// Buffered bytes in br (if any) belong to the request body; prepend them.
		s.handlePlainHTTP(c, br, method, target)
	}
}

// handleConnect does the MITM TLS handshake to both sides and pipes bytes.
func (s *ProxyServer) handleConnect(c net.Conn, target string) {
	host, port, err := splitHostPortDefault(target, 443)
	if err != nil {
		writeSimple(c, "HTTP/1.1 400 Bad Request\r\n\r\n")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	res, err := DialUTLS(ctx, host, port, s.Profile)
	if err != nil {
		logf("ghostproxy: CONNECT %s upstream dial failed: %v", target, err)
		writeSimple(c, "HTTP/1.1 502 Bad Gateway\r\n\r\n")
		return
	}
	upstream := res.UConn
	defer upstream.Close()

	if s.Verbose {
		s.logJA3(host, port, res)
	}

	leaf, err := s.CA.Leaf(host)
	if err != nil {
		logf("ghostproxy: leaf cert for %s failed: %v", host, err)
		writeSimple(c, "HTTP/1.1 502 Bad Gateway\r\n\r\n")
		return
	}

	if _, err := c.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n")); err != nil {
		return
	}

	// Offer the browser exactly the ALPN the upstream negotiated (so the piped
	// frames are mutually intelligible). For h2 we also offer http/1.1 so the
	// browser falls back gracefully if it rejects h2.
	alpn := res.ALPN
	if alpn == "" {
		alpn = "http/1.1"
	}
	offer := []string{alpn}
	if alpn == "h2" {
		offer = []string{"h2", "http/1.1"}
	}
	tlsCfg := &tls.Config{Certificates: []tls.Certificate{*leaf}, NextProtos: offer}
	brTLS := tls.Server(c, tlsCfg)
	hsCtx, hsCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer hsCancel()
	if err := brTLS.HandshakeContext(hsCtx); err != nil {
		logf("ghostproxy: browser-side TLS handshake for %s failed: %v", host, err)
		return
	}

	pipeBoth(brTLS, upstream)
}

// logJA3 logs the constructed JA3 (and the spec-variant) plus a match/mismatch
// against the profile's expected tls.ja3 when -v is on.
func (s *ProxyServer) logJA3(host string, port int, res *DialResult) {
	exp := strings.TrimSpace(s.Profile.TLS.Ja3)
	tag := ""
	if exp != "" {
		if exp == res.JA3 {
			tag = " [MATCH expected]"
		} else {
			tag = fmt.Sprintf(" [MISMATCH expected=%s]", exp)
		}
	}
	logf("ghostproxy: CONNECT %s:%d clientHelloId=%s ja3=%s ja3Full=%q ja3Sig=%s alpn=%q%s",
		host, port, s.Profile.TLS.ClientHelloId, res.JA3, res.JA3Str, res.JA3Sig, res.ALPN, tag)
}

// handlePlainHTTP forwards an absolute-URI HTTP request to the origin, rewriting
// the request-target to origin form and reordering/recasing headers per the
// profile. No TLS is used on the upstream side for plain http:// (we do not
// upgrade). This is the uncommon path.
func (s *ProxyServer) handlePlainHTTP(c net.Conn, br *bufio.Reader, method, absTarget string) {
	uri, err := parseAbsoluteURI(absTarget)
	if err != nil {
		writeSimple(c, "HTTP/1.1 400 Bad Request\r\n\r\n")
		return
	}
	host, port := hostPortFromURL(uri)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	upstream, err := dialUpstream(ctx, host, port, s.Profile.Proxy)
	if err != nil {
		writeSimple(c, "HTTP/1.1 502 Bad Gateway\r\n\r\n")
		return
	}
	defer upstream.Close()

	order := s.Profile.HTTPHeaders.Order
	casing := s.Profile.HTTPHeaders.Casing
	reqLine := fmt.Sprintf("%s %s HTTP/1.1\r\n", method, uri.RequestURI())
	hostHeader := uri.Host
	if _, ok := casing["host"]; ok {
		hostHeader = casing["host"]
	}
	hdr := http.Header{}
	hdr.Set("Host", uri.Host)
	hdr = applyHeaderCasing(orderHeaders(hdr, order), casing)
	var sb strings.Builder
	sb.WriteString(reqLine)
	sb.WriteString(fmt.Sprintf("%s: %s\r\n", firstKey(hdr), hostHeader))
	sb.WriteString("\r\n")
	if _, err := upstream.Write([]byte(sb.String())); err != nil {
		return
	}
	// Forward any buffered request body bytes from br, then pipe the response back.
	if n := br.Buffered(); n > 0 {
		if b, err := br.Peek(n); err == nil {
			_, _ = upstream.Write(b)
		}
	}
	go func() { _, _ = io.Copy(upstream, br) }()
	_, _ = io.Copy(c, upstream)
}

// ---------- helpers ----------

// pipeBoth copies bytes in both directions until one side closes, then closes both.
func pipeBoth(a, b net.Conn) {
	done := make(chan struct{}, 2)
	cp := func(dst net.Conn, src net.Conn) {
		_, _ = io.Copy(dst, src)
		if tl, ok := dst.(interface{ CloseWrite() error }); ok {
			_ = tl.CloseWrite()
		}
		done <- struct{}{}
	}
	go cp(a, b)
	go cp(b, a)
	<-done
	_ = a.Close()
	_ = b.Close()
}

func readHeaders(br *bufio.Reader) error {
	for {
		l, err := br.ReadString('\n')
		if err != nil {
			return err
		}
		if l == "\r\n" || l == "\n" {
			return nil
		}
	}
}

func writeSimple(c net.Conn, s string) {
	_, _ = c.Write([]byte(s))
}

func splitHostPortDefault(target string, defPort int) (string, int, error) {
	if !strings.Contains(target, ":") {
		return target, defPort, nil
	}
	host, portStr, err := net.SplitHostPort(target)
	if err != nil {
		return "", 0, err
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		return "", 0, err
	}
	return host, port, nil
}

func parseAbsoluteURI(s string) (*url.URL, error) {
	if !strings.HasPrefix(s, "http://") && !strings.HasPrefix(s, "https://") {
		return nil, errors.New("plain HTTP proxy request is not an absolute URI")
	}
	return url.Parse(s)
}

func firstKey(h http.Header) string {
	for k := range h {
		return k
	}
	return "Host"
}
