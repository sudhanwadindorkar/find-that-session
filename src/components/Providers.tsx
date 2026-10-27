"use client";

import { MantineProvider } from "@mantine/core";
import { ThemeProvider } from "@/components/ThemeProvider";
import { cssVariablesResolver, theme } from "@/theme";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      defaultColorScheme="auto"
    >
      <ThemeProvider>{children}</ThemeProvider>
    </MantineProvider>
  );
}
