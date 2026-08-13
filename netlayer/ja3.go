package main

// ja3.go — JA3 fingerprint computation.
//
// JA3 (Salesforce, 2017) summarizes a TLS ClientHello as:
//
//	tls_version,ciphers,extensions,elliptic_curves,ec_point_formats
//
// where each comma-separated section is a dash-joined list of decimal IDs in wire
// order. GREASE values (RFC 8701) are stripped. The JA3 *string* is then md5-hashed
// and the hex digest is the JA3 *hash*.
//
// The Stage 4 spec described the 5th field as "signature_algorithms" rather than
// "ec_point_formats". That is NOT the classic JA3 used by public databases
// (ja3er.com, tls.peet.ws, Salesforce ja3). Since the DeviceProfile.tls.ja3 field
// is meant for validation against such databases, we compute the CLASSIC JA3 as
// the canonical value, and additionally expose the spec's variant (signature
// algorithms) as JA3SigAlgs. Both are logged under -v so a profile author can
// validate against either.
//
// We compute JA3 from the raw marshaled ClientHello bytes (utls
// UConn.HandshakeState.Hello.Raw), which are the exact bytes that go on the wire.
// This is strictly more accurate than walking the ClientHelloSpec, because uTLS
// may append/patch dynamic extensions (SNI, ALPN, session ticket) that the static
// spec does not enumerate — and because the spec stores TLSExtension objects whose
// IDs must be re-derived. Parsing the marshaled bytes gives ground truth.

