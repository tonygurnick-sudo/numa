---
api_name: 'Dropbox'
api_slug: 'dropbox'
vendor: 'Dropbox, Inc.'
website: 'https://www.dropbox.com'
investigation_started: '2026-05-29'
investigator: 'Claude Code (doc-based + provider-code investigation)'
investigation_status: 'complete'
documentation_quality: 'excellent'
api_types: [REST]
overall_confidence: 'high'
researcher: 'Claude Code (doc-based + provider-code investigation)'
date_researched: '2026-05-29'
integration_path: 'Data Connector (Files) + selective API'
auth_type: 'oauth2'
blockers: []
---

# Dropbox — API Investigation Questionnaire

> **Confidence markers:** `[CONFIRMED]` = verified against a live API call · `[DOCUMENTED]` =
> stated in official Dropbox docs · `[INFERRED]` = deduced from conventions/SDKs/partial docs ·
> `[UNKNOWN]` = not yet established.
>
> ⚠️ **This is a documentation + code investigation.** No live Dropbox call was made at research
> time (no app key/token available), so **Phase 2's "first successful call" gate is NOT formally
> satisfied** — every auth/format claim below is `[DOCUMENTED]` or `[INFERRED]`, never
> `[CONFIRMED]` from a live response.
>
> However, this connector is **unusual**: a production backend provider already exists at
> `lib/oauth-providers/oauth_providers/dropbox_provider.py`. Items below tagged
> **🛠️ PROVIDER-CODE** are taken directly from that working implementation — they reflect the
> exact endpoints, payloads, headers, and response-field extraction the platform already runs in
> production for this connector. That is stronger than docs-only, but still not a captured live
> HTTP transcript, so it is recorded as `[DOCUMENTED]`/`[INFERRED]` rather than `[CONFIRMED]`.
> A developer with an app key should still run the Phase 2 smoke test. Items needing a captured
> live response are tagged **🔬 SANDBOX-CONFIRM**.

---

## Phase 1 — Documentation Discovery

### 1.1 Primary Documentation [REQUIRED]

| Item                  | Value                                                                                         | Confidence   |
| --------------------- | --------------------------------------------------------------------------------------------- | ------------ |
| Vendor                | Dropbox, Inc. (consumer + business cloud file storage)                                        | [DOCUMENTED] |
| Official API docs     | https://www.dropbox.com/developers/documentation/http/documentation                           | [DOCUMENTED] |
| Developer portal      | https://developers.dropbox.com/                                                               | [DOCUMENTED] |
| HTTP endpoint catalog | https://www.dropbox.com/developers/documentation/http/documentation (User/Business endpoints) | [DOCUMENTED] |
| OAuth guide           | https://developers.dropbox.com/oauth-guide                                                    | [DOCUMENTED] |
| Error handling guide  | https://developers.dropbox.com/error-handling-guide                                           | [DOCUMENTED] |
| Detecting changes     | https://developers.dropbox.com/detecting-changes-guide                                        | [DOCUMENTED] |
| App Console (mgmt UI) | https://www.dropbox.com/developers/apps                                                       | [DOCUMENTED] |
| Changelog             | https://www.dropbox.com/developers/reference/changelog                                        | [DOCUMENTED] |
| Status page           | https://status.dropbox.com/                                                                   | [DOCUMENTED] |

### 1.2 Supplementary Sources [IMPORTANT]

| Item                  | Value                                                                                             | Confidence   |
| --------------------- | ------------------------------------------------------------------------------------------------- | ------------ |
| OpenAPI/Swagger spec  | Dropbox publishes a Stone-based spec (`dropbox/dropbox-api-spec` on GitHub); no public Swagger UI | [DOCUMENTED] |
| Python SDK            | https://github.com/dropbox/dropbox-sdk-python (`dropbox` on PyPI)                                 | [DOCUMENTED] |
| Node SDK              | https://github.com/dropbox/dropbox-sdk-js (`dropbox` on npm)                                      | [DOCUMENTED] |
| Java SDK              | https://github.com/dropbox/dropbox-sdk-java                                                       | [DOCUMENTED] |
| Python SDK reference  | https://dropbox-sdk-python.readthedocs.io/en/latest/api/dropbox.html                              | [DOCUMENTED] |
| Engineering blog      | https://dropbox.tech/ (e.g. "Search Files Using the Dropbox API")                                 | [DOCUMENTED] |
| Community forum       | https://www.dropboxforum.com/ (Developer & API board)                                             | [DOCUMENTED] |
| Stone schema language | https://github.com/dropbox/stone (codegen source the docs are generated from)                     | [DOCUMENTED] |

> The HTTP reference page is JS-rendered (single-page app) — `WebFetch` cannot scrape endpoint
> bodies from it. The **SDK reference docs and the Stone spec are the reliable machine-readable
> sources** for field-level detail.

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                  |
| ------------------------- | ------ | ---------------------------------------------------------------------- |
| Authentication            | 5      | Dedicated OAuth guide; PKCE, offline tokens, refresh all covered       |
| Endpoint reference        | 5      | Every endpoint documented with arg/result schemas (Stone-derived)      |
| Request/response examples | 4      | Examples present but page is SPA-rendered; SDKs fill gaps              |
| Error documentation       | 4      | Error-handling guide + per-endpoint error unions; `.tag` format        |
| Rate limit documentation  | 3      | 429 + `Retry-After` documented; exact per-app thresholds not published |
| Pagination documentation  | 5      | Cursor + `has_more` model clearly documented                           |
| Webhook documentation     | 4      | Webhooks documented (HMAC-SHA256, challenge verification)              |
| SDKs / code examples      | 5      | First-party SDKs in 5+ languages, well maintained                      |
| Changelog / versioning    | 5      | Versioned API (v2), public changelog                                   |

