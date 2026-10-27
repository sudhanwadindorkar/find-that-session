# Find That Session

Localhost web app that indexes your **Claude Code CLI** sessions and finds them with hybrid search (keywords + local embeddings + exact JIRA ticket matching).

## Features

- Full-width search UI with light/dark theme (follows system by default)
- Paginated session list; click a row for a summary sidebar
- Dedicated session page with full searchable transcript (open in a new tab)
- One copyable resume command: `cd <cwd> && claude --resume <id>`
- Favorites and app-only archive (archived sessions stay out of search; unarchive anytime)
- Host enrichment job for better display titles and summaries (after 3 hours quiet)

## Start the app

### Docker

Start the app and the host enrichment job together:

```bash
./scripts/start.sh
```

This builds a single-stage image (`npm install` + `next dev`), waits until the API responds, then starts `./scripts/enrich-sessions.sh` on the host. Add `--watch-schema` to also start the optional transcript schema watcher (off by default).

Stop both:

```bash
./scripts/stop.sh
```

Open [http://127.0.0.1:53681](http://127.0.0.1:53681).

Compose binds the port to localhost and mounts:

- `~/.claude/projects` → `/data/claude/projects` (read-only)
- named volume for the app DB and embedding model cache (separate from the local npm DB under `~/.cache/find-that-session/`)

The first run downloads the local embedding model (needs network once). Keyword and ticket search work while embeddings catch up.

To run only the container:

```bash
docker compose up --build -d
```

### Local (npm, no Docker)

Start the app and enrichment job together:

```bash
npm run start:local
```

Stop both:

```bash
npm run stop:local
```

This runs `npm run dev` in the background (raises `ulimit -n` when possible), waits until the API responds, then starts `./scripts/enrich-sessions.sh`. App log: `~/.cache/find-that-session/app.log`. Enrich log: `~/.cache/find-that-session/enrich.log`. Add `--watch-schema` to also start the optional transcript schema watcher (off by default): `npm run start:local -- --watch-schema`.

For a foreground dev server only (no enrichment job):

```bash
npm install
ulimit -n 10240   # optional; avoids EMFILE with large session trees
npm run dev
```

Uses `~/.claude/projects` and stores the DB / model cache under `~/.cache/find-that-session/` by default.

### Transcript schema watcher (optional)

Indexing reads `schema/claude-code-jsonl.json` and parses each transcript with the mapping whose version range contains that file's Claude Code `version`. If the version is missing or newer than every range, it uses the last mapping in the file.

The watcher is off unless you pass `--watch-schema`:

```bash
./scripts/start.sh --watch-schema
npm run start:local -- --watch-schema
```

It samples recent `~/.claude/projects` transcripts on the host, once at start and then every 6 hours. A Claude Code upgrade that keeps the same transcript shape does not alert. When the shape drifts, it posts a macOS notification and a banner in the app. The banner stays until you dismiss it. The same drift does not notify again.

| | |
|---|---|
| Log | `~/.cache/find-that-session/schema-watch.log` |
| Pid file | `~/.cache/find-that-session/schema-watch.pid` |
| Prompt | `prompts/update-transcript-adapter.md` |
| Stop | `./scripts/stop.sh` or `npm run stop:local` (also stops the watcher) |

Paste the prompt into Claude or Cursor to append a new mapping. Leave older mappings in place.

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Transcript root |
| `CLAUDE_SETTINGS_PATH` | `~/.claude/settings.json` | Claude Code settings (for retention display) |
| `DATABASE_PATH` | `~/.cache/find-that-session/find-that-session.db` | SQLite path (Docker: `/data/app/…`) |
| `TRANSFORMERS_CACHE` | `~/.cache/find-that-session/models` | Local ONNX model cache (Docker: `/data/app/models`) |
| `EMBEDDING_MODEL` | `Xenova/bge-small-en-v1.5` | Embedding model id |
| `VECTOR_ONLY_MAX_DISTANCE` | `0.4` | Max vector distance for intent-only (no keyword) hits |

## Enrich titles and summaries (background job)

With the app running on localhost, start the host job once:

```bash
./scripts/enrich-sessions.sh
```

This starts a background Python loop (`scripts/enrich_sessions.py`) that:

1. Asks the app for sessions quiet for **3 hours** with no matching enrichment
2. Calls host `claude -p --no-session-persistence` for a title + summary
3. Posts the result to the app (does **not** change Claude’s `/resume` list)

| | |
|---|---|
| Log | `~/.cache/find-that-session/enrich.log` |
| Pid file | `~/.cache/find-that-session/enrich.pid` |
| Stop | `./scripts/stop.sh` / `npm run stop:local` (or `kill "$(cat ~/.cache/find-that-session/enrich.pid)"`) |

Requires `claude` and `python3` on your `PATH` (runs on the host, not inside Docker).

## Using the UI

- **Search** — keywords, intent text, or bare tickets like `PROJ-102` (exact title/identifier matches rank first). Keyword/token queries require a text match; embeddings only boost those hits. Multi-word intent queries may also surface very close vector-only matches.
- **Sidebar** — summary, metadata, copy resume, favorite, archive; **Open in new tab** for the full transcript
- **Archived** — top filter link; archived sessions are hidden from the main list and search until unarchived
- **Reindex** — top-right; rebuilds the index from `~/.claude/projects` without clearing favorites or archive state

## Out of scope

- Claude Desktop sessions
- Renaming sessions inside Claude’s own resume picker
- Deleting or moving transcript files on disk
- Auth / remote access