import (
	"crypto/md5"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

// isGREASE16 reports whether v is a 16-bit RFC 8701 GREASE value (0x?A?A).
func isGREASE16(v uint16) bool {
	return (v & 0x0f0f) == 0x0a0a
}

// parsedClientHello holds the JA3-relevant fields extracted from a ClientHello.
type parsedClientHello struct {
	Version        uint16
	CipherSuites   []uint16
	Extensions     []uint16
	EllipticCurves []uint16 // supported_groups (extension 0x000a)
	ECPointFormats []uint8  // ec_point_formats (extension 0x000b)
	SignatureAlgs  []uint16 // signature_algorithms (extension 0x000d)
}

const (
	extSupportedGroups     uint16 = 0x000a
	extECPointFormats      uint16 = 0x000b
	extSignatureAlgorithms uint16 = 0x000d
)

type byteReader struct {
	b   []byte
	pos int
}

func (r *byteReader) remaining() int { return len(r.b) - r.pos }
func (r *byteReader) read(n int) ([]byte, error) {
	if r.pos+n > len(r.b) {
		return nil, fmt.Errorf("ja3: short read: want %d, have %d", n, r.remaining())
	}
	out := r.b[r.pos : r.pos+n]
	r.pos += n
	return out, nil
}
func (r *byteReader) u8() (uint8, error) {
	b, err := r.read(1)
	if err != nil {
		return 0, err
	}
	return b[0], nil
}
func (r *byteReader) u16() (uint16, error) {
	b, err := r.read(2)
	if err != nil {
		return 0, err
	}
	return binary.BigEndian.Uint16(b), nil
}
func (r *byteReader) u16N(count int) ([]uint16, error) {
	out := make([]uint16, count)
	for i := 0; i < count; i++ {
		v, err := r.u16()
		if err != nil {
			return nil, err
		}
		out[i] = v
	}
	return out, nil
}
func (r *byteReader) u8N(count int) ([]uint8, error) {
	out := make([]uint8, count)
	for i := 0; i < count; i++ {
		v, err := r.u8()
		if err != nil {
			return nil, err
		}
		out[i] = v
	}
	return out, nil
}

// parseClientHello parses a ClientHello from raw bytes, accepting any of:
//   - a full TLS record (starts with 0x16 0x03 0x0X <len:2> <handshake>)
//   - a bare handshake message (starts with 0x01 <len:3> <body>)
//   - the ClientHello body itself (starts with <version:2> <random:32> ...)
//
// utls HandshakeState.Hello.Raw is the bare-handshake-message form (starts 0x01).
func parseClientHello(raw []byte) (*parsedClientHello, error) {
	if len(raw) < 38 {
		return nil, errors.New("ja3: ClientHello too short")
	}
	// Strip TLS record header if present (ContentType=22, LegacyVersion=0x03xx).
	if raw[0] == 0x16 && raw[1] == 0x03 {
		if len(raw) < 5 {
			return nil, errors.New("ja3: truncated TLS record header")
		}
		raw = raw[5:]
	}
	// Strip handshake header if present (HandshakeType=1 ClientHello).
	if raw[0] == 0x01 && len(raw) >= 4 {
		// 1 byte type + 3 byte length; validate length fits.
		bodyLen := int(raw[1])<<16 | int(raw[2])<<8 | int(raw[3])
		if 4+bodyLen <= len(raw) {
			raw = raw[4 : 4+bodyLen]
		} else {
			// length is bogus (e.g. uTLS appended trailing); just strip the header.
			raw = raw[4:]
		}
	}

	r := &byteReader{b: raw}
	p := &parsedClientHello{}

	ver, err := r.u16()
	if err != nil {
		return nil, err
	}
	p.Version = ver

	if _, err := r.read(32); err != nil { // random
		return nil, err
	}

	sidLen, err := r.u8()
	if err != nil {
		return nil, err
	}
	if _, err := r.read(int(sidLen)); err != nil { // session_id
		return nil, err
	}

	csLen, err := r.u16()
	if err != nil {
		return nil, err
	}
	if csLen%2 != 0 {
		return nil, errors.New("ja3: odd cipher_suites length")
	}
	p.CipherSuites, err = r.u16N(int(csLen) / 2)
	if err != nil {
		return nil, err
	}

	cmLen, err := r.u8()
	if err != nil {
		return nil, err
	}
	if _, err := r.read(int(cmLen)); err != nil { // compression_methods
		return nil, err
	}

	// Extensions are optional in the ClientHello (legacy clients may omit them).
	if r.remaining() < 2 {
		return p, nil
	}
	extTotal, err := r.u16()
	if err != nil {
		return nil, err
	}
	if r.remaining() < int(extTotal) {
		// Tolerate trailing truncation: clamp to what remains.
		extTotal = uint16(r.remaining())
	}
	extEnd := r.pos + int(extTotal)
	for r.pos < extEnd {
		extType, err := r.u16()
		if err != nil {
			return nil, err
		}
		extLen, err := r.u16()
		if err != nil {
			return nil, err
		}
		extData, err := r.read(int(extLen))
		if err != nil {
			return nil, err
		}
		p.Extensions = append(p.Extensions, extType)

		er := &byteReader{b: extData}
		switch extType {
		case extSupportedGroups:
			if gl, err := er.u16(); err == nil && int(gl) <= er.remaining() {
				p.EllipticCurves, _ = er.u16N(int(gl) / 2)
			}
		case extECPointFormats:
			if fl, err := er.u8(); err == nil && int(fl) <= er.remaining() {
				p.ECPointFormats, _ = er.u8N(int(fl))
			}
		case extSignatureAlgorithms:
			if sl, err := er.u16(); err == nil && int(sl) <= er.remaining() {
				p.SignatureAlgs, _ = er.u16N(int(sl) / 2)
			}
		}
	}
	return p, nil
}

// joinDecimals joins decimal representations of a uint16 slice, skipping GREASE,
// with '-' as the field separator. Used for the cipher/extension/curve sections.
func joinDecimals16(v []uint16) string {
	parts := make([]string, 0, len(v))
	for _, x := range v {
		if isGREASE16(x) {
			continue
		}
		parts = append(parts, fmt.Sprintf("%d", x))
	}
	return strings.Join(parts, "-")
}

// joinDecimals8 joins decimal representations of a uint8 slice (ec_point_formats),
// with '-' as the separator. (Point formats are not GREASEd in practice.)
func joinDecimals8(v []uint8) string {
	parts := make([]string, 0, len(v))
	for _, x := range v {
		parts = append(parts, fmt.Sprintf("%d", x))
	}
	return strings.Join(parts, "-")
}

// JA3String computes the classic JA3 string from a parsed ClientHello:
// "version,ciphers,extensions,elliptic_curves,ec_point_formats".
func JA3String(p *parsedClientHello) string {
	return strings.Join([]string{
		fmt.Sprintf("%d", p.Version),
		joinDecimals16(p.CipherSuites),
		joinDecimals16(p.Extensions),
		joinDecimals16(p.EllipticCurves),
		joinDecimals8(p.ECPointFormats),
	}, ",")
}

// JA3SigAlgsString computes the variant described in the Stage 4 spec, where the
// 5th field is signature_algorithms instead of ec_point_formats.
func JA3SigAlgsString(p *parsedClientHello) string {
	return strings.Join([]string{
		fmt.Sprintf("%d", p.Version),
		joinDecimals16(p.CipherSuites),
		joinDecimals16(p.Extensions),
		joinDecimals16(p.EllipticCurves),
		joinDecimals16(p.SignatureAlgs),
	}, ",")
}

// md5Hex returns the lowercase hex md5 of s.
func md5Hex(s string) string {
	sum := md5.Sum([]byte(s))
	return hex.EncodeToString(sum[:])
}

// JA3FromRaw returns (classicJA3String, classicJA3Hash, error) for raw ClientHello bytes.
func JA3FromRaw(raw []byte) (string, string, error) {
	p, err := parseClientHello(raw)
	if err != nil {
		return "", "", err
	}
	s := JA3String(p)
	return s, md5Hex(s), nil
}

// JA3SigAlgsFromRaw returns (ja3SigAlgsString, ja3SigAlgsHash, error).
func JA3SigAlgsFromRaw(raw []byte) (string, string, error) {
	p, err := parseClientHello(raw)
	if err != nil {
		return "", "", err
	}
	s := JA3SigAlgsString(p)
	return s, md5Hex(s), nil
}
