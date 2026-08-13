#!/usr/bin/env bash
# GhostFrame GUI launcher — invoked by the .desktop entry.
set -euo pipefail
ROOT="/home/onyx/ghostframe"
cd "$ROOT"
ELECTRON="$ROOT/node_modules/.bin/electron"

# Prefer native Wayland on Plasma; fall back to XWayland automatically if the plugin errors.
ARGS=(gui/ --enable-features=WaylandWindowDecorations)
if [ "${XDG_SESSION_TYPE:-}" = "wayland" ]; then
  ARGS+=(--ozone-platform=wayland)
fi

exec "$ELECTRON" "${ARGS[@]}" "$@"