**Overall documentation quality:** excellent

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation
- [x] Found Stone spec (machine-readable, in lieu of OpenAPI/Swagger)
- [x] Identified authentication method (OAuth 2.0, offline refresh tokens)
- [x] Found working example (the production `dropbox_provider.py` backend) 🛠️
- [x] Identified rate limit information (429 + `Retry-After`)
- [x] Identified pagination approach (cursor + `has_more`)
- [x] Checked for webhook/event support (supported, but not used by this connector)
- [x] Checked for official SDKs (Python, Node, Java, Swift, Obj-C, .NET)

---

## Phase 2 — Authentication (HARD GATE — not formally satisfied; see warning above)

### 2.1 / 2.3 Auth Model [REQUIRED]

| Item                      | Value                                                                                                                                                       | Confidence                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Auth standard             | OAuth 2.0, Authorization Code grant                                                                                                                         | [DOCUMENTED]                      |
| Auth location             | HTTP header `Authorization: Bearer {access_token}` on every API call                                                                                        | [DOCUMENTED] 🛠️                   |
| Authorize URL             | `https://www.dropbox.com/oauth2/authorize`                                                                                                                  | [DOCUMENTED] (matches registry)   |
| Token URL                 | `https://api.dropboxapi.com/oauth2/token`                                                                                                                   | [DOCUMENTED] (matches registry)   |
| Revocation URL            | `https://api.dropboxapi.com/2/auth/token/revoke`                                                                                                            | [DOCUMENTED]                      |
| Client ID / secret naming | "App key" = client_id, "App secret" = client_secret (from App Console)                                                                                      | [DOCUMENTED]                      |
| Offline / refresh tokens  | `token_access_type=offline` on the authorize URL → token response includes a `refresh_token`                                                                | [DOCUMENTED] (registry sets this) |
| Access token lifetime     | Short-lived, ~4 hours (`expires_in` ≈ 14400s) when `token_access_type=offline`                                                                              | [DOCUMENTED]/[INFERRED] 🔬        |
| Refresh behavior          | `POST /oauth2/token` with `grant_type=refresh_token&refresh_token=…` → new short-lived token; refresh token is long-lived (does **not** rotate per refresh) | [DOCUMENTED]                      |
| PKCE                      | Supported (recommended for public clients); not required for confidential clients with secret                                                               | [DOCUMENTED]                      |
| State parameter           | Supported/recommended (CSRF); platform's connect flow supplies it                                                                                           | [INFERRED]                        |
| Scope model               | Granular scopes, space-separated, on the authorize request                                                                                                  | [DOCUMENTED]                      |

**Registry config (source of truth — `connectorRegistry.ts` id `dropbox`):** 🛠️

```jsonc
{
  "authType": "oauth2",
  "authUrl": "https://www.dropbox.com/oauth2/authorize",
  "tokenUrl": "https://api.dropboxapi.com/oauth2/token",
  "scopes": "files.metadata.read files.content.read",
  "extraAuthParams": { "token_access_type": "offline" },
  "discoveryUrl": "https://www.dropbox.com/.well-known/openid-configuration",
}
```

### 2.3a Scopes [REQUIRED]

| Scope                 | Purpose                                                | Required for this connector? | Confidence   |
| --------------------- | ------------------------------------------------------ | ---------------------------- | ------------ |
| `files.metadata.read` | List folders, read file/folder metadata, search        | **Yes** (in registry)        | [DOCUMENTED] |
| `files.content.read`  | Download file content (`/2/files/download`)            | **Yes** (in registry)        | [DOCUMENTED] |
| `account_info.read`   | Read account profile (`/2/users/get_current_account`)  | No — not requested           | [DOCUMENTED] |
| `files.content.write` | Upload/move/delete files                               | No — connector is read-only  | [DOCUMENTED] |
| `sharing.read`        | Read shared-link/permission info (for `web_view_link`) | No — would extend connector  | [DOCUMENTED] |

> The connector requests only the two **read** scopes — consistent with its read-only Files-Remote
> role. Write scopes are deliberately omitted. Note `get_metadata`'s `permissions` and a file's
> `web_view_link` are returned empty in the provider because `sharing.read` is not requested. 🛠️

### 2.4 First Successful Call [REQUIRED] — CRITICAL GATE

Recommended smoke test (read-only, minimal scope):

```http
POST /2/files/list_folder HTTP/1.1
Host: api.dropboxapi.com
Authorization: Bearer <access_token>
Content-Type: application/json

{ "path": "", "recursive": false, "limit": 10 }
```

Expected success (`200`, shape per provider extraction): 🛠️

```json
{
  "entries": [
    {
      ".tag": "folder",
      "name": "Project Alpha",
      "id": "id:a4ayc_80_OEAAAAAAAAAYa",
      "path_lower": "/project alpha",
      "path_display": "/Project Alpha"
    },
    {
      ".tag": "file",
      "name": "Q1 Report.pdf",
      "id": "id:a4ayc_80_OEAAAAAAAAAYb",
      "path_lower": "/q1 report.pdf",
      "path_display": "/Q1 Report.pdf",
      "client_modified": "2026-01-15T09:30:00Z",
      "server_modified": "2026-01-15T09:31:12Z",
      "rev": "0153e6a1f2c0b00000002a1c2f3",
      "size": 482113,
      "content_hash": "599..."
    }
  ],
  "cursor": "AAH4f99T0taNz...",
  "has_more": false
}
```

