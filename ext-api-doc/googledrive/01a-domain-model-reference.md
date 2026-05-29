---
api_name: 'Google Drive'
api_slug: 'googledrive'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# Google Drive — Domain Model Reference

> Companion to `01-llm-api-rules.md`. Entity catalog, relationships, the folder graph, lifecycle,
> and business rules the workspace agent references when working with Drive data.
>
> **Mental model:** Google Drive is **not** a directory tree. It is a flat file store with a folder
> graph laid over it via the `parents` field. **Folders are themselves File resources** (with
> `mimeType = application/vnd.google-apps.folder`). The "tree" is reconstructed from `parents`.
>
> ⚠️ This is a documentation-based investigation — fields below are **[DOCUMENTED]** (Google REST
> reference) or **[INFERRED]**; nothing is **[CONFIRMED]** against a live trace. The existing
> `google_drive_provider.py` already exercises this surface, so confidence is high.

---

## Entity Catalog

### File (`files`)

**Resource path:** `/drive/v3/files` and `/drive/v3/files/{fileId}`
**Description:** The universal Drive resource. Both documents **and folders** are Files — a folder is
just a File whose `mimeType` is `application/vnd.google-apps.folder`.
**CRUD:** Read (list/get/download/export) in scope. Create/Update/Delete exist in the API but are
**out of scope** under the `drive.readonly` connector scope.

| Field            | Type     | Writable | Description                                                      | Example                                                |
| ---------------- | -------- | -------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| `id`             | string   | no       | Opaque file identifier — never parse or construct                | `"1aBcD3eFgH"`                                         |
| `name`           | string   | (write)  | File/folder display name                                         | `"Q2 Board Deck"`                                      |
| `mimeType`       | string   | no       | MIME type; `...folder` = folder; `...google-apps.*` = native doc | `"application/vnd.google-apps.document"`               |
| `parents`        | string[] | (write)  | Parent folder id(s) — the folder graph                           | `["0AHk...root"]`                                      |
| `size`           | string   | no       | Byte size as a **string**; absent for Google-native docs         | `"482913"`                                             |
| `md5Checksum`    | string   | no       | MD5 of binary content (binary files only)                        | `"e2fc714c..."`                                        |
| `version`        | string   | no       | Monotonic version counter; bumps on any change                   | `"417"`                                                |
| `modifiedTime`   | RFC 3339 | (write)  | Last modification time (UTC)                                     | `"2026-05-20T09:14:00.000Z"`                           |
| `createdTime`    | RFC 3339 | no       | Creation time (UTC)                                              | `"2026-01-02T00:00:00.000Z"`                           |
| `trashed`        | boolean  | (write)  | Whether the file is in trash                                     | `false`                                                |
| `starred`        | boolean  | (write)  | Starred by the user                                              | `false`                                                |
| `shared`         | boolean  | no       | Whether the file is shared                                       | `true`                                                 |
| `owners`         | object[] | no       | Owner User objects (`displayName`, `emailAddress`)               | `[{"emailAddress":"a@x.com"}]`                         |
| `webViewLink`    | string   | no       | Browser URL to view the file                                     | `"https://docs.google.com/.../edit"`                   |
| `webContentLink` | string   | no       | Direct download URL (binary files only)                          | `"https://drive.google.com/uc?id=...&export=download"` |
| `exportLinks`    | map      | no       | `mimeType` → export URL map (Google-native files only)           | `{"application/pdf":"https://..."}`                    |
| `iconLink`       | string   | no       | Icon URL for the file type                                       | `"https://drive-thirdparty.../document"`               |
| `fileExtension`  | string   | no       | Final extension component (binary files)                         | `"pdf"`                                                |
| `driveId`        | string   | no       | Shared-drive id (present only for items on a shared drive)       | `"0AHk..."`                                            |
| `capabilities`   | object   | no       | Per-user capabilities (`canDownload`, `canEdit`, …)              | `{"canDownload":true}`                                 |

**Relationships:**

| Related Entity | Type        | Expression                             | Notes                                          |
| -------------- | ----------- | -------------------------------------- | ---------------------------------------------- |
| File (folder)  | N:1 (graph) | `parents[]` id reference               | Folders are Files; tree rebuilt from `parents` |
| Permission     | 1:N         | sub-resource `/files/{id}/permissions` | Who can access and at what role                |
| Drive (shared) | N:1         | `driveId` field                        | Shared drives are a separate corpus            |
| User (owner)   | N:1         | `owners[]` embedded objects            | Owner identity, not a separately fetchable URL |

---

### Permission (`files/{fileId}/permissions`)

