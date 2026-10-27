import { config } from "@/lib/config";
import { getDb, type SessionRow } from "@/lib/db";
/** Sentinel turn_id for enrichment FTS rows (not a real turns.id). */
export const ENRICHMENT_FTS_TURN_ID = -1;

const TICKET_ID_RE = /^[A-Z][A-Z0-9]+-\d+$/;

export type PendingEnrichment = {
  project_slug: string;
  session_id: string;
  cwd: string | null;
  title: string | null;
  identifiers: string[];
  file_mtime_ms: number;
  excerpt: string;
};

export type EnrichmentPayload = {
  displayTitle: string;
  summary: string[];
  sourceMtimeMs: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseSummary(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  } catch {
    return [];
  }
}

function errorMatchesMtime(enrichError: string | null, mtime: number): boolean {
  if (!enrichError) return false;
  return enrichError.startsWith(`mtime:${mtime}|`);
}

function formatEnrichError(mtime: number, message: string): string {
  return `mtime:${mtime}|${message.slice(0, 500)}`;
}

function buildExcerpt(
  identifiers: string[],
  userTurns: { text: string }[],
): string {
  const ticketLine = identifiers.filter((id) => TICKET_ID_RE.test(id));

  const parts: string[] = [];
  if (ticketLine.length > 0) {
    parts.push(`Tickets: ${ticketLine.join(", ")}`);
  }

  const budget = config.enrichExcerptChars;
  const used = () => parts.join("\n\n").length;
  const remaining = () => Math.max(0, budget - used());

  if (userTurns.length === 0) {
    return parts.join("\n\n").slice(0, budget);
  }

  // Take turns from the start and end so later tickets are not cut off
  const head: string[] = [];
  const tail: string[] = [];
  let i = 0;
  let j = userTurns.length - 1;
  const half = Math.floor(budget / 2);

  while (i <= j && used() < budget) {
    if (i === j) {
      const t = userTurns[i].text.slice(0, remaining());
      if (t) head.push(t);
      break;
    }
    if (used() < half) {
      const t = userTurns[i].text.slice(0, Math.min(1200, remaining()));
      if (t) head.push(t);
      i += 1;
    } else {
      const t = userTurns[j].text.slice(0, Math.min(1200, remaining()));
      if (t) tail.unshift(t);
      j -= 1;
    }
  }

  if (head.length) parts.push(head.join("\n\n"));
  if (tail.length) {
    if (i <= j) parts.push("…");
    parts.push(tail.join("\n\n"));
  }

  return parts.join("\n\n").slice(0, budget);
}

export function listPendingEnrichments(limit = config.enrichPendingLimit): PendingEnrichment[] {
  const db = getDb();
  const cutoff = Date.now() - config.enrichQuietMs;
  const rows = db
    .prepare(
      `SELECT project_slug, session_id, cwd, title, identifiers, file_mtime_ms,
              enrich_error, enriched_mtime_ms
       FROM sessions
       WHERE index_error IS NULL
         AND archived_at IS NULL
         AND file_mtime_ms > 0
         AND file_mtime_ms <= ?
         AND (enriched_mtime_ms IS NULL OR enriched_mtime_ms != file_mtime_ms)
       ORDER BY file_mtime_ms ASC
       LIMIT ?`,
    )
    .all(cutoff, Math.max(limit * 3, limit)) as (Pick<
    SessionRow,
    | "project_slug"
    | "session_id"
    | "cwd"
    | "title"
    | "identifiers"
    | "file_mtime_ms"
    | "enrich_error"
    | "enriched_mtime_ms"
  >)[];

  const pending: PendingEnrichment[] = [];
  for (const row of rows) {
    if (errorMatchesMtime(row.enrich_error, row.file_mtime_ms)) continue;

    const identifiers = row.identifiers
      ? row.identifiers.split(/\s+/).filter(Boolean)
      : [];
    const userTurns = db
      .prepare(
        `SELECT text FROM turns
         WHERE project_slug = ? AND session_id = ? AND role = 'user'
         ORDER BY ordinal ASC`,
      )
      .all(row.project_slug, row.session_id) as { text: string }[];

    pending.push({
      project_slug: row.project_slug,
      session_id: row.session_id,
      cwd: row.cwd,
      title: row.title,
      identifiers,
      file_mtime_ms: row.file_mtime_ms,
      excerpt: buildExcerpt(identifiers, userTurns),
    });
    if (pending.length >= limit) break;
  }
  return pending;
}

export function upsertEnrichmentFts(
  projectSlug: string,
  sessionId: string,
  displayTitle: string,
  summary: string[],
  cwd: string | null,
): void {
  const db = getDb();
  db.prepare(
    "DELETE FROM turns_fts WHERE project_slug = ? AND session_id = ? AND turn_id = ?",
  ).run(projectSlug, sessionId, ENRICHMENT_FTS_TURN_ID);

  const text = [displayTitle, ...summary].filter(Boolean).join("\n");
  if (!text.trim()) return;

  db.prepare(
    `INSERT INTO turns_fts (text, title, cwd, project_slug, session_id, turn_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    text,
    displayTitle,
    cwd ?? "",
    projectSlug,
    sessionId,
    ENRICHMENT_FTS_TURN_ID,
  );
}

/** Re-apply enrichment FTS after a lexical reindex wiped turns_fts. */
export function restoreEnrichmentFtsIfPresent(
  projectSlug: string,
  sessionId: string,
): void {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT display_title, summary_json, cwd FROM sessions
       WHERE project_slug = ? AND session_id = ?`,
    )
    .get(projectSlug, sessionId) as
    | { display_title: string | null; summary_json: string | null; cwd: string | null }
    | undefined;
  if (!row?.display_title) return;
  upsertEnrichmentFts(
    projectSlug,
    sessionId,
    row.display_title,
    parseSummary(row.summary_json),
    row.cwd,
  );
}

