"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  APP_THEMES,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  isAppThemeId,
  type AppThemeId,
} from "@/lib/themes";

type ThemeContextValue = {
  themeId: AppThemeId;
  setThemeId: (id: AppThemeId) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyThemeAttr(id: AppThemeId) {
  document.documentElement.setAttribute("data-app-theme", id);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeIdState] = useState<AppThemeId>(DEFAULT_THEME);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (isAppThemeId(stored)) {
        setThemeIdState(stored);
        applyThemeAttr(stored);
        return;
      }
    } catch {
      /* ignore */
    }
    applyThemeAttr(DEFAULT_THEME);
  }, []);

  const setThemeId = useCallback((id: AppThemeId) => {
    setThemeIdState(id);
    applyThemeAttr(id);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ themeId, setThemeId }),
    [themeId, setThemeId],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useAppTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useAppTheme must be used within ThemeProvider");
  }
  return ctx;
}

export { APP_THEMES };
