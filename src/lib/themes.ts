export const THEME_STORAGE_KEY = "fts-theme";

export type AppThemeId = "ocean" | "sand" | "mist" | "pine" | "amber";

export type AppTheme = {
  id: AppThemeId;
  label: string;
  /** Accent swatch shown in the picker (light mode). */
  swatch: string;
};

export const APP_THEMES: AppTheme[] = [
  { id: "ocean", label: "Ocean paper", swatch: "#1d6fbf" },
  { id: "sand", label: "Warm sand", swatch: "#c45c26" },
  { id: "mist", label: "Mist lilac", swatch: "#6b4fa3" },
  { id: "pine", label: "Pine ink", swatch: "#0f7a57" },
  { id: "amber", label: "Slate amber", swatch: "#c27803" },
];

export const DEFAULT_THEME: AppThemeId = "ocean";

export function isAppThemeId(value: string | null | undefined): value is AppThemeId {
  return APP_THEMES.some((t) => t.id === value);
}
