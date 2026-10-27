"use client";

import { useMemo, useState } from "react";
import {
  Combobox,
  InputBase,
  ScrollArea,
  Text,
  useCombobox,
} from "@mantine/core";
import { shortPath } from "@/lib/format";

export type ProjectOption = {
  slug: string;
  label: string;
  cwd: string | null;
};

type Props = {
  projects: ProjectOption[];
  value: string;
  onChange: (projectSlug: string) => void;
  w?: number | string;
};

const ALL = "__all__";

export function ProjectCombobox({ projects, value, onChange, w = 260 }: Props) {
  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption();
      setSearch("");
    },
  });
  const [search, setSearch] = useState("");

  const selectedLabel =
    !value || value === ALL
      ? "All projects"
      : (projects.find((p) => p.slug === value)?.label ?? value);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = [
      { slug: ALL, label: "All projects", cwd: null as string | null },
      ...projects,
    ];
    if (!q) return items;
    return items.filter((p) => {
      const hay = `${p.label} ${p.cwd ?? ""} ${p.slug}`.toLowerCase();
      return hay.includes(q);
    });
  }, [projects, search]);

  return (
    <Combobox
      store={combobox}
      withinPortal
      onOptionSubmit={(val) => {
        onChange(val === ALL ? "" : val);
        setSearch("");
        combobox.closeDropdown();
      }}
    >
      <Combobox.Target>
        <InputBase
          label="Project"
          component="button"
          type="button"
          pointer
          rightSection={<Combobox.Chevron />}
          rightSectionPointerEvents="none"
          onClick={() => combobox.toggleDropdown()}
          w={w}
        >
          <Text span size="sm" truncate style={{ display: "block", textAlign: "left" }}>
            {selectedLabel}
          </Text>
        </InputBase>
      </Combobox.Target>

      <Combobox.Dropdown>
        <Combobox.Search
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="Search projects…"
        />
        <Combobox.Options>
          <ScrollArea.Autosize mah={280} type="scroll">
            {filtered.length === 0 ? (
              <Combobox.Empty>No projects found</Combobox.Empty>
            ) : (
              filtered.map((p) => {
                const path = shortPath(p.cwd);
                return (
                  <Combobox.Option
                    value={p.slug}
                    key={p.slug}
                    active={
                      (value || ALL) === p.slug ||
                      (!value && p.slug === ALL)
                    }
                  >
                    <Text size="sm" fw={500}>
                      {p.label}
                    </Text>
                    {path ? (
                      <Text size="xs" c="dimmed" truncate>
                        {path}
                      </Text>
                    ) : null}
                  </Combobox.Option>
                );
              })
            )}
          </ScrollArea.Autosize>
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
