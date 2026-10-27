/** Human-readable local datetime, e.g. "15th Oct 2026, 9:34 CET". */
export function formatLocalDateTime(iso: string | null | undefined): string {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  const day = d.getDate();
  const ord = ordinal(day);
  const month = d.toLocaleString(undefined, { month: "short" });
  const year = d.getFullYear();
  const time = d.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
  const tz =
    d
      .toLocaleTimeString(undefined, { timeZoneName: "short" })
      .split(" ")
      .pop() ?? "";

  return `${day}${ord} ${month} ${year}, ${time} ${tz}`.trim();
}

/** Session creation + last-active for list/sidebar/detail meta lines. */
export function formatSessionDates(
  startedAt: string | null | undefined,
  lastActiveAt: string | null | undefined,
): string {
  const created = formatLocalDateTime(startedAt);
  const active = formatLocalDateTime(lastActiveAt);
  if (!startedAt && !lastActiveAt) return "Unknown";
  if (!startedAt) return `Active ${active}`;
  if (!lastActiveAt || startedAt === lastActiveAt) return `Created ${created}`;
  return `Created ${created} · Active ${active}`;
}

export type WhenMode = "any" | "after" | "before" | "between" | "on";

/** Map a single when-filter into inclusive ISO from/to bounds. */
export function whenBounds(
  mode: WhenMode,
  date: string,
  dateEnd: string,
): { from?: string; to?: string } {
  if (mode === "any" || !date) return {};
  if (mode === "after") return { from: `${date}T00:00:00.000Z` };
  if (mode === "before") return { to: `${date}T23:59:59.999Z` };
  if (mode === "on") {
    return { from: `${date}T00:00:00.000Z`, to: `${date}T23:59:59.999Z` };
  }
  // between
  if (!dateEnd) return { from: `${date}T00:00:00.000Z` };
  const start = date <= dateEnd ? date : dateEnd;
  const end = date <= dateEnd ? dateEnd : date;
  return {
    from: `${start}T00:00:00.000Z`,
    to: `${end}T23:59:59.999Z`,
  };
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/** Shorten an absolute path for display (home → ~). Safe on client + server. */
export function shortPath(cwd: string | null | undefined): string | null {
  if (!cwd?.trim()) return null;
  const path = cwd.trim();
  const m = path.match(/^\/(?:Users|home)\/[^/]+(\/.*)?$/);
  if (m) return `~${m[1] ?? ""}` || "~";
  return path;
}

/**
 * Label for a Claude project. Prefer real cwd basename — Claude encodes `/` as
 * `-` in project slugs, which breaks hyphenated folder names if reversed.
 */
export function projectLabel(
  projectSlug: string,
  cwd?: string | null,
): string {
  const path = cwd?.trim();
  if (path) {
    const parts = path.split("/").filter(Boolean);
    return parts[parts.length - 1] || path;
  }
  return projectSlug.replace(/^-/, "") || projectSlug;
}

/** Truncated summary line for list rows. */
export function formatSummaryPreview(
  summary: string[],
  maxLen = 160,
): string {
  const joined = summary.map((s) => s.trim()).filter(Boolean).join(" · ");
  if (!joined) return "No summary yet";
  if (joined.length <= maxLen) return joined;
  return `${joined.slice(0, maxLen - 1).trimEnd()}…`;
}

export function sessionHref(projectSlug: string, sessionId: string): string {
  return `/sessions/${encodeURIComponent(projectSlug)}/${encodeURIComponent(sessionId)}`;
}
