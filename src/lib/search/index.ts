import { config } from "@/lib/config";
import { getDb, isVecReady, type SessionRow } from "@/lib/db";
import { embedQuery } from "@/lib/embeddings";
import { parseSummary } from "@/lib/enrichment";
import { ticketsInQuery } from "@/lib/identifiers";

export type SortMode =
  | "relevance"
  | "newest"
  | "oldest"
  | "created_newest"
  | "created_oldest";

/** Which session timestamp from/to bounds apply to. */
export type DateField = "last_active" | "started";

export type SearchParams = {
  q?: string;
  project?: string;
  from?: string;
  to?: string;
  /** Defaults to last_active (matches historical From/To behavior). */
  dateField?: DateField;
  sort?: SortMode;
  favoritesOnly?: boolean;
  /** When true, only archived sessions; default excludes archived. */
  archivedOnly?: boolean;
  limit?: number;
  page?: number;
  pageSize?: number;
};

function isDateSort(sort: SortMode | undefined): boolean {
  return (
    sort === "newest" ||
    sort === "oldest" ||
    sort === "created_newest" ||
    sort === "created_oldest"
  );
}

function dateSortColumn(sort: SortMode): "last_active_at" | "started_at" {
  return sort === "created_newest" || sort === "created_oldest"
    ? "started_at"
    : "last_active_at";
}

function dateSortAscending(sort: SortMode): boolean {
  return sort === "oldest" || sort === "created_oldest";
}

export type SearchHit = {
  project_slug: string;
  session_id: string;
  title: string | null;
  display_title: string | null;
  summary: string[];
  first_user_message: string | null;
  cwd: string | null;
  last_active_at: string | null;
  started_at: string | null;
  identifiers: string[];
  source: string;
  favorite: boolean;
  archived: boolean;
  recently_active: boolean;
  resume_command: string;
  embedded: boolean;
  snippets: { text: string; role: string }[];
  score: number;
};

export type SearchPage = {
  results: SearchHit[];
  total: number;
  page: number;
  pageSize: number;
};

export function buildResumeCommand(
  cwd: string | null | undefined,
  sessionId: string,
): string {
  const resume = `claude --resume ${sessionId}`;
  const dir = cwd?.trim();
  if (!dir) return resume;
  return `cd ${shellQuote(dir)} && ${resume}`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

type Ranked = {
  project_slug: string;
  session_id: string;
  score: number;
  snippets: { text: string; role: string }[];
  /** Present for vector-lane hits (sqlite-vec distance; lower is closer). */
  distance?: number;
};

/** Multi-word queries may admit strong vector-only hits; single tokens stay FTS-gated. */
function isIntentQuery(query: string): boolean {
  return /\s/.test(query.trim());
}

function escapeFts(query: string): string {
  // Quote each whitespace-separated term. FTS tokenizes inside the quotes, so
  // "PROJ-1612" matches the tokens proj then 1612, not every document containing PROJ.
  // OR across terms keeps multi-word intent queries broad; ranking reorders.
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '""'))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t}"`).join(" OR ");
}

/** 1–2 digit queries stay standalone, so "12" does not match "PROJ-12". */
function isShortNumericQuery(query: string): boolean {
  return /^\d{1,2}$/.test(query.trim());
}

function standaloneNumberPattern(n: string): RegExp {
  return new RegExp(`(?:^|[^A-Za-z0-9_-])${n}(?![A-Za-z0-9_-])`);
}

function numberSnippet(text: string, n: string): string | null {
  const match = standaloneNumberPattern(n).exec(text);
  if (!match) return null;
  const at = match.index + match[0].length - n.length;
  const start = Math.max(0, at - 48);
  const end = Math.min(text.length, at + n.length + 48);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const body =
    text.slice(start, at).replace(/\s+/g, " ") +
    `«${n}»` +
    text.slice(at + n.length, end).replace(/\s+/g, " ");
  return `${prefix}${body}${suffix}`;
}

function sessionKey(projectSlug: string, sessionId: string): string {
  return `${projectSlug}::${sessionId}`;
}

