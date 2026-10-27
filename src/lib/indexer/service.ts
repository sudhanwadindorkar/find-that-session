import fs from "fs";
import path from "path";
import { getClaudeRetentionInfo } from "@/lib/claude-settings";
import { config } from "@/lib/config";
import { getDb, isVecReady, type IndexStateRow, type SessionRow } from "@/lib/db";
import { embedDocument, float32ToBuffer } from "@/lib/embeddings";
import {
  buildEmbedDocument,
  parseSummary,
  restoreEnrichmentFtsIfPresent,
} from "@/lib/enrichment";
import { parseTranscript, peekTranscriptVersion } from "@/lib/indexer/parse";
import { loadSchemaMappings, selectMapping } from "@/lib/indexer/schema-map";
import { getActiveSchemaDrift } from "@/lib/schema-drift";
import type { SchemaDriftReport } from "@/lib/types";
import {
  listTranscriptFiles,
  resolveTranscriptFile,
  type TranscriptFile,
} from "@/lib/indexer/walk";

let lexicalRunning = false;
let embeddingRunning = false;
let watcherStarted = false;
const fileCooldowns = new Map<string, number>();
const pendingFiles = new Set<string>();
let debounceTimers = new Map<string, NodeJS.Timeout>();

function nowIso(): string {
  return new Date().toISOString();
}

function updateIndexState(partial: Partial<IndexStateRow>): void {
  const db = getDb();
  const row = db.prepare("SELECT * FROM index_state WHERE id = 1").get() as IndexStateRow;
  const next = { ...row, ...partial };
  db.prepare(
    `UPDATE index_state SET
      lexical_status = @lexical_status,
      embedding_status = @embedding_status,
      lexical_done = @lexical_done,
      lexical_total = @lexical_total,
      embed_done = @embed_done,
      embed_total = @embed_total,
      failed_count = @failed_count,
      last_scan_at = @last_scan_at,
      message = @message
     WHERE id = 1`,
  ).run(next);
}

