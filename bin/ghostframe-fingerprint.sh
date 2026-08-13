#!/usr/bin/env bash
# Quick one-shot fingerprint for a profile (used by the .desktop action / CLI convenience).
set -euo pipefail
ROOT="/home/onyx/ghostframe"
cd "$ROOT"
PROFILE="${1:-win11-chrome-130}"
exec "$ROOT/node_modules/.bin/tsx" src/cli/index.ts fingerprint "$PROFILE"
