---
api_name: Dropbox
api_slug: dropbox
doc: domain-model-reference (companion to 01-llm-api-rules.md)
confidence: facts are [DOCUMENTED] (official docs) AND 🛠️ provider-verified (read exactly as production lib/oauth-providers/oauth_providers/dropbox_provider.py reads them) unless tagged [INFERRED]/[UNKNOWN]/🔬(needs live capture). No live HTTP transcript captured.
---

# Dropbox — Domain Model Reference

**Mental model:** flat, **path-addressed** file store. No object graph — everything is a file or folder; "hierarchy" is just the path string. Entity types: File, Folder, a `deleted` tombstone, a search-match wrapper — all members of the `Metadata` tagged union, discriminated by `.tag`.

## Entity Catalog

### File (`FileMetadata`, `.tag="file"`)

Addressed by `path` (e.g. `/Reports/Q1.pdf`) or stable `id` (`id:...`). Read-only for this connector (list/get/download).

| Field             | Type     | Description                                                          |
| ----------------- | -------- | -------------------------------------------------------------------- |
| `.tag`            | string   | Always `"file"` — union discriminator                                |
| `name`            | string   | File name (last path segment)                                        |
| `id`              | string   | Stable id `id:...` — survives rename/move (NOT used as connector id) |
| `path_lower`      | string   | Lower-cased full path (use for matching)                             |
| `path_display`    | string   | Display-cased full path → connector `file_id`                        |
| `client_modified` | datetime | Client-set mtime (ISO 8601 `…Z`) → connector `created_at`            |
| `server_modified` | datetime | Server-set mtime (ISO 8601 `…Z`) → connector `modified_at`           |
| `rev`             | string   | Revision id (hex) → connector `version`                              |
| `size`            | int      | Bytes                                                                |
| `content_hash`    | string   | 64-char Dropbox block-hash → connector `checksum`                    |
| `is_downloadable` | bool     | `false` for some Paper/cloud-native docs (download → `409`)          |
| `media_info`      | object   | Photo/video EXIF — only if `include_media_info=true` (off here)      |

`content_hash` is NOT a plain SHA-256 — it's Dropbox's block-list hash. Use only as an opaque change-detection key (compare equality), not to cross-check a SHA computed elsewhere.

### Folder (`FolderMetadata`, `.tag="folder"`)

| Field                     | Type   | Description                          |
| ------------------------- | ------ | ------------------------------------ |
| `.tag`                    | string | Always `"folder"`                    |
| `name`                    | string | Folder name                          |
| `id`                      | string | Stable id `id:...`                   |
| `path_lower`              | string | Lower-cased full path                |
| `path_display`            | string | Display path → connector `folder_id` |
| `parent_shared_folder_id` | string | Set only when inside a shared folder |

`list_folder` does NOT return whether a folder has children. Provider hard-codes `has_subfolders=false`/`no_of_subfolders=0` rather than a second call — a folder-tree UI must drill in to learn subfolder presence.

### Deleted (`DeletedMetadata`, `.tag="deleted"`)

Tombstone appearing ONLY when `include_deleted=true` (connector sets `false`, so normally invisible). Has `name`,`path_lower`,`path_display` but no `size`/`rev`.

### SearchMatchV2 (wrapper from `search_v2`)

Double-nested: actual file/folder metadata is two levels deep — provider walks `match.metadata.metadata`:
`{"matches":[{"metadata":{".tag":"metadata","metadata":{".tag":"file","name":"Q1 Report.pdf","path_display":"/Reports/Q1 Report.pdf","size":482113,"server_modified":"2026-01-15T09:31:12Z"}}}]}`
`match.match_type` (`filename`|`content`|`both`) and `match.highlight_spans` may also be present per match (unused by connector).

## Connector Field Mapping (provider → platform) 🛠️

