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

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker not found on PATH" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "error: docker compose not available" >&2
  exit 1
fi

echo "Starting Find That Session (Docker)…"
docker compose up --build -d

echo "Waiting for ${APP_BASE_URL}…"
ready=0
for _ in $(seq 1 90); do
  if curl -sf "${APP_BASE_URL}/api/status" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done

if [[ "$ready" -ne 1 ]]; then
  echo "error: app did not become ready in time" >&2
  echo "check: docker compose logs -f web" >&2
  exit 1
fi

echo "App is up at ${APP_BASE_URL}"
echo "Starting enrichment job on the host…"
"$ROOT/scripts/enrich-sessions.sh"

if [[ "$WATCH_SCHEMA" -eq 1 ]]; then
  echo "Starting transcript schema watcher…"
  "$ROOT/scripts/watch-transcript-schema.sh"
fi

echo
echo "Open ${APP_BASE_URL}"
echo "Stop: ./scripts/stop.sh"
