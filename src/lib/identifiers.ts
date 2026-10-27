/** JIRA-style ticket IDs: PROJ-123, ABC-1 */
export const TICKET_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

export function extractTicketIds(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(TICKET_RE)) {
    found.add(m[1]);
  }
  return [...found];
}

/** Normalize query tickets case-insensitively */
export function ticketsInQuery(query: string): string[] {
  const found = new Set<string>();
  const re = /\b([A-Za-z][A-Za-z0-9]+-\d+)\b/g;
  for (const m of query.matchAll(re)) {
    found.add(m[1].toUpperCase());
  }
  return [...found];
}

export function extractPathHints(text: string): string[] {
  const found = new Set<string>();
  // Absolute or relative file-ish paths
  const pathRe =
    /(?:^|[\s"'`])((?:\/[\w.-]+)+(?:\.\w+)?|(?:[\w.-]+\/)+[\w.-]+\.\w+)/g;
  for (const m of text.matchAll(pathRe)) {
    const p = m[1];
    if (p.length > 4 && p.length < 200) found.add(p);
  }
  return [...found].slice(0, 20);
}
