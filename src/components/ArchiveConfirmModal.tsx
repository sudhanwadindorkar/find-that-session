"use client";

import { Button, Group, Modal, Stack, Text } from "@mantine/core";

type Props = {
  opened: boolean;
  count?: number;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ArchiveConfirmModal({
  opened,
  count = 1,
  onCancel,
  onConfirm,
}: Props) {
  const plural = count !== 1;
  const title = plural
    ? `Archive ${count} sessions?`
    : "Archive this session?";

  return (
    <Modal opened={opened} onClose={onCancel} title={title} centered>
      <Stack gap="md">
        <Text size="sm">
          Archived sessions are hidden from the main list and search. You can
          find them again under{" "}
          <Text span fw={600}>
            Archived
          </Text>{" "}
          and unarchive anytime.
        </Text>
        <Text size="sm" c="dimmed">
          This does not delete the Claude Code transcript on disk, and it does
          not change Claude&apos;s own resume list.
        </Text>
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button color="red" onClick={onConfirm}>
            {plural ? `Archive ${count}` : "Archive"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
