---
api_name: Google Drive
api_slug: googledrive
companion_of: 01-llm-api-rules.md
base_url: https://www.googleapis.com/drive/v3
call_surface: file-store connector (list-files/search-files/download-file); NOT `numa integrations request`
confidence: doc-based — fields are [DOCUMENTED] (Google REST ref) unless tagged [INFERRED]; nothing live-traced. Existing google_drive_provider.py exercises this surface (high confidence).
source_phases: Phase 3 (Domain Model & Behavior)
---

# Google Drive — Domain Model Reference

**Mental model:** Drive is NOT a directory tree. It is a flat file store with a folder graph overlaid via `parents`. **Folders are themselves File resources** (`mimeType=application/vnd.google-apps.folder`). The "tree" is rebuilt from `parents`.

## File (`/drive/v3/files`, `/drive/v3/files/{fileId}`)

Universal Drive resource — documents AND folders. CRUD: Read (list/get/download/export) in scope; Create/Update/Delete exist in API but out of scope under `drive.readonly`.

| Field            | Type     | Writable | Description                                                                             |
| ---------------- | -------- | -------- | --------------------------------------------------------------------------------------- |
| `id`             | string   | no       | Opaque id — never parse/construct                                                       |
| `name`           | string   | (write)  | File/folder display name                                                                |
| `mimeType`       | string   | no       | `...folder`=folder; `...google-apps.*`=native doc                                       |
| `parents`        | string[] | (write)  | Parent folder id(s) — the folder graph                                                  |
| `size`           | string   | no       | Byte size as a **string** (e.g. `"482913"`); absent for native docs                     |
| `md5Checksum`    | string   | no       | MD5 of binary content (binary files only)                                               |
| `version`        | string   | no       | Monotonic version; bumps on any change                                                  |
| `modifiedTime`   | RFC 3339 | (write)  | Last modification (UTC)                                                                 |
| `createdTime`    | RFC 3339 | no       | Creation time (UTC)                                                                     |
| `trashed`        | boolean  | (write)  | In trash                                                                                |
| `starred`        | boolean  | (write)  | Starred by user                                                                         |
| `shared`         | boolean  | no       | Whether shared                                                                          |
| `owners`         | object[] | no       | Owner User objects (`displayName`, `emailAddress`)                                      |
| `webViewLink`    | string   | no       | Browser URL to view file                                                                |
| `webContentLink` | string   | no       | Direct download URL (binary files only)                                                 |
| `exportLinks`    | map      | no       | `mimeType`→export URL map (native files only); e.g. `{"application/pdf":"https://..."}` |
| `iconLink`       | string   | no       | Icon URL for file type                                                                  |
| `fileExtension`  | string   | no       | Final extension component (binary files)                                                |
| `driveId`        | string   | no       | Shared-drive id (only for shared-drive items)                                           |
| `capabilities`   | object   | no       | Per-user capabilities (`canDownload`, `canEdit`, …)                                     |

(Writable parenthesised — connector is read-only; writes out of scope under `drive.readonly`.)

**Relationships:**
| Related | Type | Expression | Notes |
| --- | --- | --- | --- |
| File (folder) | N:1 graph | `parents[]` id ref | Folders are Files; tree rebuilt from `parents` |
| Permission | 1:N | sub-resource `/files/{id}/permissions` | Who can access, at what role |
| Drive (shared) | N:1 | `driveId` field | Shared drives are a separate corpus |
| User (owner) | N:1 | `owners[]` embedded objects | Owner identity, not separately fetchable |

## Permission (`/drive/v3/files/{fileId}/permissions`, `.../permissions/{permissionId}`)

Access-control entry. CRUD: Read (list/get) in scope; write out of scope under read-only.

| Field          | Type    | Description                                                                 |
| -------------- | ------- | --------------------------------------------------------------------------- |
| `id`           | string  | Opaque permission id (e.g. `anyoneWithLink`, or numeric grantee id)         |
| `type`         | enum    | `user` / `group` / `domain` / `anyone`                                      |
| `role`         | enum    | `owner` / `organizer` / `fileOrganizer` / `writer` / `commenter` / `reader` |
| `emailAddress` | string  | Grantee email (user/group)                                                  |
| `domain`       | string  | Grantee domain (domain type)                                                |
| `displayName`  | string  | Human-readable grantee name                                                 |
| `deleted`      | boolean | Whether grantee account was deleted                                         |

Connector surfaces `permissions` inside `get_file_metadata` (its `fields` selector includes `permissions`) — no separate ACL tool.

## Change (`/drive/v3/changes`, `/drive/v3/changes/startPageToken`)

Incremental change feed — one entry per changed file since a saved cursor. For sync; not wired into connector (see 01d).

| Field        | Type     | Description                                    |
| ------------ | -------- | ---------------------------------------------- |
| `changeType` | enum     | `file` / `drive`                               |
| `time`       | RFC 3339 | When change occurred                           |
| `removed`    | boolean  | `true` if file deleted / access lost           |
| `fileId`     | string   | Id of changed file                             |
| `file`       | object   | Embedded File resource (absent when `removed`) |
| `driveId`    | string   | Shared-drive id (shared-drive changes)         |

## Drive — shared drives (`/drive/v3/drives`)

