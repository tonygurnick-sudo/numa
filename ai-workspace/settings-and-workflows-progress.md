# Folder Settings & Workflows — Progress & Architecture

## What We're Building

Every folder in the Numa file system has a set of JSON config files that control its behaviour. These files live on S3 at `{s3Prefix}/_folders/{folderPath}/` and are the single source of truth. DynamoDB is a query cache only.

The settings editor lives inside the Files page as a 4th view mode (list / grid / gallery / **settings**). Workflows define event-driven actions using 8 canonical filesystem triggers, resolved via nearest-ancestor walk-up.

---

## Folder Config Files

Each folder can have up to 6 JSON files. The first 4 are compulsory (auto-created on bootstrap). The last 2 are optional and mutually exclusive.

```
_folders/{path}/
├── metadata.json       ← name, description, icon (compulsory)
├── system.json         ← protected items only (compulsory)
├── proxy.json          ← symbolic references to external S3 locations (compulsory)
├── workflows.json      ← event triggers + actions (compulsory)
├── allow.json          ← whitelist patterns (optional)
└── disallow.json       ← blacklist patterns (optional)
```

### Why allow.json / disallow.json Are Separate Files

Previously `system.json` held `accept[]` and `disallow[]` arrays alongside `protected[]`. This created three problems:

1. **Mutual exclusivity was enforced in code** — the backend had to validate you didn't send both. With separate files, the file system itself enforces it: one file or the other (or neither) exists.
2. **Discoverability** — a developer browsing S3 sees `allow.json` and immediately knows the folder is in whitelist mode. No need to open `system.json` and look for nested keys.
3. **Consistency** — one file = one concern. `system.json` is protection rules. `allow.json` is file type policy. `workflows.json` is event-driven automation. Clean separation.

**Schema:**

```jsonc
// allow.json — whitelist mode (only these types accepted)
{
  "patterns": ["application/pdf", ".docx", "text/*", "image/*"]
}

// disallow.json — blacklist mode (everything except these)
{
  "patterns": ["application/x-executable", ".exe", ".bat", ".cmd"]
}
```

**Precedence:** If both files somehow exist, `allow.json` wins (whitelist is more restrictive). The UI should prevent creating both, and the backend should warn.

**Inheritance:** Restriction resolution walks up the folder tree (up to 20 levels) to find the nearest ancestor with an `allow.json` or `disallow.json`. This already works — it's the same `getEffectiveRestrictions` pattern, just reading from separate files now instead of `system.json` fields.

### system.json — Protection Rules Only

```jsonc
{
  "protected": [
    {
      "name": "documents",
      "browseable": true,
      "allowRename": false,
      "allowDelete": false,
      "allowMove": false,
    },
  ],
}
```

No more `accept`/`disallow` arrays here.

---

## Workflow Architecture

### S3-Only Boundary

**Workflows only apply to S3-backed files.** This is a hard architectural constraint.

Proxy files/folders (references to Google Drive, SharePoint, OneDrive via Pipedream) are read-only external references. They don't go through the user-files Lambda for mutations. You cannot register an EventBridge rule against a user's Google Drive.

The one overlap: if a **data connector sync** pulls files from an external source **into S3**, that sync goes through the user-files Lambda, so `ENTRY_CREATED` fires. Users get triggers when content lands in their S3 file system, not when it changes at the source.

### Event Flow (EventBridge)

```
user-files Lambda (mutable operation)
    │
    ├── completes the operation (upload, delete, move, etc.)
    ├── original file is ALWAYS preserved regardless of what happens next
    │
    └── emits custom event to EventBridge
            │
            ▼
    EventBridge Rule (source: "numa.files")
            │
            ▼
    workflow-resolver Lambda
        1. Parse event (scope, path, trigger type, file metadata)
        2. Walk folder tree upward (nearest-ancestor resolution)
        3. Find first workflows.json with matching trigger
        4. Evaluate conditions (mime_type, size, extension)
        5. Dispatch actions:
           ├── Fast actions → execute inline
           └── Slow actions → invoke target Lambda async
```

The user-files Lambda does NOT resolve workflows. It emits a raw event and moves on. Decoupled.

### EventBridge Event Schema

```jsonc
{
  "source": "numa.files",
  "detail-type": "ENTRY_CREATED", // one of the 8 canonical triggers
  "detail": {
    "scope": "USER#abc123",
    "s3_prefix": "files/user/abc123/",
    "path": "/documents/reports/2024/",
    "entry_name": "quarterly.pdf",
    "entry_type": "file", // "file" or "folder"
    "file_id": "f_abc123",
    "content_type": "application/pdf",
    "size_bytes": 245000,
    "extension": ".pdf",
    "source_type": "pdf", // from file registration
    "triggered_by": "user#abc123",
    "timestamp": "2026-02-19T14:30:00Z",
  },
}
```

