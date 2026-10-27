#!/usr/bin/env python3
"""Compare recent Claude Code transcripts to schema/claude-code-jsonl.json.

Notifies once per shape fingerprint. A newer CLI version with the same shape stays quiet.
Version selection matches src/lib/indexer/schema-map.ts: last matching range, else the last mapping.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "schema" / "claude-code-jsonl.json"
APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://127.0.0.1:53681").rstrip("/")
DATA_DIR = Path(os.environ.get("DATA_DIR", Path.home() / ".cache" / "find-that-session"))
STATE_PATH = DATA_DIR / "schema-watch-state.json"
PROJECTS_DIR = Path(
    os.environ.get("CLAUDE_PROJECTS_DIR", str(Path.home() / ".claude" / "projects"))
).expanduser()
INTERVAL_SEC = int(os.environ.get("SCHEMA_WATCH_INTERVAL_SEC", str(6 * 60 * 60)))
SAMPLE_FILES = int(os.environ.get("SCHEMA_WATCH_SAMPLE_FILES", "30"))
MAX_LINES = int(os.environ.get("SCHEMA_WATCH_MAX_LINES", "4000"))
UNKNOWN_MIN = 5
CONTENT_MISMATCH_RATIO = 0.2
CONTENT_MISMATCH_MIN_EVENTS = 8
TITLE_MISMATCH_MIN = 2


def log(msg: str) -> None:
    ts = time.strftime("%Y-%m-%dT%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def parse_version(version: str) -> tuple[int, int, int] | None:
    parts = version.strip().split(".")
    if len(parts) < 3:
        return None
    try:
        return int(parts[0]), int(parts[1]), int(parts[2])
    except ValueError:
        return None


def version_satisfies(version: str, range_expr: str) -> bool:
    parsed = parse_version(version)
    if parsed is None:
        return False
    parts = range_expr.strip().split()
    if not parts or parts[0] == "*":
        return True
    for part in parts:
        op = None
        for candidate in (">=", "<=", ">", "<", "="):
            if part.startswith(candidate):
                op = candidate
                raw = part[len(candidate) :]
                break
        if op is None:
            return False
        bound = parse_version(raw)
        if bound is None:
            return False
        cmp = (parsed > bound) - (parsed < bound)
        if op == ">=" and cmp < 0:
            return False
        if op == "<=" and cmp > 0:
            return False
        if op == ">" and cmp <= 0:
            return False
        if op == "<" and cmp >= 0:
            return False
        if op == "=" and cmp != 0:
            return False
    return True


def select_mapping(version: str | None, mappings: list[dict[str, Any]]) -> dict[str, Any]:
    latest = mappings[-1]
    if not version:
        return latest
    chosen = None
    for mapping in mappings:
        if version_satisfies(version, str(mapping.get("versions", ""))):
            chosen = mapping
    return chosen or latest


def load_mappings() -> list[dict[str, Any]]:
    payload = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    mappings = payload.get("mappings")
    if not isinstance(mappings, list) or not mappings:
        raise RuntimeError(f"schema map has no mappings: {SCHEMA_PATH}")
    return mappings


def newest_transcripts(root: Path, limit: int) -> list[Path]:
    found: list[tuple[float, Path]] = []
    if not root.is_dir():
        return []
    for project in root.iterdir():
        if not project.is_dir():
            continue
        for entry in project.iterdir():
            if not entry.is_file() or entry.suffix != ".jsonl":
                continue
            if "subagents" in entry.name:
                continue
            try:
                found.append((entry.stat().st_mtime, entry))
            except OSError:
                continue
    found.sort(key=lambda item: item[0], reverse=True)
    return [path for _, path in found[:limit]]


def value_at_path(obj: dict[str, Any], keys: list[str]) -> Any:
    current: Any = obj
    for key in keys:
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    return current


def scan_file(path: Path, mappings: list[dict[str, Any]]) -> dict[str, Any]:
    version: str | None = None
    events: list[dict[str, Any]] = []
    with path.open(encoding="utf-8", errors="replace") as handle:
        for index, line in enumerate(handle):
            if index >= MAX_LINES:
                break
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(obj, dict):
                continue
            if version is None and isinstance(obj.get("version"), str) and obj["version"].strip():
                version = obj["version"].strip()
            events.append(obj)
    mapping = select_mapping(version, mappings)
    return {"version": version, "mapping": mapping, "events": events}


def known_event_types(mapping: dict[str, Any]) -> set[str]:
    known = set(mapping.get("skipTypes") or [])
    for message in mapping.get("messages") or []:
        if isinstance(message, dict) and isinstance(message.get("type"), str):
            known.add(message["type"])
    for title in mapping.get("titles") or []:
        if isinstance(title, dict) and isinstance(title.get("type"), str):
            known.add(title["type"])
    return known


def message_types(mapping: dict[str, Any]) -> set[str]:
    found: set[str] = set()
    for message in mapping.get("messages") or []:
        if isinstance(message, dict) and isinstance(message.get("type"), str):
            found.add(message["type"])
    return found


def title_fields(mapping: dict[str, Any]) -> dict[str, str]:
    found: dict[str, str] = {}
    for title in mapping.get("titles") or []:
        if (
            isinstance(title, dict)
            and isinstance(title.get("type"), str)
            and isinstance(title.get("field"), str)
        ):
            found[title["type"]] = title["field"]
    return found


def other_string_fields(obj: dict[str, Any], ignored: set[str]) -> list[str]:
    return sorted(
        key
        for key, value in obj.items()
        if key not in ignored and isinstance(value, str) and value.strip()
    )


def accumulate(samples: list[dict[str, Any]]) -> dict[str, Any]:
    unknown_events: dict[str, int] = {}
    unknown_blocks: dict[str, int] = {}
    versions: set[str] = set()
    schema_ids: set[str] = set()
    content_mismatches = 0
    message_events = 0
    title_mismatches = 0
    unexpected_title_fields: dict[str, set[str]] = {}

    for sample in samples:
        version = sample["version"]
        if isinstance(version, str):
            versions.add(version)
        mapping = sample["mapping"]
        schema_ids.add(str(mapping.get("id", "")))
        known = known_event_types(mapping)
        messages = message_types(mapping)
        titles = title_fields(mapping)
        content = mapping.get("content") if isinstance(mapping.get("content"), dict) else {}
        content_path = mapping.get("contentPath")
        if not isinstance(content_path, list):
            content_path = ["message", "content"]
        text_type = str(content.get("textBlockType", "text"))
        text_field = str(content.get("textField", "text"))
        known_blocks = set(content.get("knownBlockTypes") or [])

        for event in sample["events"]:
            event_type = event.get("type")
            if not isinstance(event_type, str) or not event_type:
                continue
            if event_type not in known:
                unknown_events[event_type] = unknown_events.get(event_type, 0) + 1
                continue
            if event_type in titles:
                expected = titles[event_type]
                raw = event.get(expected)
                if isinstance(raw, str) and raw.strip():
                    continue
                extras = other_string_fields(event, {"type", "sessionId", "uuid", expected})
                if extras:
                    title_mismatches += 1
                    unexpected_title_fields.setdefault(event_type, set()).update(extras)
                continue
            if event_type not in messages:
                continue
            message_events += 1
            body = value_at_path(event, [str(key) for key in content_path])
            if isinstance(body, str):
                continue
            if not isinstance(body, list) or any(not isinstance(block, dict) for block in body):
                content_mismatches += 1
                continue
            for block in body:
                block_type = block.get("type")
                if not isinstance(block_type, str):
                    continue
                if block_type not in known_blocks:
                    label = f"block:{block_type}"
                    unknown_blocks[label] = unknown_blocks.get(label, 0) + 1
                if block_type == text_type and not isinstance(block.get(text_field), str):
                    if other_string_fields(block, {"type", text_field}):
                        content_mismatches += 1

    return {
        "versions": versions,
        "schema_ids": schema_ids,
        "unknown_events": unknown_events,
        "unknown_blocks": unknown_blocks,
        "content_mismatches": content_mismatches,
        "message_events": message_events,
        "title_mismatches": title_mismatches,
        "unexpected_title_fields": unexpected_title_fields,
    }


def above(counts: dict[str, int]) -> list[str]:
    return sorted(name for name, count in counts.items() if count >= UNKNOWN_MIN)


def is_drift(stats: dict[str, Any]) -> bool:
    if above(stats["unknown_events"]) or above(stats["unknown_blocks"]):
        return True
    messages = stats["message_events"]
    if (
        messages >= CONTENT_MISMATCH_MIN_EVENTS
        and stats["content_mismatches"] / messages >= CONTENT_MISMATCH_RATIO
    ):
        return True
    return stats["title_mismatches"] >= TITLE_MISMATCH_MIN


def newest_version(versions: set[str]) -> str:
    parsed = [version for version in versions if parse_version(version)]
    if not parsed:
        return "unknown"
    return max(parsed, key=lambda version: parse_version(version) or (0, 0, 0))


def fingerprint_for(stats: dict[str, Any]) -> str:
    payload = {
        "unknown_types": above(stats["unknown_events"]) + above(stats["unknown_blocks"]),
        "content_mismatch": (
            stats["message_events"] >= CONTENT_MISMATCH_MIN_EVENTS
            and stats["content_mismatches"] / max(stats["message_events"], 1) >= CONTENT_MISMATCH_RATIO
        ),
        "title_fields": {
            key: sorted(values)
            for key, values in sorted(stats["unexpected_title_fields"].items())
        },
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def summary_for(stats: dict[str, Any], schema_id: str) -> str:
    version = newest_version(stats["versions"])
    parts = [f"Claude Code {version} transcripts differ from {schema_id}."]
    unknown = above(stats["unknown_events"]) + above(stats["unknown_blocks"])
    if unknown:
        shown = ", ".join(unknown[:8])
        parts.append(f"Unknown types: {shown}.")
    if stats["content_mismatches"]:
        parts.append(
            f"Content mismatches {stats['content_mismatches']}/{stats['message_events']}."
        )
    if stats["title_mismatches"]:
        parts.append(f"Title field mismatches {stats['title_mismatches']}.")
    return " ".join(parts)[:500]


def load_state() -> dict[str, Any]:
    try:
        payload = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def save_state(state: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def notify(message: str) -> None:
    script = f"display notification {json.dumps(message)} with title \"Find That Session\""
    try:
        subprocess.run(["osascript", "-e", script], check=False, timeout=15)
    except (OSError, subprocess.TimeoutExpired) as err:
        log(f"notification failed: {err}")


def post_report(report: dict[str, Any]) -> None:
    data = json.dumps(report).encode("utf-8")
    req = urllib.request.Request(
        f"{APP_BASE_URL}/api/schema-drift",
        data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp.read()


def run_once() -> None:
    if not PROJECTS_DIR.is_dir():
        log(f"projects dir missing: {PROJECTS_DIR}")
        return
    mappings = load_mappings()
    files = newest_transcripts(PROJECTS_DIR, SAMPLE_FILES)
    if not files:
        log("no transcripts to sample")
        return
    samples = [scan_file(path, mappings) for path in files]
    stats = accumulate(samples)
    if not is_drift(stats):
        log(f"schema matches ({len(files)} files, versions {sorted(stats['versions'])[:6]})")
        return

    latest_id = str(mappings[-1].get("id", "unknown"))
    fingerprint = fingerprint_for(stats)
    state = load_state()
    already_notified = state.get("last_notified_fingerprint") == fingerprint
    post_ok = bool(state.get("last_post_ok")) and already_notified
    if already_notified and post_ok:
        log(f"drift unchanged ({fingerprint[:12]})")
        return

    summary = summary_for(stats, latest_id)
    version = newest_version(stats["versions"])
    report = {
        "fingerprint": fingerprint,
        "versions": sorted(stats["versions"]),
        "schema_id": latest_id,
        "unknown_types": above(stats["unknown_events"]) + above(stats["unknown_blocks"]),
        "content_mismatch_count": stats["content_mismatches"],
        "message_event_count": stats["message_events"],
        "title_mismatch_count": stats["title_mismatches"],
        "sample_count": len(files),
        "summary": summary,
    }
    if not already_notified:
        notify(f"Claude Code {version} transcripts look different. Open Find That Session.")
        log(f"notified: {summary}")
    try:
        post_report(report)
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        log(f"could not post drift report: {err}")
        save_state({"last_notified_fingerprint": fingerprint, "last_post_ok": False})
        return
    save_state({"last_notified_fingerprint": fingerprint, "last_post_ok": True})
    log("posted drift report")


def main() -> None:
    once = "--once" in sys.argv
    while True:
        try:
            run_once()
        except Exception as err:  # noqa: BLE001 — keep the watcher alive
            log(f"scan failed: {err}")
        if once:
            return
        time.sleep(INTERVAL_SEC)


if __name__ == "__main__":
    main()
