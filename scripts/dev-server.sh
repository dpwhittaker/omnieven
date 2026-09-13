#!/usr/bin/env bash
# Start/stop/restart a local dev server (logs in /tmp/omni.log).
set -euo pipefail
cd "$(dirname "$0")/.."
PIDF=/tmp/omni.pid
stop() { [ -f $PIDF ] && kill "$(cat $PIDF)" 2>/dev/null || true; rm -f $PIDF; }
start() {
  PORT="${PORT:-7788}" PUBLIC_URL="${PUBLIC_URL:-http://localhost:${PORT:-7788}}" nohup node server/index.ts > /tmp/omni.log 2>&1 &
  echo $! > $PIDF; sleep 1.5; head -12 /tmp/omni.log
}
case "${1:-restart}" in
  start) start;; stop) stop;; restart) stop; start;; log) tail -n "${2:-40}" /tmp/omni.log;;
esac
