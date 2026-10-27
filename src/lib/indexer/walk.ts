import fs from "fs";
import path from "path";
import { config } from "@/lib/config";

export type TranscriptFile = {
  projectSlug: string;
  sessionId: string;
  transcriptPath: string;
  size: number;
  mtimeMs: number;
};

export function listTranscriptFiles(
  rootDir: string = config.claudeProjectsDir,
): TranscriptFile[] {
  const results: TranscriptFile[] = [];
  if (!fs.existsSync(rootDir)) return results;

  let projectDirs: string[];
  try {
    projectDirs = fs.readdirSync(rootDir);
  } catch {
    return results;
  }

  for (const projectSlug of projectDirs) {
    const projectPath = path.join(rootDir, projectSlug);
    let st: fs.Stats;
    try {
      st = fs.statSync(projectPath);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    let entries: string[];
    try {
      entries = fs.readdirSync(projectPath);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      // Ignore subagent-related paths (defensive)
      if (entry.includes("subagents")) continue;

      const transcriptPath = path.join(projectPath, entry);
      let fileStat: fs.Stats;
      try {
        fileStat = fs.statSync(transcriptPath);
      } catch {
        continue;
      }
      if (!fileStat.isFile()) continue;

      const sessionId = entry.replace(/\.jsonl$/, "");
      if (!sessionId) continue;

      results.push({
        projectSlug,
        sessionId,
        transcriptPath,
        size: fileStat.size,
        mtimeMs: Math.floor(fileStat.mtimeMs),
      });
    }
  }

  return results;
}

/** Resolve a single transcript path into metadata, or null if invalid/subagent. */
export function resolveTranscriptFile(filePath: string): TranscriptFile | null {
  const normalized = path.resolve(filePath);
  const root = path.resolve(config.claudeProjectsDir);
  if (!normalized.startsWith(root + path.sep)) return null;
  if (normalized.includes(`${path.sep}subagents${path.sep}`)) return null;
  if (!normalized.endsWith(".jsonl")) return null;

  const rel = path.relative(root, normalized);
  const parts = rel.split(path.sep);
  if (parts.length !== 2) return null;

  const [projectSlug, fileName] = parts;
  if (!projectSlug || !fileName) return null;

  let st: fs.Stats;
  try {
    st = fs.statSync(normalized);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;

  return {
    projectSlug,
    sessionId: fileName.replace(/\.jsonl$/, ""),
    transcriptPath: normalized,
    size: st.size,
    mtimeMs: Math.floor(st.mtimeMs),
  };
}