| Platform field        | Dropbox source                    | Notes                                                                                                       |
| --------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `file_id`/`folder_id` | `path_display`                    | **path-as-id** — breaks on rename/move                                                                      |
| `name`                | `name`                            | —                                                                                                           |
| `path`                | `path_display` (normalized)       | via `normalize_file_path()`                                                                                 |
| `size`                | `size`                            | bytes                                                                                                       |
| `content_type`        | derived from file **extension**   | `_get_content_type_from_name()`; Dropbox returns no MIME. Unknown/no extension → `application/octet-stream` |
| `parent_id`           | `path_display` minus last segment | string-split, not an API field                                                                              |
| `created_at`          | `client_modified`                 | client clock — can be wrong/old                                                                             |
| `modified_at`         | `server_modified`                 | server clock — authoritative for change                                                                     |
| `version`             | `rev`                             | revision id                                                                                                 |
| `checksum`            | `content_hash`                    | Dropbox block-hash                                                                                          |
| `web_view_link`       | `null`                            | would need `sharing.read`/`get_temporary_link`                                                              |
| `permissions`         | `{}`                              | would need `sharing.read`                                                                                   |

## Relationships

- **No foreign keys.** Hierarchy = the **path string** only. A child's parent = `path_display` minus its last `/`-segment (provider derives by string-splitting).
- `id:...` is stable across rename/move; **paths are not**. Connector uses `path_display` as id, so rename/move invalidates a previously-returned id → re-list the parent for the current path.
- Root = `""`. Its children's `parent_id` is `null` (no parent path).

```
Folder ──contains (path prefix)──> File
  └─ self-nesting via path hierarchy (recursive=true to descend)
```

## State

Read-only connector → no state machine. Only state distinction Dropbox surfaces is **active vs deleted** (`include_deleted` on listing; `file_status` `active`/`deleted` on search). Connector pins both to live (`include_deleted=false`, `file_status="active"`), so deleted state is invisible. Writes (out of scope) would expose optimistic concurrency via `rev`.

## Business Rules

**Path:** Root=`""` (never `"/"`; `"/"` errors). Subpaths leading `/`, no trailing `/`. Case-insensitive but case-preserving (`path_lower` compare, `path_display` show); two files differing only in case cannot coexist.
**Listing:** `list_folder` returns direct children only unless `recursive=true`. `include_mounted_folders=true` (provider default) includes shared/mounted folders. No total count — enumerate with cursors.
**Download:** non-downloadable files (Dropbox Paper, some Google-backed cloud docs) → `409 unsupported_file`; skip or `/2/files/export` (not wired up). `restricted_content` (DMCA/policy) also `409`s → skip.
**Search:** filenames always searchable; **content** searchable for indexed types (docs, PDFs, text). **Index lag** — newly added files may not appear immediately (eventual consistency). Minimum query length undocumented; very short/empty queries may error [UNKNOWN] 🔬.

## Field Formats

| Format       | Pattern                             | Example                       | Notes                               |
| ------------ | ----------------------------------- | ----------------------------- | ----------------------------------- |
| DateTime     | ISO 8601 UTC `YYYY-MM-DDTHH:MM:SSZ` | `2026-01-15T09:31:12Z`        | `client_modified`,`server_modified` |
| Path id      | `/Display/Cased/Path.ext`           | `/Reports/Q1 Report.pdf`      | used as connector file/folder id    |
| Stable id    | `id:`+opaque base64-ish             | `id:a4ayc_80_OEAAAAAAAAAYa`   | survives rename/move (not conn. id) |
| Revision     | hex string                          | `0153e6a1f2c0b00000002a1c2f3` | `rev` → `version`                   |
| Content hash | 64-char hex (block-hash)            | `599f9c00...`                 | `content_hash`; NOT plain SHA-256   |
| Cursor       | opaque base64                       | `AAH4f99T0taNz...`            | pagination + delta token            |
| Size         | integer (bytes)                     | `482113`                      | `size`                              |

## Enums

| Entity        | Field               | Allowed values                                                                                  | Default     | Notes                    |
| ------------- | ------------------- | ----------------------------------------------------------------------------------------------- | ----------- | ------------------------ |
| Metadata      | `.tag`              | `file` · `folder` · `deleted`                                                                   | —           | union discriminator      |
| SearchOptions | `file_status`       | `active` · `deleted`                                                                            | `active`    | provider sets `active`   |
| SearchOptions | `order_by`          | `relevance` · `last_modified_time`                                                              | `relevance` | not set by provider      |
| SearchOptions | `filename_only`     | `true` · `false`                                                                                | `false`     | provider sets `false`    |
| SearchOptions | `file_categories[]` | `image` `document` `pdf` `spreadsheet` `presentation` `audio` `video` `folder` `paper` `others` | —           | optional filter (unused) |
| SearchMatch   | `match_type`        | `filename` · `content` · `both`                                                                 | —           | per-match (unused)       |
