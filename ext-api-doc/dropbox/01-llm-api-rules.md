---
api_name: 'Dropbox'
api_slug: 'dropbox'
version: 'API v2 (HTTP-RPC)'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
line_count_target: '< 300 lines'
---

# Dropbox — Workspace Agent API Rules

> **Loaded into the workspace agent's context when the Dropbox integration is active.**
> Dropbox is a cloud file store. This connector is **read-only**: browse, search, download.
> Companion files (01a–01d) hold the detailed reference.

## Context

- **API:** Dropbox API v2 — HTTP-RPC style: **every call is `POST` with a JSON body**, even reads.
- **Base URLs (two hosts):**
  - Metadata / JSON-RPC: `https://api.dropboxapi.com/2`
  - Binary content (download): `https://content.dropboxapi.com/2`
- **Auth:** OAuth 2.0 (authorization code, offline refresh token). Scopes
  `files.metadata.read files.content.read`. **Read-only** — no write/sharing/account scopes.
- **Integration path:** Data Connector (Files) — surfaced in **Files > Remote** and chat. The
  executable integration is the platform provider (`dropbox_provider.py`); you do **not** call
  Dropbox HTTP endpoints by hand. Use the connector's file-browse / search / download tools. This
  doc is reference/agent-context for what the underlying API does and its constraints.
- **Rate limits:** `429` with a `Retry-After` header when exceeded; exact thresholds unpublished.

## Auth Structure

OAuth2 bearer token on every call. The connector layer manages the OAuth dance, token storage,
and refresh — you never see the App key/secret or the refresh flow.

```
Authorization: Bearer <access_token>
Content-Type: application/json          # JSON-RPC calls on api.dropboxapi.com
```

**Token lifecycle:**

- Access token is short-lived (~4 hours). The connector auto-refreshes with the long-lived
  `refresh_token` (`grant_type=refresh_token`); the refresh token does **not** rotate per refresh.
- `token_access_type=offline` is set on the authorize URL — that is what makes the refresh token
  long-lived. A `401` means the access token expired; the connector refreshes and retries.

## Capabilities

### CAN

1. Browse Dropbox folders — list files and subfolders of a path (paginated).
2. Search by filename or **full-text content** across the account or a subtree (`search_v2`).
3. Download file content (bytes) for KB ingestion / chat analysis.
4. Read file/folder metadata: size, `server_modified`, `client_modified`, `rev`, `content_hash`.

### CANNOT

1. Upload, move, rename, or delete files — no write scope (`files.content.write`) requested.
2. Create or manage shared links / change permissions — no `sharing.write`/`sharing.read`.
3. Read account profile, team-admin, or other users' namespaces — no `account_info.read`.
4. Download non-downloadable cloud-native docs (Dropbox Paper) without an export step → `409`.

## Critical Gotchas

> Things that will cause errors if you get them wrong.

1. **Root folder is the empty string `""`, NOT `"/"`.** Passing `"/"` errors. The connector maps
   `root`/null → `""`. Subpaths look like `/Reports/Q1.pdf` (leading slash, no trailing slash).
2. **Errors come back as HTTP `409`, not `404`/`422`.** A `200` is success; expected app errors
   (path missing, unsupported file) are `409` with a typed `.tag` union in the body. Branch on the
   `.tag` / `error_summary` prefix, never on a bare status code.
3. **Download is on a different host with a header arg, no JSON body.** `POST` to
   `content.dropboxapi.com/2/files/download` with the path in the **`Dropbox-API-Arg`** header
   (ASCII-only JSON; non-ASCII must be `\uXXXX`-escaped). Bytes in body, metadata in the
   `Dropbox-API-Result` response header.