**Resource path:** `/drive/v3/files/{fileId}/permissions` and `.../permissions/{permissionId}`
**Description:** An access-control entry — who can access a file and at what role.
**CRUD:** Read (list/get) in scope. Write (create/update/delete) **out of scope** under read-only.

| Field          | Type    | Description                                                                 |
| -------------- | ------- | --------------------------------------------------------------------------- |
| `id`           | string  | Opaque permission id (e.g. `anyoneWithLink`, or a numeric grantee id)       |
| `type`         | enum    | `user` / `group` / `domain` / `anyone`                                      |
| `role`         | enum    | `owner` / `organizer` / `fileOrganizer` / `writer` / `commenter` / `reader` |
| `emailAddress` | string  | Grantee email (for `user` / `group`)                                        |
| `domain`       | string  | Grantee domain (for `domain`)                                               |
| `displayName`  | string  | Human-readable grantee name                                                 |
| `deleted`      | boolean | Whether the grantee account was deleted                                     |

> The connector surfaces `permissions` inside `get_file_metadata` (its `fields` selector includes
> `permissions`). There is no separate connector tool for the ACL today.

---

### Change (`changes`)

**Resource path:** `/drive/v3/changes` (+ `/drive/v3/changes/startPageToken`)
**Description:** The incremental change feed — one entry per changed file since a saved cursor. Used
for sync; not wired into the connector today (see 01d).

| Field        | Type     | Description                                    |
| ------------ | -------- | ---------------------------------------------- |
| `changeType` | enum     | `file` / `drive`                               |
| `time`       | RFC 3339 | When the change occurred                       |
| `removed`    | boolean  | `true` if the file was deleted / lost access   |
| `fileId`     | string   | Id of the changed file                         |
| `file`       | object   | Embedded File resource (absent when `removed`) |
| `driveId`    | string   | Shared-drive id (for shared-drive changes)     |

---

### Drive (shared drives) (`drives`)

**Resource path:** `/drive/v3/drives`
**Description:** Team/shared drives. The provider lists these at the connector's **root level** as
top-level folders (id prefixed `shared-drive:<driveId>`) so the user can browse into them.
**CRUD:** Read (list) in scope.

| Field  | Type   | Description               |
| ------ | ------ | ------------------------- |
| `id`   | string | Shared-drive id           |
| `name` | string | Shared-drive display name |
| `kind` | string | `drive#drive`             |

---

### Virtual Folders (connector-only, not a Drive resource)

The provider's **root listing** does not call the API for files — it returns three kinds of virtual
navigation folders so the user can drill in:

| Virtual id               | Label               | Maps to (on drill-in)                                   |
| ------------------------ | ------------------- | ------------------------------------------------------- |
| `virtual:my-drive`       | "My Drive"          | `q='root' in parents and trashed=false`, `corpora=user` |
| `virtual:shared-with-me` | "Shared with me"    | `q=sharedWithMe=true and trashed=false`, `corpora=user` |
| `shared-drive:<driveId>` | (shared drive name) | `q='<driveId>' in parents`, `corpora=drive`, `driveId`  |

> These ids are **synthetic** — they are not real Drive file ids and must not be passed to
> `/files/{id}`. The provider resolves them to the queries above.

---

## Entity Relationship Diagram

```
┌──────────────┐   driveId    ┌─────────────────────┐
│    Drive     │<─────────────│        File         │
│  (shared)    │              │  (incl. folders)    │
└──────────────┘              └──────────┬──────────┘
                                         │ parents[]  (self-referential folder graph)
                                         ▼
                              ┌─────────────────────┐
                              │        File         │
                              └──────────┬──────────┘
                                         │ 1:N
                                         ▼
                              ┌─────────────────────┐
                              │     Permission      │
                              └─────────────────────┘
        Changes feed observes File mutations across the whole corpus.
```

---

## State Machines

### File — trash lifecycle

The only File lifecycle is around trashing. The connector is read-only, so these are
**observational** — surfaced via the `trashed` field and the `changes` feed, never driven by it.

```
[active] ──trash──> [trashed] ──untrash──> [active]
[trashed] ──empty trash / delete──> [permanently deleted]
```

**Transitions:**

| From    | Trigger        | To                  | Reversible? | Side Effects                              |
| ------- | -------------- | ------------------- | ----------- | ----------------------------------------- |
| active  | trash          | trashed             | yes         | `trashed=true`; auto-purge after ~30 days |
| trashed | untrash        | active              | yes         | `trashed=false`                           |
| trashed | delete / empty | permanently deleted | no          | File gone; emits a `removed` change       |

