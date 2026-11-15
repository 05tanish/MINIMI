#!/bin/sh
set -eu
DATA_DIR=${REDIS_DATA_DIR:-/private/tmp/minimi-audio-redis}
mkdir -p "$DATA_DIR"
if redis-cli -h 127.0.0.1 -p 6379 ping >/dev/null 2>&1; then
  echo "Redis is already responding on 127.0.0.1:6379"
  exit 0
fi
redis-server --daemonize yes --bind 127.0.0.1 --port 6379 --appendonly yes \
  --dir "$DATA_DIR" --pidfile "$DATA_DIR/redis.pid" --logfile "$DATA_DIR/redis.log"
redis-cli -h 127.0.0.1 -p 6379 ping
