"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Group,
  Loader,
  Text,
  Tooltip,
  useMantineColorScheme,
} from "@mantine/core";
import { RetentionControl } from "@/components/RetentionControl";
import { ThemePicker } from "@/components/ThemePicker";
import { SparkSearchIcon } from "@/components/icons";
import type { IndexStatus } from "@/lib/types";
import { formatLocalDateTime } from "@/lib/format";

type Props = {
  status: IndexStatus | null;
  onReindex?: () => void;
  reindexing?: boolean;
  children: React.ReactNode;
};

function ReindexIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4.5 12a7.5 7.5 0 0 1 12.7-5.4M19.5 12a7.5 7.5 0 0 1-12.7 5.4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M17 3.5v4h4M7 20.5v-4H3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AppShell({
  status,
  onReindex,
  reindexing = false,
  children,
}: Props) {
  const { setColorScheme } = useMantineColorScheme();
  const [hiddenDrift, setHiddenDrift] = useState<string | null>(null);
  const drift = status?.schema_drift ?? null;
  const showDrift = Boolean(drift && drift.fingerprint !== hiddenDrift);
  const lexicalBusy =
    status?.lexical_status === "running" ||
    status?.lexical_status === "scanning" ||
    status?.lexical_status === "indexing";

  return (
    <div className="app-layout">
      <Box
        component="header"
        px="md"
        py="sm"
        className="app-surface"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 40,
          borderBottom: "1px solid var(--app-border)",
        }}
      >
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Group gap="sm" wrap="wrap">
            <Link
              href="/"
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <Group gap={8} wrap="nowrap">
                <Box
                  component="span"
                  c="var(--app-accent)"
                  style={{ display: "flex", flexShrink: 0 }}
                  aria-hidden
                >
                  <SparkSearchIcon />
                </Box>
                <Text
                  fw={600}
                  size="md"
                  c="var(--app-text)"
                  style={{ letterSpacing: "-0.03em" }}
                >
                  Find That Session
                </Text>
              </Group>
            </Link>
            <Text size="sm" c="dimmed">
              {status ? `${status.session_count} sessions` : "… sessions"}
            </Text>
            {status?.last_scan_at ? (
              <Text size="sm" c="dimmed">
                Last scan {formatLocalDateTime(status.last_scan_at)}
              </Text>
            ) : null}
          </Group>
          <Group gap="xs">
            <RetentionControl status={status} />
            <ThemePicker />
            <Tooltip label="Switch to light mode">
              <ActionIcon
                className="light-hidden"
                variant="subtle"
                color="gray"
                size="lg"
                radius="xl"
                aria-label="Switch to light mode"
                onClick={() => setColorScheme("light")}
              >
                <MoonIcon />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Switch to dark mode">
              <ActionIcon
                className="dark-hidden"
                variant="subtle"
                color="gray"
                size="lg"
                radius="xl"
                aria-label="Switch to dark mode"
                onClick={() => setColorScheme("dark")}
              >
                <SunIcon />
              </ActionIcon>
            </Tooltip>
            {onReindex ? (
              <Tooltip
                label={
                  reindexing || lexicalBusy
                    ? "Reindexing Claude Code sessions…"
                    : "Rebuild the search index from Claude Code transcripts. Favorites and archive stay as they are. Usually not needed — new and changed sessions are indexed automatically. Use this if results look stale or wrong."
                }
                multiline
                w={280}
              >
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="lg"
                  radius="xl"
                  aria-label="Reindex sessions"
                  onClick={onReindex}
                  disabled={reindexing || lexicalBusy}
                >
                  {reindexing || lexicalBusy ? (
                    <Loader size={16} color="gray" />
                  ) : (
                    <ReindexIcon />
                  )}
                </ActionIcon>
              </Tooltip>
            ) : null}
          </Group>
        </Group>
      </Box>
      {showDrift && drift ? (
        <Alert color="yellow" variant="light" radius={0} title="Transcript schema changed">
          <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
            <Text size="sm">{drift.summary}</Text>
            <Group gap="xs" wrap="nowrap">
              <Text size="sm" c="dimmed">
                prompts/update-transcript-adapter.md
              </Text>
              <Button
                size="compact-xs"
                variant="default"
                onClick={() => {
                  setHiddenDrift(drift.fingerprint);
                  void fetch("/api/schema-drift/dismiss", { method: "POST" });
                }}
              >
                Dismiss
              </Button>
            </Group>
          </Group>
        </Alert>
      ) : null}
      {children}
    </div>
  );
}
