"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Checkbox,
  CloseButton,
  Group,
  Paper,
  Select,
  SegmentedControl,
  Text,
  TextInput,
} from "@mantine/core";
import { AppShell } from "@/components/AppShell";
import { ArchiveConfirmModal } from "@/components/ArchiveConfirmModal";
import { ExternalLinkIcon } from "@/components/icons";
import { Pagination } from "@/components/Pagination";
import {
  ProjectCombobox,
  type ProjectOption,
} from "@/components/ProjectCombobox";
import { SessionSidebar } from "@/components/SessionSidebar";
import {
  formatSessionDates,
  formatSummaryPreview,
  projectLabel,
  sessionHref,
  shortPath,
  whenBounds,
  type WhenMode,
} from "@/lib/format";
import type { IndexStatus, SearchHit, SearchPage } from "@/lib/types";

export type Filters = {
  q: string;
  project: string;
  when: WhenMode;
  date: string;
  dateEnd: string;
  dateField: "last_active" | "started";
  sort: "relevance" | "newest" | "oldest" | "created_newest" | "created_oldest";
  favoritesOnly: boolean;
};

const initialFilters: Filters = {
  q: "",
  project: "",
  when: "any",
  date: "",
  dateEnd: "",
  dateField: "last_active",
  sort: "relevance",
  favoritesOnly: false,
};

type Props = {
  mode: "active" | "archived";
};

function hitKey(hit: SearchHit): string {
  return `${hit.project_slug}::${hit.session_id}`;
}

