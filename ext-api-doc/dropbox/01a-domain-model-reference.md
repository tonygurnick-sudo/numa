---
api_name: 'Dropbox'
api_slug: 'dropbox'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# Dropbox — Domain Model Reference

> Companion to `01-llm-api-rules.md`. Entity catalog, relationships, business rules, formats.
>
> **Mental model:** Dropbox is a flat, **path-addressed** file store. There is no rich object
> graph — everything is a file or a folder, and "hierarchy" is just the path string. Field tables
> below are `[DOCUMENTED]` (official docs) and **🛠️ provider-verified** (extracted exactly as the
> production `dropbox_provider.py` reads them) unless marked otherwise. No live HTTP transcript was
> captured at research time, so nothing is `[CONFIRMED]`; items needing a live response are 🔬.

---

## Entity Catalog

There are effectively **two** entity types (File, Folder), a `deleted` tombstone variant, and a
search-match wrapper. All are members of the `Metadata` tagged union, discriminated by `.tag`.

### File (`FileMetadata`, `.tag = "file"`)

**Addressed by:** `path` (e.g. `/Reports/Q1.pdf`) or stable `id` (`id:...`).
**CRUD:** Read only for this connector (list / get / download). No write scopes requested.

| Field             | Type     | Description                                                      | Confidence      |
| ----------------- | -------- | ---------------------------------------------------------------- | --------------- |
| `.tag`            | string   | Always `"file"` — union discriminator                            | [DOCUMENTED]    |
| `name`            | string   | File name (last path segment)                                    | [DOCUMENTED] 🛠️ |
| `id`              | string   | Stable id `id:...` — survives rename/move (NOT used as conn. id) | [DOCUMENTED]    |
| `path_lower`      | string   | Lower-cased full path (use for matching)                         | [DOCUMENTED] 🛠️ |
| `path_display`    | string   | Display-cased full path → connector `file_id`                    | [DOCUMENTED] 🛠️ |
| `client_modified` | datetime | Client-set mtime (ISO 8601 `…Z`) → connector `created_at`        | [DOCUMENTED] 🛠️ |
| `server_modified` | datetime | Server-set mtime (ISO 8601 `…Z`) → connector `modified_at`       | [DOCUMENTED] 🛠️ |
| `rev`             | string   | Revision id (hex) → connector `version`                          | [DOCUMENTED] 🛠️ |
| `size`            | int      | Size in bytes                                                    | [DOCUMENTED] 🛠️ |
| `content_hash`    | string   | 64-char Dropbox block-hash → connector `checksum`                | [DOCUMENTED] 🛠️ |
| `is_downloadable` | bool     | `false` for some Paper/cloud-native docs (download → 409)        | [DOCUMENTED]    |
| `media_info`      | object   | Photo/video EXIF — only if `include_media_info=true` (off here)  | [DOCUMENTED]    |

> `content_hash` is **not** a plain SHA-256 — it is Dropbox's block-list hash. Use it only as an
> opaque change-detection key (compare equality), not to cross-check a SHA computed elsewhere.

### Folder (`FolderMetadata`, `.tag = "folder"`)

| Field                     | Type   | Description                          | Confidence      |
| ------------------------- | ------ | ------------------------------------ | --------------- |
| `.tag`                    | string | Always `"folder"`                    | [DOCUMENTED]    |
| `name`                    | string | Folder name                          | [DOCUMENTED] 🛠️ |
| `id`                      | string | Stable id `id:...`                   | [DOCUMENTED]    |
| `path_lower`              | string | Lower-cased full path                | [DOCUMENTED] 🛠️ |
| `path_display`            | string | Display path → connector `folder_id` | [DOCUMENTED] 🛠️ |
| `parent_shared_folder_id` | string | Set only when inside a shared folder | [DOCUMENTED]    |

> `list_folder` does **not** return whether a folder has children. The provider hard-codes
> `has_subfolders=false` / `no_of_subfolders=0` rather than making a second call — a folder-tree UI
> cannot pre-know subfolder presence; it must drill in to find out. 🛠️

### Deleted (`DeletedMetadata`, `.tag = "deleted"`)

A tombstone that appears **only** when `include_deleted=true` (connector sets it `false`, so you
will not normally see these). Has `name`, `path_lower`, `path_display` but no `size`/`rev`. [DOCUMENTED]

### SearchMatchV2 (wrapper from `search_v2`)

Search results are **double-nested**. The actual file/folder metadata is two levels deep — the
provider walks it as `match.metadata.metadata`: 🛠️

```json
{
  "matches": [
    {
      "metadata": {
        ".tag": "metadata",
        "metadata": {
          ".tag": "file",
          "name": "Q1 Report.pdf",
          "path_display": "/Reports/Q1 Report.pdf",
          "size": 482113,
          "server_modified": "2026-01-15T09:31:12Z"
        }
      }
    }
  ]
}
```

`match.match_type` (`filename` | `content` | `both`) and `match.highlight_spans` may also be
present per match (not used by the connector). [DOCUMENTED]

---

## Connector Field Mapping (provider → platform)

How the provider maps Dropbox fields onto the platform's generic file model. 🛠️