- **Expected status code:** `200` (Dropbox returns `200` even for many app-level errors only on the success path; routing errors use `409`). [DOCUMENTED]
- **Response headers of note:** `X-Dropbox-Request-Id` (support correlation). [DOCUMENTED]
- **Gotcha:** the **root folder is the empty string `""`**, NOT `"/"`. Passing `"/"` is an error. The provider maps `folder_id == "root"` or `None` → `""`. 🛠️ [DOCUMENTED]
- **Gotcha:** all calls are **`POST`** with a JSON body, even reads. [DOCUMENTED]

- [ ] **GATE CHECK: live first call NOT captured (no app key at research time)** 🔬

---

## Phase 3 — Domain Model & Behavior

### 3.1 Core Entities [REQUIRED]

Dropbox is a flat-namespace **path-addressed** file store. There are effectively two entity
types plus search-match wrappers.

#### Entity: File (`FileMetadata`, `.tag = "file"`)

- **Resource:** addressed by `path` (string) or by stable `id` (`id:...`)
- **CRUD:** Read (list/get/download) — connector is read-only

| Field             | Type     | Description                                                  | Confidence      |
| ----------------- | -------- | ------------------------------------------------------------ | --------------- |
| `.tag`            | string   | Always `"file"`                                              | [DOCUMENTED]    |
| `name`            | string   | File name (last path segment)                                | [DOCUMENTED] 🛠️ |
| `id`              | string   | Stable file id, `id:...` (survives rename/move)              | [DOCUMENTED]    |
| `path_lower`      | string   | Lower-cased full path                                        | [DOCUMENTED] 🛠️ |
| `path_display`    | string   | Display-cased full path (used as `file_id` in connector)     | [DOCUMENTED] 🛠️ |
| `client_modified` | datetime | Client-set mtime (ISO 8601 `...Z`) → connector `created_at`  | [DOCUMENTED] 🛠️ |
| `server_modified` | datetime | Server-set mtime (ISO 8601 `...Z`) → connector `modified_at` | [DOCUMENTED] 🛠️ |
| `rev`             | string   | Revision id (used as connector `version`)                    | [DOCUMENTED] 🛠️ |
| `size`            | int      | Bytes                                                        | [DOCUMENTED] 🛠️ |
| `content_hash`    | string   | 64-char Dropbox content hash (used as connector `checksum`)  | [DOCUMENTED] 🛠️ |
| `media_info`      | object   | Photo/video EXIF — only if `include_media_info=true`         | [DOCUMENTED]    |
| `is_downloadable` | bool     | False for some Paper/cloud-native docs                       | [DOCUMENTED]    |

#### Entity: Folder (`FolderMetadata`, `.tag = "folder"`)

| Field                     | Type   | Description                        | Confidence      |
| ------------------------- | ------ | ---------------------------------- | --------------- |
| `.tag`                    | string | Always `"folder"`                  | [DOCUMENTED]    |
| `name`                    | string | Folder name                        | [DOCUMENTED] 🛠️ |
| `id`                      | string | Stable folder id `id:...`          | [DOCUMENTED]    |
| `path_lower`              | string | Lower-cased full path              | [DOCUMENTED] 🛠️ |
| `path_display`            | string | Display path (used as `folder_id`) | [DOCUMENTED] 🛠️ |
| `parent_shared_folder_id` | string | Set when inside a shared folder    | [DOCUMENTED]    |

> A third `.tag = "deleted"` (`DeletedMetadata`) appears only when `include_deleted=true`
> (connector sets it `false`). [DOCUMENTED]

#### Wrapper: SearchMatchV2 (from `search_v2`)

Nested shape (provider walks it as `match.metadata.metadata`): 🛠️

```json
{ "matches": [ { "metadata": { ".tag": "metadata", "metadata": { ".tag": "file", "name": "...", "path_display": "...", ... } } } ] }
```

### 3.2 Entity Relationships [IMPORTANT]

```
┌──────────┐  contains (path prefix)  ┌──────────┐
│  Folder  │─────────────────────────>│  File    │
└──────────┘   recursive=true         └──────────┘
      │  self-nesting (path hierarchy)
      ▼
┌──────────┐
│  Folder  │
└──────────┘
```

- There are **no IDs-as-foreign-keys**; hierarchy is expressed purely by the **path string**
  (`parent = path_display minus last segment`). The provider derives parents by string-splitting
  `path_display`. 🛠️ [DOCUMENTED]
- `id:...` values are stable across renames/moves; **paths are not**. The connector currently uses
  `path_display` as its `file_id`/`folder_id` (simpler, human-readable, but path-fragile). 🛠️

### 3.3 State Machines [IMPORTANT]

Files have no rich lifecycle relevant to a read-only connector. The only state distinction is
`active` vs `deleted` (surfaced via `file_status` in search and `include_deleted` in listing).
Not a state machine the connector drives. [DOCUMENTED]

### 3.4 Business Rules [IMPORTANT]

- **Root = `""`** (empty string), never `"/"`. 🛠️ [DOCUMENTED]
- Paths are **case-insensitive** but case-preserving (`path_lower` vs `path_display`). [DOCUMENTED]
- `list_folder` returns the **direct children only** unless `recursive=true`. [DOCUMENTED] 🛠️
- Some files (Dropbox Paper, certain cloud docs) are **non-downloadable**; `download` returns a
  `409` `unsupported_file` error. The connector should skip/flag these. [DOCUMENTED]