### Trigger Resolution: Nearest-Ancestor Walk-Up

When an event fires in `/documents/reports/2024/`:

```
1. Read /documents/reports/2024/workflows.json → no ENTRY_CREATED trigger
2. Read /documents/reports/workflows.json      → no ENTRY_CREATED trigger
3. Read /documents/workflows.json              → MATCH: ENTRY_CREATED with extract action
4. Execute matched workflow actions
```

This reuses the same walk-up pattern as `getEffectiveRestrictions` (max 20 levels). It means you define a workflow where it makes sense — on `/documents/` for document extraction, on `/images/` for image processing — and all child folders inherit it automatically.

**`stopPropagation`**: A workflow can set `"stopPropagation": true` to prevent further bubbling. If a subfolder has its own `ENTRY_CREATED` workflow with `stopPropagation`, the parent's workflow won't fire.

### 8 Canonical Triggers

| Trigger                    | Emitted By                         | Description                          |
| -------------------------- | ---------------------------------- | ------------------------------------ |
| `ENTRY_CREATED`            | `registerFile()`, `createFolder()` | File uploaded or folder created      |
| `ENTRY_UPDATED`            | file content replace               | File content replaced (same file ID) |
| `ENTRY_DELETED`            | `deleteFile()`, `deleteFolder()`   | File or folder removed               |
| `ENTRY_MOVED`              | `moveFile()`, `moveFolder()`       | Moved to a different parent folder   |
| `ENTRY_RENAMED`            | `renameFile()`, `renameFolder()`   | Renamed in place (same parent)       |
| `ENTRY_METADATA_UPDATED`   | `updateSettings()`                 | Folder metadata/settings changed     |
| `ENTRY_PERMISSION_CHANGED` | share/unshare operations           | Access control changed               |
| `ENTRY_RESTORED`           | restore from trash/version         | File restored from previous state    |

All triggers are **API-driven** (emitted from the user-files Lambda), not S3-event-driven. The existing S3 notifications (`metadata.json`, `_folder.json` changes) handle DynamoDB cache sync — a separate concern.

---

## Workflow Actions

Actions are the "then do this" part of a workflow. They run **after** the triggering operation has already completed. The original file is always preserved — action failures never prevent an upload.

### Action Type: `extract`

Runs the `extract-content-from-file` Lambda on the uploaded file.

**Supported file types (30+):**

- **Text:** .txt, .md, .py, .js, .ts, .json, .yaml, .xml, .csv, .html, .css, .sql, .sh, .log, .cfg, .conf, .ini, .tex, .less, .scss, .bash, .yml, .markdown
- **Documents:** .docx (python-docx with page break handling), .xlsx (openpyxl, simple or complex mode), .msg (Outlook)
- **Vision (Bedrock):** .pdf (PyMuPDF → image → Claude Haiku/Nova Pro), .png, .jpg, .jpeg
- **Audio/Video (Transcribe):** .mp3, .mp4, .wav, .flac, .ogg, .amr, .webm, .m4a

**What it does:**

1. Sets `extraction_status: 'processing'` on the file record
2. Invokes extraction Lambda async with the file's S3 location
3. Lambda writes `extracted.json` (structured document with pages) and `extracted.status.json`
4. On success: `extraction_status: 'ready'`, word count and page count populated
5. On failure: `extraction_status: 'error'`, `extraction_error` message stored

**Workflow condition matching:** Use `mime_type` or file extension patterns to target specific types.

```jsonc
{
  "trigger": "ENTRY_CREATED",
  "conditions": {
    "mime_type": ["application/pdf", "application/vnd.openxmlformats*", "text/*"],
    "size_max": 104857600, // 100MB
  },
  "actions": [{ "type": "extract", "target": "extract-content-from-file" }],
}
```

### Action Type: `convert_database`

Runs the DB conversion Lambda to validate and convert database files to queryable SQLite format.

**Supported file types:**

- **Native SQLite:** .db, .sqlite, .sqlite3 — validated, schema extracted
- **SQL scripts:** .sql — parsed and imported into SQLite
- **Legacy databases:** .mdb, .accdb (Access), .dbf (dBASE) — converted to SQLite

**What it does:**