function rrfMerge(
  lists: { key: string; rank: number }[][],
  k: number,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    for (const item of list) {
      const prev = scores.get(item.key) ?? 0;
      scores.set(item.key, prev + 1 / (k + item.rank));
    }
  }
  return scores;
}

function filterSql(params: SearchParams): {
  where: string;
  bindings: unknown[];
} {
  const clauses: string[] = ["s.index_error IS NULL"];
  const bindings: unknown[] = [];

  if (params.archivedOnly) {
    clauses.push("s.archived_at IS NOT NULL");
  } else {
    clauses.push("s.archived_at IS NULL");
  }

  if (params.project) {
    clauses.push("s.project_slug = ?");
    bindings.push(params.project);
  }
  const dateColumn =
    params.dateField === "started" ? "s.started_at" : "s.last_active_at";
  if (params.from) {
    clauses.push(`${dateColumn} >= ?`);
    bindings.push(params.from);
  }
  if (params.to) {
    clauses.push(`${dateColumn} <= ?`);
    bindings.push(params.to);
  }
  if (params.favoritesOnly) {
    clauses.push(
      "EXISTS (SELECT 1 FROM favorites f WHERE f.project_slug = s.project_slug AND f.session_id = s.session_id)",
    );
  }

  return { where: clauses.join(" AND "), bindings };
}

