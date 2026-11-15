#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PYTHON=${PYTHON:-/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12}
VENV="$ROOT/worker/.venv"

if [ ! -x "$VENV/bin/python" ]; then
  "$PYTHON" -m venv --system-site-packages "$VENV"
fi
"$VENV/bin/python" -m pip install --no-cache-dir -r "$ROOT/worker/requirements-local.txt"
