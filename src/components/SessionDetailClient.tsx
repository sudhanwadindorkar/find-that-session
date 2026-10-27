"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  CloseButton,
  Code,
  Group,
  List,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { AppShell } from "@/components/AppShell";
import { ArchiveConfirmModal } from "@/components/ArchiveConfirmModal";
import {
  ArchiveIcon,
  CheckIcon,
  CopyIcon,
  UnarchiveIcon,
} from "@/components/icons";
import { MarkdownBody } from "@/components/MarkdownBody";
import {
  formatLocalDateTime,
  formatSessionDates,
  projectLabel,
  shortPath,
} from "@/lib/format";
import type { IndexStatus, SessionDetail } from "@/lib/types";

type Props = {
  projectSlug: string;
  sessionId: string;
};

export function SessionDetailClient({ projectSlug, sessionId }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [transcriptQ, setTranscriptQ] = useState("");
  const [copied, setCopied] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(projectSlug)}/${encodeURIComponent(sessionId)}`,
        );
        if (!res.ok) throw new Error("Session not found");
        const data = (await res.json()) as SessionDetail;
        if (!cancelled) setDetail(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectSlug, sessionId]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/status");
        if (res.ok) setStatus((await res.json()) as IndexStatus);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const filteredTurns = useMemo(() => {
    if (!detail) return [];
    const q = transcriptQ.trim().toLowerCase();
    if (!q) return detail.turns;
    return detail.turns.filter((t) => t.text.toLowerCase().includes(q));
  }, [detail, transcriptQ]);

  async function copyResume() {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(detail.resume_command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  async function toggleFavorite() {
    if (!detail) return;
    const path = `/api/favorites/${encodeURIComponent(projectSlug)}/${encodeURIComponent(sessionId)}`;
    const res = await fetch(path, {
      method: detail.favorite ? "DELETE" : "POST",
    });
    if (!res.ok) return;
    setDetail({ ...detail, favorite: !detail.favorite });
  }

  async function performToggleArchive() {
    if (!detail) return;
    const path = `/api/sessions/${encodeURIComponent(projectSlug)}/${encodeURIComponent(sessionId)}/archive`;
    const res = await fetch(path, {
      method: detail.archived ? "DELETE" : "POST",
    });
    if (!res.ok) return;
    setDetail({ ...detail, archived: !detail.archived });
  }

  function requestToggleArchive() {
    if (!detail) return;
    if (!detail.archived) {
      setArchiveConfirmOpen(true);
      return;
    }
    void performToggleArchive();
  }

  const title =
    detail?.display_title?.trim() ||
    detail?.title?.trim() ||
    "Untitled session";

  return (
    <AppShell status={status}>
      <Stack gap={0}>
        <Box
          p="md"
          style={{
            borderBottom: "1px solid var(--app-border)",
            background: "var(--app-surface)",
          }}
        >
          {loading && <Text c="dimmed">Loading session…</Text>}
          {error && (
            <Alert color="red" title="Error">
              {error}
            </Alert>
          )}

          {detail && (
            <Stack gap="sm">
              <Group gap={6} align="center" wrap="nowrap">
                <Title order={2} style={{ minWidth: 0 }}>
                  {title}
                </Title>
                <Tooltip label={detail.favorite ? "Unfavorite" : "Favorite"}>
                  <ActionIcon
                    variant="subtle"
                    color={detail.favorite ? "ocean" : "gray"}
                    size="md"
                    aria-label={detail.favorite ? "Unfavorite" : "Favorite"}
                    onClick={() => void toggleFavorite()}
                    style={{ flexShrink: 0, transform: "translateY(1px)" }}
                  >
                    {detail.favorite ? "★" : "☆"}
                  </ActionIcon>
                </Tooltip>
                {detail.archived ? <Badge variant="light">Archived</Badge> : null}
              </Group>
              <Text size="sm" c="dimmed">
                {projectLabel(detail.project_slug, detail.cwd)}
                {shortPath(detail.cwd) ? ` · ${shortPath(detail.cwd)}` : ""} ·{" "}
                {formatSessionDates(detail.started_at, detail.last_active_at)}
              </Text>
              <Group gap={4}>
                <Tooltip label={copied ? "Copied" : "Copy resume"}>
                  <ActionIcon
                    variant="subtle"
                    color={copied ? "ocean" : "gray"}
                    size="lg"
                    aria-label={copied ? "Copied" : "Copy resume"}
                    onClick={() => void copyResume()}
                  >
                    {copied ? <CheckIcon /> : <CopyIcon />}
                  </ActionIcon>
                </Tooltip>
                <Tooltip label={detail.archived ? "Unarchive" : "Archive"}>
                  <ActionIcon
                    variant="subtle"
                    color={detail.archived ? "ocean" : "red"}
                    size="lg"
                    aria-label={detail.archived ? "Unarchive" : "Archive"}
                    onClick={requestToggleArchive}
                  >
                    {detail.archived ? <UnarchiveIcon /> : <ArchiveIcon />}
                  </ActionIcon>
                </Tooltip>
              </Group>
              {detail.summary.length > 0 ? (
                <List size="sm" spacing={6}>
                  {detail.summary.map((s) => (
                    <List.Item key={s}>{s}</List.Item>
                  ))}
                </List>
              ) : (
                <Text size="sm" c="dimmed">
                  No summary yet
                </Text>
              )}
              <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {detail.resume_command}
              </Code>
            </Stack>
          )}
        </Box>

        {detail && (
          <>
            <Group
              px="md"
              py="sm"
              style={{
                borderBottom: "1px solid var(--app-border)",
                position: "sticky",
                top: 56,
                zIndex: 20,
                background: "var(--app-surface)",
              }}
            >
              <TextInput
                flex={1}
                placeholder="Search transcript…"
                value={transcriptQ}
                onChange={(e) => setTranscriptQ(e.currentTarget.value)}
                radius="xl"
                rightSection={
                  transcriptQ ? (
                    <CloseButton
                      aria-label="Clear transcript search"
                      onClick={() => setTranscriptQ("")}
                    />
                  ) : null
                }
                rightSectionPointerEvents={transcriptQ ? "all" : "none"}
              />
              <Text size="sm" c="dimmed">
                {filteredTurns.length} / {detail.turns.length} turns
              </Text>
            </Group>
            <Stack gap="sm" p="md">
              {filteredTurns.length === 0 ? (
                <Paper withBorder p="xl" radius="md">
                  <Text c="dimmed" ta="center">
                    No turns match this filter.
                  </Text>
                </Paper>
              ) : (
                filteredTurns.map((turn) => (
                  <Paper key={turn.ordinal} withBorder p="md" radius="md">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={8}>
                      {turn.role}
                      {turn.created_at
                        ? ` · ${formatLocalDateTime(turn.created_at)}`
                        : ""}
                    </Text>
                    <MarkdownBody
                      text={turn.text}
                      highlightQuery={transcriptQ}
                    />
                  </Paper>
                ))
              )}
            </Stack>
          </>
        )}
      </Stack>

      <ArchiveConfirmModal
        opened={archiveConfirmOpen}
        onCancel={() => setArchiveConfirmOpen(false)}
        onConfirm={() => {
          setArchiveConfirmOpen(false);
          void performToggleArchive();
        }}
      />
    </AppShell>
  );
}
