package main

// profile.go — loads an active GhostFrame DeviceProfile (netlayer subset) from a
// JSON file path. The full profile JSON is produced by Stage 1 and lives under
// /home/onyx/ghostframe/data/profiles/. We only decode the fields netlayer needs.

import (
	"encoding/json"
	"fmt"
	"os"
)

// LoadProfile reads and parses a DeviceProfile JSON file, returning the
// netlayer-relevant subset. Extra top-level fields in the JSON are ignored.
func LoadProfile(path string) (*DeviceProfile, error) {
	if path == "" {
		return nil, fmt.Errorf("profile path is empty (set -profile or $GHOSTFRAME_PROFILE)")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read profile %q: %w", path, err)
	}
	var p DeviceProfile
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, fmt.Errorf("unmarshal profile %q: %w", path, err)
	}
	if p.TLS.ClientHelloId == "" {
		return nil, fmt.Errorf("profile %q: tls.clientHelloId is required", path)
	}
	return &p, nil
}

// ResolveProfilePath returns the profile path from an explicit arg, falling back
// to the GHOSTFRAME_PROFILE env var when the arg is empty.
func ResolveProfilePath(flagPath string) string {
	if flagPath != "" {
		return flagPath
	}
	return os.Getenv("GHOSTFRAME_PROFILE")
}
