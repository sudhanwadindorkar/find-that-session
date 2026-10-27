export type SchemaDriftReport = {
  fingerprint: string;
  versions: string[];
  schema_id: string;
  unknown_types: string[];
  content_mismatch_count: number;
  message_event_count: number;
  title_mismatch_count: number;
  sample_count: number;
  summary: string;
  reported_at: string;
};

export type IndexStatus = {
  lexical_status: string;
  embedding_status: string;
  lexical_done: number;
  lexical_total: number;
  embed_done: number;
  embed_total: number;
  failed_count: number;
  last_scan_at: string | null;
  message: string | null;
  session_count: number;
  favorite_count: number;
  projects_dir: string;
  projects_dir_exists: boolean;
  vec_ready: boolean;
  cleanup_period_days: number;
  cleanup_period_is_default: boolean;
  claude_settings_path: string;
  claude_settings_exists: boolean;
  schema_drift: SchemaDriftReport | null;
};

export type SearchHit = {
  project_slug: string;
  session_id: string;
  title: string | null;
  display_title: string | null;
  summary: string[];
  first_user_message: string | null;
  cwd: string | null;
  last_active_at: string | null;
  started_at: string | null;
  identifiers: string[];
  source: string;
  favorite: boolean;
  archived: boolean;
  recently_active: boolean;
  resume_command: string;
  embedded: boolean;
  snippets: { text: string; role: string }[];
  score: number;
};

export type SearchPage = {
  results: SearchHit[];
  total: number;
  page: number;
  pageSize: number;
};

export type SessionDetail = SearchHit & {
  turns: {
    ordinal: number;
    role: string;
    text: string;
    created_at: string | null;
  }[];
};