- A folder's `has_subfolders`/`no_of_subfolders` is **not** returned by `list_folder` — the
  provider hard-codes `has_subfolders=False` rather than making a second call. 🛠️ [DOCUMENTED]

### 3.5 Field Format Reference [IMPORTANT]

| Format       | Pattern                              | Example                        | Notes                                |
| ------------ | ------------------------------------ | ------------------------------ | ------------------------------------ |
| DateTime     | ISO 8601 UTC, `YYYY-MM-DDTHH:MM:SSZ` | `2026-01-15T09:31:12Z`         | `client_modified`, `server_modified` |
| Path id      | `/Display/Cased/Path.ext`            | `/Project Alpha/Q1 Report.pdf` | Used as connector file/folder id 🛠️  |
| Stable id    | `id:` + opaque base64-ish            | `id:a4ayc_80_OEAAAAAAAAAYa`    | Survives rename/move                 |
| Revision     | hex string                           | `0153e6a1f2c0b00000002a1c2f3`  | `rev`                                |
| Content hash | 64-char hex (Dropbox block-hash)     | `599...`                       | `content_hash` (not a plain SHA-256) |
| Cursor       | opaque base64 string                 | `AAH4f99T0taNz...`             | Pagination + delta token             |

### 3.6 Enum Value Reference [NICE-TO-HAVE]

| Entity        | Field               | Allowed Values                                                                                                    | Default     | Notes                     |
| ------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------- |
| Metadata      | `.tag`              | `file` · `folder` · `deleted`                                                                                     | —           | union discriminator       |
| SearchOptions | `file_status`       | `active` · `deleted`                                                                                              | `active`    | provider sets `active` 🛠️ |
| SearchOptions | `order_by`          | `relevance` · `last_modified_time`                                                                                | `relevance` | not set by provider       |
| SearchOptions | `file_categories[]` | `image` · `document` · `pdf` · `spreadsheet` · `presentation` · `audio` · `video` · `folder` · `paper` · `others` | —           | optional filter           |

---

## Phase 4 — Endpoint Catalog

> **Two hosts:** JSON-RPC metadata calls go to `api.dropboxapi.com`; binary content
> upload/download goes to `content.dropboxapi.com`. Provider constants: 🛠️
> `BASE_URL = https://api.dropboxapi.com/2`, `CONTENT_URL = https://content.dropboxapi.com/2`.

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: POST /2/files/list_folder 🛠️

- **Purpose:** List direct children (files + folders) of a path.
- **Auth:** yes · **Scope:** `files.metadata.read` · **Idempotent:** yes (read)
- **Content-Type:** `application/json`

**Request body (provider defaults):**

```json
{
  "path": "",
  "recursive": false,
  "include_media_info": false,
  "include_deleted": false,
  "include_has_explicit_shared_members": false,
  "include_mounted_folders": true,
  "limit": 100
}
```

**Success response (200):**

```json
{
  "entries": [ { ".tag": "folder", "name": "Reports", "path_display": "/Reports", ... },
               { ".tag": "file",   "name": "memo.docx", "path_display": "/memo.docx",
                 "size": 23145, "server_modified": "2026-05-01T10:00:00Z",
                 "rev": "015...", "content_hash": "ab..." } ],
  "cursor": "AAH4f99T0taNz...",
  "has_more": true
}
```

| Param   | Type | Required | Default | Notes                                                      |
| ------- | ---- | -------- | ------- | ---------------------------------------------------------- |
| `path`  | str  | yes      | —       | `""` for root; not `"/"`                                   |
| `limit` | int  | no       | (none)  | provider sends `min(page_size, 2000)` 🛠️; Dropbox max 2000 |

#### Endpoint: POST /2/files/list_folder/continue 🛠️

- **Purpose:** Fetch the next page using a cursor.
- **Request:** `{ "cursor": "AAH4f99T0taNz..." }`
- **Response:** same shape as `list_folder` (`entries`, `cursor`, `has_more`).

#### Endpoint: POST /2/files/download (host: content.dropboxapi.com) 🛠️

- **Purpose:** Download raw file bytes.
- **Auth:** yes · **Scope:** `files.content.read`
- **No JSON body.** The path goes in a **header**:

```http
POST /2/files/download HTTP/1.1
Host: content.dropboxapi.com
Authorization: Bearer <token>
Dropbox-API-Arg: {"path":"/Project Alpha/Q1 Report.pdf"}
```

- **Response:** raw binary body; metadata JSON echoed in the **`Dropbox-API-Result`** response
  header. Provider returns `response.content` (bytes). 🛠️ [DOCUMENTED]
- **Gotcha:** `Dropbox-API-Arg` must be **HTTP-header-safe JSON** (ASCII; non-ASCII must be
  `\uXXXX`-escaped). [DOCUMENTED]

#### Endpoint: POST /2/files/get_metadata 🛠️

- **Request:** `{ "path": "<id-or-path>", "include_media_info": false, "include_deleted": false, "include_has_explicit_shared_members": false }`
- **Response:** a single `FileMetadata`/`FolderMetadata` object (fields per Phase 3.1).

#### Endpoint: POST /2/files/search_v2 🛠️

- **Purpose:** Search file/folder names (and optionally content) across the account.
- **Auth:** yes · **Scope:** `files.metadata.read`

