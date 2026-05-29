---
api_name: 'Google Drive'
api_slug: 'googledrive'
researcher: 'Claude Code (doc-based investigation)'
date_researched: '2026-05-29'
integration_path: 'Data Connector (Files) + selective API'
auth_type: 'oauth2'
oauth_platform: 'google'
vendor: 'Google LLC'
website: 'https://developers.google.com/workspace/drive/api'
documentation_quality: 'excellent'
api_types: ['REST']
overall_confidence: 'high'
---

# Google Drive — API Investigation Questionnaire

> **Confidence markers:** `[CONFIRMED]` = verified against a live API call · `[DOCUMENTED]` =
> stated in official Google Drive API docs · `[INFERRED]` = deduced from conventions/SDK/partial
> docs · `[UNKNOWN]` = not yet established.
>
> ⚠️ **This is a documentation-based investigation.** No live Google Drive call was made at
> research time (no test OAuth client/tenant exercised). **Phase 2's "first successful call" gate
> is therefore NOT satisfied by a live trace** — every auth/format claim below is `[DOCUMENTED]`
> or `[INFERRED]`. The good news: Google's docs are excellent and an existing backend provider
> (`lib/oauth-providers/oauth_providers/google_drive_provider.py`) already exercises this surface,
> so confidence is **high**. Items that still warrant a live smoke test are tagged
> **🔬 LIVE-CONFIRM**.
>
> **Integration path note:** Google Drive is a **file-browsing** provider. It is wired as a
> **Data Connector (Files)** — `surfaces: ['files', 'chat']`, `category: 'Cloud Storage'` — backed
> by a Python `OAuthProvider` subclass, **not** a spec-driven chat-only `connect_request` connector.
> The agent reaches Drive through the Files-Remote connector path (`list_files` / `download_file` /
> `search_files` / `get_file_metadata`), not via raw HTTP from chat. This mirrors the Dropbox /
> OneDrive / Gmail file-browser pattern, **not** the Actionstep / NetSuite / Zoho direct-API pattern.

---

## Phase 1 — Documentation Discovery

| Item                   | Value                                                                       | Confidence   |
| ---------------------- | --------------------------------------------------------------------------- | ------------ |
| Vendor                 | Google LLC (Google Workspace)                                               | [DOCUMENTED] |
| Primary docs           | https://developers.google.com/workspace/drive/api                           | [DOCUMENTED] |
| REST reference (v3)    | https://developers.google.com/workspace/drive/api/reference/rest/v3         | [DOCUMENTED] |
| Auth / scopes guide    | https://developers.google.com/workspace/drive/api/guides/api-specific-auth  | [DOCUMENTED] |
| OAuth 2.0 (web server) | https://developers.google.com/identity/protocols/oauth2/web-server          | [DOCUMENTED] |
| Search (q syntax)      | https://developers.google.com/workspace/drive/api/guides/search-files       | [DOCUMENTED] |
| Export formats         | https://developers.google.com/workspace/drive/api/guides/ref-export-formats | [DOCUMENTED] |
| Download/upload guide  | https://developers.google.com/workspace/drive/api/guides/manage-downloads   | [DOCUMENTED] |
| Push notifications     | https://developers.google.com/workspace/drive/api/guides/push               | [DOCUMENTED] |
| Quotas / limits        | https://developers.google.com/workspace/drive/api/guides/limits             | [DOCUMENTED] |
| Error handling         | https://developers.google.com/workspace/drive/api/guides/handle-errors      | [DOCUMENTED] |
| OpenID discovery       | https://accounts.google.com/.well-known/openid-configuration                | [DOCUMENTED] |
| Discovery doc (v3)     | https://www.googleapis.com/discovery/v1/apis/drive/v3/rest                  | [DOCUMENTED] |

**OpenAPI / Discovery:** Google publishes a machine-readable **Discovery Document** (not OpenAPI, but
equivalent) at the URL above, plus the unofficial OpenAPI mirror in `googleapis/google-api-go-client`
(`drive/v3/drive-api.json`). [DOCUMENTED]

**Official SDKs:** Python (`google-api-python-client`), Node.js (`googleapis`), Go, Java, .NET, PHP —
all first-party and well maintained. [DOCUMENTED]

### 1.3 Documentation Quality Assessment

| Area                      | Rating | Notes                                                                |
| ------------------------- | ------ | -------------------------------------------------------------------- |
| Authentication            | 5      | Standard Google OAuth 2.0, exhaustively documented                   |
| Endpoint reference        | 5      | Full REST reference + Discovery Document                             |
| Request/response examples | 5      | Examples per method, "Try this method" widget                        |
| Error documentation       | 4      | Dedicated guide with reason codes; some 403 reasons under-documented |
| Rate limit documentation  | 5      | Quota-unit model fully published                                     |
| Pagination documentation  | 5      | `pageToken` / `nextPageToken` model clear                            |
| Webhook documentation     | 4      | Push channels documented; payload is header-only (no body)           |
| SDKs / code examples      | 5      | First-party SDKs in 6+ languages                                     |
| Changelog / versioning    | 4      | Release notes published; v3 stable for years                         |

**Overall documentation quality:** excellent.

### 1.4 Discovery Status

