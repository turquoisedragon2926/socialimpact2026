#!/bin/zsh
set -eu
cd "${0:A:h}"
exec uv run uvicorn server:app --host 127.0.0.1 --port 8780