function pageParams(params: SearchParams): { page: number; pageSize: number; offset: number } {
  const pageSize = Math.min(
    100,
    Math.max(1, params.pageSize ?? params.limit ?? config.pageSize),
  );
  const page = Math.max(1, params.page ?? 1);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function recentHits(params: SearchParams): SearchPage {
  const db = getDb();
  const { where, bindings } = filterSql(params);
  const { page, pageSize, offset } = pageParams(params);
  const sort: SortMode =
    params.sort === "oldest" ||
    params.sort === "created_newest" ||
    params.sort === "created_oldest"
      ? params.sort
      : "newest";
  const column = dateSortColumn(sort);
  const order = dateSortAscending(sort) ? "ASC" : "DESC";

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM sessions s WHERE ${where}`)
      .get(...bindings) as { c: number }
  ).c;

  const rows = db
    .prepare(
      `SELECT s.*,
        CASE WHEN fav.session_id IS NULL THEN 0 ELSE 1 END AS is_favorite
       FROM sessions s
       LEFT JOIN favorites fav
         ON fav.project_slug = s.project_slug AND fav.session_id = s.session_id
       WHERE ${where}
       ORDER BY s.${column} ${order}
       LIMIT ? OFFSET ?`,
    )
    .all(...bindings, pageSize, offset) as (SessionRow & { is_favorite: number })[];

  return {
    results: rows.map((r) => toHit(r, [], 0)),
    total,
    page,
    pageSize,
  };
}

function toHit(
  row: SessionRow & { is_favorite?: number },
  snippets: { text: string; role: string }[],
  score: number,
): SearchHit {
  const last = row.last_active_at ? Date.parse(row.last_active_at) : 0;
  return {
    project_slug: row.project_slug,
    session_id: row.session_id,
    title: row.title,
    display_title: row.display_title ?? null,
    summary: parseSummary(row.summary_json ?? null),
    first_user_message: row.first_user_message,
    cwd: row.cwd,
    last_active_at: row.last_active_at,
    started_at: row.started_at,
    identifiers: row.identifiers ? row.identifiers.split(/\s+/).filter(Boolean) : [],
    source: row.source,
    favorite: Boolean(row.is_favorite),
    archived: Boolean(row.archived_at),
    recently_active: last > 0 && Date.now() - last < config.recentlyActiveMs,
    resume_command: buildResumeCommand(row.cwd, row.session_id),
    embedded: Boolean(row.embedded_hash),
    snippets,
    score,
  };
}

/** Exact ticket tokens present in text (case-insensitive). */
function ticketsInText(text: string | null | undefined): string[] {
  if (!text) return [];
  return ticketsInQuery(text);
}

/**
 * How strongly a title string features any of the queried tickets.
 *   3 = leading ticket cluster (e.g. "PROJ-101/PROJ-102: …" or "PROJ-102 …")
 *   2 = ticket appears somewhere else in the title
 *   0 = no title match
 */
function titleTicketTier(
  text: string | null | undefined,
  ticketSet: Set<string>,
): number {
  if (!text?.trim()) return 0;
  const upper = text.trim().toUpperCase();
  const present = ticketsInText(upper).filter((t) => ticketSet.has(t));
  if (present.length === 0) return 0;

  // Leading cluster: one or more tickets separated by / , or space, optionally before ":".
  const lead = upper.match(/^((?:[A-Z][A-Z0-9]+-\d+[\/,\s]*)+)/);
  if (lead && ticketsInText(lead[1]).some((t) => ticketSet.has(t))) {
    return 3;
  }
  if (present.some((t) => upper.startsWith(t))) return 3;
  return 2;
}

/**
 * Ticket lane: exact matches in display_title / title / identifiers.
 * Ranked so title hits beat identifier-only mentions:
 *   3 = queried ticket in a leading title cluster
 *   2 = queried ticket elsewhere in display_title / title
 *   1 = identifiers only
 * Ties break by last_active_at (newer first).
 */
function identifierLane(tickets: string[], params: SearchParams): Ranked[] {
  if (tickets.length === 0) return [];
  const db = getDb();
  const { where, bindings } = filterSql(params);
  const ticketSet = new Set(tickets);

  // Broad LIKE prefilter on identifiers + titles; exact tokens checked in JS.
  const likeParts = tickets.flatMap(() => [
    "UPPER(s.identifiers) LIKE ?",
    "UPPER(COALESCE(s.display_title, '')) LIKE ?",
    "UPPER(COALESCE(s.title, '')) LIKE ?",
  ]);
  const likeBindings = tickets.flatMap((t) => [`%${t}%`, `%${t}%`, `%${t}%`]);

  const rows = db
    .prepare(
      `SELECT s.project_slug, s.session_id, s.identifiers, s.display_title, s.title,
              s.last_active_at
       FROM sessions s
       WHERE ${where} AND (${likeParts.join(" OR ")})`,
    )
    .all(...bindings, ...likeBindings) as {
    project_slug: string;
    session_id: string;
    identifiers: string;
    display_title: string | null;
    title: string | null;
    last_active_at: string | null;
  }[];

  type Cand = {
    project_slug: string;
    session_id: string;
    tier: number;
    last_active_at: string;
  };

  const byKey = new Map<string, Cand>();

  for (const row of rows) {
    const inIdentifiers = row.identifiers
      .split(/\s+/)
      .map((x) => x.toUpperCase())
      .some((id) => ticketSet.has(id));
    const titleTier = Math.max(
      titleTicketTier(row.display_title, ticketSet),
      titleTicketTier(row.title, ticketSet),
    );
    if (titleTier === 0 && !inIdentifiers) continue;

    const tier = titleTier > 0 ? titleTier : 1;
    const key = sessionKey(row.project_slug, row.session_id);
    const prev = byKey.get(key);
    if (!prev || tier > prev.tier) {
      byKey.set(key, {
        project_slug: row.project_slug,
        session_id: row.session_id,
        tier,
        last_active_at: row.last_active_at ?? "",
      });
    }
  }

  const ranked = [...byKey.values()].sort((a, b) => {
    if (b.tier !== a.tier) return b.tier - a.tier;
    return b.last_active_at.localeCompare(a.last_active_at);
  });

  return ranked.map((r, i) => ({
    project_slug: r.project_slug,
    session_id: r.session_id,
    // Preserve tier in the high digits so fused RRF cannot overturn title > id.
    score: r.tier * 1000 - i,
    snippets: [],
  }));
}

function shortNumberLane(n: string, params: SearchParams): Ranked[] {
  const db = getDb();
  const { where, bindings } = filterSql(params);
  const re = standaloneNumberPattern(n);
  const sessions = db
    .prepare(
      `SELECT s.project_slug, s.session_id, s.title, s.display_title, s.summary_json
       FROM sessions s
       WHERE ${where}
         AND (
           instr(COALESCE(s.title, ''), ?) > 0
           OR instr(COALESCE(s.display_title, ''), ?) > 0
           OR instr(COALESCE(s.summary_json, ''), ?) > 0
           OR EXISTS (
             SELECT 1 FROM turns t
             WHERE t.project_slug = s.project_slug
               AND t.session_id = s.session_id
               AND instr(t.text, ?) > 0
           )
         )`,
    )
    .all(...bindings, n, n, n, n) as {
    project_slug: string;
    session_id: string;
    title: string | null;
    display_title: string | null;
    summary_json: string | null;
  }[];

  const ranked: Ranked[] = [];
  const needTranscript: typeof sessions = [];

  for (const row of sessions) {
    const displayHit = re.test(row.display_title ?? "");
    const rawTitleHit = re.test(row.title ?? "");
    const summaryText = parseSummary(row.summary_json).join("\n");
    if (displayHit || rawTitleHit) {
      const titleText = (displayHit ? row.display_title : row.title) ?? "";
      ranked.push({
        project_slug: row.project_slug,
        session_id: row.session_id,
        score: 3,
        snippets: [
          {
            text: numberSnippet(titleText, n) ?? titleText,
            role: "user",
          },
        ],
      });
    } else if (re.test(summaryText)) {
      ranked.push({
        project_slug: row.project_slug,
        session_id: row.session_id,
        score: 2,
        snippets: [
          {
            text: numberSnippet(summaryText, n) ?? summaryText,
            role: "user",
          },
        ],
      });
    } else {
      needTranscript.push(row);
    }
  }

  if (needTranscript.length > 0) {
    const wanted = new Set(
      needTranscript.map((row) => sessionKey(row.project_slug, row.session_id)),
    );
    const turns = db
      .prepare(
        `SELECT project_slug, session_id, role, text
         FROM turns
         WHERE instr(text, ?) > 0`,
      )
      .all(n) as {
      project_slug: string;
      session_id: string;
      role: string;
      text: string;
    }[];
    const seen = new Set<string>();
    for (const turn of turns) {
      const key = sessionKey(turn.project_slug, turn.session_id);
      if (!wanted.has(key) || seen.has(key) || !re.test(turn.text)) continue;
      seen.add(key);
      ranked.push({
        project_slug: turn.project_slug,
        session_id: turn.session_id,
        score: 1,
        snippets: [
          {
            text: numberSnippet(turn.text, n) ?? turn.text.slice(0, 160),
            role: turn.role,
          },
        ],
      });
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

function ftsLane(query: string, params: SearchParams): Ranked[] {
  if (isShortNumericQuery(query)) return shortNumberLane(query.trim(), params);

  const db = getDb();
  const ftsQuery = escapeFts(query);
  const { where, bindings } = filterSql(params);

  type FtsRow = {
    project_slug: string;
    session_id: string;
    turn_id: number;
    rank: number;
    snippet: string;
    role: string;
  };

  let rows: FtsRow[] = [];
  try {
    rows = db
      .prepare(
        `SELECT
           fts.project_slug AS project_slug,
           fts.session_id AS session_id,
           fts.turn_id AS turn_id,
           bm25(turns_fts) AS rank,
           snippet(turns_fts, 0, '«', '»', '…', 24) AS snippet,
           COALESCE(t.role, 'user') AS role
         FROM turns_fts fts
         LEFT JOIN turns t ON t.id = fts.turn_id
         JOIN sessions s
           ON s.project_slug = fts.project_slug AND s.session_id = fts.session_id
         WHERE turns_fts MATCH ?
           AND ${where}
         ORDER BY rank
         LIMIT ?`,
      )
      .all(ftsQuery, ...bindings, config.ftsCandidateLimit) as FtsRow[];
  } catch (err) {
    console.warn("[search] FTS query failed:", err);
    return [];
  }

  // Aggregate: sum of top 3 BM25 scores per session (bm25 is more negative = better)
  const bySession = new Map<
    string,
    { project_slug: string; session_id: string; scores: number[]; snippets: { text: string; role: string }[] }
  >();

  for (const row of rows) {
    const key = sessionKey(row.project_slug, row.session_id);
    let agg = bySession.get(key);
    if (!agg) {
      agg = {
        project_slug: row.project_slug,
        session_id: row.session_id,
        scores: [],
        snippets: [],
      };
      bySession.set(key, agg);
    }
    // Invert bm25 so higher is better
    agg.scores.push(-row.rank);
    if (agg.snippets.length < 2 && row.snippet) {
      agg.snippets.push({ text: row.snippet, role: row.role });
    }
  }

  const ranked: Ranked[] = [];
  for (const agg of bySession.values()) {
    const top = agg.scores.sort((a, b) => b - a).slice(0, 3);
    const score = top.reduce((a, b) => a + b, 0);
    ranked.push({
      project_slug: agg.project_slug,
      session_id: agg.session_id,
      score,
      snippets: agg.snippets,
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

async function vectorLane(query: string, params: SearchParams): Promise<Ranked[]> {
  if (!isVecReady()) return [];

  let vector: Float32Array;
  try {
    vector = await embedQuery(query);
  } catch (err) {
    console.warn("[search] embed query failed:", err);
    return [];
  }

  const db = getDb();
  const { where, bindings } = filterSql(params);
  const buf = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);

  type VecRow = { rowid: number; distance: number };
  let neighbors: VecRow[] = [];
  try {
    neighbors = db
      .prepare(
        `SELECT rowid, distance
         FROM session_embeddings
         WHERE embedding MATCH ?
           AND k = ?
         ORDER BY distance`,
      )
      .all(buf, config.vectorCandidateLimit) as VecRow[];
  } catch (err) {
    console.warn("[search] vector query failed:", err);
    return [];
  }

  const ranked: Ranked[] = [];
  for (const n of neighbors) {
    const meta = db
      .prepare("SELECT project_slug, session_id FROM session_embedding_meta WHERE rowid = ?")
      .get(n.rowid) as { project_slug: string; session_id: string } | undefined;
    if (!meta) continue;

    const ok = db
      .prepare(
        `SELECT 1 AS ok FROM sessions s
         WHERE s.project_slug = ? AND s.session_id = ? AND ${where}`,
      )
      .get(meta.project_slug, meta.session_id, ...bindings) as { ok: number } | undefined;
    if (!ok) continue;

    ranked.push({
      project_slug: meta.project_slug,
      session_id: meta.session_id,
      score: 1 / (1 + n.distance),
      distance: n.distance,
      snippets: [],
    });
  }

  return ranked;
}

function hydrateHits(
  keys: { project_slug: string; session_id: string; score: number; snippets: { text: string; role: string }[] }[],
): SearchHit[] {
  const db = getDb();
  const hits: SearchHit[] = [];
  const getSession = db.prepare(
    `SELECT s.*,
       CASE WHEN fav.session_id IS NULL THEN 0 ELSE 1 END AS is_favorite
     FROM sessions s
     LEFT JOIN favorites fav
       ON fav.project_slug = s.project_slug AND fav.session_id = s.session_id
     WHERE s.project_slug = ? AND s.session_id = ?`,
  );

  for (const key of keys) {
    const row = getSession.get(key.project_slug, key.session_id) as
      | (SessionRow & { is_favorite: number })
      | undefined;
    if (!row || row.index_error) continue;

    let snippets = key.snippets;
    if (snippets.length === 0) {
      const turns = db
        .prepare(
          `SELECT role, text FROM turns
           WHERE project_slug = ? AND session_id = ? AND role = 'user'
           ORDER BY ordinal ASC LIMIT 2`,
        )
        .all(key.project_slug, key.session_id) as { role: string; text: string }[];
      snippets = turns.map((t) => ({
        text: t.text.length > 180 ? `${t.text.slice(0, 180)}…` : t.text,
        role: t.role,
      }));
    }

    hits.push(toHit(row, snippets, key.score));
  }
  return hits;
}

export async function searchSessions(params: SearchParams): Promise<SearchPage> {
  const q = (params.q ?? "").trim();
  const sort = params.sort ?? (q ? "relevance" : "newest");
  const { page, pageSize, offset } = pageParams(params);

  if (!q) {
    return recentHits({
      ...params,
      sort: isDateSort(sort) ? sort : "newest",
    });
  }

  const tickets = ticketsInQuery(q);
  const ticketOnly =
    tickets.length > 0 &&
    q.replace(/[A-Za-z][A-Za-z0-9]+-\d+/g, "").replace(/[\s,]+/g, "") === "";

  const idHits = identifierLane(tickets, params);
  // Bare ticket with no exact title/identifier hit: do not fall back to
  // vector "similar PROJ work" — that buries relevance under noise.
  if (ticketOnly && idHits.length === 0) {
    return { results: [], total: 0, page, pageSize };
  }
  // For bare ticket queries, exact matches are enough (avoids 50
  // dependency-tree mentions). Broader hybrid still runs for intent text.
  const ftsHits = ticketOnly ? [] : ftsLane(q, params);
  const vecHits = ticketOnly ? [] : await vectorLane(q, params);
  const intentQuery = isIntentQuery(q);

  const ftsRank = ftsHits.map((h, i) => ({
    key: sessionKey(h.project_slug, h.session_id),
    rank: i + 1,
  }));
  const vecRank = vecHits.map((h, i) => ({
    key: sessionKey(h.project_slug, h.session_id),
    rank: i + 1,
  }));

  // Vectors boost FTS ranking via RRF; they do not freely inject new rows.
  const fused = rrfMerge([ftsRank, vecRank], config.rrfK);

  // Merge snippet info from FTS (and fetch snippets for identifier-only hits)
  const snippetMap = new Map<string, { text: string; role: string }[]>();
  for (const h of ftsHits) {
    snippetMap.set(sessionKey(h.project_slug, h.session_id), h.snippets);
  }
  if (ticketOnly && idHits.length > 0) {
    for (const h of ftsLane(tickets[0] ?? q, params)) {
      const key = sessionKey(h.project_slug, h.session_id);
      if (!snippetMap.has(key)) snippetMap.set(key, h.snippets);
    }
  }

  const idKeys = new Set(idHits.map((h) => sessionKey(h.project_slug, h.session_id)));
  const ftsKeys = new Set(ftsHits.map((h) => sessionKey(h.project_slug, h.session_id)));
  const vecDistance = new Map(
    vecHits.map((h) => [sessionKey(h.project_slug, h.session_id), h.distance ?? Infinity]),
  );

  const combined: {
    project_slug: string;
    session_id: string;
    score: number;
    snippets: { text: string; role: string }[];
  }[] = [];

  // Identifier/title lane first (preserve tier ranking from identifierLane)
  for (const h of idHits) {
    const key = sessionKey(h.project_slug, h.session_id);
    combined.push({
      project_slug: h.project_slug,
      session_id: h.session_id,
      score: 1_000_000 + h.score + (fused.get(key) ?? 0),
      snippets: snippetMap.get(key) ?? [],
    });
  }

  // FTS hits (vector-boosted via RRF), then strong vector-only for intent queries.
  const fusedSorted = [...fused.entries()].sort((a, b) => b[1] - a[1]);
  for (const [key, score] of fusedSorted) {
    if (idKeys.has(key)) continue;
    const inFts = ftsKeys.has(key);
    const distance = vecDistance.get(key) ?? Infinity;
    const strongVectorOnly =
      intentQuery &&
      !inFts &&
      distance <= config.vectorOnlyMaxDistance;
    if (!inFts && !strongVectorOnly) continue;

    const [project_slug, session_id] = key.split("::");
    if (!project_slug || !session_id) continue;
    combined.push({
      project_slug,
      session_id,
      score,
      snippets: snippetMap.get(key) ?? [],
    });
  }

  // Intent queries: admit high-similarity vector neighbors that RRF omitted
  // (e.g. only in vector lane beyond fused iteration — already covered above).
  // Ensure every strong vector-only hit is present even if somehow missing from fused.
  if (intentQuery) {
    for (const h of vecHits) {
      const key = sessionKey(h.project_slug, h.session_id);
      if (idKeys.has(key) || ftsKeys.has(key)) continue;
      if ((h.distance ?? Infinity) > config.vectorOnlyMaxDistance) continue;
      if (combined.some((c) => sessionKey(c.project_slug, c.session_id) === key)) {
        continue;
      }
      combined.push({
        project_slug: h.project_slug,
        session_id: h.session_id,
        score: fused.get(key) ?? h.score,
        snippets: [],
      });
    }
  }

  let hits = hydrateHits(combined);

  if (isDateSort(sort)) {
    const field = dateSortColumn(sort);
    const ascending = dateSortAscending(sort);
    hits = hits.sort((a, b) => {
      const left = a[field] ?? "";
      const right = b[field] ?? "";
      return ascending ? left.localeCompare(right) : right.localeCompare(left);
    });
  }

  return {
    results: hits.slice(offset, offset + pageSize),
    total: hits.length,
    page,
    pageSize,
  };
}

export type ProjectOption = {
  slug: string;
  /** Prefer basename of a real cwd so hyphenated folders stay intact. */
  label: string;
  cwd: string | null;
};

export function listProjects(): ProjectOption[] {
  const db = getDb();
  // Prefer the shortest cwd (closest to project root). Ordering by
  // last_active_at picked deep worktrees (e.g. …/api2) and hid "my-project".
  const rows = db
    .prepare(
      `SELECT project_slug,
              (SELECT cwd FROM sessions s2
               WHERE s2.project_slug = s.project_slug
                 AND s2.cwd IS NOT NULL AND TRIM(s2.cwd) != ''
               ORDER BY LENGTH(s2.cwd) ASC, s2.last_active_at DESC
               LIMIT 1) AS cwd
       FROM sessions s
       WHERE index_error IS NULL
       GROUP BY project_slug
       ORDER BY project_slug ASC`,
    )
    .all() as { project_slug: string; cwd: string | null }[];

  return rows
    .map((r) => {
      const cwd = r.cwd?.trim() || null;
      const parts = cwd ? cwd.split("/").filter(Boolean) : [];
      const label = parts[parts.length - 1] || r.project_slug.replace(/^-/, "");
      return { slug: r.project_slug, label, cwd };
    })
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
    );
}

export function getSessionDetail(
  projectSlug: string,
  sessionId: string,
): (SearchHit & { turns: { ordinal: number; role: string; text: string; created_at: string | null }[] }) | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.*,
         CASE WHEN fav.session_id IS NULL THEN 0 ELSE 1 END AS is_favorite
       FROM sessions s
       LEFT JOIN favorites fav
         ON fav.project_slug = s.project_slug AND fav.session_id = s.session_id
       WHERE s.project_slug = ? AND s.session_id = ?`,
    )
    .get(projectSlug, sessionId) as (SessionRow & { is_favorite: number }) | undefined;

  if (!row) return null;

  const turns = db
    .prepare(
      `SELECT ordinal, role, text, created_at FROM turns
       WHERE project_slug = ? AND session_id = ?
       ORDER BY ordinal ASC`,
    )
    .all(projectSlug, sessionId) as {
    ordinal: number;
    role: string;
    text: string;
    created_at: string | null;
  }[];

  const hit = toHit(row, [], 0);
  return { ...hit, turns };
}

export function setFavorite(
  projectSlug: string,
  sessionId: string,
  favorite: boolean,
): boolean {
  const db = getDb();
  const exists = db
    .prepare("SELECT 1 AS ok FROM sessions WHERE project_slug = ? AND session_id = ?")
    .get(projectSlug, sessionId) as { ok: number } | undefined;
  if (!exists) return false;

  if (favorite) {
    db.prepare(
      `INSERT OR IGNORE INTO favorites (project_slug, session_id, created_at)
       VALUES (?, ?, datetime('now'))`,
    ).run(projectSlug, sessionId);
  } else {
    db.prepare(
      "DELETE FROM favorites WHERE project_slug = ? AND session_id = ?",
    ).run(projectSlug, sessionId);
  }
  return true;
}
