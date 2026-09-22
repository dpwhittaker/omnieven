#!/usr/bin/env bash
# Pixel-exact rendering without the glasses: run Omni's client in the Even Hub
# simulator (headless, under Xvfb) against a throwaway server, like the fake
# client's --sandbox. Blocks until Ctrl-C / SIGTERM, then tears everything down.
#
#   scripts/simulator.sh                       # prints the server + simulator URLs when ready
#   curl -s http://127.0.0.1:9898/api/screenshot/glasses > shot.png   # 576×288 RGBA: alpha > 0 = lit pixel
#   curl -s -X POST http://127.0.0.1:9898/api/input -H 'content-type: application/json' -d '{"action":"up"}'
#       # actions: up down click double_click long_press long_press_release context_menu
#   curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/api/show -d '{"view":"…"}' …   # any view
#
# Needs xvfb-run and the simulator binary: EVENHUB_SIM=<path>, or the first
# */node_modules/@evenrealities/sim-linux-x64/bin/evenhub-simulator under
# ~/projects (install one with `npm i -D @evenrealities/evenhub-simulator`).
# Env: PORT (server, default 7799), SIM_PORT (automation API, default 9898).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-7799}"; SIM_PORT="${SIM_PORT:-9898}"
SIM="${EVENHUB_SIM:-$(ls ~/projects/*/node_modules/@evenrealities/sim-linux-x64/bin/evenhub-simulator 2>/dev/null | head -1 || true)}"
[ -x "$SIM" ] || { echo "simulator binary not found (set EVENHUB_SIM)" >&2; exit 1; }
command -v xvfb-run >/dev/null || { echo "xvfb-run not found (apt install xvfb)" >&2; exit 1; }

DATA=$(mktemp -d -t omni-sim-XXXXXX)
[ -f "${OMNI_DATA_DIR:-data}/config.json" ] && cp "${OMNI_DATA_DIR:-data}/config.json" "$DATA/"   # same gestures / homeApp as live
TOKEN=$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')
SERVER_PID=""; SIM_PID=""
# The simulator runs in its own process group so one kill takes xvfb-run, Xvfb and the binary.
cleanup() { [ -n "$SIM_PID" ] && kill -- -"$SIM_PID" 2>/dev/null; [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null; wait 2>/dev/null; rm -rf "$DATA"; }
trap cleanup EXIT
trap 'exit 0' INT TERM

PORT="$PORT" HOST=127.0.0.1 OMNI_DATA_DIR="$DATA" OMNI_TOKEN="$TOKEN" PUBLIC_URL="http://127.0.0.1:$PORT" \
  node server/index.ts --omni-simulator > "$DATA/server.log" 2>&1 &
SERVER_PID=$!
curl -s --retry 30 --retry-delay 1 --retry-connrefused --retry-all-errors -o /dev/null "http://127.0.0.1:$PORT/healthz" \
  || { echo "server did not come up:" >&2; tail -20 "$DATA/server.log" >&2; exit 1; }

setsid xvfb-run -a -s "-screen 0 1280x800x24" "$SIM" --automation-port "$SIM_PORT" "http://127.0.0.1:$PORT/app/?token=$TOKEN" > "$DATA/sim.log" 2>&1 &
SIM_PID=$!
curl -s --retry 40 --retry-delay 1 --retry-connrefused --retry-all-errors -o /dev/null "http://127.0.0.1:$SIM_PORT/api/ping" \
  || { echo "simulator did not come up:" >&2; tail -20 "$DATA/sim.log" >&2; exit 1; }
for _ in $(seq 1 30); do
  curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/api/status" | grep -q '"device":{"model":"g2"' && break
  sleep 1
done
echo "server    http://127.0.0.1:$PORT  token $TOKEN  (curl -H \"Authorization: Bearer $TOKEN\" …/api/screen)"
echo "simulator http://127.0.0.1:$SIM_PORT  (GET /api/screenshot/glasses, POST /api/input)"
echo "logs      $DATA/server.log  $DATA/sim.log   — Ctrl-C stops both"
wait "$SIM_PID"