- [x] Found official API documentation
- [x] Found Discovery Document (Google's OpenAPI equivalent)
- [x] Identified authentication method (Google OAuth 2.0, authorization_code)
- [x] Found multiple working examples (docs + existing backend provider)
- [x] Identified rate limit information (quota-unit model)
- [x] Identified pagination approach (`pageToken`)
- [x] Checked for webhook/event support (push channels + changes feed)
- [x] Checked for official SDKs (6+ first-party)

---

## Phase 2 — Authentication (HARD GATE — not satisfied by a live trace, see warning above)

Auth values below are taken from the **connector registry entry** (`connectorRegistry.ts`,
`id: 'googledrive'`) and cross-checked against Google's OAuth 2.0 docs. They match.

| Item                  | Value                                                                                    | Confidence   |
| --------------------- | ---------------------------------------------------------------------------------------- | ------------ |
| Auth standard         | OAuth 2.0, Authorization Code grant (web-server flow)                                    | [DOCUMENTED] |
| Platform              | `google` (`oauthPlatform: 'google'`)                                                     | [DOCUMENTED] |
| Authorize URL         | `https://accounts.google.com/o/oauth2/v2/auth`                                           | [DOCUMENTED] |
| Token URL             | `https://oauth2.googleapis.com/token`                                                    | [DOCUMENTED] |
| Revocation URL        | `https://oauth2.googleapis.com/revoke`                                                   | [DOCUMENTED] |
| Discovery URL         | `https://accounts.google.com/.well-known/openid-configuration`                           | [DOCUMENTED] |
| Scope (registry)      | `https://www.googleapis.com/auth/drive.readonly`                                         | [DOCUMENTED] |
| Extra auth params     | `{"access_type":"offline","prompt":"consent"}` (forces refresh-token issuance)           | [DOCUMENTED] |
| Auth header format    | `Authorization: Bearer {access_token}`                                                   | [DOCUMENTED] |
| Access token lifetime | 3600s (1 hour)                                                                           | [DOCUMENTED] |
| Refresh token         | Long-lived; requires `access_type=offline` + first-consent (or `prompt=consent`)         | [DOCUMENTED] |
| Refresh behavior      | Manual — POST `grant_type=refresh_token` to token URL; refresh token does **not** rotate | [DOCUMENTED] |
| PKCE                  | Supported by Google; not required for confidential web clients                           | [DOCUMENTED] |
| State parameter       | Recommended (CSRF protection); used by the OAuth wizard                                  | [DOCUMENTED] |
| Redirect URI          | Must be pre-registered in Google Cloud Console → Credentials → OAuth Client ID           | [DOCUMENTED] |

**Scope is RESTRICTED.** `drive.readonly` is a Google **restricted scope** — production OAuth apps
using it must pass **OAuth app verification AND an annual third-party security assessment (CASA)**.
This is a real onboarding cost for any client that wants Drive enabled. [DOCUMENTED] 🔬 LIVE-CONFIRM
(verification status is per-Google-Cloud-project; each client's own OAuth client must be verified).

**Token response (documented shape):**

```json
{
  "access_token": "ya29.a0Af...",
  "expires_in": 3599,
  "refresh_token": "1//0gFp...",
  "scope": "https://www.googleapis.com/auth/drive.readonly",
  "token_type": "Bearer"
}
```

> Note: `refresh_token` is only returned on the **first** consent unless `prompt=consent` is sent —
> which is exactly why the registry sets `extraAuthParams` to `{"access_type":"offline","prompt":"consent"}`.

### 2.4 First Successful Call (gate)

```http
GET /drive/v3/about?fields=user,storageQuota HTTP/1.1
Host: www.googleapis.com
Authorization: Bearer ya29.a0Af...
```

Recommended smoke test: `GET /drive/v3/about?fields=user` returns the authenticated user's identity
— minimal, read-only, confirms the token + scope. [DOCUMENTED — endpoint] / [INFERRED — smoke-test choice]

- [ ] **GATE CHECK: first successful live API call — NOT DONE (no test OAuth client exercised)** 🔬

---

## Phase 3 — Domain Model & Behaviour

Google Drive is a **flat file store with a folder graph overlaid via the `parents` field** — there is
no true directory tree; folders are themselves File resources (`mimeType =
application/vnd.google-apps.folder`) and a file can have multiple parents historically (now typically one).

### 3.1 Core Entities

#### Entity: File (`files`)

- **Resource path:** `/drive/v3/files` and `/drive/v3/files/{fileId}`
- **CRUD:** Read (in scope for connector); Create/Update/Delete exist in the API but are **out of scope**
  under the read-only scope.

| Field            | Type     | Writable? | Description                                                              | Example                                              |
| ---------------- | -------- | --------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| `id`             | string   | no        | Opaque file identifier                                                   | `1aBcD3eFgH...`                                      |
| `name`           | string   | yes       | File/folder display name                                                 | `Q2 Board Deck`                                      |
| `mimeType`       | string   | no        | MIME type; `...google-apps.folder` = folder; `...google-apps.*` = native | `application/vnd.google-apps.document`               |
| `parents`        | string[] | yes       | Parent folder ID(s) — the folder graph                                   | `["0AHk...root"]`                                    |
| `size`           | string   | no        | Byte size (absent for Google-native docs)                                | `"482913"`                                           |
| `md5Checksum`    | string   | no        | MD5 of binary content (binary files only)                                | `e2fc714c...`                                        |
| `modifiedTime`   | RFC 3339 | yes       | Last modification time (UTC)                                             | `2026-05-20T09:14:00.000Z`                           |
| `createdTime`    | RFC 3339 | no        | Creation time                                                            | `2026-01-02T00:00:00.000Z`                           |
| `trashed`        | boolean  | yes       | Whether file is in trash                                                 | `false`                                              |
| `starred`        | boolean  | yes       | Starred by the user                                                      | `false`                                              |
| `shared`         | boolean  | no        | Whether the file is shared                                               | `true`                                               |
| `owners`         | object[] | no        | Owner User objects (`displayName`, `emailAddress`)                       | `[{"emailAddress":"a@x.com"}]`                       |
| `webViewLink`    | string   | no        | Browser URL to view the file                                             | `https://docs.google.com/.../edit`                   |
| `webContentLink` | string   | no        | Direct download URL (binary files only)                                  | `https://drive.google.com/uc?id=...&export=download` |
| `iconLink`       | string   | no        | Icon URL for the file type                                               | `https://drive-thirdparty.../document`               |
| `exportLinks`    | map      | no        | mimeType → export URL map (Google-native files only)                     | `{"application/pdf":"https://..."}`                  |
| `fileExtension`  | string   | no        | Final extension component                                                | `pdf`                                                |
| `driveId`        | string   | no        | Shared drive ID (if on a shared drive)                                   | `0AHk...`                                            |
| `capabilities`   | object   | no        | Per-user permissions (`canDownload`, `canEdit`, …)                       | `{"canDownload":true}`                               |

**Relationships:**

| Related Entity | Type        | How Expressed                          | Notes                                        |
| -------------- | ----------- | -------------------------------------- | -------------------------------------------- |
| File (folder)  | N:1 (graph) | `parents[]` ID reference               | Folders are Files; tree built from `parents` |
| Permission     | 1:N         | sub-resource `/files/{id}/permissions` | Who can access and at what role              |
| Drive (shared) | N:1         | `driveId` field                        | Shared drives are a separate corpus          |
| User (owner)   | N:1         | `owners[]` embedded objects            | Owner identity, not a separate fetchable URL |

#### Entity: Permission (`files/{fileId}/permissions`)

- **CRUD:** Read in scope (list/get); write out of scope under read-only scope.

| Field          | Type    | Description                                                                 |
| -------------- | ------- | --------------------------------------------------------------------------- |
| `id`           | string  | Opaque permission ID                                                        |
| `type`         | enum    | `user` / `group` / `domain` / `anyone`                                      |
| `role`         | enum    | `owner` / `organizer` / `fileOrganizer` / `writer` / `commenter` / `reader` |
| `emailAddress` | string  | Grantee email (user/group)                                                  |
| `domain`       | string  | Grantee domain (domain type)                                                |
| `displayName`  | string  | Human-readable grantee name                                                 |
| `deleted`      | boolean | Whether the grantee account was deleted                                     |

#### Entity: Change (`changes`)

The incremental change feed (see Phase 7). Fields: `changeType`, `time`, `removed`, `fileId`,
`file` (embedded File), `driveId`. [DOCUMENTED]

#### Entity: Drive (shared drives) (`drives`)

Team/shared drives. The connector lists them as top-level "folders" to browse into. Fields:
`id`, `name`, `kind`. [DOCUMENTED — provider lists shared drives as folders]

### 3.2 Entity Relationship Map

```
┌──────────────┐  driveId   ┌──────────────┐
│   Drive      │<───────────│    File      │
│ (shared)     │            │ (incl folders)│
└──────────────┘            └──────┬───────┘
                                   │ parents[] (self-referential graph)
                                   ▼
                            ┌──────────────┐
                            │    File      │
                            └──────┬───────┘
                                   │ 1:N
                                   ▼
                            ┌──────────────┐
                            │  Permission  │
                            └──────────────┘
```

### 3.3 State Machines

Files have a lightweight lifecycle around trashing:

```
[active] --trash--> [trashed] --untrash--> [active]
[trashed] --empty trash / delete--> [permanently deleted]
```

| From State | Trigger      | To State            | Reversible? | Side Effects                         |
| ---------- | ------------ | ------------------- | ----------- | ------------------------------------ |
| active     | trash        | trashed             | yes         | `trashed=true`; auto-purge after 30d |
| trashed    | untrash      | active              | yes         | `trashed=false`                      |
| trashed    | delete/empty | permanently deleted | no          | File gone; emits `removed` change    |

(Connector is read-only, so these are observational only — surfaced through the `trashed` field and
the `changes` feed.) [DOCUMENTED]

### 3.4 Business Rules

- **Folders are files.** Detect with `mimeType = 'application/vnd.google-apps.folder'`. There is no
  separate folder endpoint. [DOCUMENTED]
- **Google-native files have no byte content and no `size`.** Docs/Sheets/Slides/Drawings/Forms must
  be **exported** to a downloadable format — they cannot be fetched with `alt=media`. [DOCUMENTED]
- **`drive.readonly` is a restricted scope** → OAuth verification + CASA security assessment required
  before production. [DOCUMENTED]
- **Shared-drive items require flags.** To see files on shared drives you must pass
  `includeItemsFromAllDrives=true` AND `supportsAllDrives=true` (and `corpora` appropriately).
  Omitting them silently hides shared-drive content. [DOCUMENTED]
- **`incompleteSearch=true`** in a list response means results across multiple drives are incomplete —
  narrow the corpus or retry. [DOCUMENTED]
- **IDs are opaque.** Never parse or construct file IDs. [DOCUMENTED]

### 3.5 Field Format Reference

| Format   | Pattern                         | Example                                | Notes                                        |
| -------- | ------------------------------- | -------------------------------------- | -------------------------------------------- |
| DateTime | RFC 3339 / ISO 8601, UTC        | `2026-05-20T09:14:00.000Z`             | Used for `modifiedTime`, `createdTime`, etc. |
| Date (q) | `'YYYY-MM-DDTHH:MM:SS'`         | `'2026-01-01T00:00:00'`                | In `q` filter, quoted, UTC assumed           |
| ID       | opaque base64-ish string        | `1aBcD3eFgHiJkLmNoPqRsTuVwXyZ`         | Do not parse                                 |
| Size     | string of bytes                 | `"482913"`                             | String, not int; absent for native docs      |
| MIME     | standard or `vnd.google-apps.*` | `application/vnd.google-apps.document` | Folder/native detection                      |

### 3.6 Enum Value Reference

| Entity                   | Field                   | Allowed Values                                                         |
| ------------------------ | ----------------------- | ---------------------------------------------------------------------- |
| Permission               | `type`                  | `user`, `group`, `domain`, `anyone`                                    |
| Permission               | `role`                  | `owner`, `organizer`, `fileOrganizer`, `writer`, `commenter`, `reader` |
| Change                   | `changeType`            | `file`, `drive`                                                        |
| Resource state (webhook) | `X-Goog-Resource-State` | `sync`, `add`, `remove`, `update`, `trash`, `untrash`, `change`        |

**Key Google-native MIME types:**

| Native mimeType                            | Meaning       | Default export (connector)              |
| ------------------------------------------ | ------------- | --------------------------------------- |
| `application/vnd.google-apps.folder`       | Folder        | n/a (not a file)                        |
| `application/vnd.google-apps.document`     | Google Doc    | DOCX (`...wordprocessingml.document`)   |
| `application/vnd.google-apps.spreadsheet`  | Google Sheet  | XLSX (`...spreadsheetml.sheet`)         |
| `application/vnd.google-apps.presentation` | Google Slides | PPTX (`...presentationml.presentation`) |
| `application/vnd.google-apps.drawing`      | Drawing       | PDF                                     |
| `application/vnd.google-apps.form`         | Form          | ZIP                                     |
| `application/vnd.google-apps.script`       | Apps Script   | JSON (`...google-apps.script+json`)     |

(Mapping confirmed against existing `_get_export_mime_type` in `google_drive_provider.py`.) [DOCUMENTED]

---

## Phase 4 — Endpoint Catalog

- **Base URL:** `https://www.googleapis.com/drive/v3` [DOCUMENTED — matches provider `BASE_URL`]
- **Content type:** `application/json; charset=UTF-8` (metadata); binary stream for `alt=media`/export.
- **Versioning:** URL path (`/drive/v3`).

### 4.1 Critical Endpoints

#### Endpoint: GET /drive/v3/files (list / browse / search)

- **Purpose:** List or search files & folders. Powers `list_files` and `search_files`.
- **Auth:** yes · **Idempotent:** yes · **Quota:** 100 units/call.

**Query parameters:**

| Parameter                   | Type    | Default | Description                                                                                       |
| --------------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------- |
| `q`                         | string  | —       | Search/filter query (see Phase 5)                                                                 |
| `pageSize`                  | int     | 100     | Max files per page; **max 100**                                                                   |
| `pageToken`                 | string  | —       | Continuation token from previous `nextPageToken`                                                  |
| `fields`                    | string  | —       | Partial response selector, e.g. `nextPageToken,files(id,name,mimeType,size,modifiedTime,parents)` |
| `orderBy`                   | string  | —       | Sort keys, e.g. `modifiedTime desc,name`                                                          |
| `spaces`                    | string  | `drive` | `drive`, `appDataFolder`                                                                          |
| `corpora`                   | string  | `user`  | `user`, `domain`, `drive`, `allDrives`                                                            |
| `includeItemsFromAllDrives` | boolean | false   | Include shared-drive items                                                                        |
| `supportsAllDrives`         | boolean | false   | App supports shared drives (required with the above)                                              |
| `driveId`                   | string  | —       | Scope to one shared drive                                                                         |

**Request:**

```http
GET /drive/v3/files?q=trashed%3Dfalse%20and%20%27root%27%20in%20parents&pageSize=100&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,webViewLink) HTTP/1.1
Host: www.googleapis.com
Authorization: Bearer ya29.a0Af...
```

**Success response (200):**

```json
{
  "kind": "drive#fileList",
  "incompleteSearch": false,
  "nextPageToken": "~!!~AI9F...",
  "files": [
    {
      "id": "1aBcD3eFgH",
      "name": "Q2 Board Deck",
      "mimeType": "application/vnd.google-apps.presentation",
      "modifiedTime": "2026-05-20T09:14:00.000Z",
      "parents": ["0AHk...root"],
      "webViewLink": "https://docs.google.com/presentation/d/1aBcD3eFgH/edit"
    },
    {
      "id": "2xYz9wV",
      "name": "budget.xlsx",
      "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "size": "204812",
      "modifiedTime": "2026-05-18T11:02:33.000Z",
      "parents": ["0AHk...root"]
    }
  ]
}
```

#### Endpoint: GET /drive/v3/files/{fileId} (metadata)

- **Purpose:** Fetch a single file's metadata. Powers `get_file_metadata`.
- **Auth:** yes · **Quota:** 5 units. · Pass `fields=*` for the full resource, or a narrow selector.
- **Note:** add `supportsAllDrives=true` for shared-drive files.

```http
GET /drive/v3/files/1aBcD3eFgH?fields=id,name,mimeType,size,modifiedTime,parents,exportLinks,capabilities&supportsAllDrives=true HTTP/1.1
Authorization: Bearer ya29...
```

#### Endpoint: GET /drive/v3/files/{fileId}?alt=media (download binary)

- **Purpose:** Download the raw bytes of a **binary** file. Powers `download_file` (non-native branch).
- **Auth:** yes · **Quota:** 200 units (download). Response body is the file content.
- **Cannot be used for Google-native files** — returns a 403 `fileNotDownloadable`; use export instead.
- `acknowledgeAbuse=true` required to download files flagged as malware (owner/organizer only).

```http
GET /drive/v3/files/2xYz9wV?alt=media&supportsAllDrives=true HTTP/1.1
Authorization: Bearer ya29...
```

#### Endpoint: GET /drive/v3/files/{fileId}/export?mimeType=... (export native)

- **Purpose:** Export a Google-native Doc/Sheet/Slide to a downloadable format. Powers `download_file`
  (native branch). **Hard 10 MB cap** on exported content — larger files must use the `exportLinks` URLs.
- **Auth:** yes · **Quota:** download-class.

```http
GET /drive/v3/files/1aBcD3eFgH/export?mimeType=application%2Fvnd.openxmlformats-officedocument.presentationml.presentation HTTP/1.1
Authorization: Bearer ya29...
```

Response: binary PPTX stream, `Content-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation`.

#### Endpoint: GET /drive/v3/files/{fileId}/permissions (list permissions)

- **Purpose:** Who can access a file and at what role. [DOCUMENTED]
- **Auth:** yes · pass `supportsAllDrives=true` for shared-drive items.

```json
{
  "kind": "drive#permissionList",
  "permissions": [
    { "id": "anyoneWithLink", "type": "anyone", "role": "reader" },
    { "id": "0392...", "type": "user", "role": "writer", "emailAddress": "alex@example.com", "displayName": "Alex K" }
  ]
}
```

#### Endpoint: GET /drive/v3/changes (incremental change feed) + GET /drive/v3/changes/startPageToken

- **Purpose:** Poll for changes since a saved token. See Phase 7.

### 4.2 Full Endpoint Index (connector-relevant subset)

| Method | Path                                   | Purpose                   | Auth? | Pagination?       | Notes                             |
| ------ | -------------------------------------- | ------------------------- | ----- | ----------------- | --------------------------------- |
| GET    | `/files`                               | List / search / browse    | yes   | yes (`pageToken`) | Core list endpoint                |
| GET    | `/files/{id}`                          | Metadata                  | yes   | no                | `fields` selector recommended     |
| GET    | `/files/{id}?alt=media`                | Download binary           | yes   | no                | Not for native docs               |
| GET    | `/files/{id}/export`                   | Export native doc         | yes   | no                | 10 MB cap                         |
| GET    | `/files/{id}/permissions`              | List ACL                  | yes   | yes               | `supportsAllDrives`               |
| GET    | `/drives`                              | List shared drives        | yes   | yes               | Browsed as top-level folders      |
| GET    | `/changes`                             | Incremental change feed   | yes   | yes               | Needs `startPageToken` first      |
| GET    | `/changes/startPageToken`              | Get current change cursor | yes   | no                | Seed for polling                  |
| POST   | `/changes/watch` / `/files/{id}/watch` | Register push channel     | yes   | no                | Out of scope for read-only browse |
| GET    | `/about?fields=user,storageQuota`      | Authed user + quota       | yes   | no                | Good smoke test                   |

(Write endpoints — `POST/PATCH/DELETE /files`, `permissions.create`, etc. — exist but are **out of
scope** under the `drive.readonly` connector scope.)

---

## Phase 5 — Query & Filter Capabilities

The `q` parameter is a small expression DSL: `query_term operator value`, combinable with
`and` / `or` / `not`. Values are single-quoted; escape `'` and `\` inside values.

| Capability                      | Supported? | Syntax                                  | Confidence   |
| ------------------------------- | ---------- | --------------------------------------- | ------------ |
| Filter by field value           | yes        | `name = 'report.pdf'`                   | [DOCUMENTED] |
| Filter by date range            | yes        | `modifiedTime > '2026-01-01T00:00:00'`  | [DOCUMENTED] |
| Full-text search (content+meta) | yes        | `fullText contains 'quarterly revenue'` | [DOCUMENTED] |
| Filter by MIME / type           | yes        | `mimeType = 'application/pdf'`          | [DOCUMENTED] |
| Folder scoping                  | yes        | `'<folderId>' in parents`               | [DOCUMENTED] |
| Owner / sharing                 | yes        | `'me' in owners`, `sharedWithMe`        | [DOCUMENTED] |
| Trashed / starred               | yes        | `trashed = false`, `starred = true`     | [DOCUMENTED] |
| Sort by field                   | yes        | `orderBy=modifiedTime desc`             | [DOCUMENTED] |
| Sort direction (asc/desc)       | yes        | append ` desc` to a key                 | [DOCUMENTED] |
| Field selection (partial resp.) | yes        | `fields=files(id,name,...)`             | [DOCUMENTED] |
| Logical operators (and/or/not)  | yes        | `... and (... or ...)`                  | [DOCUMENTED] |
| Comparison operators            | yes        | `=`, `!=`, `<`, `<=`, `>`, `>=`         | [DOCUMENTED] |
| Membership / `contains`         | yes        | `in`, `contains`                        | [DOCUMENTED] |
| Aggregate / count               | no         | No count endpoint; count by paging      | [DOCUMENTED] |
| Regex / pattern matching        | no         | `contains` is substring/prefix only     | [DOCUMENTED] |

### 5.2 Filter Syntax

```
GET /drive/v3/files?q=<url-encoded expression>
```

`contains` semantics differ by term: for `name` and `fullText` it is a **prefix/token** match, not a
free substring match — a known footgun. [DOCUMENTED]

### 5.3 Sort Syntax

```
orderBy=folder,modifiedTime desc,name
```

Sort keys: `createdTime`, `folder`, `modifiedByMeTime`, `modifiedTime`, `name`, `name_natural`,
`quotaBytesUsed`, `recency`, `sharedWithMeTime`, `starred`, `viewedByMeTime`. [DOCUMENTED]

### 5.6 Common Query Patterns

**Pattern 1 — Top-level folder contents (browse "My Drive root"):**

```http
GET /drive/v3/files?q='root'%20in%20parents%20and%20trashed%3Dfalse&orderBy=folder,name
```

**Pattern 2 — Children of a folder:**

```http
GET /drive/v3/files?q='1aBcFolderId'%20in%20parents%20and%20trashed%3Dfalse
```

**Pattern 3 — Full-text search across the user's Drive:**

```http
GET /drive/v3/files?q=fullText%20contains%20'merger%20agreement'%20and%20trashed%3Dfalse
```

**Pattern 4 — Only PDFs modified this year:**

```http
GET /drive/v3/files?q=mimeType%3D'application%2Fpdf'%20and%20modifiedTime%20%3E%20'2026-01-01T00%3A00%3A00'
```

**Pattern 5 — Folders only (build the tree):**

```http
GET /drive/v3/files?q=mimeType%3D'application%2Fvnd.google-apps.folder'%20and%20trashed%3Dfalse
```

---

## Phase 6 — Pagination & Bulk

| Item                | Value                                                   | Confidence   |
| ------------------- | ------------------------------------------------------- | ------------ |
| Pagination model    | Cursor / opaque page token                              | [DOCUMENTED] |
| Default page size   | 100                                                     | [DOCUMENTED] |
| Max page size       | 100                                                     | [DOCUMENTED] |
| Paging params       | `pageSize`, `pageToken`                                 | [DOCUMENTED] |
| Next-page token     | `nextPageToken` in body                                 | [DOCUMENTED] |
| Last-page detection | `nextPageToken` absent                                  | [DOCUMENTED] |
| Total count         | **Not provided** — no total; iterate until token absent | [DOCUMENTED] |

### 6.2 Pagination Worked Example

```
Page 1: GET /files?pageSize=100&q=trashed=false
        -> { files: [...100], nextPageToken: "TOKEN_A" }
Page 2: GET /files?pageSize=100&q=trashed=false&pageToken=TOKEN_A
        -> { files: [...100], nextPageToken: "TOKEN_B" }
Last:   GET /files?pageSize=100&q=trashed=false&pageToken=TOKEN_B
        -> { files: [...37] }            # no nextPageToken -> done
```

> When paging a filtered list, **send identical `q`/`orderBy` on every page** — the token encodes the
> query context. [DOCUMENTED]

### 6.3 Bulk Operations

Google Drive supports **HTTP batch requests** (`POST https://www.googleapis.com/batch/drive/v3`,
`multipart/mixed`, up to 100 sub-requests). Useful to fetch metadata for many IDs in one round-trip.
Read-only connector use is optional; not required for the Files surface. [DOCUMENTED]

| Operation              | Endpoint                    | Max Batch | Notes                           |
| ---------------------- | --------------------------- | --------- | ------------------------------- |
| Batch read (metadata)  | `POST /batch/drive/v3`      | 100       | `multipart/mixed`; per-sub-resp |
| Bulk create/update/del | n/a for read-only connector | —         | Out of scope                    |

**Partial failure:** Each sub-request in a batch returns its own status; failures are isolated. [DOCUMENTED]

### 6.4 Export / Large Dataset

For Google-native files > 10 MB, the inline `files.export` cap is exceeded — use the per-format URLs in
the file's `exportLinks` map (authenticated GET) instead. [DOCUMENTED]

---

## Phase 7 — Real-Time & Events

| Mechanism                | Supported? | Notes                                                                   |
| ------------------------ | ---------- | ----------------------------------------------------------------------- |
| Webhooks (push channels) | yes        | `files.watch` / `changes.watch` POST a channel; HTTPS + verified domain |
| WebSocket                | no         | —                                                                       |
| Server-Sent Events       | no         | —                                                                       |
| Change feed (polling)    | yes        | `changes.list` + `startPageToken` — the recommended sync mechanism      |

### 7.2 Webhooks (push notifications)

- **Register:** `POST /drive/v3/changes/watch` (or `/files/{id}/watch`) with a channel body:
  `{ "id": "<uuid>", "type": "web_hook", "address": "https://...", "token": "<opaque>", "expiration": <ms> }`. [DOCUMENTED]
- **Expiration:** max **1 day** for `files`, **1 week** for `changes`. No auto-renew — re-issue with a
  new `id` before expiry. [DOCUMENTED]
- **Notifications are header-only (no body).** Key headers: [DOCUMENTED]

| Header                  | Meaning                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `X-Goog-Channel-ID`     | Your channel id (echo of `id`)                                        |
| `X-Goog-Resource-State` | `sync` / `add` / `remove` / `update` / `trash` / `untrash` / `change` |
| `X-Goog-Resource-ID`    | Opaque watched-resource id                                            |
| `X-Goog-Message-Number` | Monotonic message counter (dedupe / ordering)                         |
| `X-Goog-Channel-Token`  | Echo of your `token` (use to authenticate the callback)               |
| `X-Goog-Changed`        | `content` / `parents` / `children` / `permissions`                    |

- **Verification:** Domain must serve a valid (non-self-signed) SSL cert; channel ownership is proven
  via the `token` you supplied. There is **no HMAC signature** — security relies on the secret `token`
  - HTTPS. [DOCUMENTED]
- **Stop:** `POST /drive/v3/channels/stop` with `{id, resourceId}`. [DOCUMENTED]
- **Reliability:** at-least-once delivery; duplicates possible (dedupe on `X-Goog-Message-Number`);
  no strict ordering guarantee. [DOCUMENTED]

### 7.4 Polling Fallback (recommended for sync)

1. `GET /drive/v3/changes/startPageToken` → save `startPageToken`. [DOCUMENTED]
2. `GET /drive/v3/changes?pageToken=<saved>&includeRemoved=true&includeItemsFromAllDrives=true&supportsAllDrives=true`
3. Follow `nextPageToken` within the cycle; when absent, **store `newStartPageToken`** for the next poll.
4. Each `Change` has `fileId`, `file` (embedded), `removed`, `time`, `changeType`. [DOCUMENTED]

- **"Modified since" filter:** yes — `modifiedTime > '...'` on `files.list`, or the `changes` feed.
- **Change detection fields:** `modifiedTime`, `md5Checksum` (binary), `version` (internal). [DOCUMENTED]

---

## Phase 8 — Operational Concerns

### 8.1 Rate Limits (quota-unit model)

| Scope                | Limit           | Window     | Confidence   |
| -------------------- | --------------- | ---------- | ------------ |
| Per project          | 1,000,000 units | per minute | [DOCUMENTED] |
| Per user per project | 325,000 units   | per minute | [DOCUMENTED] |
| Per project (egress) | 1 TB            | per day    | [DOCUMENTED] |

**Per-method quota cost:** read ≈ 5 units, **list ≈ 100 units**, **download ≈ 200 units**, edit ≈ 50,
other ≈ 5. So a browse-then-download session is dominated by list/download costs. [DOCUMENTED]

- **Exceeded responses:** HTTP **403** (`userRateLimitExceeded` / `rateLimitExceeded`) or **429**
  (`rateLimitExceeded`). [DOCUMENTED]
- **`Retry-After`:** not consistently sent — use **truncated exponential backoff**
  `min((2^n) + random_ms, 64s)`. [DOCUMENTED]

```json
{
  "error": {
    "errors": [{ "domain": "usageLimits", "reason": "userRateLimitExceeded", "message": "User Rate Limit Exceeded" }],
    "code": 403,
    "message": "User Rate Limit Exceeded"
  }
}
```

### 8.2 Error Handling

**Standard Google error envelope:** [DOCUMENTED]

```json
{
  "error": {
    "code": 404,
    "message": "File not found: 1aBcD3eFgH.",
    "errors": [
      {
        "domain": "global",
        "reason": "notFound",
        "message": "File not found: 1aBcD3eFgH.",
        "locationType": "parameter",
        "location": "fileId"
      }
    ]
  }
}
```

**Error code reference:**

| HTTP    | reason (examples)                                | Meaning                              | Retryable? | Recovery                             |
| ------- | ------------------------------------------------ | ------------------------------------ | ---------- | ------------------------------------ |
| 400     | `badRequest`, `invalidQuery`, `invalidParameter` | Malformed `q`/params                 | No         | Fix query/params                     |
| 401     | `authError`, `invalidCredentials`                | Expired/invalid token                | Yes        | Refresh access token, retry          |
| 403     | `insufficientPermissions`                        | Scope/ACL too narrow                 | No         | Re-consent with needed scope         |
| 403     | `userRateLimitExceeded`, `rateLimitExceeded`     | Quota exhausted                      | Yes        | Backoff + retry                      |
| 403     | `fileNotDownloadable`                            | `alt=media` on a Google-native file  | No         | Use `files.export` instead           |
| 403     | `cannotDownloadAbusiveFile`                      | Malware-flagged                      | No         | `acknowledgeAbuse=true` (owner only) |
| 404     | `notFound`                                       | File/permission missing or no access | No         | Verify ID / access                   |
| 429     | `rateLimitExceeded`                              | Quota exhausted                      | Yes        | Backoff + retry                      |
| 500     | `internalError`                                  | Server error                         | Yes        | Retry w/ backoff                     |
| 502/503 | `backendError`                                   | Transient backend                    | Yes        | Retry w/ backoff                     |

> Always branch on the **`reason`** field, not just the HTTP code — 403 spans both permission and
> rate-limit cases with very different recovery paths. [DOCUMENTED]

### 8.3 Idempotency

- GET (all connector reads): naturally idempotent. [DOCUMENTED]
- Write methods support an `Idempotency-Key`-style header for uploads, but writes are out of scope here.

### 8.5 File Handling

- **Download (binary):** `GET /files/{id}?alt=media` → raw bytes. [DOCUMENTED]
- **Download (native):** `GET /files/{id}/export?mimeType=...` → converted bytes, **10 MB cap**;
  larger → `exportLinks` URLs. [DOCUMENTED]
- **Detect native vs binary:** `mimeType` starts with `application/vnd.google-apps.` → export path. [DOCUMENTED]
- **Max single file size:** 5 TB (download); connector should impose its own size guard before pulling
  bytes into the workspace. [DOCUMENTED]
- **Upload:** out of scope (read-only connector).

---

## Phase 9 — Platform Integration Assessment

### 9.1 Integration Path Decision

| Path                       | Fits? | Notes                                                                          |
| -------------------------- | ----- | ------------------------------------------------------------------------------ |
| Data Connector             | —     | Subsumed by Files variant                                                      |
| **Data Connector (Files)** | ✅    | Drive is a file-storage system — browse / search / download is the native fit  |
| Direct API Only            | ❌    | Drive is not action-oriented; users want to browse/read files                  |
| Hybrid                     | ➖    | Could add selective metadata/permission reads in chat, but core value is Files |

**Selected integration path:** **Data Connector (Files) + selective API.** [DECISION]

**Justification:** Google Drive is a document/file store with a browsable folder graph, full-text
search, and metadata — the textbook Files-Remote provider. It is wired exactly like Dropbox / OneDrive
/ Gmail: `surfaces: ['files', 'chat']`, `category: 'Cloud Storage'`, OAuth2 (`oauthPlatform: 'google'`),
and backed by a Python `OAuthProvider` subclass — **not** a spec-driven `connect_request` chat-only
connector. A backend provider already exists at
`lib/oauth-providers/oauth_providers/google_drive_provider.py` implementing `list_files`,
`download_file`, `get_file_metadata`, and `search_files`, with native-doc export handling. The
"selective API" part = the connector exposes Drive's _file_ surface (list/get/export/download) plus the
read-only _permissions_/_changes_ endpoints; Drive's write surface stays out of scope under the
`drive.readonly` scope.

### 9.2 Connector Requirements (Files path)

| Connector Method         | API Endpoint                                                             | Notes                                                            |
| ------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `list_files`             | `GET /files?q='<parent>' in parents&...`                                 | Folders = files with folder mimeType; shared drives as top-level |
| `download_file`          | `GET /files/{id}?alt=media` **or** `GET /files/{id}/export?mimeType=...` | Branch on native vs binary mimeType                              |
| `search_files`           | `GET /files?q=fullText contains '...'`                                   | DSL search; substring footgun on `contains`                      |
| `get_file_metadata`      | `GET /files/{id}?fields=...`                                             | Use `fields` to control payload                                  |
| `upload_file` (optional) | n/a                                                                      | Out of scope (read-only scope)                                   |
| `delete_file` (optional) | n/a                                                                      | Out of scope                                                     |

**Auth type for connector:** OAuth 2.0 (Google, authorization_code + refresh).
**Connector category:** cloud-storage.
**Caching appropriate:** yes — registry uses `CACHING_PRESETS.cloudStorage`. File listings/metadata
are cacheable; invalidate via `modifiedTime` / the `changes` feed.

### 9.3 Workspace Agent Capabilities

**CAN do (in scope):**

1. Browse the user's Drive folder graph and shared drives (folders + files).
2. Full-text and metadata search across the user's Drive.
3. Download binary files and export Google-native Docs/Sheets/Slides into the workspace (DOCX/XLSX/PPTX/PDF).
4. Read file metadata (owners, modified time, size, links) and ACL/permissions.

**CANNOT do (out of scope / blocked by read-only scope):**

1. Create, rename, move, trash, or delete files.
2. Modify or grant permissions / sharing.
3. Export native files larger than the 10 MB inline cap without falling back to `exportLinks`.

**Default parameters:**

| Parameter                        | Default                                                                       | Reason                                   |
| -------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------- |
| `pageSize`                       | 100                                                                           | API max; fewest round-trips              |
| `q` base clause                  | `trashed = false`                                                             | Hide trashed items by default            |
| `supportsAllDrives`              | true                                                                          | Don't silently hide shared-drive content |
| `includeItemsFromAllDrives`      | true                                                                          | Same                                     |
| `fields` (list)                  | `nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,webViewLink)` | Trim payload                             |
| export default (Doc/Sheet/Slide) | DOCX / XLSX / PPTX                                                            | Office formats the workspace can parse   |

### 9.4 SDK Assessment

| SDK                                     | Language | Quality   | Maintained? | Worth Using? | Notes                                                       |
| --------------------------------------- | -------- | --------- | ----------- | ------------ | ----------------------------------------------------------- |
| googleapis (`google-api-python-client`) | Python   | Excellent | Yes         | Optional     | First-party; current provider uses raw httpx, which is fine |
| googleapis                              | Node.js  | Excellent | Yes         | Optional     | First-party                                                 |

The existing provider calls the REST API directly (httpx) rather than via the SDK — acceptable; the SDK
is heavyweight and the REST surface is small and stable.

---

## Phase 10 — Readiness Checklist

- [x] Documentation located (Phase 1) — excellent, with Discovery Document
- [ ] **Phase 2 first successful _live_ call — NOT DONE (no test OAuth client exercised)** 🔬
- [x] Auth flow documented (URLs, grant, token lifecycle) — matches registry entry
- [x] Core entities catalogued (File, Permission, Change, Drive) with fields
- [x] Critical endpoints documented (list, get, alt=media, export, permissions, changes)
- [x] Query/filter DSL documented with worked examples
- [x] Pagination model documented with worked example
- [x] Event-driven capabilities assessed (push channels + changes feed)
- [x] Error envelope + quota-unit rate limits documented
- [x] Integration path selected + justified (Files connector — backend provider already exists)

**Overall investigation confidence:** **high** (excellent docs + existing working backend provider).

**Known gaps that will reduce output quality:**

1. No live OAuth round-trip captured — token response shape and exact 403 `reason` strings are
   `[DOCUMENTED]`, not `[CONFIRMED]`. 🔬 LIVE-CONFIRM with a real `drive.readonly` consent.
2. **Restricted-scope verification/CASA** status is per-client-project and must be checked before any
   production client enables Drive — this is an onboarding blocker, not a code gap. 🔬
3. `contains` substring/prefix semantics on `name`/`fullText` should be validated against real data to
   set correct user expectations for search.
4. Exact behaviour of `exportLinks` for >10 MB native files (auth header vs cookie) needs a live check.

### 10.3 Confidence Report

| Output Document              | Can Generate? | Confidence | Gaps                                               |
| ---------------------------- | ------------- | ---------- | -------------------------------------------------- |
| 01-llm-api-rules             | Yes           | High       | 403 reason strings not live-confirmed              |
| 01a-domain-model-reference   | Yes           | High       | Full File field list trimmed to connector-relevant |
| 01b-query-patterns           | Yes           | High       | `contains` semantics need live validation          |
| 01c-mutation-patterns        | N/A           | —          | Read-only connector — no mutations in scope        |
| 01d-event-and-error-handling | Yes           | High       | Webhook is header-only; no body to document        |
| 02-api-spec-investigation    | Yes           | High       | —                                                  |
| 03-connector-setup           | Yes           | High       | Backend provider already exists; document + verify |