**Request body (provider):**

```json
{
  "query": "quarterly report",
  "options": {
    "path": "",
    "max_results": 100,
    "file_status": "active",
    "filename_only": false
  }
}
```

**Success response (200):**

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
  ],
  "has_more": false,
  "cursor": "AAH..."
}
```

| Param                   | Type | Required | Default  | Notes                                              |
| ----------------------- | ---- | -------- | -------- | -------------------------------------------------- |
| `query`                 | str  | yes      | —        | search terms                                       |
| `options.path`          | str  | no       | `""`     | scope to a subtree                                 |
| `options.max_results`   | int  | no       | 100      | provider sends `min(page_size, 1000)` 🛠️; max 1000 |
| `options.file_status`   | enum | no       | `active` | `active` \| `deleted`                              |
| `options.filename_only` | bool | no       | false    | true = name match only                             |

#### Endpoint: POST /2/files/search/continue_v2 🛠️

- **Request:** `{ "cursor": "AAH..." }` → next page of matches.

### 4.2 Full Endpoint Index [IMPORTANT]

| Method | Path (host)                                         | Purpose                         | Auth | Pagination        | Used by connector              |
| ------ | --------------------------------------------------- | ------------------------------- | ---- | ----------------- | ------------------------------ |
| POST   | `/2/files/list_folder` (api)                        | List children                   | yes  | cursor/`has_more` | ✅ 🛠️                          |
| POST   | `/2/files/list_folder/continue` (api)               | Next page / delta               | yes  | cursor            | ✅ 🛠️                          |
| POST   | `/2/files/list_folder/get_latest_cursor` (api)      | Cursor w/o entries (delta seed) | yes  | —                 | candidate (sync)               |
| POST   | `/2/files/download` (content)                       | Download bytes                  | yes  | —                 | ✅ 🛠️                          |
| POST   | `/2/files/get_metadata` (api)                       | Single item metadata            | yes  | —                 | ✅ 🛠️                          |
| POST   | `/2/files/search_v2` (api)                          | Search                          | yes  | cursor/`has_more` | ✅ 🛠️                          |
| POST   | `/2/files/search/continue_v2` (api)                 | Search next page                | yes  | cursor            | ✅ 🛠️                          |
| POST   | `/2/files/get_temporary_link` (api)                 | Short-lived direct URL          | yes  | —                 | candidate (web_view_link)      |
| POST   | `/2/sharing/create_shared_link_with_settings` (api) | Shareable link                  | yes  | —                 | no (needs `sharing.write`)     |
| POST   | `/2/users/get_current_account` (api)                | Account profile                 | yes  | —                 | no (needs `account_info.read`) |
| POST   | `/2/oauth2/token/revoke` (api)                      | Revoke token                    | yes  | —                 | candidate (disconnect)         |

---

## Phase 5 — Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                      | Supported?   | Syntax / Notes                                                    | Confidence      |
| ------------------------------- | ------------ | ----------------------------------------------------------------- | --------------- |
| Filter by field value           | Partial      | via `search_v2` filters (file category, status)                   | [DOCUMENTED]    |
| Filter by date range            | Partial      | `search_v2` does not natively range-filter dates; client-side     | [INFERRED] 🔬   |
| Full-text search                | Yes          | `search_v2` indexes file **content** for many types               | [DOCUMENTED]    |
| Filename-only search            | Yes          | `options.filename_only=true`                                      | [DOCUMENTED] 🛠️ |
| Sort by field                   | Yes (search) | `options.order_by` = `relevance` \| `last_modified_time`          | [DOCUMENTED]    |
| Field selection / sparse fields | No           | Fixed metadata shape                                              | [DOCUMENTED]    |
| Include related records         | Partial      | `include_media_info`, `include_has_explicit_shared_members` flags | [DOCUMENTED]    |
| Aggregate / count               | No           | No count endpoint; enumerate                                      | [DOCUMENTED]    |
| Logical operators (AND/OR)      | Limited      | search query is keyword-based, not boolean DSL                    | [INFERRED]      |
| Recursive listing               | Yes          | `recursive=true` on `list_folder`                                 | [DOCUMENTED] 🛠️ |

### 5.2 Filter / Search Syntax [REQUIRED]

- **Listing** has no field filters — it returns a folder's children; scope by `path` and
  `recursive`. 🛠️
- **Search** is the query surface: `{ "query": "...", "options": { "path": "/scope", "file_status": "active", "filename_only": false, "max_results": N } }`. 🛠️

### 5.5 Search Capabilities [IMPORTANT]

- **Endpoint:** `/2/files/search_v2` (account-wide or path-scoped). [DOCUMENTED] 🛠️
- **Searchable:** filenames always; **content** for indexed file types (docs, PDFs, text). [DOCUMENTED]
- **Index lag:** newly added files may take time to appear in search (eventual consistency). [DOCUMENTED]
- **Min query length:** not strictly documented; very short/empty queries may error. [UNKNOWN] 🔬

### 5.6 Common Query Patterns [REQUIRED]

**Pattern 1 — Browse a folder:** `POST /2/files/list_folder { "path": "/Reports", "recursive": false }`
**Pattern 2 — Walk an entire subtree:** `list_folder { "path": "/Reports", "recursive": true }` then loop `list_folder/continue` until `has_more=false`.
**Pattern 3 — Find by name across the account:** `search_v2 { "query": "invoice 2026", "options": { "filename_only": true } }`.
**Pattern 4 — Full-text content search in a subtree:** `search_v2 { "query": "termination clause", "options": { "path": "/Contracts" } }`.

---

## Phase 6 — Pagination & Bulk

### 6.1 Pagination Model [REQUIRED]

| Item                | Value                                                                  | Confidence                 |
| ------------------- | ---------------------------------------------------------------------- | -------------------------- |
| Pagination type     | **Cursor** (opaque)                                                    | [DOCUMENTED] 🛠️            |
| First page param    | `limit` (listing) / `options.max_results` (search)                     | [DOCUMENTED] 🛠️            |
| Next page param     | `cursor` → `/list_folder/continue` or `/search/continue_v2`            | [DOCUMENTED] 🛠️            |
| Default page size   | Listing: unbounded if `limit` omitted; provider sends 100. Search: 100 | [DOCUMENTED]/[INFERRED] 🛠️ |
| Max page size       | Listing: **2000** · Search: **1000**                                   | [DOCUMENTED] 🛠️            |
| Total count         | **Not provided** — enumerate to count                                  | [DOCUMENTED]               |
| Last-page detection | `has_more == false` (then `cursor` becomes a delta token)              | [DOCUMENTED] 🛠️            |

**Response structure:**

```json
{ "entries": [], "cursor": "AAH...", "has_more": true }
```

### 6.2 Pagination Worked Example [REQUIRED] 🛠️

```
Page 1: POST /2/files/list_folder            { "path": "/Reports", "limit": 100 }
        → { entries:[...], cursor:"C1", has_more:true }
