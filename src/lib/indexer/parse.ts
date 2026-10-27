import fs from "fs";
import readline from "readline";
import crypto from "crypto";
import { config } from "@/lib/config";
import { extractPathHints, extractTicketIds } from "@/lib/identifiers";
import {
  loadSchemaMappings,
  selectMapping,
  type SchemaContent,
  type SchemaMapping,
} from "@/lib/indexer/schema-map";

export type ParsedTurn = {
  ordinal: number;
  role: "user" | "assistant";
  text: string;
  created_at: string | null;
};

export type ParsedSession = {
  session_id: string;
  project_slug: string;
  cwd: string | null;
  title: string | null;
  /** True when title came from a user-set custom-title event (not ai-title). */
  title_is_custom: boolean;
  schema_id: string;
  first_user_message: string | null;
  identifiers: string[];
  started_at: string | null;
  last_active_at: string | null;
  turns: ParsedTurn[];
  indexable_hash: string;
  embed_document: string;
};

function valueAtPath(obj: Record<string, unknown>, keys: string[]): unknown {
  let current: unknown = obj;
  for (const key of keys) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function textFromContent(content: unknown, spec: SchemaContent): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const rec = block as Record<string, unknown>;
    const text = rec[spec.textField];
    if (rec.type === spec.textBlockType && typeof text === "string") {
      parts.push(text);
    }
  }
  return parts.join("\n").trim();
}

function toolHintsFromContent(content: unknown, spec: SchemaContent): string[] {
  if (!Array.isArray(content)) return [];
  const hints: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const rec = block as Record<string, unknown>;
    if (rec.type !== spec.toolUseType) continue;
    const name = rec[spec.toolNameField];
    if (typeof name === "string") hints.push(name);
    const input = rec[spec.toolInputField];
    if (!input || typeof input !== "object") continue;
    const fields = input as Record<string, unknown>;
    for (const key of spec.toolInputKeys) {
      const value = fields[key];
      if (typeof value !== "string" || value.length === 0 || value.length >= 300) continue;
      if (key === spec.commandKey) {
        const first = value.trim().split(/\s+/)[0] ?? value;
        hints.push(first.slice(0, 80));
        hints.push(...extractTicketIds(value));
        hints.push(...extractPathHints(value).slice(0, 3));
      } else {
        hints.push(value.slice(0, 200));
        hints.push(...extractTicketIds(value));
      }
    }
  }
  return hints;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

/** First Claude Code `version` on an event, if one appears near the start of the file. */
export async function peekTranscriptVersion(transcriptPath: string): Promise<string | null> {
  const stream = fs.createReadStream(transcriptPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let seen = 0;
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      seen += 1;
      if (seen > 200) break;
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (typeof obj.version === "string" && obj.version.trim()) {
          return obj.version.trim();
        }
      } catch {
        continue;
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return null;
}

async function parseWithMapping(
  transcriptPath: string,
  projectSlug: string,
  sessionId: string,
  mapping: SchemaMapping,
): Promise<ParsedSession> {
  const stream = fs.createReadStream(transcriptPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const skipTypes = new Set(mapping.skipTypes);
  const messageRoles = new Map(mapping.messages.map((message) => [message.type, message.role]));

  let title: string | null = null;
  let titleIsCustom = false;
  let cwd: string | null = null;
  let startedAt: string | null = null;
  let lastActiveAt: string | null = null;
  let firstUserMessage: string | null = null;
  const identifierSet = new Set<string>();
  const turns: ParsedTurn[] = [];
  let ordinal = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Tolerate truncated final line while session is writing
      continue;
    }

    const type = typeof obj.type === "string" ? obj.type : "";
    const ts = typeof obj.timestamp === "string" ? obj.timestamp : null;
    if (ts) {
      if (!startedAt) startedAt = ts;
      lastActiveAt = ts;
    }

    // Keep the session-start cwd. Claude Code updates event cwd as the agent
    // `cd`s into monorepo subdirs; last-wins made path/project labels drift.
    if (!cwd && typeof obj.cwd === "string" && obj.cwd) {
      cwd = obj.cwd;
    }

    const titleSpec = mapping.titles.find((item) => item.type === type);
    if (titleSpec) {
      const raw = obj[titleSpec.field];
      if (typeof raw === "string" && raw.trim()) {
        if (titleSpec.custom) {
          title = raw.trim();
          titleIsCustom = true;
        } else if (!titleIsCustom) {
          title = raw.trim();
        }
      }
      continue;
    }

    if (skipTypes.has(type)) continue;

    const role = messageRoles.get(type);
    if (!role) continue;

    const content = valueAtPath(obj, mapping.contentPath);

    for (const hint of toolHintsFromContent(content, mapping.content)) {
      for (const ticket of extractTicketIds(hint)) identifierSet.add(ticket);
      for (const hintPath of extractPathHints(hint)) identifierSet.add(hintPath);
    }

    const text = textFromContent(content, mapping.content);
    if (!text) continue;

    for (const ticket of extractTicketIds(text)) identifierSet.add(ticket);

    if (role === "user") {
      const userText = truncate(text, config.maxUserCharsPerMessage);
      const isMetaNoise =
        userText.startsWith("<local-command-caveat>") ||
        userText.startsWith("<command-name>") ||
        userText.startsWith("<command-message>");
      if (!firstUserMessage && !isMetaNoise) {
        firstUserMessage = truncate(userText, 280);
      }
      turns.push({
        ordinal: ordinal++,
        role: "user",
        text: userText,
        created_at: ts,
      });
    } else {
      turns.push({
        ordinal: ordinal++,
        role: "assistant",
        text: truncate(text, config.maxAssistantChars),
        created_at: ts,
      });
    }
  }

  const identifiers = [...identifierSet].sort();
  const userTexts = turns
    .filter((turn) => turn.role === "user")
    .map((turn) => truncate(turn.text, 800));

  const embedParts = [
    title ?? "",
    cwd ?? "",
    projectSlug,
    identifiers.join(" "),
    ...userTexts,
  ].filter(Boolean);

  let embedDocument = embedParts.join("\n");
  if (embedDocument.length > config.maxEmbedDocChars) {
    embedDocument = embedDocument.slice(0, config.maxEmbedDocChars);
  }

  const hashPayload = JSON.stringify({
    title,
    title_is_custom: titleIsCustom,
    cwd,
    identifiers,
    turns: turns.map((turn) => ({ r: turn.role, t: turn.text })),
  });
  const indexableHash = crypto.createHash("sha256").update(hashPayload).digest("hex");

  return {
    session_id: sessionId,
    project_slug: projectSlug,
    cwd,
    title,
    title_is_custom: titleIsCustom,
    schema_id: mapping.id,
    first_user_message: firstUserMessage,
    identifiers,
    started_at: startedAt,
    last_active_at: lastActiveAt,
    turns,
    indexable_hash: indexableHash,
    embed_document: embedDocument,
  };
}

export async function parseTranscript(
  transcriptPath: string,
  projectSlug: string,
  sessionId: string,
): Promise<ParsedSession> {
  const version = await peekTranscriptVersion(transcriptPath);
  const mapping = selectMapping(version, loadSchemaMappings());
  return parseWithMapping(transcriptPath, projectSlug, sessionId, mapping);
}
