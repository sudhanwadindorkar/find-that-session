"use client";

import { ActionIcon, Menu, Text } from "@mantine/core";
import { APP_THEMES, useAppTheme } from "@/components/ThemeProvider";

function PaletteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3a9 9 0 1 0 0 18c.8 0 1.4-.6 1.4-1.4 0-.4-.1-.7-.4-1-.3-.3-.5-.7-.5-1.1a1.9 1.9 0 0 1 1.9-1.9H16a5 5 0 0 0 0-10H12Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <circle cx="7.5" cy="11" r="1.1" fill="currentColor" />
      <circle cx="10" cy="7.5" r="1.1" fill="currentColor" />
      <circle cx="14" cy="7.5" r="1.1" fill="currentColor" />
      <circle cx="16.5" cy="11" r="1.1" fill="currentColor" />
    </svg>
  );
}

export function ThemePicker() {
  const { themeId, setThemeId } = useAppTheme();

  return (
    <Menu shadow="md" width={200} position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="lg"
          radius="xl"
          aria-label="Color theme"
          title="Color theme"
        >
          <PaletteIcon />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Theme</Menu.Label>
        {APP_THEMES.map((theme) => (
          <Menu.Item
            key={theme.id}
            onClick={() => setThemeId(theme.id)}
            leftSection={
              <span
                aria-hidden
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: theme.swatch,
                  display: "inline-block",
                  boxShadow: "inset 0 0 0 1px rgba(0,0,0,.12)",
                }}
              />
            }
            rightSection={
              themeId === theme.id ? (
                <Text size="xs" c="dimmed">
                  ✓
                </Text>
              ) : null
            }
          >
            {theme.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