Page 2: POST /2/files/list_folder/continue   { "cursor": "C1" }
        → { entries:[...], cursor:"C2", has_more:true }
Page N: POST /2/files/list_folder/continue   { "cursor": "C(N-1)" }
        → { entries:[...], cursor:"Cn", has_more:false }   ← stop
```

> **Bonus — delta sync:** after `has_more=false`, the final `cursor` can be reused later against
> `/list_folder/continue` to fetch only _changes_ since then (this is Dropbox's "detecting
> changes" model). Useful for incremental KB re-sync. [DOCUMENTED]

### 6.3 Bulk Operations [IMPORTANT]

| Operation              | Endpoint                               | Notes                                                |
| ---------------------- | -------------------------------------- | ---------------------------------------------------- |
| Bulk read (list)       | `list_folder` (recursive)              | Effectively bulk-read of a subtree                   |
| Batch download         | `/2/files/download_zip` (folder → zip) | Folder ≤ 20 GB / 10k files; not used 🔬              |
| Bulk create/update/del | `/2/files/*_batch` (move/copy/delete)  | Async job + `*/check` poll; out of scope (read-only) |

**Partial failure:** batch endpoints return per-item `.tag` `success`/`failure`. Not used by this
read-only connector. [DOCUMENTED]

---

## Phase 7 — Real-Time & Events

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism            | Supported? | Notes                                                    |
| -------------------- | ---------- | -------------------------------------------------------- |
| Webhooks             | Yes        | App-level webhook URL; notifies which users have changes |
| WebSocket            | No         | —                                                        |
| Server-Sent Events   | No         | —                                                        |
| Long polling         | Yes        | `/2/files/list_folder/longpoll` on a cursor              |
| Change feeds / delta | Yes        | cursor replay via `list_folder/continue`                 |

### 7.2 Webhooks [IMPORTANT]

- **Registration:** static webhook URL set in the **App Console** (not per-call API). [DOCUMENTED]
- **Verification:** initial GET with `?challenge=…` must be echoed back verbatim. [DOCUMENTED]
- **Security:** each POST carries `X-Dropbox-Signature` = **HMAC-SHA256** of the raw body keyed by
  the **app secret**. [DOCUMENTED]
- **Payload:** thin — `{ "list_folder": { "accounts": ["dbid:..."] } }`; the app must then call
  `list_folder/continue` per account to learn _what_ changed. [DOCUMENTED]
- **Not used by this connector** today — listing/search are pull-based. Webhooks would be the path
  if Numa later wants push-driven KB re-index. [INFERRED]

### 7.4 Polling Fallback [IMPORTANT]

- **Recommended:** cursor delta via `list_folder/continue`, optionally gated by
  `/2/files/list_folder/longpoll` (returns when changes exist, up to a configurable timeout). [DOCUMENTED]
- **Change-detection fields:** `server_modified`, `rev`, `content_hash`. [DOCUMENTED] 🛠️

---

## Phase 8 — Operational Concerns

### 8.1 Rate Limits [REQUIRED]

| Scope        | Limit                               | Window  | Notes                                            | Confidence   |
| ------------ | ----------------------------------- | ------- | ------------------------------------------------ | ------------ |
| Per-app/user | Not publicly fixed; dynamic         | rolling | `429` when exceeded; namespace/concurrency based | [DOCUMENTED] |
| Concurrency  | Excessive concurrent writes → `429` | —       | Mostly affects writes (n/a here, read-only)      | [DOCUMENTED] |

- **429 behavior:** response includes a **`Retry-After`** header (seconds) and/or a body
  `{"error":{".tag":"too_many_requests"},"error_summary":"too_many_requests/..","retry_after":N}`.
  Honor `Retry-After` then exponential backoff. [DOCUMENTED]
- The provider already routes all calls through `_make_request_with_retry`, which is the place that
  must respect `Retry-After`. 🛠️ **🔬 SANDBOX-CONFIRM:** exact 429 body `.tag`/`retry_after` shape.

| Header                 | Meaning                         |
| ---------------------- | ------------------------------- |
| `Retry-After`          | Seconds to wait before retrying |
| `X-Dropbox-Request-Id` | Support correlation id          |

### 8.2 Error Handling [REQUIRED]

**Status code semantics (Dropbox is non-standard — read carefully):** [DOCUMENTED]

| HTTP Status | Meaning                                                                                                 | Retryable?    | Recovery                              |
| ----------- | ------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------- |
| 200         | Success                                                                                                 | —             | —                                     |
| 400         | Malformed request / bad input syntax (not JSON-routed error)                                            | No            | Fix request                           |
| 401         | Invalid/expired/insufficient-scope token                                                                | After refresh | Refresh access token, retry once      |
| 403         | Account/team lacks access (e.g. feature/permission)                                                     | Maybe         | Needs account-side action             |
| 409         | **Endpoint-specific app error** (e.g. `path/not_found`, `unsupported_file`) — body has the `.tag` union | Depends       | Inspect `.tag`; usually not retryable |
| 429         | Rate limited                                                                                            | Yes           | Honor `Retry-After`, backoff          |
| 5xx         | Server error                                                                                            | Yes           | Exponential backoff                   |

> **Critical quirk:** a successful HTTP `200` can still wrap nothing, while **expected
> application errors come back as HTTP `409`** with a typed error union in the body — NOT `404`/
> `422`. Code must branch on the `.tag`, not just the status. [DOCUMENTED]

**Error body format:**

```json
{
  "error_summary": "path/not_found/...",
  "error": {
    ".tag": "path",
    "path": { ".tag": "not_found" }
  }
}
```

- **`error_summary`** is a human/string-matchable summary; **prefix-matching is officially
  acceptable** (e.g. startswith `"path/not_found"`). [DOCUMENTED]
- **`error`** is a nested tagged union; walk `.tag` for programmatic handling. [DOCUMENTED]

**Common `409` error tags relevant to this connector:**

| `error_summary` prefix         | Meaning                             | Recovery                   |
| ------------------------------ | ----------------------------------- | -------------------------- |
| `path/not_found`               | Path/id doesn't exist               | Re-list parent; path stale |
| `path/not_file` / `not_folder` | Wrong type for the operation        | Use correct op             |
| `path/restricted_content`      | Content blocked (DMCA/policy)       | Skip                       |
| `unsupported_file`             | Non-downloadable (e.g. Paper)       | Skip / use export endpoint |
| `too_many_requests`            | Rate limited (also surfaces as 429) | Backoff                    |

### 8.3 Idempotency [IMPORTANT]

- All connector operations are **reads → naturally idempotent**. No idempotency-key header needed. 🛠️ [INFERRED]
- (Write batch endpoints use async job ids, but the connector does not write.) [DOCUMENTED]

### 8.5 File Handling [IMPORTANT]

| Item                | Value                                                                                            | Confidence      |
| ------------------- | ------------------------------------------------------------------------------------------------ | --------------- |
| Download endpoint   | `POST https://content.dropboxapi.com/2/files/download`                                           | [DOCUMENTED] 🛠️ |
| Download method     | Path in **`Dropbox-API-Arg`** header; raw bytes in body; metadata in `Dropbox-API-Result` header | [DOCUMENTED] 🛠️ |
| Max file size       | No hard download cap for single file (API upload session cap is 350 GB); large downloads stream  | [DOCUMENTED]    |
| Non-downloadable    | Paper/cloud-native docs → `409 unsupported_file`; use `/2/files/export` if needed                | [DOCUMENTED]    |
| `max_download_size` | Provider accepts a param but does not currently enforce it client-side                           | [INFERRED] 🛠️   |
| Upload (n/a)        | `content.dropboxapi.com/2/files/upload` — out of scope (read-only connector)                     | [DOCUMENTED]    |