Team/shared drives. Provider lists these at connector **root level** as top-level folders (id `shared-drive:<driveId>`). CRUD: Read (list) in scope. Fields: `id`, `name`, `kind` (`drive#drive`).

## Virtual Folders (connector-only, NOT a Drive resource)

Provider root listing does NOT call the API — it returns synthetic navigation folders:
| Virtual id | Label | Maps to on drill-in |
| --- | --- | --- |
| `virtual:my-drive` | "My Drive" | `q='root' in parents and trashed=false`, `corpora=user` |
| `virtual:shared-with-me` | "Shared with me" | `q=sharedWithMe=true and trashed=false`, `corpora=user` |
| `shared-drive:<driveId>` | (shared drive name) | `q='<driveId>' in parents`, `corpora=drive`, `driveId` |

These ids are synthetic — never pass them to `/files/{id}`. Provider resolves them to the queries above.

## ERD

```
Drive(shared) ←─driveId─ File(incl. folders) ─parents[](self-ref graph)→ File ─1:N→ Permission
Changes feed observes File mutations across the whole corpus.
```

## File trash lifecycle (observational only — read-only connector surfaces via `trashed` + `changes` feed, never drives it)

```
[active] ──trash──> [trashed] ──untrash──> [active]
[trashed] ──empty trash / delete──> [permanently deleted]
```

| From    | Trigger      | To                  | Reversible? | Side effects                              |
| ------- | ------------ | ------------------- | ----------- | ----------------------------------------- |
| active  | trash        | trashed             | yes         | `trashed=true`; auto-purge after ~30 days |
| trashed | untrash      | active              | yes         | `trashed=false`                           |
| trashed | delete/empty | permanently deleted | no          | File gone; emits a `removed` change       |

Visibility: `active`=visible (all queries append `trashed=false`); `trashed`=hidden by default clause; `deleted`=gone, detectable only via `changes` feed (`removed:true`).

## Business Rules

- Folders are files — detect via `mimeType=='application/vnd.google-apps.folder'`. No separate folder endpoint.
- A file can have multiple parents historically (now typically one). Build tree from `parents[]`; don't assume a single parent.
- Shared-drive items are a separate corpus — need `supportsAllDrives=true` + `includeItemsFromAllDrives=true` + `corpora`/`driveId`.
- Google-native files have no byte content and no `size` — Docs/Sheets/Slides/Drawings/Forms must be **exported**, not fetched with `alt=media`.
- `incompleteSearch=true` in a list response = cross-drive results incomplete — narrow corpus or retry.
- Server-managed (read-only): `id`, `createdTime`, `md5Checksum`, `version`, `shared`, `owners`, `webViewLink`, `webContentLink`, `exportLinks`, `capabilities`, `iconLink`. `version` bumps on every change — usable as a lightweight per-file change cursor.

## Field Formats

| Format        | Pattern                         | Example                                | Notes                                  |
| ------------- | ------------------------------- | -------------------------------------- | -------------------------------------- |
| DateTime      | RFC 3339 / ISO 8601, UTC        | `2026-05-20T09:14:00.000Z`             | `modifiedTime`, `createdTime`          |
| Date (in `q`) | `'YYYY-MM-DDTHH:MM:SS'`         | `'2026-01-01T00:00:00'`                | Quoted inside `q`, UTC assumed         |
| ID            | opaque base64-ish string        | `1aBcD3eFgHiJkLmNoPqRsTuVwXyZ`         | Do not parse                           |
| Size          | string of bytes                 | `"482913"`                             | String not int; absent for native docs |
| MIME          | standard or `vnd.google-apps.*` | `application/vnd.google-apps.document` | Folder / native-doc detection          |

## Enums

| Entity     | Field                   | Allowed values                                                         | Notes                             |
| ---------- | ----------------------- | ---------------------------------------------------------------------- | --------------------------------- |
| Permission | `type`                  | `user`, `group`, `domain`, `anyone`                                    |                                   |
| Permission | `role`                  | `owner`, `organizer`, `fileOrganizer`, `writer`, `commenter`, `reader` | `organizer` roles = shared drives |
| Change     | `changeType`            | `file`, `drive`                                                        |                                   |
| Webhook    | `X-Goog-Resource-State` | `sync`, `add`, `remove`, `update`, `trash`, `untrash`, `change`        | Push-channel header (01d)         |

## Google-native MIME types → connector export mapping

(Confirmed against `_get_export_mime_type` in `google_drive_provider.py`.)
| Native mimeType | Meaning | Export target |
| --- | --- | --- |
| `application/vnd.google-apps.folder` | Folder | n/a (not downloadable) |
| `application/vnd.google-apps.document` | Google Doc | DOCX (`...wordprocessingml.document`) |
| `application/vnd.google-apps.spreadsheet` | Google Sheet | XLSX (`...spreadsheetml.sheet`) |
| `application/vnd.google-apps.presentation` | Google Slides | PPTX (`...presentationml.presentation`) |
| `application/vnd.google-apps.drawing` | Drawing | PDF |
| `application/vnd.google-apps.form` | Form | ZIP |
| `application/vnd.google-apps.script` | Apps Script | JSON (`...google-apps.script+json`) |
| any other `vnd.google-apps.*` | other native | PDF (provider fallback) |
