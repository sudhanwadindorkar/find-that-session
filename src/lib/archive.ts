import { getDb } from "@/lib/db";

export type SessionRef = {
  projectSlug: string;
  sessionId: string;
};

function sessionExists(projectSlug: string, sessionId: string): boolean {
  const row = getDb()
    .prepare(
      "SELECT 1 AS ok FROM sessions WHERE project_slug = ? AND session_id = ?",
    )
    .get(projectSlug, sessionId) as { ok: number } | undefined;
  return Boolean(row);
}

export function setArchived(
  projectSlug: string,
  sessionId: string,
  archived: boolean,
): boolean {
  if (!sessionExists(projectSlug, sessionId)) return false;
  const db = getDb();
  if (archived) {
    db.prepare(
      `UPDATE sessions SET archived_at = COALESCE(archived_at, datetime('now'))
       WHERE project_slug = ? AND session_id = ?`,
    ).run(projectSlug, sessionId);
  } else {
    db.prepare(
      `UPDATE sessions SET archived_at = NULL
       WHERE project_slug = ? AND session_id = ?`,
    ).run(projectSlug, sessionId);
  }
  return true;
}

export function setArchivedBulk(
  sessions: SessionRef[],
  archived: boolean,
): { updated: number; missing: number } {
  let updated = 0;
  let missing = 0;
  const db = getDb();
  const tx = db.transaction(() => {
    for (const s of sessions) {
      if (setArchived(s.projectSlug, s.sessionId, archived)) updated += 1;
      else missing += 1;
    }
  });
  tx();
  return { updated, missing };
}
