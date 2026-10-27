#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DATA_DIR="${DATA_DIR:-${HOME}/.cache/find-that-session}"
PID_FILE="$DATA_DIR/enrich.pid"
SCHEMA_PID_FILE="$DATA_DIR/schema-watch.pid"

echo "Stopping transcript schema watcher…"
if [[ -f "$SCHEMA_PID_FILE" ]]; then
  schema_pid="$(cat "$SCHEMA_PID_FILE" 2>/dev/null || true)"
  if [[ -n "${schema_pid}" ]] && kill -0 "$schema_pid" 2>/dev/null; then
    kill "$schema_pid" 2>/dev/null || true
    for _ in $(seq 1 10); do
      if ! kill -0 "$schema_pid" 2>/dev/null; then
        break
      fi
      sleep 0.2
    done
    if kill -0 "$schema_pid" 2>/dev/null; then
      kill -9 "$schema_pid" 2>/dev/null || true
    fi
    echo "stopped schema watcher (pid $schema_pid)"
  else
    echo "schema watcher not running"
  fi
  rm -f "$SCHEMA_PID_FILE"
else
  echo "schema watcher not running (no pid file)"
fi

echo "Stopping enrichment job…"
if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${pid}" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    # Wait briefly, then force if still alive.
    for _ in $(seq 1 10); do
      if ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep 0.2
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    echo "stopped enrich job (pid $pid)"
  else
    echo "enrich job not running"
  fi
  rm -f "$PID_FILE"
else
  echo "enrich job not running (no pid file)"
fi

echo "Stopping Find That Session (Docker)…"
if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker not found on PATH" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "error: docker compose not available" >&2
  exit 1
fi

docker compose down
echo "App stopped"
