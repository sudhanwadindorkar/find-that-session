#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-53681}"
DATA_DIR="${DATA_DIR:-${HOME}/.cache/find-that-session}"
ENRICH_PID_FILE="$DATA_DIR/enrich.pid"
SCHEMA_PID_FILE="$DATA_DIR/schema-watch.pid"
APP_PID_FILE="$DATA_DIR/app.pid"

stop_pid() {
  local label="$1"
  local pid_file="$2"
  if [[ ! -f "$pid_file" ]]; then
    echo "${label} not running (no pid file)"
    return 0
  fi
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -z "${pid}" ]] || ! kill -0 "$pid" 2>/dev/null; then
    echo "${label} not running"
    rm -f "$pid_file"
    return 0
  fi

  # Prefer process-group kill when the job was started with setsid.
  kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true

  # Also stop direct children (npm -> next).
  local kids
  kids="$(pgrep -P "$pid" 2>/dev/null || true)"
  if [[ -n "${kids}" ]]; then
    # shellcheck disable=SC2086
    kill $kids 2>/dev/null || true
  fi

  for _ in $(seq 1 20); do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 0.2
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 -- "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
    if [[ -n "${kids}" ]]; then
      # shellcheck disable=SC2086
      kill -9 $kids 2>/dev/null || true
    fi
  fi

  rm -f "$pid_file"
  echo "stopped ${label} (pid $pid)"
}

echo "Stopping transcript schema watcher…"
stop_pid "schema watcher" "$SCHEMA_PID_FILE"

echo "Stopping enrichment job…"
stop_pid "enrich job" "$ENRICH_PID_FILE"

echo "Stopping Find That Session (npm)…"
stop_pid "app" "$APP_PID_FILE"

# Fallback: anything still listening on the app port (orphaned next/node).
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "freeing port ${PORT}…"
  # shellcheck disable=SC2046
  kill $(lsof -tiTCP:"$PORT" -sTCP:LISTEN) 2>/dev/null || true
  sleep 0.5
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    # shellcheck disable=SC2046
    kill -9 $(lsof -tiTCP:"$PORT" -sTCP:LISTEN) 2>/dev/null || true
  fi
fi

echo "App stopped"
