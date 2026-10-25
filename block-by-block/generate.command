#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$ROOT/worlds/dolores-park" "$ROOT/logs"
# Arnis creates a new numbered world; existing edited worlds are preserved.
"$ROOT/apps/arnis-mac-universal" --luanti \
  --bbox='37.7580,-122.4295,37.7625,-122.4245' \
  --output-dir="$ROOT/worlds/dolores-park" \
  --spawn-lat=37.7596 --spawn-lng=-122.4269 --fillground \
  2>&1 | tee "$ROOT/logs/generation-$(date +%Y%m%d-%H%M%S).log"
