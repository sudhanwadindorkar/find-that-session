"use client";

import { Group, Pagination as MantinePagination, Text } from "@mantine/core";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
};

export function Pagination({ page, pageSize, total, onChange }: Props) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  return (
    <Group
      justify="space-between"
      px="md"
      py="sm"
      style={{
        borderTop: "1px solid var(--app-border)",
        background: "var(--app-surface)",
      }}
    >
      <MantinePagination
        value={page}
        onChange={onChange}
        total={pageCount}
        size="sm"
        radius="xl"
      />
      <Text size="sm" c="dimmed">
        {total} total · {pageSize} / page
      </Text>
    </Group>
  );
}
