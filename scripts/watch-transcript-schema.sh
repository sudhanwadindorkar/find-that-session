#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DATA_DIR="${DATA_DIR:-${HOME}/.cache/find-that-session}"
mkdir -p "$DATA_DIR"
PID_FILE="$DATA_DIR/schema-watch.pid"
LOG_FILE="$DATA_DIR/schema-watch.log"
export DATA_DIR
export APP_BASE_URL="${APP_BASE_URL:-http://127.0.0.1:${PORT:-53681}}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 not found on PATH" >&2
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${old_pid}" ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "schema watcher already running (pid $old_pid)"
    echo "log: $LOG_FILE"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if command -v setsid >/dev/null 2>&1; then
  setsid python3 "$ROOT/scripts/watch_transcript_schema.py" >>"$LOG_FILE" 2>&1 </dev/null &
else
  nohup python3 "$ROOT/scripts/watch_transcript_schema.py" >>"$LOG_FILE" 2>&1 </dev/null &
fi
pid=$!
echo "$pid" >"$PID_FILE"
disown "$pid" 2>/dev/null || true
echo "started schema watcher (pid $pid)"
echo "log: $LOG_FILE"
echo "stop: kill \"\$(cat $PID_FILE)\""