1. Sets `ingestion_status: 'validating'` on the file record
2. Invokes DB conversion Lambda async
3. Lambda attempts to read/convert the file into a valid SQLite database
4. On success: `ingestion_status: 'db_ready'` → file is queryable via API
5. On failure: `ingestion_status: 'invalid'` → file tagged in UI, re-validate button shown

**The original file is always kept.** A failed conversion means the user has the original .mdb file sitting in their folder with an "Invalid" badge. They can re-validate or just use it as-is.

```jsonc
{
  "trigger": "ENTRY_CREATED",
  "conditions": {
    "extension": [".db", ".sqlite", ".sqlite3", ".sql", ".mdb", ".accdb", ".dbf"],
  },
  "actions": [{ "type": "convert_database", "target": "db-conversion-lambda" }],
}
```

### Action Type: `tag`

Applies metadata tags to the file after processing. Used by other actions on failure, and available standalone.

```jsonc
{
  "type": "tag",
  "tags": { "extraction": "failed", "reason": "unsupported_format" },
}
```

### Error Handling Model

**Principle: uploads never fail because of workflow actions.**

```
File uploaded → registered in DynamoDB → S3 write confirmed → SUCCESS returned to user
                                                                    │
                                                              EventBridge event emitted
                                                                    │
                                                              workflow resolves
                                                                    │
                                                        ┌───────────┴───────────┐
                                                        ▼                       ▼
                                                   Action succeeds         Action fails
                                                        │                       │
                                                   Status: 'ready'         Status: 'error'
                                                   or 'db_ready'          or 'invalid'
                                                        │                       │
                                                   Badge: green ✓          Badge: red ✗
                                                                          + error message
                                                                          + retry button
```

**What the user sees when extraction fails:**

- The file appears in the folder normally (original preserved)
- A red "Error" badge appears on the file with a tooltip showing the error message
- A retry button (↻ icon) lets them re-trigger extraction
- This is exactly how it works today — workflows just formalize the trigger

**What the user sees when DB conversion fails:**

- The database file appears in the folder normally
- An "Invalid" badge appears with a "Re-validate" button
- They can fix the file and re-upload, or re-validate as-is

### Future Action Types (not shipping now)

| Action Type            | Description                                             |
| ---------------------- | ------------------------------------------------------- |
| `index_knowledge_base` | Add extracted content to Bedrock KB or Amazon Q for RAG |
| `notify`               | Send notification to user or Slack/Teams channel        |
| `move`                 | Move file to a target folder after processing           |
| `copy`                 | Copy file to another scope (e.g., user → company)       |
| `webhook`              | Call an external URL with event payload                 |
| `chain`                | Trigger another workflow in a different folder          |

---

## Bootstrap Defaults

When a folder is auto-created, `ensureCompulsoryFolderFiles()` creates the compulsory config files. Category folders get specific defaults.

### Root Folder (`/`)

```jsonc
// workflows.json — catch-all for unhandled file types
{ "workflows": [] }

// allow.json — not created (unrestricted at root)
// disallow.json — not created
```

### Category Folder: `/documents/`

```jsonc
// allow.json
{ "patterns": ["application/pdf", ".doc", ".docx", ".odt", ".rtf", ".pages", ".epub", "text/plain", "text/markdown", "text/html"] }

// workflows.json
{
  "workflows": [{
    "trigger": "ENTRY_CREATED",
    "stopPropagation": true,
    "conditions": {},
    "actions": [
      { "type": "extract", "target": "extract-content-from-file" }
    ]
  }]
}
```

### Category Folder: `/databases/`

```jsonc
// allow.json
{ "patterns": [".db", ".sqlite", ".sqlite3", ".sql", ".mdb", ".accdb", ".dbf", ".csv", ".tsv", ".xls", ".xlsx", ".ods"] }

// workflows.json
{
  "workflows": [
    {
      "trigger": "ENTRY_CREATED",
      "stopPropagation": true,
      "conditions": {
        "extension": [".db", ".sqlite", ".sqlite3", ".sql", ".mdb", ".accdb", ".dbf"]
      },
      "actions": [
        { "type": "convert_database", "target": "db-conversion-lambda" }
      ]
    },
    {
      "trigger": "ENTRY_CREATED",
      "stopPropagation": true,
      "conditions": {
        "extension": [".csv", ".tsv", ".xls", ".xlsx", ".ods"]
      },
      "actions": [
        { "type": "extract", "target": "extract-content-from-file" }
      ]
    }
  ]
}
```

### Category Folder: `/images/`