**Per-State Capabilities (connector):**

| State   | Visible by default? | Notes                                                          |
| ------- | ------------------- | -------------------------------------------------------------- |
| active  | yes                 | All connector queries append `trashed=false`                   |
| trashed | no                  | Hidden by the default `trashed=false` clause                   |
| deleted | no                  | Gone; only detectable via the `changes` feed (`removed: true`) |

---

## Business Rules

### Structure / Dependency Rules

- **Folders are files.** Detect a folder with `mimeType == 'application/vnd.google-apps.folder'`.
  There is no separate folder endpoint. [DOCUMENTED]
- **A file can have multiple parents historically** (now typically one). Build the tree from
  `parents[]`, don't assume a single parent. [DOCUMENTED]
- **Shared-drive items live in a separate corpus.** To see them you must pass
  `supportsAllDrives=true` + `includeItemsFromAllDrives=true` and set `corpora`/`driveId`
  appropriately. [DOCUMENTED]

### Field-Level Rules

- **Google-native files have no byte content and no `size`.** Docs/Sheets/Slides/Drawings/Forms must
  be **exported** to a downloadable format — they cannot be fetched with `alt=media`. [DOCUMENTED]
- **`size` is a string of bytes**, not an integer, and is absent for native docs. [DOCUMENTED]
- **Ids are opaque.** Never parse or construct file ids; treat them as blobs. [DOCUMENTED]
- **`incompleteSearch=true`** in a list response means cross-drive results are incomplete — narrow
  the corpus or retry. [DOCUMENTED]

### Computed / Read-Only Fields

- `id`, `createdTime`, `md5Checksum`, `version`, `shared`, `owners`, `webViewLink`,
  `webContentLink`, `exportLinks`, `capabilities`, `iconLink` are all server-managed. [DOCUMENTED]
- `version` bumps on every change — usable as a lightweight change cursor for a single file.

---

## Field Format Reference

| Format   | Pattern                         | Example                                | Notes                                      |
| -------- | ------------------------------- | -------------------------------------- | ------------------------------------------ |
| DateTime | RFC 3339 / ISO 8601, UTC        | `2026-05-20T09:14:00.000Z`             | `modifiedTime`, `createdTime`, etc.        |
| Date (q) | `'YYYY-MM-DDTHH:MM:SS'`         | `'2026-01-01T00:00:00'`                | Inside the `q` filter, quoted, UTC assumed |
| ID       | opaque base64-ish string        | `1aBcD3eFgHiJkLmNoPqRsTuVwXyZ`         | Do not parse                               |
| Size     | string of bytes                 | `"482913"`                             | String, not int; absent for native docs    |
| MIME     | standard or `vnd.google-apps.*` | `application/vnd.google-apps.document` | Folder / native-doc detection              |

---

## Enum Value Reference

| Entity     | Field                   | Allowed Values                                                         | Notes                             |
| ---------- | ----------------------- | ---------------------------------------------------------------------- | --------------------------------- |
| Permission | `type`                  | `user`, `group`, `domain`, `anyone`                                    |                                   |
| Permission | `role`                  | `owner`, `organizer`, `fileOrganizer`, `writer`, `commenter`, `reader` | `organizer` roles = shared drives |
| Change     | `changeType`            | `file`, `drive`                                                        |                                   |
| Webhook    | `X-Goog-Resource-State` | `sync`, `add`, `remove`, `update`, `trash`, `untrash`, `change`        | Push-channel header (see 01d)     |

### Key Google-native MIME types & connector export mapping

> Confirmed against `_get_export_mime_type` in `google_drive_provider.py`.

| Native mimeType                            | Meaning       | Connector export target                 |
| ------------------------------------------ | ------------- | --------------------------------------- |
| `application/vnd.google-apps.folder`       | Folder        | n/a (not downloadable; it's a folder)   |
| `application/vnd.google-apps.document`     | Google Doc    | DOCX (`...wordprocessingml.document`)   |
| `application/vnd.google-apps.spreadsheet`  | Google Sheet  | XLSX (`...spreadsheetml.sheet`)         |
| `application/vnd.google-apps.presentation` | Google Slides | PPTX (`...presentationml.presentation`) |
| `application/vnd.google-apps.drawing`      | Drawing       | PDF                                     |
| `application/vnd.google-apps.form`         | Form          | ZIP                                     |
| `application/vnd.google-apps.script`       | Apps Script   | JSON (`...google-apps.script+json`)     |
| _anything else `vnd.google-apps.*`_        | other native  | PDF (provider fallback)                 |

---

_Generated from the investigation questionnaire, Phase 3._