export function getIndexStatus(): IndexStateRow & {
  session_count: number;
  favorite_count: number;
  projects_dir: string;
  projects_dir_exists: boolean;
  vec_ready: boolean;
  cleanup_period_days: number;
  cleanup_period_is_default: boolean;
  claude_settings_path: string;
  claude_settings_exists: boolean;
  schema_drift: SchemaDriftReport | null;
} {
  const db = getDb();
  const row = db.prepare("SELECT * FROM index_state WHERE id = 1").get() as IndexStateRow;
  const sessionCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM sessions
         WHERE index_error IS NULL AND archived_at IS NULL`,
      )
      .get() as { c: number }
  ).c;
  const favoriteCount = (
    db.prepare("SELECT COUNT(*) AS c FROM favorites").get() as { c: number }
  ).c;
  const retention = getClaudeRetentionInfo();
  return {
    ...row,
    session_count: sessionCount,
    favorite_count: favoriteCount,
    projects_dir: config.claudeProjectsDir,
    projects_dir_exists: fs.existsSync(config.claudeProjectsDir),
    vec_ready: isVecReady(),
    cleanup_period_days: retention.cleanup_period_days,
    cleanup_period_is_default: retention.is_default,
    claude_settings_path: retention.settings_path,
    claude_settings_exists: retention.settings_exists,
    schema_drift: getActiveSchemaDrift(),
  };
}

function deleteSession(projectSlug: string, sessionId: string): void {
  const db = getDb();
  const meta = db
    .prepare(
      "SELECT rowid FROM session_embedding_meta WHERE project_slug = ? AND session_id = ?",
    )
    .get(projectSlug, sessionId) as { rowid: number } | undefined;

  db.prepare("DELETE FROM turns_fts WHERE project_slug = ? AND session_id = ?").run(
    projectSlug,
    sessionId,
  );
  db.prepare("DELETE FROM turns WHERE project_slug = ? AND session_id = ?").run(
    projectSlug,
    sessionId,
  );
  db.prepare("DELETE FROM embed_queue WHERE project_slug = ? AND session_id = ?").run(
    projectSlug,
    sessionId,
  );
  db.prepare("DELETE FROM favorites WHERE project_slug = ? AND session_id = ?").run(
    projectSlug,
    sessionId,
  );

  if (meta && isVecReady()) {
    try {
      db.prepare("DELETE FROM session_embeddings WHERE rowid = ?").run(meta.rowid);
    } catch {
      /* ignore */
    }
  }
  db.prepare(
    "DELETE FROM session_embedding_meta WHERE project_slug = ? AND session_id = ?",
  ).run(projectSlug, sessionId);

  try {
    db.prepare(
      "DELETE FROM session_embeddings_blob WHERE project_slug = ? AND session_id = ?",
    ).run(projectSlug, sessionId);
  } catch {
    /* table may not exist when vec is ready */
  }

  db.prepare("DELETE FROM sessions WHERE project_slug = ? AND session_id = ?").run(
    projectSlug,
    sessionId,
  );
}

function writeSessionLexical(
  file: TranscriptFile,
  parsed: Awaited<ReturnType<typeof parseTranscript>>,
  enqueueEmbed: boolean,
): void {
  const db = getDb();
  const tx = db.transaction(() => {
    // Clear previous turns/fts for this session
    db.prepare("DELETE FROM turns_fts WHERE project_slug = ? AND session_id = ?").run(
      file.projectSlug,
      file.sessionId,
    );
    db.prepare("DELETE FROM turns WHERE project_slug = ? AND session_id = ?").run(
      file.projectSlug,
      file.sessionId,
    );

    const titleIsCustom = parsed.title_is_custom ? 1 : 0;
    // Custom titles should show immediately and beat any prior enrichment title
    const displayTitle = parsed.title_is_custom ? parsed.title : null;

    db.prepare(
      `INSERT INTO sessions (
        project_slug, session_id, cwd, title, first_user_message, identifiers,
        started_at, last_active_at, source, transcript_path, file_size, file_mtime_ms,
        indexable_hash, embedded_hash, indexed_at, index_error,
        title_is_custom, display_title, schema_id
      ) VALUES (
        @project_slug, @session_id, @cwd, @title, @first_user_message, @identifiers,
        @started_at, @last_active_at, 'cli', @transcript_path, @file_size, @file_mtime_ms,
        @indexable_hash, NULL, @indexed_at, NULL,
        @title_is_custom, @display_title, @schema_id
      )
      ON CONFLICT(project_slug, session_id) DO UPDATE SET
        cwd = excluded.cwd,
        title = excluded.title,
        first_user_message = excluded.first_user_message,
        identifiers = excluded.identifiers,
        started_at = excluded.started_at,
        last_active_at = excluded.last_active_at,
        transcript_path = excluded.transcript_path,
        file_size = excluded.file_size,
        file_mtime_ms = excluded.file_mtime_ms,
        indexable_hash = excluded.indexable_hash,
        embedded_hash = NULL,
        indexed_at = excluded.indexed_at,
        index_error = NULL,
        title_is_custom = excluded.title_is_custom,
        schema_id = excluded.schema_id,
        display_title = CASE
          WHEN excluded.title_is_custom = 1 THEN excluded.title
          ELSE sessions.display_title
        END`,
    ).run({
      project_slug: file.projectSlug,
      session_id: file.sessionId,
      cwd: parsed.cwd,
      title: parsed.title,
      first_user_message: parsed.first_user_message,
      identifiers: parsed.identifiers.join(" "),
      started_at: parsed.started_at,
      last_active_at: parsed.last_active_at,
      transcript_path: file.transcriptPath,
      file_size: file.size,
      file_mtime_ms: file.mtimeMs,
      indexable_hash: parsed.indexable_hash,
      indexed_at: nowIso(),
      title_is_custom: titleIsCustom,
      display_title: displayTitle,
      schema_id: parsed.schema_id,
    });

    const insertTurn = db.prepare(
      `INSERT INTO turns (project_slug, session_id, ordinal, role, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertFts = db.prepare(
      `INSERT INTO turns_fts (text, title, cwd, project_slug, session_id, turn_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    for (const turn of parsed.turns) {
      const info = insertTurn.run(
        file.projectSlug,
        file.sessionId,
        turn.ordinal,
        turn.role,
        turn.text,
        turn.created_at,
      );
      insertFts.run(
        turn.text,
        parsed.title ?? "",
        parsed.cwd ?? "",
        file.projectSlug,
        file.sessionId,
        Number(info.lastInsertRowid),
      );
    }

    // Also index title/cwd as a synthetic turn row for FTS if there are no turns
    if (parsed.turns.length === 0 && (parsed.title || parsed.cwd)) {
      const info = insertTurn.run(
        file.projectSlug,
        file.sessionId,
        0,
        "user",
        [parsed.title, parsed.cwd, parsed.identifiers.join(" ")].filter(Boolean).join("\n"),
        parsed.started_at,
      );
      insertFts.run(
        [parsed.title, parsed.identifiers.join(" ")].filter(Boolean).join(" "),
        parsed.title ?? "",
        parsed.cwd ?? "",
        file.projectSlug,
        file.sessionId,
        Number(info.lastInsertRowid),
      );
    }

    if (enqueueEmbed) {
      db.prepare(
        `INSERT INTO embed_queue (project_slug, session_id, enqueued_at)
         VALUES (?, ?, ?)
         ON CONFLICT(project_slug, session_id) DO UPDATE SET enqueued_at = excluded.enqueued_at`,
      ).run(file.projectSlug, file.sessionId, nowIso());
    }

    // Lexical rewrite wiped turns_fts; put enrichment title/summary back
    restoreEnrichmentFtsIfPresent(file.projectSlug, file.sessionId);
  });
  tx();
}

async function indexOneFile(
  file: TranscriptFile,
  opts: { force?: boolean } = {},
): Promise<"skipped" | "touched" | "indexed" | "error"> {
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM sessions WHERE project_slug = ? AND session_id = ?")
    .get(file.projectSlug, file.sessionId) as SessionRow | undefined;

  if (
    !opts.force &&
    existing &&
    existing.file_size === file.size &&
    existing.file_mtime_ms === file.mtimeMs &&
    !existing.index_error
  ) {
    if (!existing.schema_id) {
      try {
        const version = await peekTranscriptVersion(file.transcriptPath);
        const mapping = selectMapping(version, loadSchemaMappings());
        db.prepare(
          "UPDATE sessions SET schema_id = ? WHERE project_slug = ? AND session_id = ?",
        ).run(mapping.id, file.projectSlug, file.sessionId);
      } catch {
        /* schema id is filled on the next full index */
      }
    }
    return "skipped";
  }

  try {
    const parsed = await parseTranscript(
      file.transcriptPath,
      file.projectSlug,
      file.sessionId,
    );

    if (parsed.turns.length === 0 && !parsed.title && parsed.identifiers.length === 0) {
      db.prepare(
        `INSERT INTO sessions (
          project_slug, session_id, cwd, title, first_user_message, identifiers,
          started_at, last_active_at, source, transcript_path, file_size, file_mtime_ms,
          indexable_hash, embedded_hash, indexed_at, index_error, schema_id
        ) VALUES (?, ?, ?, NULL, NULL, '', NULL, NULL, 'cli', ?, ?, ?, NULL, NULL, ?, ?, ?)
        ON CONFLICT(project_slug, session_id) DO UPDATE SET
          file_size = excluded.file_size,
          file_mtime_ms = excluded.file_mtime_ms,
          indexed_at = excluded.indexed_at,
          index_error = excluded.index_error,
          schema_id = excluded.schema_id`,
      ).run(
        file.projectSlug,
        file.sessionId,
        parsed.cwd,
        file.transcriptPath,
        file.size,
        file.mtimeMs,
        nowIso(),
        "No indexable text found",
        parsed.schema_id,
      );
      return "error";
    }

    if (existing && existing.indexable_hash === parsed.indexable_hash) {
      // Searchable text unchanged — refresh display metadata; keep embeddings
      const titleIsCustom = parsed.title_is_custom ? 1 : 0;
      db.prepare(
        `UPDATE sessions SET
          file_size = ?,
          file_mtime_ms = ?,
          started_at = COALESCE(started_at, ?),
          last_active_at = COALESCE(?, last_active_at),
          cwd = COALESCE(?, cwd),
          title = COALESCE(?, title),
          first_user_message = COALESCE(?, first_user_message),
          identifiers = ?,
          indexed_at = ?,
          index_error = NULL,
          title_is_custom = ?,
          schema_id = ?,
          display_title = CASE
            WHEN ? = 1 THEN COALESCE(?, display_title)
            ELSE display_title
          END
         WHERE project_slug = ? AND session_id = ?`,
      ).run(
        file.size,
        file.mtimeMs,
        parsed.started_at,
        parsed.last_active_at,
        parsed.cwd,
        parsed.title,
        parsed.first_user_message,
        parsed.identifiers.join(" "),
        nowIso(),
        titleIsCustom,
        parsed.schema_id,
        titleIsCustom,
        parsed.title,
        file.projectSlug,
        file.sessionId,
      );
      return "touched";
    }

    const needsEmbed =
      !existing ||
      existing.embedded_hash !== parsed.indexable_hash ||
      existing.indexable_hash !== parsed.indexable_hash;

    writeSessionLexical(file, parsed, needsEmbed);
    return "indexed";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(
      `INSERT INTO sessions (
        project_slug, session_id, cwd, title, first_user_message, identifiers,
        started_at, last_active_at, source, transcript_path, file_size, file_mtime_ms,
        indexable_hash, embedded_hash, indexed_at, index_error
      ) VALUES (?, ?, NULL, NULL, NULL, '', NULL, NULL, 'cli', ?, ?, ?, NULL, NULL, ?, ?)
      ON CONFLICT(project_slug, session_id) DO UPDATE SET
        file_size = excluded.file_size,
        file_mtime_ms = excluded.file_mtime_ms,
        indexed_at = excluded.indexed_at,
        index_error = excluded.index_error`,
    ).run(
      file.projectSlug,
      file.sessionId,
      file.transcriptPath,
      file.size,
      file.mtimeMs,
      nowIso(),
      message,
    );
    return "error";
  }
}

function storeEmbedding(
  projectSlug: string,
  sessionId: string,
  hash: string,
  vector: Float32Array,
): void {
  const db = getDb();
  const buf = float32ToBuffer(vector);

  if (isVecReady()) {
    const existing = db
      .prepare(
        "SELECT rowid FROM session_embedding_meta WHERE project_slug = ? AND session_id = ?",
      )
      .get(projectSlug, sessionId) as { rowid: number } | undefined;

    if (existing) {
      db.prepare("DELETE FROM session_embeddings WHERE rowid = ?").run(existing.rowid);
      db.prepare("DELETE FROM session_embedding_meta WHERE rowid = ?").run(existing.rowid);
    }

    const insert = db.prepare(
      "INSERT INTO session_embeddings(embedding) VALUES (?)",
    );
    const info = insert.run(buf);
    const rowid = Number(info.lastInsertRowid);
    db.prepare(
      "INSERT INTO session_embedding_meta(rowid, project_slug, session_id) VALUES (?, ?, ?)",
    ).run(rowid, projectSlug, sessionId);
  } else {
    db.prepare(
      `INSERT INTO session_embeddings_blob(project_slug, session_id, embedding)
       VALUES (?, ?, ?)
       ON CONFLICT(project_slug, session_id) DO UPDATE SET embedding = excluded.embedding`,
    ).run(projectSlug, sessionId, buf);
  }

  db.prepare(
    "UPDATE sessions SET embedded_hash = ? WHERE project_slug = ? AND session_id = ?",
  ).run(hash, projectSlug, sessionId);
  db.prepare(
    "DELETE FROM embed_queue WHERE project_slug = ? AND session_id = ?",
  ).run(projectSlug, sessionId);
}

function enqueueMissingEmbeddings(): number {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO embed_queue (project_slug, session_id, enqueued_at)
       SELECT project_slug, session_id, ?
       FROM sessions
       WHERE index_error IS NULL
         AND indexable_hash IS NOT NULL
         AND (embedded_hash IS NULL OR embedded_hash != indexable_hash)`,
    )
    .run(nowIso());
  return Number(result.changes ?? 0);
}

async function processEmbedQueue(): Promise<void> {
  if (embeddingRunning) return;
  embeddingRunning = true;
  let consecutiveFailures = 0;

  try {
    const db = getDb();
    enqueueMissingEmbeddings();

    while (true) {
      const remaining = (
        db.prepare("SELECT COUNT(*) AS c FROM embed_queue").get() as { c: number }
      ).c;
      const embedded = (
        db
          .prepare(
            "SELECT COUNT(*) AS c FROM sessions WHERE embedded_hash IS NOT NULL AND index_error IS NULL",
          )
          .get() as { c: number }
      ).c;
      const total = (
        db
          .prepare(
            "SELECT COUNT(*) AS c FROM sessions WHERE index_error IS NULL AND indexable_hash IS NOT NULL",
          )
          .get() as { c: number }
      ).c;

      updateIndexState({
        embedding_status: remaining > 0 ? "running" : "idle",
        embed_total: total,
        embed_done: embedded,
        message:
          remaining > 0 ? `Embedding ${embedded}/${total}…` : null,
      });

      if (remaining === 0) break;

      const queue = db
        .prepare(
          `SELECT q.project_slug, q.session_id, s.indexable_hash,
                  s.title, s.display_title, s.summary_json, s.cwd, s.identifiers
           FROM embed_queue q
           JOIN sessions s ON s.project_slug = q.project_slug AND s.session_id = q.session_id
           WHERE s.index_error IS NULL
           ORDER BY q.enqueued_at ASC
           LIMIT 1`,
        )
        .get() as
        | {
            project_slug: string;
            session_id: string;
            indexable_hash: string | null;
            title: string | null;
            display_title: string | null;
            summary_json: string | null;
            cwd: string | null;
            identifiers: string;
          }
        | undefined;

      if (!queue || !queue.indexable_hash) break;

      try {
        const userTurns = db
          .prepare(
            `SELECT text FROM turns
             WHERE project_slug = ? AND session_id = ? AND role = 'user'
             ORDER BY ordinal ASC`,
          )
          .all(queue.project_slug, queue.session_id) as { text: string }[];

        const doc = buildEmbedDocument({
          displayTitle: queue.display_title,
          title: queue.title,
          summary: parseSummary(queue.summary_json),
          cwd: queue.cwd,
          projectSlug: queue.project_slug,
          identifiers: queue.identifiers,
          userTexts: userTurns.map((t) => t.text),
        });

        const vector = await embedDocument(doc);
        storeEmbedding(
          queue.project_slug,
          queue.session_id,
          queue.indexable_hash,
          vector,
        );
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures += 1;
        console.error("[embed] failed", queue.session_id, err);
        // Keep the item queued; back off and retry later so a transient model
        // load error does not wipe the whole queue.
        updateIndexState({
          embedding_status: "error",
          message:
            err instanceof Error
              ? `Embedding paused: ${err.message}`
              : "Embedding paused after errors",
        });
        if (consecutiveFailures >= 3) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    const remaining = (
      db.prepare("SELECT COUNT(*) AS c FROM embed_queue").get() as { c: number }
    ).c;
    const embedded = (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM sessions WHERE embedded_hash IS NOT NULL AND index_error IS NULL",
        )
        .get() as { c: number }
    ).c;
    const total = (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM sessions WHERE index_error IS NULL AND indexable_hash IS NOT NULL",
        )
        .get() as { c: number }
    ).c;

    updateIndexState({
      embedding_status: remaining > 0 ? "error" : "idle",
      embed_done: embedded,
      embed_total: total,
      message: remaining > 0 ? `Embedding paused with ${remaining} left` : null,
    });
  } finally {
    embeddingRunning = false;
  }
}

export async function runLexicalScan(reason = "scan"): Promise<void> {
  if (lexicalRunning) return;
  lexicalRunning = true;
  const force = reason === "manual";

  try {
    if (!fs.existsSync(config.claudeProjectsDir)) {
      updateIndexState({
        lexical_status: "idle",
        lexical_done: 0,
        lexical_total: 0,
        failed_count: 0,
        last_scan_at: nowIso(),
        message: `No Claude Code sessions found. Expected ${config.claudeProjectsDir}`,
      });
      return;
    }

    const files = listTranscriptFiles();
    updateIndexState({
      lexical_status: "running",
      lexical_done: 0,
      lexical_total: files.length,
      failed_count: 0,
      message: `Indexing transcripts 0/${files.length} (${reason})…`,
    });

    const db = getDb();
    const seen = new Set<string>();
    let done = 0;
    let failed = 0;

    for (const file of files) {
      seen.add(`${file.projectSlug}::${file.sessionId}`);
      const result = await indexOneFile(file, { force });
      done += 1;
      if (result === "error") failed += 1;
      if (done % 5 === 0 || done === files.length) {
        updateIndexState({
          lexical_status: "running",
          lexical_done: done,
          lexical_total: files.length,
          failed_count: failed,
          message: `Indexing transcripts ${done}/${files.length}…`,
        });
      }
    }

    // Remove sessions whose files disappeared
    const all = db
      .prepare("SELECT project_slug, session_id, transcript_path FROM sessions")
      .all() as { project_slug: string; session_id: string; transcript_path: string }[];
    for (const row of all) {
      const key = `${row.project_slug}::${row.session_id}`;
      if (!seen.has(key) || !fs.existsSync(row.transcript_path)) {
        deleteSession(row.project_slug, row.session_id);
      }
    }

    const queued = enqueueMissingEmbeddings();

    updateIndexState({
      lexical_status: "idle",
      lexical_done: files.length,
      lexical_total: files.length,
      failed_count: failed,
      last_scan_at: nowIso(),
      message:
        failed > 0
          ? `${failed} session(s) failed to index`
          : queued > 0
            ? `Queued ${queued} session(s) for embedding`
            : null,
    });

    void processEmbedQueue();
  } catch (err) {
    updateIndexState({
      lexical_status: "error",
      message: err instanceof Error ? err.message : String(err),
      last_scan_at: nowIso(),
    });
  } finally {
    lexicalRunning = false;
  }
}

async function indexPathFromWatch(filePath: string): Promise<void> {
  const now = Date.now();
  const last = fileCooldowns.get(filePath) ?? 0;
  if (now - last < config.watchCooldownMs) {
    pendingFiles.add(filePath);
    return;
  }
  fileCooldowns.set(filePath, now);
  pendingFiles.delete(filePath);

  if (!fs.existsSync(filePath)) {
    const resolved = resolveTranscriptFile(filePath);
    // If path is gone, try to find by relative key from path parts
    const root = path.resolve(config.claudeProjectsDir);
    const rel = path.relative(root, path.resolve(filePath));
    const parts = rel.split(path.sep);
    if (parts.length === 2 && parts[1]?.endsWith(".jsonl")) {
      deleteSession(parts[0], parts[1].replace(/\.jsonl$/, ""));
    }
    void resolved;
    return;
  }

  const file = resolveTranscriptFile(filePath);
  if (!file) return;
  await indexOneFile(file);
  void processEmbedQueue();
}

function scheduleWatch(filePath: string): void {
  const existing = debounceTimers.get(filePath);
  if (existing) clearTimeout(existing);
  debounceTimers.set(
    filePath,
    setTimeout(() => {
      debounceTimers.delete(filePath);
      void indexPathFromWatch(filePath);
    }, config.watchDebounceMs),
  );
}

export async function startBackgroundServices(): Promise<void> {
  // Kick off initial scan
  void runLexicalScan("startup");

  if (watcherStarted) return;
  watcherStarted = true;

  if (!fs.existsSync(config.claudeProjectsDir)) {
    console.warn("[watcher] projects dir missing:", config.claudeProjectsDir);
    return;
  }

  // Prefer lightweight polling over native recursive watches. Claude projects
  // trees are large; fs.watch can exhaust file descriptors (EMFILE) alongside
  // Next.js's own watcher.
  const { default: chokidar } = await import("chokidar");
  const watcher = chokidar.watch(path.join(config.claudeProjectsDir, "*", "*.jsonl"), {
    ignoreInitial: true,
    usePolling: true,
    interval: 10_000,
    binaryInterval: 10_000,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
    ignored: (p: string) => p.includes(`${path.sep}subagents${path.sep}`),
    depth: 1,
  });

  watcher.on("add", (p) => scheduleWatch(p));
  watcher.on("change", (p) => scheduleWatch(p));
  watcher.on("unlink", (p) => scheduleWatch(p));
  watcher.on("error", (err) => {
    console.warn("[watcher] error:", err);
  });

  // Drain cooldown-deferred files periodically
  setInterval(() => {
    for (const p of [...pendingFiles]) {
      void indexPathFromWatch(p);
    }
  }, config.watchCooldownMs);

  // Safety net: periodic lexical scan picks up anything polling missed
  setInterval(() => {
    if (!lexicalRunning) void runLexicalScan("poll");
  }, 5 * 60_000);

  console.log("[watcher] polling", config.claudeProjectsDir);
}

export async function requestReindex(): Promise<{ ok: true }> {
  void runLexicalScan("manual");
  return { ok: true };
}

/** Kick the background embedding worker (e.g. after enrichment save). */
export function kickEmbeddingWorker(): void {
  void processEmbedQueue();
}
