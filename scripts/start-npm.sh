#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WATCH_SCHEMA=0
for arg in "$@"; do
  case "$arg" in
    --watch-schema) WATCH_SCHEMA=1 ;;
    *)
      echo "error: unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

PORT="${PORT:-53681}"
APP_BASE_URL="${APP_BASE_URL:-http://127.0.0.1:${PORT}}"
export APP_BASE_URL

DATA_DIR="${DATA_DIR:-${HOME}/.cache/find-that-session}"
mkdir -p "$DATA_DIR"
PID_FILE="$DATA_DIR/app.pid"
LOG_FILE="$DATA_DIR/app.log"

if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm not found on PATH" >&2
  exit 1
fi

if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "Installing dependencies…"
  npm install
fi

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${old_pid}" ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "error: app already running (pid $old_pid)" >&2
    echo "stop: ./scripts/stop-npm.sh" >&2
    exit 1
  fi
  rm -f "$PID_FILE"
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "error: port ${PORT} is already in use" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2 || true
  echo "stop docker with ./scripts/stop.sh, or free the port and retry" >&2
  exit 1
fi

# Raise open-file limit when possible (large ~/.claude/projects trees).
ulimit -n 10240 2>/dev/null || true

echo "Starting Find That Session (npm)…"
# Detach so IDE/shell cleanup does not kill the server.
if command -v setsid >/dev/null 2>&1; then
  setsid npm run dev >>"$LOG_FILE" 2>&1 </dev/null &
else
  nohup npm run dev >>"$LOG_FILE" 2>&1 </dev/null &
fi
pid=$!
echo "$pid" >"$PID_FILE"
disown "$pid" 2>/dev/null || true

echo "Waiting for ${APP_BASE_URL}…"
ready=0
for _ in $(seq 1 90); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "error: app process exited early (pid $pid)" >&2
    echo "check: $LOG_FILE" >&2
    rm -f "$PID_FILE"
    exit 1
  fi
  if curl -sf "${APP_BASE_URL}/api/status" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done

if [[ "$ready" -ne 1 ]]; then
  echo "error: app did not become ready in time" >&2
  echo "check: $LOG_FILE" >&2
  exit 1
fi

echo "App is up at ${APP_BASE_URL} (pid $pid)"
echo "log: $LOG_FILE"
echo "Starting enrichment job on the host…"
"$ROOT/scripts/enrich-sessions.sh"

if [[ "$WATCH_SCHEMA" -eq 1 ]]; then
  echo "Starting transcript schema watcher…"
  "$ROOT/scripts/watch-transcript-schema.sh"
fi

echo
echo "Open ${APP_BASE_URL}"
echo "Stop: npm run stop:local"