export function buildEmbedDocument(opts: {
  displayTitle: string | null;
  title: string | null;
  summary: string[];
  cwd: string | null;
  projectSlug: string;
  identifiers: string;
  userTexts: string[];
}): string {
  const parts: string[] = [];
  const title = opts.displayTitle?.trim() || opts.title?.trim() || "";
  if (title) parts.push(title);

  if (opts.summary.length > 0) {
    const summaryBlock = opts.summary.join("\n");
    // Repeat summary so the mean-pooled vector leans toward it
    parts.push(summaryBlock);
    parts.push(summaryBlock);
  }

  if (opts.identifiers) parts.push(opts.identifiers);
  if (opts.cwd) parts.push(opts.cwd);
  parts.push(opts.projectSlug);

  let doc = parts.filter(Boolean).join("\n");
  const budget = config.maxEmbedDocChars - doc.length - 1;
  if (budget > 0 && opts.userTexts.length > 0) {
    const userJoined: string[] = [];
    let used = 0;
    for (const t of opts.userTexts) {
      const slice = t.slice(0, 800);
      if (used + slice.length + 1 > budget) break;
      userJoined.push(slice);
      used += slice.length + 1;
    }
    if (userJoined.length) {
      doc = `${doc}\n${userJoined.join("\n")}`;
    }
  }

  if (doc.length > config.maxEmbedDocChars) {
    doc = doc.slice(0, config.maxEmbedDocChars);
  }
  return doc || " ";
}

export function saveEnrichment(
  projectSlug: string,
  sessionId: string,
  payload: EnrichmentPayload,
): { ok: true } | { ok: false; status: 404 | 409; error: string } {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM sessions WHERE project_slug = ? AND session_id = ?")
    .get(projectSlug, sessionId) as SessionRow | undefined;

  if (!row) return { ok: false, status: 404, error: "Not found" };
  if (row.file_mtime_ms !== payload.sourceMtimeMs) {
    return {
      ok: false,
      status: 409,
      error: "Transcript changed while enrichment was running",
    };
  }

  // Keep user-set Claude Code custom titles; enrichment may still add a summary
  const customTitle =
    row.title_is_custom && row.title?.trim() ? row.title.trim() : null;
  const displayTitle = (customTitle ?? payload.displayTitle).trim().slice(0, 160);
  const summary = payload.summary
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);

  if (!displayTitle || summary.length === 0) {
    return { ok: false, status: 409, error: "displayTitle and summary required" };
  }

  db.prepare(
    `UPDATE sessions SET
       display_title = ?,
       summary_json = ?,
       enriched_mtime_ms = ?,
       enriched_at = ?,
       enrich_error = NULL
     WHERE project_slug = ? AND session_id = ?`,
  ).run(
    displayTitle,
    JSON.stringify(summary),
    payload.sourceMtimeMs,
    nowIso(),
    projectSlug,
    sessionId,
  );

  upsertEnrichmentFts(projectSlug, sessionId, displayTitle, summary, row.cwd);

  db.prepare(
    `INSERT INTO embed_queue (project_slug, session_id, enqueued_at)
     VALUES (?, ?, ?)
     ON CONFLICT(project_slug, session_id) DO UPDATE SET enqueued_at = excluded.enqueued_at`,
  ).run(projectSlug, sessionId, nowIso());

  // Mark embedding stale so status reflects work remaining
  db.prepare(
    `UPDATE sessions SET embedded_hash = NULL
     WHERE project_slug = ? AND session_id = ?`,
  ).run(projectSlug, sessionId);

  return { ok: true };
}

export function saveEnrichmentError(
  projectSlug: string,
  sessionId: string,
  sourceMtimeMs: number,
  message: string,
): { ok: true } | { ok: false; status: 404 | 409; error: string } {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT file_mtime_ms FROM sessions WHERE project_slug = ? AND session_id = ?",
    )
    .get(projectSlug, sessionId) as { file_mtime_ms: number } | undefined;

  if (!row) return { ok: false, status: 404, error: "Not found" };
  if (row.file_mtime_ms !== sourceMtimeMs) {
    return {
      ok: false,
      status: 409,
      error: "Transcript changed while enrichment was running",
    };
  }

  db.prepare(
    `UPDATE sessions SET enrich_error = ?
     WHERE project_slug = ? AND session_id = ?`,
  ).run(formatEnrichError(sourceMtimeMs, message), projectSlug, sessionId);

  return { ok: true };
}

export { parseSummary };