### 8.6 Concurrency & Consistency [NICE-TO-HAVE]

- **Optimistic concurrency** via `rev` (writes can require an expected `rev`). [DOCUMENTED]
- **Eventual consistency** for search indexing and for very large recursive listings. [DOCUMENTED]

---

## Phase 9 — Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

| Path                       | Fits? | Notes                                                          |
| -------------------------- | ----- | -------------------------------------------------------------- |
| Data Connector             | ◑     | It is file content, but Dropbox is _primarily_ a file store    |
| **Data Connector (Files)** | ✅    | **Selected** — pure cloud file storage; browse/search/download |
| Direct API Only            | ✗     | Would waste the natural Files-Remote fit                       |
| Hybrid                     | ◑     | Read-only today; could add write/share later                   |

**Selected integration path: Data Connector (Files) + selective API.** [DECISION]

**Justification:** Dropbox is a canonical cloud file-storage product whose primary surface is
**browse / search / download** — exactly the Files-Remote connector shape. The registry already
marks it `surfaces: ['files', 'chat']` and `category: 'Cloud Storage'`, and a **production backend
provider already exists** (`lib/oauth-providers/oauth_providers/dropbox_provider.py`) implementing
the four standard connector methods. This mirrors Google Drive / OneDrive / Box — a
`lib/oauth-providers/` provider class surfaced in **Files > Remote**, NOT a spec-driven
`ext-api-doc`-only chat connector (that pattern is for action-oriented APIs like NetSuite/simPRO).
This `ext-api-doc/dropbox/` package therefore documents the API for reference/agent-context; the
_executable_ integration lives in the provider class. 🛠️

### 9.2 Connector Requirements [IMPORTANT] — already implemented 🛠️