4. **Paths are case-insensitive but case-preserving.** `path_lower` for matching, `path_display`
   for showing. The connector uses `path_display` as the file/folder id — so **ids break if a
   file is renamed/moved** (stable `id:...` exists but isn't used as the connector id today).
5. **`search_v2` results are double-nested:** the real entry is at
   `match.metadata.metadata` (a `.tag:"metadata"` wrapper around the file/folder metadata).

## Default Parameters

Use these defaults unless the user specifies otherwise:

| Parameter              | Default      | Reason                                        |
| ---------------------- | ------------ | --------------------------------------------- |
| `path` (root)          | `""`         | Dropbox root is the empty string, never `"/"` |
| `recursive`            | `false`      | List one level; recurse only on demand        |
| `include_deleted`      | `false`      | Hide deleted tombstones from users            |
| `limit` (list)         | 100 (≤ 2000) | Sensible page; respects Dropbox max           |
| `max_results` (search) | 100 (≤ 1000) | Sensible page; respects search max            |
| `file_status` (search) | `active`     | Only live files                               |
| `filename_only`        | `false`      | Search content too, not just names            |

## Working Examples

### Example 1: List the contents of a folder

```http
POST https://api.dropboxapi.com/2/files/list_folder
Authorization: Bearer <token>
Content-Type: application/json

{ "path": "/Reports", "recursive": false, "limit": 100 }
```

```json
{
  "entries": [
    {
      ".tag": "folder",
      "name": "2026",
      "id": "id:a4ayc_80_OEAAAAAAAAAYa",
      "path_lower": "/reports/2026",
      "path_display": "/Reports/2026"
    },
    {
      ".tag": "file",
      "name": "Q1 Report.pdf",
      "id": "id:a4ayc_80_OEAAAAAAAAAYb",
      "path_lower": "/reports/q1 report.pdf",
      "path_display": "/Reports/Q1 Report.pdf",
      "client_modified": "2026-01-15T09:30:00Z",
      "server_modified": "2026-01-15T09:31:12Z",
      "rev": "0153e6a1f2c0b00000002a1c2f3",
      "size": 482113,
      "content_hash": "599f9c00..."
    }
  ],
  "cursor": "AAH4f99T0taNz...",
  "has_more": true
}
```

> Root: send `{ "path": "" }`. The connector turns `""` into `path`, never `"/"`.

### Example 2: Next page (cursor continuation)

```http
POST https://api.dropboxapi.com/2/files/list_folder/continue
Authorization: Bearer <token>
Content-Type: application/json

{ "cursor": "AAH4f99T0taNz..." }
```

```json
{
  "entries": [
    /* more file/folder objects */
  ],
  "cursor": "AAH8kq2...",
  "has_more": false
}
```

### Example 3: Search by name and content

```http
POST https://api.dropboxapi.com/2/files/search_v2
Authorization: Bearer <token>
Content-Type: application/json

{ "query": "quarterly report",
  "options": { "path": "", "max_results": 100, "file_status": "active", "filename_only": false } }
```

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
          "server_modified": "2026-01-15T09:31:12Z",
          "rev": "0153e6a1f2c0b00000002a1c2f3"
        }
      }
    }
  ],
  "has_more": false,
  "cursor": "AAH..."
}
```

> Real entry is `matches[i].metadata.metadata`. Continue with `/files/search/continue_v2`.

### Example 4: Download a file's bytes

```http
POST https://content.dropboxapi.com/2/files/download
Authorization: Bearer <token>
Dropbox-API-Arg: {"path":"/Reports/Q1 Report.pdf"}
```

```
<raw binary bytes in the response body>
# Metadata echoed in the response header:
Dropbox-API-Result: {"name":"Q1 Report.pdf","size":482113,"rev":"0153e6a1f2c0b00000002a1c2f3", ...}
```

> No JSON request body. Path is in the **header**, not the body. Different host (`content.`).

### Example 5: Get metadata for one path

```http
POST https://api.dropboxapi.com/2/files/get_metadata
Authorization: Bearer <token>
Content-Type: application/json

