import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "@/lib/config";
import { SCHEMA_SQL } from "@/lib/db/schema";

let dbInstance: Database.Database | null = null;
let vecReady = false;

function tryLoadSqliteVec(db: Database.Database): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqliteVec = require("sqlite-vec") as {
      load: (db: Database.Database) => void;
      getLoadablePath?: () => string;
    };
    if (typeof sqliteVec.load === "function") {
      sqliteVec.load(db);
    } else if (typeof sqliteVec.getLoadablePath === "function") {
      db.loadExtension(sqliteVec.getLoadablePath());
    } else {
      return false;
    }

    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS session_embeddings USING vec0(
        embedding float[${config.embeddingDims}]
      );
    `);

    // Map rowid of session_embeddings to session key
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_embedding_meta (
        rowid INTEGER PRIMARY KEY,
        project_slug TEXT NOT NULL,
        session_id TEXT NOT NULL,
        UNIQUE(project_slug, session_id)
      );
    `);
    return true;
  } catch (err) {
    console.warn(
      "[db] sqlite-vec unavailable; vector search disabled:",
      err instanceof Error ? err.message : err,
    );
    // Fallback: store embeddings as blobs for later migration
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_embeddings_blob (
        project_slug TEXT NOT NULL,
        session_id TEXT NOT NULL,
        embedding BLOB NOT NULL,
        PRIMARY KEY (project_slug, session_id)
      );
    `);
    return false;
  }
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const dir = path.dirname(config.databasePath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(config.databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  migrateSessionColumns(db);
  migrateFtsTokenizer(db);

  vecReady = tryLoadSqliteVec(db);
  dbInstance = db;
  return db;
}

const TURNS_FTS_SQL = `
CREATE VIRTUAL TABLE turns_fts USING fts5(
  text,
  title,
  cwd,
  project_slug UNINDEXED,
  session_id UNINDEXED,
  turn_id UNINDEXED,
  tokenize = 'unicode61'
);
`;

/** Rebuild turns_fts when it still keeps '-' and '_' inside tokens. */
function migrateFtsTokenizer(db: Database.Database): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'turns_fts'")
    .get() as { sql: string } | undefined;
  if (!row?.sql?.includes("tokenchars")) return;

  console.info("[db] Rebuilding full-text index so hyphenated text matches by part");
  const rebuild = db.transaction(() => {
    db.exec("DROP TABLE IF EXISTS turns_fts_migrate");
    db.exec(`
      CREATE TABLE turns_fts_migrate (
        text TEXT,
        title TEXT,
        cwd TEXT,
        project_slug TEXT,
        session_id TEXT,
        turn_id INTEGER
      );
      INSERT INTO turns_fts_migrate (text, title, cwd, project_slug, session_id, turn_id)
      SELECT text, title, cwd, project_slug, session_id, turn_id FROM turns_fts;
      DROP TABLE turns_fts;
    `);
    db.exec(TURNS_FTS_SQL);
    db.exec(`
      INSERT INTO turns_fts (text, title, cwd, project_slug, session_id, turn_id)
      SELECT text, title, cwd, project_slug, session_id, turn_id FROM turns_fts_migrate;
      DROP TABLE turns_fts_migrate;
    `);
  });
  rebuild();
}

function migrateSessionColumns(db: Database.Database): void {
  const cols = new Set(
    (
      db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]
    ).map((c) => c.name),
  );
  const adds: [string, string][] = [
    ["display_title", "TEXT"],
    ["summary_json", "TEXT"],
    ["enriched_mtime_ms", "INTEGER"],
    ["enriched_at", "TEXT"],
    ["enrich_error", "TEXT"],
    ["archived_at", "TEXT"],
    ["title_is_custom", "INTEGER NOT NULL DEFAULT 0"],
    ["schema_id", "TEXT"],
  ];
  for (const [name, type] of adds) {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${type}`);
    }
  }
}

export function isVecReady(): boolean {
  getDb();
  return vecReady;
}

export type SessionRow = {
  project_slug: string;
  session_id: string;
  cwd: string | null;
  title: string | null;
  first_user_message: string | null;
  identifiers: string;
  started_at: string | null;
  last_active_at: string | null;
  source: string;
  transcript_path: string;
  file_size: number;
  file_mtime_ms: number;
  indexable_hash: string | null;
  embedded_hash: string | null;
  indexed_at: string | null;
  index_error: string | null;
  display_title: string | null;
  summary_json: string | null;
  enriched_mtime_ms: number | null;
  enriched_at: string | null;
  enrich_error: string | null;
  archived_at: string | null;
  title_is_custom: number;
  schema_id: string | null;
};

export type IndexStateRow = {
  id: number;
  lexical_status: string;
  embedding_status: string;
  lexical_done: number;
  lexical_total: number;
  embed_done: number;
  embed_total: number;
  failed_count: number;
  last_scan_at: string | null;
  message: string | null;
};