```jsonc
// allow.json
{ "patterns": ["image/*"] }

// workflows.json
{
  "workflows": [{
    "trigger": "ENTRY_CREATED",
    "stopPropagation": true,
    "conditions": {},
    "actions": [
      { "type": "extract", "target": "extract-content-from-file" }
    ]
  }]
}
```

---

## What's Done

### Frontend — SettingsEditor Component

**File:** `numa-frontend/src/Components/Files/SettingsEditor.tsx`

- Full tabbed UI (needs tab updates for new file split — see "What's Not Done")
- TypeScript interfaces for JSON schemas
- Metadata tab: Name, version, description — functional form
- System tab: protected items display (accept/disallow UI needs removal — moved to allow.json/disallow.json)
- Proxy tab: Placeholder (deferred)
- Workflows tab: Trigger dropdown, actions display, conditions display
- Save/Reload buttons with loading spinners
- Currently loads placeholder data — no API calls yet

**Status:** Commented out in Files.tsx. Was disabled to fix a deployment crash.

### Frontend — Toolbar Integration

**File:** `numa-frontend/src/Pages/Files.tsx`

- `ViewMode` type extended: `'list' | 'grid' | 'gallery' | 'settings'`
- Settings cog button in view toggle group
- Placeholder `<div>` when `viewMode === 'settings'`

### Backend — PUT Endpoints

**File:** `lambdas/node/user-files/index.ts`

- Route: `PUT /api/files/{scope}/settings/{type}?path=/folder/`
- Validation for metadata, system, proxy, workflows
- Needs update: remove accept/disallow validation from system.json, add allow.json/disallow.json as new setting types

### Folder Bootstrap

**File:** `lambdas/node/user-files/index.ts` — `ensureCompulsoryFolderFiles()`

Currently creates 3 compulsory files (metadata, system, proxy). Needs workflows.json added as 4th, and allow.json created for category folders.

---

## What's Not Done

### Critical Path

| #   | Item                                            | Where                           | Notes                                                                                                   |
| --- | ----------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | **Add workflows.json to bootstrap**             | `ensureCompulsoryFolderFiles()` | 4th compulsory file with per-category defaults                                                          |
| 2   | **Add allow.json to category folder bootstrap** | `ensureCompulsoryFolderFiles()` | Create allow.json (not disallow.json) for documents/, images/, etc.                                     |
| 3   | **Migrate accept/disallow out of system.json**  | user-files Lambda               | Remove from system.json validation, add allow.json/disallow.json as setting types                       |
| 4   | **Update `getEffectiveRestrictions`**           | user-files Lambda               | Read from allow.json/disallow.json instead of system.json fields                                        |
| 5   | **GET endpoints for reading settings**          | user-files Lambda               | PUT exists, GET doesn't — editor can't load real data                                                   |
| 6   | **filesService API functions**                  | filesService.ts                 | No `getSettings()` or `updateSettings()` exist                                                          |
| 7   | **Update SettingsEditor tabs**                  | SettingsEditor.tsx              | Replace System tab accept/disallow with new Allow/Disallow tabs; update Workflows tab with action types |
| 8   | **Uncomment & wire SettingsEditor**             | Files.tsx                       | Import is commented out; needs real API integration                                                     |
| 9   | **i18n keys for settings UI**                   | locales/en/files.json           | Only `toolbar.settingsView` exists                                                                      |

### Workflow Execution Engine (separate workstream)

| #   | Item                                               | Where                  | Notes                                                                        |
| --- | -------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| 10  | **Emit EventBridge events from user-files Lambda** | user-files Lambda      | After each mutable op, put event to EventBridge                              |
| 11  | **EventBridge rule**                               | infra/                 | Rule matching `source: "numa.files"` → workflow-resolver Lambda              |
| 12  | **workflow-resolver Lambda**                       | New Lambda             | Parses event, walks folder tree, resolves workflows.json, dispatches actions |
| 13  | **Extract action handler**                         | workflow-resolver      | Invokes extract-content-from-file Lambda, updates extraction_status          |
| 14  | **convert_database action handler**                | workflow-resolver      | Invokes DB conversion Lambda, updates ingestion_status                       |
| 15  | **Error tagging**                                  | workflow-resolver + UI | On action failure, set status fields; UI already shows badges                |

### Non-blocking (iterate later)