{ "path": "/Reports/Q1 Report.pdf", "include_media_info": false, "include_deleted": false }
```

```json
{
  ".tag": "file",
  "name": "Q1 Report.pdf",
  "id": "id:a4ayc_80_OEAAAAAAAAAYb",
  "path_display": "/Reports/Q1 Report.pdf",
  "size": 482113,
  "server_modified": "2026-01-15T09:31:12Z",
  "client_modified": "2026-01-15T09:30:00Z",
  "rev": "0153e6a1f2c0b00000002a1c2f3",
  "content_hash": "599f9c00..."
}
```

## Proxy API Operations

> The connector exposes these as file-browse / search / download tools. Underlying endpoints:

| Operation        | Method | Path (host)                           | Key Parameters               | Notes                         |
| ---------------- | ------ | ------------------------------------- | ---------------------------- | ----------------------------- |
| List folder      | POST   | `/2/files/list_folder` (api)          | `path`, `recursive`, `limit` | `path:""` = root              |
| List next page   | POST   | `/2/files/list_folder/continue` (api) | `cursor`                     | Same shape; also delta replay |
| Download         | POST   | `/2/files/download` (content)         | `Dropbox-API-Arg` header     | Bytes in body; no JSON body   |
| Get metadata     | POST   | `/2/files/get_metadata` (api)         | `path`                       | Single file/folder object     |
| Search           | POST   | `/2/files/search_v2` (api)            | `query`, `options.*`         | Name + content                |
| Search next page | POST   | `/2/files/search/continue_v2` (api)   | `cursor`                     | `matches.metadata.metadata`   |

## Pagination

- **Type:** opaque **cursor** + `has_more` flag (same model for listing and search).
- **Default page size:** listing 100 (provider), search 100. **Max:** listing **2000**, search **1000**.
- **How to paginate:**

```http
# Page 1
POST /2/files/list_folder            { "path": "/Reports", "limit": 100 }
# → { entries:[...], cursor:"C1", has_more:true }
# Page N
POST /2/files/list_folder/continue   { "cursor": "C1" }
# → { entries:[...], cursor:"Cn", has_more:false }   ← stop
```

- **Last-page detection:** `has_more == false`. There is **no total count** — enumerate to count.
- **Delta sync bonus:** after `has_more=false`, the final `cursor` can later be replayed against
  `/list_folder/continue` to fetch only changes since then (Dropbox "detecting changes").

## Webhooks / Events

The connector is **pull-based** — it does not use webhooks. Dropbox _does_ support app-level
webhooks (HMAC-SHA256 signed, thin payload listing changed accounts) and longpoll on a cursor, but
neither is wired up here. For incremental re-sync, replay the cursor via `list_folder/continue`
(see 01d). Change-detection fields: `server_modified`, `rev`, `content_hash`.

## Error Handling

**Standard error format (HTTP 409 with a typed union):**

```json
{
  "error_summary": "path/not_found/...",
  "error": { ".tag": "path", "path": { ".tag": "not_found" } }
}
```

- `error_summary` is a string you can **prefix-match** (e.g. startswith `"path/not_found"`).
- `error` is a nested tagged union — walk `.tag` for programmatic handling.

**Recovery by status:**

| Status | Meaning                                  | Action                                             |
| ------ | ---------------------------------------- | -------------------------------------------------- |
| 200    | Success                                  | —                                                  |
| 400    | Malformed request / bad JSON syntax      | Fix request                                        |
| 401    | Invalid/expired/insufficient-scope token | Connector refreshes token, retries once            |
| 403    | Account/team lacks access to feature     | Surface; needs account-side action                 |
| 409    | **App error** — inspect `error.tag`      | e.g. `path/not_found` → path stale, re-list parent |
| 429    | Rate limited                             | Honor `Retry-After`, then exponential backoff      |
| 5xx    | Server error                             | Retry with exponential backoff                     |

**Common `409` tags:** `path/not_found` (stale path/id), `path/not_file`/`not_folder` (wrong type),
`path/restricted_content` (policy block — skip), `unsupported_file` (Paper/cloud doc — skip or
export), `too_many_requests` (also surfaces as 429).

## Known Limitations

1. Read-only: no upload/move/rename/delete, no sharing-link creation, no permissions read.
2. Connector ids are `path_display` — they break on rename/move; re-list the parent to recover.
3. No total count, no native date-range filter in search (filter client-side), `has_subfolders`
   is always reported `false` (the provider skips the extra call), `web_view_link`/`permissions`
   are empty (no `sharing.read`).

---

_Generated from investigation questionnaire. See companion files for detailed reference:_

- _01a-domain-model-reference.md — File/Folder/SearchMatch entities, fields, formats_
- _01b-query-patterns.md — list, recurse, search, pagination, delta sync_
- _01c-mutation-patterns.md — (read-only connector; no mutations — what writes would need)_
- _01d-event-and-error-handling.md — webhooks/longpoll/delta, 409 union, 429 recovery_
