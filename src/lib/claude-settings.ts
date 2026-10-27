import fs from "fs";
import { config } from "@/lib/config";

export const DEFAULT_CLEANUP_PERIOD_DAYS = 30;

export type ClaudeRetentionInfo = {
  cleanup_period_days: number;
  is_default: boolean;
  settings_path: string;
  settings_exists: boolean;
};

/** Read Claude Code user settings for transcript retention (cleanupPeriodDays). */
export function getClaudeRetentionInfo(): ClaudeRetentionInfo {
  const settingsPath = config.claudeSettingsPath;
  const settingsExists = fs.existsSync(settingsPath);

  if (!settingsExists) {
    return {
      cleanup_period_days: DEFAULT_CLEANUP_PERIOD_DAYS,
      is_default: true,
      settings_path: settingsPath,
      settings_exists: false,
    };
  }

  try {
    const raw = fs.readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as { cleanupPeriodDays?: unknown };
    const value = parsed.cleanupPeriodDays;
    if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
      const days = Math.floor(value);
      return {
        cleanup_period_days: days,
        is_default: days === DEFAULT_CLEANUP_PERIOD_DAYS,
        settings_path: settingsPath,
        settings_exists: true,
      };
    }
  } catch {
    /* fall through to default */
  }

  return {
    cleanup_period_days: DEFAULT_CLEANUP_PERIOD_DAYS,
    is_default: true,
    settings_path: settingsPath,
    settings_exists: true,
  };
}