| Platform field          | Dropbox source                    | Notes                                                                    |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| `file_id` / `folder_id` | `path_display`                    | **Path-as-id** — breaks on rename/move                                   |
| `name`                  | `name`                            | —                                                                        |
| `path`                  | `path_display` (normalized)       | via `normalize_file_path()`                                              |
| `size`                  | `size`                            | bytes                                                                    |
| `content_type`          | derived from file **extension**   | provider's `_get_content_type_from_name()`; Dropbox does not return MIME |
| `parent_id`             | `path_display` minus last segment | string-split, not an API field                                           |
| `created_at`            | `client_modified`                 | client clock — can be wrong/old                                          |
| `modified_at`           | `server_modified`                 | server clock — authoritative for change                                  |
| `version`               | `rev`                             | revision id                                                              |
| `checksum`              | `content_hash`                    | Dropbox block-hash                                                       |
| `web_view_link`         | `null`                            | would need `sharing.read` / `get_temporary_link`                         |
| `permissions`           | `{}`                              | would need `sharing.read`                                                |

> **Content type is inferred from the filename extension**, not from Dropbox. Files with no
> extension or an unknown one map to `application/octet-stream`.

---

## Entity Relationship Diagram

```
┌──────────┐   contains (path prefix)    ┌──────────┐
│  Folder  │────────────────────────────>│   File   │
└────┬─────┘   recursive=true to descend  └──────────┘
     │  self-nesting via path hierarchy
     ▼
┌──────────┐
│  Folder  │
└──────────┘
```

- **No foreign keys.** Hierarchy is the **path string** only. A child's parent =
  `path_display` minus its last `/`-segment. The provider derives parents by string-splitting. 🛠️
- `id:...` values are stable across renames/moves; **paths are not**. The connector uses
  `path_display` as its id, so a rename/move invalidates a previously-returned id — re-list the
  parent folder to get the current path. 🛠️
- Root is the empty string `""`. Its children's `parent_id` is `null` (no parent path). 🛠️

---

## State Machines

A read-only file connector drives no state machine. The only state distinction Dropbox surfaces is
**active vs deleted** (`include_deleted` on listing; `file_status` `active`/`deleted` on search).
The connector pins both to live files (`include_deleted=false`, `file_status="active"`), so deleted
state is invisible. [DOCUMENTED] 🛠️

Writes (not in scope) would expose optimistic concurrency via `rev` — a write can require an
expected `rev` and fail if the file changed underneath. Irrelevant to reads. [DOCUMENTED]

---

## Business Rules

### Path rules

- **Root = `""`** (empty string), never `"/"`. Passing `"/"` is an error. 🛠️ [DOCUMENTED]
- Subpaths: leading `/`, no trailing `/`, e.g. `/Reports/Q1 Report.pdf`. [DOCUMENTED]
- Paths are **case-insensitive** but **case-preserving** — `path_lower` for comparison,
  `path_display` for display. Two files differing only in case cannot coexist. [DOCUMENTED]

### Listing rules

- `list_folder` returns **direct children only** unless `recursive=true`. [DOCUMENTED] 🛠️
- `include_mounted_folders=true` (provider default) includes shared/mounted folders in listings. 🛠️
- No total count is returned — enumerate with cursors to count. [DOCUMENTED]

### Download rules

- Some files are **non-downloadable** (Dropbox Paper, certain Google-backed cloud docs) →
  `409 unsupported_file`. Skip them, or use `/2/files/export` (not wired up). [DOCUMENTED]
- `restricted_content` (DMCA/policy) also `409`s — skip. [DOCUMENTED]

### Search rules

- Filenames are always searchable; **content** is searchable for indexed types (docs, PDFs, text). [DOCUMENTED]
- **Index lag:** newly added files may not appear in search immediately (eventual consistency). [DOCUMENTED]
- Minimum query length is not precisely documented; very short/empty queries may error. [UNKNOWN] 🔬

---

## Field Format Reference

| Format       | Pattern                              | Example                       | Notes                                |
| ------------ | ------------------------------------ | ----------------------------- | ------------------------------------ |
| DateTime     | ISO 8601 UTC, `YYYY-MM-DDTHH:MM:SSZ` | `2026-01-15T09:31:12Z`        | `client_modified`, `server_modified` |
| Path id      | `/Display/Cased/Path.ext`            | `/Reports/Q1 Report.pdf`      | Used as connector file/folder id 🛠️  |
| Stable id    | `id:` + opaque base64-ish            | `id:a4ayc_80_OEAAAAAAAAAYa`   | Survives rename/move (not conn. id)  |
| Revision     | hex string                           | `0153e6a1f2c0b00000002a1c2f3` | `rev` → connector `version`          |
| Content hash | 64-char hex (Dropbox block-hash)     | `599f9c00...`                 | `content_hash`; NOT a plain SHA-256  |
| Cursor       | opaque base64 string                 | `AAH4f99T0taNz...`            | Pagination + delta token             |
| Size         | integer (bytes)                      | `482113`                      | `size`                               |

---

## Enum Value Reference

| Entity        | Field               | Allowed Values                                                                                  | Default     | Notes                     |
| ------------- | ------------------- | ----------------------------------------------------------------------------------------------- | ----------- | ------------------------- |
| Metadata      | `.tag`              | `file` · `folder` · `deleted`                                                                   | —           | union discriminator       |
| SearchOptions | `file_status`       | `active` · `deleted`                                                                            | `active`    | provider sets `active` 🛠️ |
| SearchOptions | `order_by`          | `relevance` · `last_modified_time`                                                              | `relevance` | not set by provider       |
| SearchOptions | `filename_only`     | `true` · `false`                                                                                | `false`     | provider sets `false` 🛠️  |
| SearchOptions | `file_categories[]` | `image` `document` `pdf` `spreadsheet` `presentation` `audio` `video` `folder` `paper` `others` | —           | optional filter (unused)  |
| SearchMatch   | `match_type`        | `filename` · `content` · `both`                                                                 | —           | per-match (unused)        |

---

_Generated from the investigation questionnaire, Phase 3, cross-checked against the production
`lib/oauth-providers/oauth_providers/dropbox_provider.py`._
