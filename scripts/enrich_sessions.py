#!/usr/bin/env python3
"""Long-running host job: enrich quiet Claude Code sessions via claude -p."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://127.0.0.1:53681").rstrip("/")
LIMIT = int(os.environ.get("ENRICH_LIMIT", "10"))
SLEEP_EMPTY_SEC = int(os.environ.get("ENRICH_SLEEP_SEC", str(15 * 60)))
CLAUDE_TIMEOUT_SEC = int(os.environ.get("ENRICH_CLAUDE_TIMEOUT", "120"))
CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude")

PROMPT = """You name and summarize one finished Claude Code session for a local search index.
Reply with one JSON object and no other text:
{"title":"...","summary":["..."]}

title: at most 160 characters. Name the outcome, not the first command. Include every JIRA id the session actually worked on, up to four (for example PROJ-101, PROJ-102). If there are more than four, put the rest only in the summary.
summary: 4 to 10 bullets, past tense. When several tickets are present, write at least one bullet per ticket that says the id and what was done for it. Other bullets can cover the rest of the work (implemented the fix, added a failing test, opened a PR). Skip tool noise, file paths, and slash-command wrappers.

Session excerpt:
"""


def log(msg: str) -> None:
    ts = time.strftime("%Y-%m-%dT%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def http_json(method: str, path: str, body: dict[str, Any] | None = None) -> Any:
    url = f"{APP_BASE_URL}{path}"
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8")
        if not raw:
            return None
        return json.loads(raw)


def fetch_pending() -> list[dict[str, Any]]:
    payload = http_json("GET", f"/api/enrichment/pending?limit={LIMIT}")
    sessions = payload.get("sessions") if isinstance(payload, dict) else None
    if not isinstance(sessions, list):
        return []
    return sessions


def post_enrichment(session: dict[str, Any], title: str, summary: list[str]) -> None:
    project = urllib.parse.quote(session["project_slug"], safe="")
    sid = urllib.parse.quote(session["session_id"], safe="")
    http_json(
        "POST",
        f"/api/sessions/{project}/{sid}/enrichment",
        {
            "displayTitle": title,
            "summary": summary,
            "sourceMtimeMs": session["file_mtime_ms"],
        },
    )


def post_error(session: dict[str, Any], message: str) -> None:
    project = urllib.parse.quote(session["project_slug"], safe="")
    sid = urllib.parse.quote(session["session_id"], safe="")
    try:
        http_json(
            "POST",
            f"/api/sessions/{project}/{sid}/enrichment/error",
            {
                "sourceMtimeMs": session["file_mtime_ms"],
                "message": message,
            },
        )
    except Exception as err:  # noqa: BLE001
        log(f"failed to post error for {session.get('session_id')}: {err}")


def extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    try:
        value = json.loads(text)
        if isinstance(value, dict):
            return value
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        value = json.loads(text[start : end + 1])
        if isinstance(value, dict):
            return value
    raise ValueError("Claude response was not a JSON object")


def call_claude(excerpt: str) -> tuple[str, list[str]]:
    prompt = PROMPT + (excerpt or "(empty excerpt)")
    # Pass prompt on stdin so large excerpts do not hit argv limits, and start
    # a new session so a hung Claude child can be killed with the process group.
    proc = subprocess.Popen(
        [CLAUDE_BIN, "-p", "--no-session-persistence"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    try:
        stdout, stderr = proc.communicate(prompt, timeout=CLAUDE_TIMEOUT_SEC)
    except subprocess.TimeoutExpired as err:
        try:
            os.killpg(proc.pid, 9)
        except ProcessLookupError:
            pass
        proc.wait(timeout=5)
        raise err

    if proc.returncode != 0:
        err = (stderr or stdout or "claude failed").strip()
        raise RuntimeError(err[:800] or f"claude exited {proc.returncode}")
    payload = extract_json(stdout or "")
    title = payload.get("title")
    summary = payload.get("summary")
    if not isinstance(title, str) or not title.strip():
        raise ValueError("missing title")
    if not isinstance(summary, list) or not summary:
        raise ValueError("missing summary")
    cleaned = [str(s).strip() for s in summary if str(s).strip()]
    if not cleaned:
        raise ValueError("empty summary")
    return title.strip()[:160], cleaned[:10]


def enrich_one(session: dict[str, Any]) -> bool:
    sid = session.get("session_id", "?")
    excerpt = str(session.get("excerpt") or "")
    log(f"enriching {sid} (excerpt {len(excerpt)} chars)")
    try:
        title, summary = call_claude(excerpt)
        post_enrichment(session, title, summary)
        log(f"saved {sid}: {title}")
        return True
    except subprocess.TimeoutExpired:
        msg = f"claude timed out after {CLAUDE_TIMEOUT_SEC}s"
        log(f"{sid}: {msg}")
        post_error(session, msg)
        return False
    except Exception as err:  # noqa: BLE001
        msg = str(err)
        log(f"{sid}: {msg}")
        post_error(session, msg)
        return False


def run_pass() -> int:
    try:
        pending = fetch_pending()
    except urllib.error.URLError as err:
        log(f"app unreachable at {APP_BASE_URL}: {err}")
        return -1
    except Exception as err:  # noqa: BLE001
        log(f"pending fetch failed: {err}")
        return -1

    if not pending:
        log("no pending sessions")
        return 0

    log(f"pending {len(pending)} session(s)")
    saved = 0
    for session in pending:
        if enrich_one(session):
            saved += 1
    return saved


def main() -> int:
    log(f"enrich loop starting against {APP_BASE_URL}")
    while True:
        try:
            saved = run_pass()
        except Exception as err:  # noqa: BLE001
            log(f"pass crashed: {err}")
            saved = -1
        if saved > 0:
            continue
        log(f"sleeping {SLEEP_EMPTY_SEC}s")
        time.sleep(SLEEP_EMPTY_SEC)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        log("stopped")
        raise SystemExit(0)
    except Exception as err:  # noqa: BLE001
        log(f"fatal: {err}")
        raise SystemExit(1)
