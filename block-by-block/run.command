#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
export LUANTI_USER_PATH="$ROOT/runtime"
mkdir -p "$LUANTI_USER_PATH/games" "$ROOT/logs"
if [ ! -e "$LUANTI_USER_PATH/games/mineclonia" ]; then
  ln -s "$ROOT/games/mineclonia" "$LUANTI_USER_PATH/games/mineclonia"
fi
exec "$ROOT/apps/luanti.app/Contents/MacOS/luanti" \
  --config "$ROOT/luanti.conf" \
  --world "$ROOT/worlds/dolores-park/Arnis Luanti World 1" \
  --logfile "$ROOT/logs/luanti.log" --name Planner --go "$@"
