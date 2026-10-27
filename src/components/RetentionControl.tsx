"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Code,
  Group,
  Modal,
  NumberInput,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import type { IndexStatus } from "@/lib/types";

const PRESETS: { days: number; label: string }[] = [
  { days: 30, label: "30d · default" },
  { days: 90, label: "90d" },
  { days: 365, label: "1 year" },
  { days: 3650, label: "~10 years" },
  { days: 36500, label: "~100 years" },
];

function formatDays(days: number): string {
  if (days >= 365 && days % 365 === 0) {
    const years = days / 365;
    return `${years}y`;
  }
  return `${days}d`;
}

function settingsSnippet(days: number): string {
  return JSON.stringify({ cleanupPeriodDays: days }, null, 2);
}

function claudePrompt(days: number, settingsPath: string): string {
  return [
    `Update my Claude Code user settings so local session transcripts are kept for ${days} day${days === 1 ? "" : "s"}.`,
    ``,
    `Set \`cleanupPeriodDays\` to ${days} in \`${settingsPath}\` (usually ~/.claude/settings.json).`,
    `Merge with any existing keys — do not remove other settings.`,
    `Minimum allowed value is 1. Confirm the file contents after editing.`,
  ].join("\n");
}

function displaySettingsPath(settingsPath: string): string {
  if (settingsPath.endsWith("/.claude/settings.json") || settingsPath.endsWith(".claude/settings.json")) {
    return "~/.claude/settings.json";
  }
  return settingsPath;
}

type Props = {
  status: IndexStatus | null;
};

export function RetentionControl({ status }: Props) {
  const [opened, setOpened] = useState(false);
  const currentDays = status?.cleanup_period_days ?? 30;
  const isDefault = status?.cleanup_period_is_default ?? true;
  const settingsPath = status?.claude_settings_path ?? "~/.claude/settings.json";
  const pathLabel = displaySettingsPath(settingsPath);

  const [selectedDays, setSelectedDays] = useState(currentDays);
  const [customDays, setCustomDays] = useState<number | string>(currentDays);
  const [copied, setCopied] = useState<"snippet" | "prompt" | null>(null);

  useEffect(() => {
    if (!opened) return;
    setSelectedDays(currentDays);
    setCustomDays(currentDays);
    setCopied(null);
  }, [opened, currentDays]);

  const snippet = useMemo(() => settingsSnippet(selectedDays), [selectedDays]);
  const prompt = useMemo(
    () => claudePrompt(selectedDays, pathLabel),
    [selectedDays, pathLabel],
  );

  async function copyText(kind: "snippet" | "prompt", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      /* ignore */
    }
  }

  function pickPreset(days: number) {
    setSelectedDays(days);
    setCustomDays(days);
    setCopied(null);
  }

  function applyCustom(value: number | string) {
    setCustomDays(value);
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n) && n >= 1) {
      setSelectedDays(Math.floor(n));
      setCopied(null);
    }
  }

  const shortLabel = status ? formatDays(currentDays) : "…";

  return (
    <>
      <Tooltip
        label={
          isDefault
            ? `Claude Code keeps transcripts for ${shortLabel} (default). Click to adjust.`
            : `Claude Code keeps transcripts for ${shortLabel}. Click to adjust.`
        }
      >
        <UnstyledButton
          onClick={() => setOpened(true)}
          aria-label={`Transcript retention ${shortLabel}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 36,
            height: 36,
            padding: "0 8px",
            borderRadius: 999,
            color: "var(--app-muted)",
            fontSize: "0.8rem",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            background: "transparent",
          }}
        >
          {shortLabel}
        </UnstyledButton>
      </Tooltip>

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Transcript retention"
        centered
        size="md"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Claude Code deletes local session transcripts older than this many
            days. This app can only search what is still on disk.
          </Text>

          <Text size="sm">
            Current setting:{" "}
            <Text span fw={600}>
              {currentDays} day{currentDays === 1 ? "" : "s"}
            </Text>
            {isDefault ? " (Claude Code default)" : ""}
          </Text>

          <div>
            <Text size="sm" fw={500} mb={8}>
              Choose a retention period
            </Text>
            <Group gap="xs">
              {PRESETS.map((p) => (
                <Button
                  key={p.days}
                  size="xs"
                  variant={selectedDays === p.days ? "filled" : "light"}
                  onClick={() => pickPreset(p.days)}
                >
                  {p.label}
                </Button>
              ))}
            </Group>
          </div>

          <NumberInput
            label="Custom days"
            description="Minimum 1. There is no documented maximum."
            min={1}
            step={1}
            value={customDays}
            onChange={applyCustom}
          />

          <Stack gap={6}>
            <Text size="sm" fw={500}>
              Add this to {pathLabel}
            </Text>
            <Code block style={{ whiteSpace: "pre" }}>
              {snippet}
            </Code>
            <Group justify="flex-end">
              <Button
                size="xs"
                variant="light"
                onClick={() => void copyText("snippet", snippet)}
              >
                {copied === "snippet" ? "Copied" : "Copy JSON"}
              </Button>
            </Group>
          </Stack>

          <Stack gap={6}>
            <Text size="sm" fw={500}>
              Or paste this prompt into Claude Code
            </Text>
            <Code block style={{ whiteSpace: "pre-wrap" }}>
              {prompt}
            </Code>
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Text size="xs" c="dimmed" style={{ flex: 1 }}>
                Merge with any existing keys. Takes effect on the next Claude
                Code startup. A project{" "}
                <Text span ff="monospace" size="xs">
                  .claude/settings.json
                </Text>{" "}
                can override this and affect cleanup across projects.
              </Text>
              <Button
                size="xs"
                variant="light"
                onClick={() => void copyText("prompt", prompt)}
              >
                {copied === "prompt" ? "Copied" : "Copy prompt"}
              </Button>
            </Group>
          </Stack>
        </Stack>
      </Modal>
    </>
  );
}
