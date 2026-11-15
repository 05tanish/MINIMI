#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PYTHON=${PYTHON:-"$ROOT/worker/.venv/bin/python"}
MODE=${1:-api}

if [ ! -f "$ROOT/.env" ]; then
  echo "Missing project .env file" >&2
  exit 1
fi
if [ ! -x "$PYTHON" ]; then
  echo "Run sh worker/setup-local.sh first" >&2
  exit 1
fi

export PYTHONPATH="$ROOT/worker"
export REDIS_URL=redis://127.0.0.1:6379/0
export CELERY_BROKER_URL=redis://127.0.0.1:6379/0
export CELERY_RESULT_BACKEND=redis://127.0.0.1:6379/1
export WORKER_STORAGE_DIR=${WORKER_STORAGE_DIR_LOCAL:-/private/tmp/minimi-audio}
mkdir -p "$WORKER_STORAGE_DIR"
cd "$ROOT/worker"

case "$MODE" in
  api) exec "$PYTHON" -m dotenv -f "$ROOT/.env" run -- "$PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port 8001 ;;
  celery) exec "$PYTHON" -m dotenv -f "$ROOT/.env" run -- "$PYTHON" -m celery -A app.celery_app:celery_app worker --loglevel=INFO --concurrency=1 ;;
  *) echo "Usage: sh worker/run-local.sh [api|celery]" >&2; exit 2 ;;
esac
