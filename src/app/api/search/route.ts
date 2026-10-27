import { NextRequest, NextResponse } from "next/server";
import {
  searchSessions,
  type DateField,
  type SortMode,
} from "@/lib/search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SORT_MODES = new Set<SortMode>([
  "relevance",
  "newest",
  "oldest",
  "created_newest",
  "created_oldest",
]);

const DATE_FIELDS = new Set<DateField>(["last_active", "started"]);

function parseSort(value: string | null): SortMode | undefined {
  if (!value || !SORT_MODES.has(value as SortMode)) return undefined;
  return value as SortMode;
}

function parseDateField(value: string | null): DateField | undefined {
  if (!value || !DATE_FIELDS.has(value as DateField)) return undefined;
  return value as DateField;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const favoritesOnly = sp.get("favoritesOnly");
  const archived = sp.get("archived");
  const page = Number(sp.get("page") ?? "1");
  const pageSize = Number(sp.get("pageSize") ?? "25");
  const result = await searchSessions({
    q: sp.get("q") ?? undefined,
    project: sp.get("project") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    dateField: parseDateField(sp.get("dateField")),
    sort: parseSort(sp.get("sort")),
    favoritesOnly: favoritesOnly === "1" || favoritesOnly === "true",
    archivedOnly: archived === "1" || archived === "true",
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 25,
  });
  return NextResponse.json(result);
}