| Item                             | Notes                                             |
| -------------------------------- | ------------------------------------------------- |
| `stopPropagation` support        | Resolver checks flag and halts walk-up            |
| Workflow condition: `extension`  | Match by file extension in addition to mime_type  |
| Workflow condition: `entry_type` | Match file vs folder                              |
| "Add Workflow" button            | Button exists but isn't wired                     |
| Workflow action editor           | Currently display-only badges                     |
| Protected items editor           | System tab shows stub                             |
| Proxy references editor          | Proxy tab shows stub                              |
| `index_knowledge_base` action    | Add to Bedrock KB after extraction                |
| `notify` action                  | User notifications on workflow completion/failure |

---

## Architecture Decisions

1. **S3 is authoritative.** Config files live on S3. DynamoDB is a query cache.

2. **S3-only boundary.** Workflows only fire for S3-backed file operations. Proxy files (Google Drive, SharePoint, etc.) are read-only references — no events. Data connector syncs that land files in S3 do trigger workflows.

3. **Separate allow/disallow files.** File existence declares the mode. No mutual-exclusivity validation needed. One concern per file.

4. **Nearest-ancestor resolution, not top-level-only.** Workflow triggers resolve by walking up the folder tree to the first matching `workflows.json`. This reuses the same walk-up pattern as restriction inheritance (max 20 levels). Category folders define their own workflows; child folders inherit automatically.

5. **EventBridge decoupling.** The user-files Lambda emits raw events. A separate workflow-resolver Lambda handles resolution and dispatch. No coupling between file operations and workflow logic.

6. **Uploads never fail because of workflows.** Actions run asynchronously after the upload succeeds. Failures set status fields on the file record. The UI shows error badges with retry buttons. The original file is always preserved.

7. **View mode, not separate page.** Settings cog is part of the view toggle group. You're always "inside" the folder you're editing.

8. **Validation lives in the backend.** The Lambda validates JSON structure, trigger enums, action types, etc. Frontend sends raw JSON.

---

## Task Tracking

| #   | Task                                                         | Status  |
| --- | ------------------------------------------------------------ | ------- |
| 16  | Add settings cog as 4th view mode to toolbar                 | Done    |
| 17  | Create settings editor component for JSON files              | Done    |
| 18  | Create API endpoints for folder settings (GET + PUT)         | Done    |
| 19  | Add workflows.json + allow.json to folder bootstrap          | Done    |
| 20  | Fix 5 TypeScript errors crashing Files page                  | Done    |
| 21  | Migrate accept/disallow from system.json to separate files   | Done    |
| 22  | Update getEffectiveRestrictions for new file layout          | Done    |
| 23  | Wire SettingsEditor to real API + add i18n keys              | Done    |
| 24  | Add admin toggle for Numa Files in Settings page             | Done    |
| 25  | Fix Remote tab UI (grid view, gallery, browse button, OAuth) | Done    |
| 26  | Self-healing for corrupt config files                        | Done    |
| 27  | Emit EventBridge events from user-files Lambda               | Pending |
| 28  | Build workflow-resolver Lambda                               | Pending |
| 29  | Wire extract action to extraction Lambda                     | Pending |
| 30  | Wire convert_database action to DB conversion Lambda         | Pending |

---

## Next Steps (in order)

### Phase 1 — Settings File Restructure ✅ COMPLETE

1. ~~Add `workflows.json` to `ensureCompulsoryFolderFiles()` with per-category defaults~~
2. ~~Add `allow.json` creation for category folders during bootstrap~~
3. ~~Migrate `accept`/`disallow` out of `system.json` validation~~
4. ~~Update `getEffectiveRestrictions()` to read from `allow.json`/`disallow.json`~~

### Phase 2 — Settings API & UI ✅ COMPLETE

5. ~~Add GET endpoints for all settings types (including allow/disallow)~~
6. ~~Add `filesService` functions (`getFolderSettings`, `updateFolderSettings`)~~
7. ~~Update SettingsEditor tabs (System=protection only, Allow/Disallow, Workflows)~~
8. ~~Uncomment and wire SettingsEditor with real API calls~~
9. ~~Add i18n keys~~

### Phase 3 — Workflow Execution Engine

10. Add EventBridge event emission to user-files Lambda (after each mutable op)
11. Create EventBridge rule in infra (CDK construct)
12. Build workflow-resolver Lambda (event → folder walk-up → action dispatch)
13. Wire `extract` action → `extract-content-from-file` Lambda
14. Wire `convert_database` action → DB conversion Lambda
15. Error handling: set status fields on failure, UI already shows badges + retry

### Phase 4 — Polish & Extend

16. `stopPropagation` support in resolver
17. Additional condition types (extension, entry_type, path pattern)
18. `index_knowledge_base` action
19. `notify` action
20. Workflow editor UI (add/remove/edit workflows in the Workflows tab)
