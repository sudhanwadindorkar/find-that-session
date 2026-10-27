import fs from "fs";
import path from "path";
import os from "os";

function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Keep runtime DB/models outside the repo. Writes under ./data/ make Next.js
 * Turbopack treat the tree as changed and full-reload the page in a loop.
 */
function resolveDefaultDataDir(): string {
  const preferred = path.join(os.homedir(), ".cache", "find-that-session");
  const legacy = path.join(process.cwd(), "data");
  migrateLegacyDataDir(legacy, preferred);
  return preferred;
}

function migrateLegacyDataDir(legacy: string, preferred: string): void {
  try {
    const legacyDb = path.join(legacy, "find-that-session.db");
    const preferredDb = path.join(preferred, "find-that-session.db");
    const legacyModels = path.join(legacy, "models");
    const preferredModels = path.join(preferred, "models");

    if (fs.existsSync(legacyDb) && !fs.existsSync(preferredDb)) {
      fs.mkdirSync(preferred, { recursive: true });
      fs.renameSync(legacyDb, preferredDb);
      for (const suffix of ["-wal", "-shm"] as const) {
        const src = `${legacyDb}${suffix}`;
        if (fs.existsSync(src)) {
          try {
            fs.renameSync(src, `${preferredDb}${suffix}`);
          } catch {
            /* ignore locked sidecars */
          }
        }
      }
      console.info(`[config] Moved database from ${legacyDb} to ${preferredDb}`);
    }

    if (fs.existsSync(legacyModels) && !fs.existsSync(preferredModels)) {
      fs.mkdirSync(preferred, { recursive: true });
      fs.renameSync(legacyModels, preferredModels);
      console.info(
        `[config] Moved model cache from ${legacyModels} to ${preferredModels}`,
      );
    }
  } catch (err) {
    console.warn(
      "[config] Could not migrate legacy ./data into cache dir:",
      err instanceof Error ? err.message : err,
    );
  }
}

const defaultProjectsDir = path.join(os.homedir(), ".claude", "projects");
const defaultDataDir = resolveDefaultDataDir();

export const config = {
  dataDir: defaultDataDir,
  claudeProjectsDir: expandHome(
    process.env.CLAUDE_PROJECTS_DIR || defaultProjectsDir,
  ),
  claudeSettingsPath: expandHome(
    process.env.CLAUDE_SETTINGS_PATH ||
      path.join(os.homedir(), ".claude", "settings.json"),
  ),
  databasePath: expandHome(
    process.env.DATABASE_PATH || path.join(defaultDataDir, "find-that-session.db"),
  ),
  transformersCacheDir: expandHome(
    process.env.TRANSFORMERS_CACHE || path.join(defaultDataDir, "models"),
  ),
  embeddingModel: process.env.EMBEDDING_MODEL || "Xenova/bge-small-en-v1.5",
  embeddingDims: 384,
  queryPrefix: "Represent this sentence for searching relevant passages: ",
  maxAssistantChars: 2000,
  maxUserCharsPerMessage: 4000,
  maxEmbedDocChars: 6000,
  enrichQuietMs: 3 * 60 * 60 * 1000,
  enrichExcerptChars: 12_000,
  enrichPendingLimit: 10,
  watchDebounceMs: 3000,
  watchCooldownMs: 30_000,
  recentlyActiveMs: 30 * 60 * 1000,
  rrfK: 60,
  searchLimit: 50,
  pageSize: 25,
  ftsCandidateLimit: 80,
  vectorCandidateLimit: 80,
  /**
   * Max sqlite-vec distance for vector-only results on multi-word intent queries.
   * FTS hits are always kept; vectors otherwise only boost those hits.
   */
  vectorOnlyMaxDistance: Number(process.env.VECTOR_ONLY_MAX_DISTANCE || 0.4),
};
