import { getDb } from "@/lib/db";
import type { SchemaDriftReport } from "@/lib/types";

type DriftRow = {
  fingerprint: string | null;
  report_json: string | null;
  dismissed_fingerprint: string | null;
};

function readRow(): DriftRow | undefined {
  return getDb()
    .prepare(
      "SELECT fingerprint, report_json, dismissed_fingerprint FROM schema_drift WHERE id = 1",
    )
    .get() as DriftRow | undefined;
}

function isReport(value: unknown): value is SchemaDriftReport {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.fingerprint === "string" &&
    typeof row.schema_id === "string" &&
    typeof row.summary === "string" &&
    typeof row.reported_at === "string" &&
    Array.isArray(row.versions) &&
    Array.isArray(row.unknown_types) &&
    typeof row.content_mismatch_count === "number" &&
    typeof row.message_event_count === "number" &&
    typeof row.title_mismatch_count === "number" &&
    typeof row.sample_count === "number"
  );
}

export function getActiveSchemaDrift(): SchemaDriftReport | null {
  const row = readRow();
  if (!row?.fingerprint || !row.report_json) return null;
  if (row.dismissed_fingerprint === row.fingerprint) return null;
  try {
    const parsed = JSON.parse(row.report_json) as unknown;
    if (!isReport(parsed) || parsed.fingerprint !== row.fingerprint) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSchemaDrift(report: SchemaDriftReport): void {
  const db = getDb();
  const existing = readRow();
  const dismissed =
    existing?.dismissed_fingerprint === report.fingerprint ? report.fingerprint : null;
  db.prepare(
    `UPDATE schema_drift SET
       fingerprint = ?,
       report_json = ?,
       reported_at = ?,
       dismissed_fingerprint = ?
     WHERE id = 1`,
  ).run(report.fingerprint, JSON.stringify(report), report.reported_at, dismissed);
}

export function dismissSchemaDrift(): void {
  getDb()
    .prepare(
      `UPDATE schema_drift
       SET dismissed_fingerprint = fingerprint
       WHERE id = 1 AND fingerprint IS NOT NULL`,
    )
    .run();
}
