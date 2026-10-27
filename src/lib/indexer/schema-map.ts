import fs from "fs";
import path from "path";

export type SchemaMessage = {
  type: string;
  role: "user" | "assistant";
};

export type SchemaTitle = {
  type: string;
  field: string;
  custom: boolean;
};

export type SchemaContent = {
  textBlockType: string;
  textField: string;
  toolUseType: string;
  toolNameField: string;
  toolInputField: string;
  toolInputKeys: string[];
  commandKey: string;
  knownBlockTypes: string[];
};

export type SchemaMapping = {
  id: string;
  versions: string;
  description?: string;
  skipTypes: string[];
  messages: SchemaMessage[];
  titles: SchemaTitle[];
  contentPath: string[];
  content: SchemaContent;
};

type Cache = {
  mtimeMs: number;
  mappings: SchemaMapping[];
};

let cache: Cache | null = null;

export function schemaMapPath(): string {
  return path.join(process.cwd(), "schema", "claude-code-jsonl.json");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseMapping(value: unknown): SchemaMapping {
  if (!value || typeof value !== "object") {
    throw new Error("schema mapping must be an object");
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id.trim()) {
    throw new Error("schema mapping is missing id");
  }
  if (typeof row.versions !== "string" || !row.versions.trim()) {
    throw new Error(`schema mapping ${row.id} is missing versions`);
  }
  if (!isStringArray(row.skipTypes) || !isStringArray(row.contentPath)) {
    throw new Error(`schema mapping ${row.id} has an invalid skipTypes or contentPath`);
  }
  if (!Array.isArray(row.messages) || !Array.isArray(row.titles)) {
    throw new Error(`schema mapping ${row.id} is missing messages or titles`);
  }

  const messages: SchemaMessage[] = row.messages.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error(`schema mapping ${row.id} has an invalid message`);
    }
    const message = item as Record<string, unknown>;
    if (
      typeof message.type !== "string" ||
      (message.role !== "user" && message.role !== "assistant")
    ) {
      throw new Error(`schema mapping ${row.id} has an invalid message role`);
    }
    return { type: message.type, role: message.role };
  });

  const titles: SchemaTitle[] = row.titles.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error(`schema mapping ${row.id} has an invalid title`);
    }
    const title = item as Record<string, unknown>;
    if (typeof title.type !== "string" || typeof title.field !== "string") {
      throw new Error(`schema mapping ${row.id} has an invalid title field`);
    }
    return { type: title.type, field: title.field, custom: title.custom === true };
  });

  const contentRaw = row.content;
  if (!contentRaw || typeof contentRaw !== "object") {
    throw new Error(`schema mapping ${row.id} is missing content`);
  }
  const content = contentRaw as Record<string, unknown>;
  const stringKeys = [
    "textBlockType",
    "textField",
    "toolUseType",
    "toolNameField",
    "toolInputField",
    "commandKey",
  ] as const;
  for (const key of stringKeys) {
    if (typeof content[key] !== "string") {
      throw new Error(`schema mapping ${row.id} content.${key} must be a string`);
    }
  }
  if (!isStringArray(content.toolInputKeys) || !isStringArray(content.knownBlockTypes)) {
    throw new Error(
      `schema mapping ${row.id} content.toolInputKeys and knownBlockTypes must be string arrays`,
    );
  }

  return {
    id: row.id,
    versions: row.versions.trim(),
    description: typeof row.description === "string" ? row.description : undefined,
    skipTypes: row.skipTypes,
    messages,
    titles,
    contentPath: row.contentPath,
    content: {
      textBlockType: content.textBlockType as string,
      textField: content.textField as string,
      toolUseType: content.toolUseType as string,
      toolNameField: content.toolNameField as string,
      toolInputField: content.toolInputField as string,
      toolInputKeys: content.toolInputKeys,
      commandKey: content.commandKey as string,
      knownBlockTypes: content.knownBlockTypes,
    },
  };
}

export function loadSchemaMappings(): SchemaMapping[] {
  const filePath = schemaMapPath();
  const stat = fs.statSync(filePath);
  if (cache && cache.mtimeMs === stat.mtimeMs) return cache.mappings;

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { mappings?: unknown }).mappings)) {
    throw new Error("schema map must contain a mappings array");
  }
  const mappings = (parsed as { mappings: unknown[] }).mappings.map(parseMapping);
  if (mappings.length === 0) {
    throw new Error("schema map has no mappings");
  }
  cache = { mtimeMs: stat.mtimeMs, mappings };
  return mappings;
}

function parseVersion(version: string): [number, number, number] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: [number, number, number], right: [number, number, number]): number {
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

/** Space-separated comparators such as ">=2.1.0 <3.0.0". "*" matches every version. */
export function versionSatisfies(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  const parts = range.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || parts[0] === "*") return true;
  for (const part of parts) {
    const match = part.match(/^(>=|<=|>|<|=)(\d+\.\d+\.\d+)$/);
    if (!match) return false;
    const bound = parseVersion(match[2]);
    if (!bound) return false;
    const cmp = compareVersions(parsed, bound);
    const op = match[1];
    if (op === ">=" && cmp < 0) return false;
    if (op === "<=" && cmp > 0) return false;
    if (op === ">" && cmp <= 0) return false;
    if (op === "<" && cmp >= 0) return false;
    if (op === "=" && cmp !== 0) return false;
  }
  return true;
}

/**
 * Use the last mapping whose range contains `version`.
 * Missing or unmatched versions use the last entry (the latest mapping).
 */
export function selectMapping(version: string | null, mappings: SchemaMapping[]): SchemaMapping {
  if (mappings.length === 0) {
    throw new Error("schema map has no mappings");
  }
  const latest = mappings[mappings.length - 1];
  if (!version) return latest;
  let chosen: SchemaMapping | null = null;
  for (const mapping of mappings) {
    if (versionSatisfies(version, mapping.versions)) chosen = mapping;
  }
  return chosen ?? latest;
}