export function SessionWorkspace({ mode }: Props) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [debouncedQ, setDebouncedQ] = useState("");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
  const [pendingArchive, setPendingArchive] = useState<
    null | { kind: "single"; hit: SearchHit } | { kind: "bulk"; count: number }
  >(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(filters.q), 250);
    return () => clearTimeout(t);
  }, [filters.q]);

  useEffect(() => {
    setPage(1);
  }, [
    debouncedQ,
    filters.project,
    filters.when,
    filters.date,
    filters.dateEnd,
    filters.dateField,
    filters.sort,
    filters.favoritesOnly,
    mode,
  ]);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error("status failed");
      setStatus((await res.json()) as IndexStatus);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const id = setInterval(() => void refreshStatus(), 2000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/projects");
        if (!res.ok) return;
        const data = (await res.json()) as { projects: ProjectOption[] };
        setProjects(Array.isArray(data.projects) ? data.projects : []);
      } catch {
        /* ignore */
      }
    })();
  }, [status?.session_count]);

  const searchKey = useMemo(
    () =>
      JSON.stringify({
        q: debouncedQ,
        project: filters.project,
        when: filters.when,
        date: filters.date,
        dateEnd: filters.dateEnd,
        dateField: filters.dateField,
        sort: filters.sort,
        favoritesOnly: filters.favoritesOnly,
        page,
        mode,
      }),
    [
      debouncedQ,
      filters.project,
      filters.when,
      filters.date,
      filters.dateEnd,
      filters.dateField,
      filters.sort,
      filters.favoritesOnly,
      page,
      mode,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const parsed = JSON.parse(searchKey) as Filters & {
          q: string;
          page: number;
          mode: "active" | "archived";
        };
        const sp = new URLSearchParams();
        if (parsed.q) sp.set("q", parsed.q);
        if (parsed.project) sp.set("project", parsed.project);
        const bounds = whenBounds(parsed.when, parsed.date, parsed.dateEnd);
        if (bounds.from) sp.set("from", bounds.from);
        if (bounds.to) sp.set("to", bounds.to);
        if (bounds.from || bounds.to) sp.set("dateField", parsed.dateField);
        const sort =
          !parsed.q && parsed.sort === "relevance" ? "newest" : parsed.sort;
        sp.set("sort", sort);
        if (parsed.favoritesOnly) sp.set("favoritesOnly", "1");
        if (parsed.mode === "archived") sp.set("archived", "1");
        sp.set("page", String(parsed.page));
        sp.set("pageSize", "25");

        const res = await fetch(`/api/search?${sp.toString()}`);
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const data = (await res.json()) as SearchPage;
        if (!cancelled) {
          setResults(data.results);
          setTotal(data.total);
          setPageSize(data.pageSize);
          setSelectedSet(new Set());
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Search failed");
          setResults([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchKey, status?.lexical_done, status?.embed_total]);

  const selected = results.find((r) => hitKey(r) === selectedKey) ?? null;

  async function onReindex() {
    setReindexing(true);
    try {
      await fetch("/api/reindex", { method: "POST" });
      await refreshStatus();
    } finally {
      setReindexing(false);
    }
  }

  async function onToggleFavorite(hit: SearchHit) {
    const path = `/api/favorites/${encodeURIComponent(hit.project_slug)}/${encodeURIComponent(hit.session_id)}`;
    const res = await fetch(path, { method: hit.favorite ? "DELETE" : "POST" });
    if (!res.ok) return;
    setResults((prev) =>
      prev.map((r) =>
        hitKey(r) === hitKey(hit) ? { ...r, favorite: !r.favorite } : r,
      ),
    );
    void refreshStatus();
  }

  async function performArchive(hit: SearchHit) {
    const path = `/api/sessions/${encodeURIComponent(hit.project_slug)}/${encodeURIComponent(hit.session_id)}/archive`;
    const res = await fetch(path, {
      method: mode === "archived" ? "DELETE" : "POST",
    });
    if (!res.ok) return;
    setResults((prev) => prev.filter((r) => hitKey(r) !== hitKey(hit)));
    setTotal((t) => Math.max(0, t - 1));
    if (selectedKey === hitKey(hit)) setSelectedKey(null);
    void refreshStatus();
  }

  function onToggleArchive(hit: SearchHit) {
    if (mode === "active") {
      setPendingArchive({ kind: "single", hit });
      return;
    }
    void performArchive(hit);
  }

  async function performBulkArchive() {
    const sessions = results
      .filter((r) => selectedSet.has(hitKey(r)))
      .map((r) => ({
        projectSlug: r.project_slug,
        sessionId: r.session_id,
      }));
    if (sessions.length === 0) return;
    const res = await fetch("/api/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessions,
        archived: mode === "active",
      }),
    });
    if (!res.ok) return;
    const keys = new Set(
      sessions.map((s) => `${s.projectSlug}::${s.sessionId}`),
    );
    setResults((prev) => prev.filter((r) => !keys.has(hitKey(r))));
    setTotal((t) => Math.max(0, t - sessions.length));
    setSelectedSet(new Set());
    if (selectedKey && keys.has(selectedKey)) setSelectedKey(null);
    void refreshStatus();
  }

  function onBulkArchive() {
    if (selectedSet.size === 0) return;
    if (mode === "active") {
      setPendingArchive({ kind: "bulk", count: selectedSet.size });
      return;
    }
    void performBulkArchive();
  }

  async function confirmPendingArchive() {
    const pending = pendingArchive;
    setPendingArchive(null);
    if (!pending) return;
    if (pending.kind === "single") {
      await performArchive(pending.hit);
      return;
    }
    await performBulkArchive();
  }

  function selectSession(key: string) {
    setSelectedKey(key);
    window.scrollTo({ top: 0, behavior: "smooth" });
    listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleSelect(key: string, checked: boolean) {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  const emptyMessage =
    mode === "archived"
      ? debouncedQ
        ? `No archived sessions matched “${debouncedQ}”.`
        : "No archived sessions."
      : !status?.projects_dir_exists
        ? `No Claude Code sessions found. Expected ${status?.projects_dir ?? "~/.claude/projects"}.`
        : debouncedQ
          ? `No sessions matched “${debouncedQ}”. Try a broader query or clear filters.`
          : "No sessions indexed yet. Wait for indexing to finish or click Reindex.";

  return (
    <AppShell status={status} onReindex={onReindex} reindexing={reindexing}>
      <div className="app-body">
        <div className="app-main">
          <Box className="app-filters" px="md" pt="md" pb="sm">
            <TextInput
              placeholder="Search by keywords, intent, or JIRA ticket (e.g. PROJ-102)"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.currentTarget.value })}
              size="md"
              radius="xl"
              autoFocus={mode === "active"}
              mb="sm"
              rightSection={
                filters.q ? (
                  <CloseButton
                    aria-label="Clear search"
                    onClick={() => setFilters({ ...filters, q: "" })}
                  />
                ) : null
              }
              rightSectionPointerEvents={filters.q ? "all" : "none"}
            />
            <Group gap="sm" align="flex-end" wrap="wrap">
              <ProjectCombobox
                projects={projects}
                value={filters.project}
                onChange={(project) => setFilters({ ...filters, project })}
                w={280}
              />
              <Select
                label="When"
                data={[
                  { value: "any", label: "Any time" },
                  { value: "after", label: "After" },
                  { value: "before", label: "Before" },
                  { value: "between", label: "Between" },
                  { value: "on", label: "On" },
                ]}
                value={filters.when}
                onChange={(value) =>
                  setFilters({
                    ...filters,
                    when: (value as WhenMode) ?? "any",
                    dateEnd: value === "between" ? filters.dateEnd : "",
                  })
                }
                allowDeselect={false}
                w={130}
              />
              {filters.when !== "any" ? (
                <TextInput
                  type="date"
                  label={filters.when === "between" ? "From" : "Date"}
                  value={filters.date}
                  onChange={(e) =>
                    setFilters({ ...filters, date: e.currentTarget.value })
                  }
                  w={150}
                />
              ) : null}
              {filters.when === "between" ? (
                <TextInput
                  type="date"
                  label="To"
                  value={filters.dateEnd}
                  onChange={(e) =>
                    setFilters({ ...filters, dateEnd: e.currentTarget.value })
                  }
                  w={150}
                />
              ) : null}
              {filters.when !== "any" ? (
                <Select
                  label="Based on"
                  data={[
                    { value: "last_active", label: "Last active" },
                    { value: "started", label: "Created" },
                  ]}
                  value={filters.dateField}
                  onChange={(value) =>
                    setFilters({
                      ...filters,
                      dateField:
                        value === "started" ? "started" : "last_active",
                    })
                  }
                  allowDeselect={false}
                  w={140}
                />
              ) : null}
              <Select
                label="Sort"
                data={[
                  { value: "relevance", label: "Relevance" },
                  { value: "newest", label: "Last active · newest" },
                  { value: "oldest", label: "Last active · oldest" },
                  { value: "created_newest", label: "Created · newest" },
                  { value: "created_oldest", label: "Created · oldest" },
                ]}
                value={filters.sort}
                onChange={(value) =>
                  setFilters({
                    ...filters,
                    sort: (value as Filters["sort"]) ?? "relevance",
                  })
                }
                allowDeselect={false}
                w={200}
              />
              <Checkbox
                label="Favorites"
                checked={filters.favoritesOnly}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    favoritesOnly: e.currentTarget.checked,
                  })
                }
                mb={6}
              />
              <SegmentedControl
                value={mode}
                onChange={(value) => {
                  router.push(value === "archived" ? "/archived" : "/");
                }}
                data={[
                  { label: "Active", value: "active" },
                  { label: "Archived", value: "archived" },
                ]}
                mb={4}
              />
            </Group>
          </Box>

          {selectedSet.size > 0 && (
            <Group
              gap="sm"
              px="md"
              py="xs"
              style={{
                background: "var(--app-accent-soft)",
                borderBottom: "1px solid var(--app-border)",
              }}
            >
              <Text size="sm">{selectedSet.size} selected</Text>
              <Button size="xs" variant="light" onClick={() => void onBulkArchive()}>
                {mode === "archived" ? "Unarchive selected" : "Archive selected"}
              </Button>
              <Button
                size="xs"
                variant="subtle"
                onClick={() => setSelectedSet(new Set())}
              >
                Clear
              </Button>
            </Group>
          )}

          {error && (
            <Alert color="red" mx="md" mt="sm" title="Search failed">
              {error}
            </Alert>
          )}

          <div className="app-list" ref={listRef}>
            {loading && (
              <Paper withBorder p="xl" m="md" radius="md">
                <Text c="dimmed" ta="center">
                  Loading…
                </Text>
              </Paper>
            )}
            {!loading && !error && results.length === 0 && (
              <Paper withBorder p="xl" m="md" radius="md">
                <Text c="dimmed" ta="center">
                  {emptyMessage}
                </Text>
              </Paper>
            )}
            {!loading &&
              results.map((hit) => {
                const key = hitKey(hit);
                const title =
                  hit.display_title?.trim() ||
                  hit.title?.trim() ||
                  "Untitled session";
                const summaryLine = formatSummaryPreview(hit.summary, 160);
                const project = projectLabel(hit.project_slug, hit.cwd);
                const pathHint = shortPath(hit.cwd);
                return (
                  <div
                    key={key}
                    className="session-row"
                    data-selected={selectedKey === key ? "true" : "false"}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectSession(key)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectSession(key);
                      }
                    }}
                  >
                    <Checkbox
                      checked={selectedSet.has(key)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        toggleSelect(key, e.currentTarget.checked)
                      }
                      aria-label={`Select ${title}`}
                      mt={4}
                    />
                    <div>
                      <div className="session-row-title">
                        <h3>{title}</h3>
                        <Group
                          gap={2}
                          wrap="nowrap"
                          className="session-row-actions"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <ActionIcon
                            variant="subtle"
                            color={hit.favorite ? "ocean" : "gray"}
                            size="md"
                            aria-label={
                              hit.favorite ? "Unfavorite" : "Favorite"
                            }
                            onClick={() => void onToggleFavorite(hit)}
                          >
                            {hit.favorite ? "★" : "☆"}
                          </ActionIcon>
                          <ActionIcon
                            component="a"
                            href={sessionHref(
                              hit.project_slug,
                              hit.session_id,
                            )}
                            target="_blank"
                            rel="noreferrer"
                            variant="subtle"
                            color="gray"
                            size="md"
                            aria-label={`Open ${title} in new tab`}
                          >
                            <ExternalLinkIcon />
                          </ActionIcon>
                        </Group>
                      </div>
                      <p className="summary-line">{summaryLine}</p>
                      <div className="meta">
                        {project}
                        {pathHint ? ` · ${pathHint}` : ""} ·{" "}
                        {formatSessionDates(hit.started_at, hit.last_active_at)}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onChange={setPage}
          />
        </div>

        {selected ? (
          <SessionSidebar
            hit={selected}
            mode={mode}
            onClose={() => setSelectedKey(null)}
            onToggleFavorite={() => void onToggleFavorite(selected)}
            onToggleArchive={() => onToggleArchive(selected)}
          />
        ) : null}
      </div>

      <ArchiveConfirmModal
        opened={pendingArchive !== null}
        count={
          pendingArchive?.kind === "bulk" ? pendingArchive.count : 1
        }
        onCancel={() => setPendingArchive(null)}
        onConfirm={() => void confirmPendingArchive()}
      />
    </AppShell>
  );
}
