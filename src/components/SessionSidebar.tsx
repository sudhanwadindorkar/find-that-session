"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Box,
  Code,
  Group,
  List,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import type { SearchHit } from "@/lib/types";
import {
  ArchiveIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  UnarchiveIcon,
} from "@/components/icons";
import {
  formatSessionDates,
  projectLabel,
  sessionHref,
  shortPath,
} from "@/lib/format";

const WIDTH_KEY = "fts-sidebar-width";
const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 280;
const MAX_WIDTH = 640;

type Props = {
  hit: SearchHit;
  mode: "active" | "archived";
  onClose: () => void;
  onToggleFavorite: () => void;
  onToggleArchive: () => void;
};

function clampWidth(px: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(px)));
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 6l12 12M18 6 6 18"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function readStoredWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (!raw) return DEFAULT_WIDTH;
    const n = Number(raw);
    return Number.isFinite(n) ? clampWidth(n) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

export function SessionSidebar({
  hit,
  mode,
  onClose,
  onToggleFavorite,
  onToggleArchive,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [width, setWidth] = useState(readStoredWidth);
  const dragging = useRef(false);
  const title =
    hit.display_title?.trim() || hit.title?.trim() || "Untitled session";
  const tickets = hit.identifiers.filter((id) =>
    /^[A-Z][A-Z0-9]+-\d+$/i.test(id),
  );
  const path = shortPath(hit.cwd);
  const detailHref = sessionHref(hit.project_slug, hit.session_id);

  function persistWidth(next: number) {
    const clamped = clampWidth(next);
    setWidth(clamped);
    try {
      localStorage.setItem(WIDTH_KEY, String(clamped));
    } catch {
      /* ignore */
    }
  }

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!dragging.current) return;
    const next = clampWidth(window.innerWidth - e.clientX);
    setWidth(next);
    try {
      localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
      /* ignore */
    }
  }, []);

  const endDrag = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [onPointerMove, endDrag]);

  function startDrag(e: React.PointerEvent<HTMLDivElement>) {
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  }

  function onResizerKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      persistWidth(width + 16);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      persistWidth(width - 16);
    }
  }

  async function copyResume() {
    try {
      await navigator.clipboard.writeText(hit.resume_command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="app-sidebar-wrap" style={{ width }}>
      <div
        className="app-sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize session panel"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={onResizerKeyDown}
      />
      <aside className="app-sidebar">
        <Stack gap="md" p="md">
          <Group justify="space-between" align="center">
            <Text size="sm" c="dimmed">
              Session
            </Text>
            <Tooltip label="Close">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="md"
                aria-label="Close"
                onClick={onClose}
              >
                <CloseIcon />
              </ActionIcon>
            </Tooltip>
          </Group>

          <Box>
            <Group gap={6} align="center" wrap="nowrap">
              <Title order={3} size="h4" style={{ minWidth: 0 }}>
                {title}
              </Title>
              <Tooltip label={hit.favorite ? "Unfavorite" : "Favorite"}>
                <ActionIcon
                  variant="subtle"
                  color={hit.favorite ? "ocean" : "gray"}
                  size="md"
                  aria-label={hit.favorite ? "Unfavorite" : "Favorite"}
                  onClick={onToggleFavorite}
                  style={{ flexShrink: 0, transform: "translateY(1px)" }}
                >
                  {hit.favorite ? "★" : "☆"}
                </ActionIcon>
              </Tooltip>
            </Group>
            <Text size="sm" c="dimmed" mt={4}>
              {formatSessionDates(hit.started_at, hit.last_active_at)}
            </Text>
          </Box>

          <Group gap={4}>
            <Tooltip label="Open in new tab">
              <ActionIcon
                component="a"
                href={detailHref}
                target="_blank"
                rel="noreferrer"
                variant="subtle"
                color="gray"
                size="lg"
                aria-label="Open in new tab"
              >
                <ExternalLinkIcon />
              </ActionIcon>
            </Tooltip>
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
            <Tooltip label={mode === "archived" ? "Unarchive" : "Archive"}>
              <ActionIcon
                variant="subtle"
                color={mode === "active" ? "red" : "ocean"}
                size="lg"
                aria-label={mode === "archived" ? "Unarchive" : "Archive"}
                onClick={onToggleArchive}
              >
                {mode === "archived" ? <UnarchiveIcon /> : <ArchiveIcon />}
              </ActionIcon>
            </Tooltip>
          </Group>

          <Box>
            <Text size="xs" c="dimmed" mb={4}>
              Summary
            </Text>
            {hit.summary.length > 0 ? (
              <List size="sm" spacing={6}>
                {hit.summary.map((line) => (
                  <List.Item key={line}>{line}</List.Item>
                ))}
              </List>
            ) : (
              <Text size="sm" c="dimmed">
                No summary yet
              </Text>
            )}
          </Box>

          <Box>
            <Text size="xs" c="dimmed" mb={4}>
              Project
            </Text>
            <Text size="sm">{projectLabel(hit.project_slug, hit.cwd)}</Text>
          </Box>

          {path ? (
            <Box>
              <Text size="xs" c="dimmed" mb={4}>
                Working directory
              </Text>
              <Code
                block
                style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}
              >
                {path}
              </Code>
            </Box>
          ) : null}

          {tickets.length > 0 ? (
            <Box>
              <Text size="xs" c="dimmed" mb={4}>
                Tickets
              </Text>
              <Text size="sm">{tickets.join(", ")}</Text>
            </Box>
          ) : null}

          <Box>
            <Text size="xs" c="dimmed" mb={4}>
              Resume
            </Text>
            <Code
              block
              style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}
            >
              {hit.resume_command}
            </Code>
          </Box>
        </Stack>
      </aside>
    </div>
  );
}