| Connector Method    | API Endpoint                                   | Status                             |
| ------------------- | ---------------------------------------------- | ---------------------------------- |
| `list_files`        | `/2/files/list_folder` (+ `/continue`)         | ✅ implemented                     |
| `download_file`     | `/2/files/download` (content host, header arg) | ✅ implemented                     |
| `search_files`      | `/2/files/search_v2` (+ `/search/continue_v2`) | ✅ implemented                     |
| `get_file_metadata` | `/2/files/get_metadata`                        | ✅ implemented                     |
| `upload_file` (opt) | `/2/files/upload`                              | ✗ not implemented (no write scope) |
| `delete_file` (opt) | `/2/files/delete_v2`                           | ✗ not implemented (no write scope) |

- **Auth type:** OAuth 2.0 (offline refresh token). [DOCUMENTED] 🛠️
- **Connector category:** `cloud-storage`. 🛠️
- **Caching appropriate:** yes — `CACHING_PRESETS.cloudStorage` in registry; file content is
  stable per `rev`/`content_hash`, ideal cache keys. 🛠️ [DOCUMENTED]

**Known gaps in the current provider (improvement backlog, not blockers):** 🛠️

1. Uses `path_display` as `file_id` → ids break on rename/move. Switching to `id:...` + the
   path-id resolution form would be more robust.
2. `has_subfolders` hard-coded `False` (avoids an extra call) — folder tree UI can't pre-know.
3. `web_view_link` / `permissions` always empty (no `sharing.read`; could use
   `get_temporary_link` for a transient link).

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. Browse Dropbox folders and list files/subfolders (paginated).
2. Full-text / filename search across the account or a subtree.
3. Download file content for KB ingestion / chat analysis.
4. Read file metadata (size, modified time, rev, content hash).

**CANNOT do (out of scope / dangerous):**

1. Upload, move, rename, or delete files (no write scope requested).
2. Create or manage shared links / change permissions (no `sharing.write`).
3. Read team-admin / business endpoints or other users' namespaces.
4. Download non-downloadable cloud-native docs without an export step.

**Default parameters:** 🛠️

| Parameter              | Default     | Reason                                    |
| ---------------------- | ----------- | ----------------------------------------- |
| `path` (root)          | `""`        | Dropbox root is empty string, never `"/"` |
| `recursive`            | `false`     | Browse one level; recurse only on demand  |
| `include_deleted`      | `false`     | Hide tombstones from users                |
| `limit` (list)         | 100 (≤2000) | Reasonable page; respects Dropbox max     |
| `max_results` (search) | 100 (≤1000) | Reasonable page; respects search max      |
| `file_status`          | `active`    | Only live files                           |

### 9.4 SDK Assessment [NICE-TO-HAVE]

| SDK     | Language | Quality   | Maintained?       | Worth Using?                                                      |
| ------- | -------- | --------- | ----------------- | ----------------------------------------------------------------- |
| dropbox | Python   | Excellent | Yes (first-party) | Reference only — provider uses raw httpx for streaming control 🛠️ |
| dropbox | Node     | Excellent | Yes               | Reference                                                         |

---

## Phase 10 — Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 — sources identified, quality excellent
- [ ] Phase 2 — **live first call NOT captured** (no app key) 🔬; auth flow fully documented + matches registry
- [x] Phase 3 — entities (File/Folder/SearchMatch) + fields documented (provider-verified) 🛠️
- [x] Phase 4 — 5+ critical endpoints with request/response (provider-verified) 🛠️
- [x] Phase 5 — query/search/filter patterns documented
- [x] Phase 6 — cursor pagination documented with worked example + delta-sync note
- [x] Phase 7 — webhooks/longpoll/delta assessed (connector is pull-based)
- [x] Phase 8 — `409` typed-union error model + 429/`Retry-After` documented
- [x] Phase 9 — integration path selected (Files-Remote, provider already exists) + gaps logged

**Overall investigation confidence:** **high** — uniquely strong because a production provider
backs every claimed endpoint/payload. The only true unknowns are live-response edge shapes
(429 body, search min-length) and the deliberate provider gaps in 9.2.

**Known gaps that will reduce output quality:**

1. No captured live HTTP transcript — `200`-vs-`409` and `429`/`retry_after` exact bodies unverified. 🔬
2. Search min-query-length and content-index lag not precisely documented. 🔬
3. `path_display`-as-id fragility and empty `web_view_link`/`permissions` are provider design gaps, not API limits. 🛠️

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence | Gaps                                          |
| ---------------------------- | ------------- | ---------- | --------------------------------------------- |
| 01-llm-api-rules             | Yes           | High       | 429 body shape 🔬                             |
| 01a-domain-model-reference   | Yes           | High       | media_info detail (not used)                  |
| 01b-query-patterns           | Yes           | High       | search min-length 🔬                          |
| 01c-mutation-patterns        | N/A           | —          | Read-only connector; no mutations             |
| 01d-event-and-error-handling | Yes           | High       | live 429/retry_after capture 🔬               |
| 02-api-spec-investigation    | Yes           | High       | —                                             |
| 03-connector-setup           | Yes           | High       | Provider already exists; document gaps in 9.2 |

**Top unknowns to confirm with an app key + live call:**

1. Exact `429` body (`.tag` `too_many_requests`, `retry_after` int) and `Retry-After` header presence. 🔬
2. `search_v2` minimum query length and content-index latency. 🔬
3. Confirm `expires_in` ≈ 14400s for offline access tokens. 🔬
