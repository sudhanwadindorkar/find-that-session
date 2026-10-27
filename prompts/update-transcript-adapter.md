# Update the Claude Code transcript mapping

Paste this prompt into Claude or Cursor from the `find-that-session` repo.

---

Compare the newest Claude Code transcripts on this machine with the stored schema mappings. If the on-disk shape changed, append a new mapping. If only the CLI version changed, stop and say so.

## Read

1. `schema/claude-code-jsonl.json` — ordered mappings. The last entry is the latest fallback.
2. `src/lib/indexer/schema-map.ts` and `src/lib/indexer/parse.ts` — version selection and how a mapping drives parsing.
3. The newest `~/.claude/projects/*/*.jsonl` files (skip `subagents`). Read the `version` field and the event shapes (`type`, title fields, `message.content` blocks).
4. If it exists, `~/.cache/find-that-session/schema-watch.log` and any schema-drift banner details.

## Decide

- Use the mapping whose `versions` range contains the transcript `version`.
- If the version is missing or matches no range, the parser already uses the last mapping. Do not add a mapping only to record a new patch version.
- Treat it as a shape change when event types, title field names, content paths, or content block types differ from the mapping that should apply. A new Claude Code version with the same shape is not a change.

## When the shape changed

1. Append a new entry to `mappings`. Do not delete or rewrite older entries.
2. Give it a new `id` (for example `claude-code-jsonl-v2`) and its own semver range. Narrow the previous entry's range if both would match the same version. Among matches, the parser uses the last one; if nothing matches, it uses the last entry.
3. Describe skip types, message roles, title fields (`custom: true` still wins over an ai title), `contentPath`, and content block fields, including `knownBlockTypes`.
4. Keep a single parser. Add a second code path only if the new shape cannot be described by the map.
5. Do not notify from this prompt. Indexing picks the mapping up on the next reindex or file change.

## When nothing structural changed

Stop. Say which mapping already covers the transcripts and which Claude Code versions you saw.
