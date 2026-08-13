package main

// main.go — CLI entry point for the ghostproxy binary.
//
// Flags:
//   -addr       local listen address (default "127.0.0.1:8421")
//   -profile    path to a GhostFrame DeviceProfile JSON
//   -v          verbose: log constructed JA3 of every upstream CONNECT
//   -ca-dir     directory for the MITM CA (default ~/.ghostframe)
//   -selftest   dial a JA3 echo service once and report observed vs expected, then exit
//   -selftest-target  override the selftest echo endpoint (default tls.peet.ws:443)
//
// If -profile is empty, the GHOSTFRAME_PROFILE env var is used.

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// logf is the package-wide timestamped logger used by proxy.go and dialer.go.
func logf(format string, args ...any) {
	log.Printf(format, args...)
}

func main() {
	addr := flag.String("addr", "127.0.0.1:8421", "local listen address")
	profilePath := flag.String("profile", "", "path to DeviceProfile JSON (or set $GHOSTFRAME_PROFILE)")
	verbose := flag.Bool("v", false, "verbose: log constructed JA3 of each upstream CONNECT")
	caDir := flag.String("ca-dir", "", "directory for the MITM CA (default ~/.ghostframe)")
	selftest := flag.Bool("selftest", false, "dial a JA3 echo service once and exit")
	selftestTarget := flag.String("selftest-target", "tls.peet.ws:443", "echo service host:port for -selftest")
	pinJA3Flag := flag.Bool("pin-ja3", true, "reorder uTLS extensions to match profile.tls.extensions (stable JA3 = md5(profile.tls.ja3Full)); disable for raw uTLS canned-spec behavior")
	flag.Parse()
	pinJA3 = *pinJA3Flag

	resolved := ResolveProfilePath(*profilePath)
	if resolved == "" {
		fmt.Fprintln(os.Stderr, "ghostproxy: no profile (-profile or $GHOSTFRAME_PROFILE required)")
		flag.Usage()
		os.Exit(2)
	}
	prof, err := LoadProfile(resolved)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ghostproxy:", err)
		os.Exit(2)
	}
	logf("ghostproxy: profile %q loaded (id=%s clientHelloId=%s)", resolved, prof.ID, prof.TLS.ClientHelloId)

	dir := *caDir
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			fmt.Fprintln(os.Stderr, "ghostproxy: cannot resolve home dir:", err)
			os.Exit(2)
		}
		dir = filepath.Join(home, ".ghostframe")
	}

	if *selftest {
		os.Exit(runSelftest(prof, *selftestTarget, dir))
	}

	ca, err := LoadOrCreateCA(dir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ghostproxy: CA init failed:", err)
		os.Exit(1)
	}

	srv := &ProxyServer{
		Addr:    *addr,
		Profile: prof,
		CA:      ca,
		Verbose: *verbose,
	}
	if err := srv.ListenAndServe(); err != nil {
		fmt.Fprintln(os.Stderr, "ghostproxy:", err)
		os.Exit(1)
	}
}

// runSelftest dials target (default a JA3 echo service) via uTLS with the profile's
// ClientHelloID, prints the constructed JA3 and the profile's expected JA3, then
// issues a GET /api/all over the established conn and prints the observed JA3 the
// service reports. Returns the process exit code.
func runSelftest(prof *DeviceProfile, target, caDir string) int {
	// We still init the CA so a leaf could be used; not strictly needed for selftest
	// (we connect directly, not via the proxy), but cheap and keeps paths exercised.
	_, _ = LoadOrCreateCA(caDir)

	host, port, err := splitHostPortDefault(target, 443)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ghostproxy: bad -selftest-target:", err)
		return 2
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	res, err := DialUTLS(ctx, host, port, prof)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ghostproxy: selftest handshake to %s failed: %v\n", target, err)
		return 1
	}
	defer res.UConn.Close()

	fmt.Printf("selftest: target=%s clientHelloId=%s\n", target, prof.TLS.ClientHelloId)
	fmt.Printf("selftest: constructed JA3 hash = %s\n", res.JA3)
	fmt.Printf("selftest: constructed JA3 full = %s\n", res.JA3Str)
	fmt.Printf("selftest: constructed JA3(sigalgs variant) = %s\n", res.JA3Sig)
	fmt.Printf("selftest: profile expected JA3 hash = %s\n", prof.TLS.Ja3)
	if prof.TLS.Ja3 != "" {
		if prof.TLS.Ja3 == res.JA3 {
			fmt.Println("selftest: EXPECTED MATCH ✓")
		} else {
			fmt.Println("selftest: EXPECTED MISMATCH ✗ (uTLS spec may differ from the profile's recorded ja3)")
		}
	}
	fmt.Printf("selftest: negotiated ALPN = %q\n", res.ALPN)

	// Issue a GET over the uTLS conn and read what the echo service says about us.
	req := fmt.Sprintf("GET /api/all HTTP/1.1\r\nHost: %s\r\nUser-Agent: ghostproxy-selftest\r\nConnection: close\r\n\r\n", host)
	if _, err := res.UConn.Write([]byte(req)); err != nil {
		fmt.Fprintln(os.Stderr, "ghostproxy: selftest write GET:", err)
		return 1
	}
	body, _ := io.ReadAll(res.UConn)
	observed := extractJA3(body)
	if observed != "" {
		fmt.Printf("selftest: service-observed JA3 hash = %s\n", observed)
		if prof.TLS.Ja3 != "" && observed == prof.TLS.Ja3 {
			fmt.Println("selftest: OBSERVED MATCHES PROFILE ✓")
		}
		if observed == res.JA3 {
			fmt.Println("selftest: OBSERVED MATCHES CONSTRUCTED ✓")
		}
	} else {
		fmt.Println("selftest: (service did not return a parseable JA3; first 256 bytes below)")
		preview := string(body)
		if len(preview) > 256 {
			preview = preview[:256]
		}
		fmt.Println(preview)
	}
	return 0
}

var ja3HashRe = regexp.MustCompile(`(?i)"ja3_hash"\s*:\s*"([0-9a-f]{32})"`)
var ja3PlainRe = regexp.MustCompile(`(?i)"ja3"\s*:\s*"([0-9a-f]{32})"`)

// extractJA3 scans an HTTP response body for a JA3 hash in common JSON shapes
// (tls.peet.ws uses ja3_hash; ja3er uses ja3).
func extractJA3(body []byte) string {
	// The HTTP response has a status line + headers before the JSON. Drop them so
	// the regex does not pick up a header named "ja3".
	if i := strings.Index(string(body), "\r\n\r\n"); i >= 0 {
		body = body[i+4:]
	} else if i := strings.Index(string(body), "\n\n"); i >= 0 {
		body = body[i+2:]
	}
	if m := ja3HashRe.FindSubmatch(body); len(m) >= 2 {
		return strings.ToLower(string(m[1]))
	}
	if m := ja3PlainRe.FindSubmatch(body); len(m) >= 2 {
		return strings.ToLower(string(m[1]))
	}
	return ""
}
