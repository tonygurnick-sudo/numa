---
api_name: 'Dropbox'
api_slug: 'dropbox'
base_url: 'https://api.dropboxapi.com/2 (metadata) · https://content.dropboxapi.com/2 (content)'
version: 'API v2 (HTTP-RPC)'
spec_format: 'Stone schema (dropbox/dropbox-api-spec); no public OpenAPI/Swagger'
spec_url: 'https://github.com/dropbox/dropbox-api-spec'
docs_url: 'https://www.dropbox.com/developers/documentation/http/documentation'
date_researched: '2026-05-29'
---

# Dropbox — API Specification & Investigation

> Clean developer reference for the Dropbox API v2. **Documentation + provider-code based** — no
> live HTTP transcript was captured (no app key at research time), but every endpoint/payload below
> is also verified against the production provider class at
> `lib/oauth-providers/oauth_providers/dropbox_provider.py`. Items needing a live response are
> tagged 🔬.

---

## Overview

- **Vendor:** Dropbox, Inc. (consumer + business cloud file storage).
- **API version:** v2 (HTTP-RPC). v1 is fully retired.
- **Base URL:** **two hosts** —
  - Metadata / JSON-RPC: `https://api.dropboxapi.com/2`
  - Binary content (download/upload): `https://content.dropboxapi.com/2`
- **Sandbox URL:** none — there is no separate sandbox host. Use a real (free) Dropbox account; a
  dev app in **Development** mode is automatically limited to the developer's own account.
- **API type:** REST-ish **HTTP-RPC** — **every call is `POST`**, even reads. There are no
  `GET`/`PUT`/`DELETE` verbs; the operation is the URL path and the argument is a JSON body.
- **Data format:** JSON. Tagged unions use a `.tag` discriminator field.
- **Documentation:** [HTTP reference](https://www.dropbox.com/developers/documentation/http/documentation)
- **API reference:** [Python SDK reference](https://dropbox-sdk-python.readthedocs.io/en/latest/api/dropbox.html)
  (the HTTP page is a JS-rendered SPA; the SDK docs + Stone spec are the reliable field-level sources)
- **OpenAPI spec:** Not available. Dropbox publishes a **Stone** schema
  ([dropbox/dropbox-api-spec](https://github.com/dropbox/dropbox-api-spec)) that the SDKs and docs
  are generated from.
- **Status page:** [status.dropbox.com](https://status.dropbox.com/)

**Summary:** A path-addressed cloud file store. This connector uses the read surface only —
browse a folder, search by name/content, read metadata, and download bytes.

---

## Authentication

### Method: OAuth 2.0 (Authorization Code grant, offline refresh tokens)

Bearer token on every call. The Numa connector layer runs the full OAuth dance, stores tokens, and
auto-refreshes — the developer/agent never handles the App key/secret or the refresh flow directly.

**Header format:**

```
Authorization: Bearer <access_token>
Content-Type: application/json          # JSON-RPC calls on api.dropboxapi.com
```

(The download endpoint on `content.dropboxapi.com` has no JSON body — see Endpoint Catalog.)

**For OAuth 2.0:**

| Parameter         | Value                                                                             |
| ----------------- | --------------------------------------------------------------------------------- |
| Grant type        | `authorization_code` (refresh via `refresh_token`)                                |
| Authorization URL | `https://www.dropbox.com/oauth2/authorize` _(matches registry)_                   |
| Token URL         | `https://api.dropboxapi.com/oauth2/token` _(matches registry)_                    |
| Revocation URL    | `https://api.dropboxapi.com/2/auth/token/revoke`                                  |
| Token lifetime    | access ~4h (`expires_in` ≈ 14400s 🔬); refresh token long-lived, **non-rotating** |
| Refresh mechanism | `grant_type=refresh_token` → new short-lived access token; same refresh token     |
| PKCE required     | No (confidential client with secret). Supported for public clients.               |

> Offline refresh tokens are only issued when `token_access_type=offline` is sent on the authorize
> request — the registry sets exactly this via `extraAuthParams`. Without it Dropbox returns a
> short-lived access token only and **no** refresh token.

**Required scopes:**

| Scope                 | Purpose                                               | Required for Integration?   |
| --------------------- | ----------------------------------------------------- | --------------------------- |
| `files.metadata.read` | List folders, read metadata, search                   | **Yes** (in registry)       |
| `files.content.read`  | Download file content (`/2/files/download`)           | **Yes** (in registry)       |
| `account_info.read`   | Read account profile (`/2/users/get_current_account`) | No — not requested          |
| `files.content.write` | Upload / move / delete files                          | No — connector is read-only |
| `sharing.read`        | Read shared-link / permission info (`web_view_link`)  | No — would extend connector |

> The connector requests only the two **read** scopes — consistent with its read-only Files-Remote
> role. Because `sharing.read` is not requested, `web_view_link` and `permissions` come back empty.

---

## Endpoint Catalog

> All paths are relative to a host. `(api)` = `https://api.dropboxapi.com`, `(content)` =
> `https://content.dropboxapi.com`. **Everything is `POST`.**

### Files (used by this connector)

| Method | Path                                  | Purpose                     | Auth | Paginated    | Idempotent |
| ------ | ------------------------------------- | --------------------------- | ---- | ------------ | ---------- |
| POST   | `/2/files/list_folder` (api)          | List a folder's children    | Yes  | Yes (cursor) | Yes (read) |
| POST   | `/2/files/list_folder/continue` (api) | Next page / delta replay    | Yes  | Yes (cursor) | Yes (read) |
| POST   | `/2/files/get_metadata` (api)         | Single file/folder metadata | Yes  | No           | Yes (read) |
| POST   | `/2/files/search_v2` (api)            | Search names + content      | Yes  | Yes (cursor) | Yes (read) |
| POST   | `/2/files/search/continue_v2` (api)   | Search next page            | Yes  | Yes (cursor) | Yes (read) |
| POST   | `/2/files/download` (content)         | Download raw bytes          | Yes  | No           | Yes (read) |

### Full Endpoint Index

| #   | Method | Path (host)                                         | Purpose                             | Notes                                    |
| --- | ------ | --------------------------------------------------- | ----------------------------------- | ---------------------------------------- |
| 1   | POST   | `/2/files/list_folder` (api)                        | List children                       | `path:""` = root; `recursive` flag       |
| 2   | POST   | `/2/files/list_folder/continue` (api)               | Next page / delta                   | takes `cursor`; same response shape      |
| 3   | POST   | `/2/files/list_folder/get_latest_cursor` (api)      | Cursor without entries (delta seed) | candidate for incremental sync           |
| 4   | POST   | `/2/files/list_folder/longpoll` (notify host)       | Block until changes on a cursor     | not used (pull-based)                    |
| 5   | POST   | `/2/files/get_metadata` (api)                       | Single item metadata                | `path` or `id:...`                       |
| 6   | POST   | `/2/files/search_v2` (api)                          | Search                              | `query` + `options`; double-nested match |
| 7   | POST   | `/2/files/search/continue_v2` (api)                 | Search next page                    | takes `cursor`                           |
| 8   | POST   | `/2/files/download` (content)                       | Download bytes                      | arg in `Dropbox-API-Arg` header; no body |
| 9   | POST   | `/2/files/get_temporary_link` (api)                 | Short-lived direct URL              | candidate for `web_view_link`            |
| 10  | POST   | `/2/files/export` (content)                         | Export non-downloadable docs        | for Paper / cloud-native files           |
| 11  | POST   | `/2/files/upload` (content)                         | Upload bytes                        | out of scope (no write scope)            |
| 12  | POST   | `/2/sharing/create_shared_link_with_settings` (api) | Shareable link                      | needs `sharing.write`                    |
| 13  | POST   | `/2/users/get_current_account` (api)                | Account profile                     | needs `account_info.read`                |
| 14  | POST   | `/2/auth/token/revoke` (api)                        | Revoke the current token            | candidate for disconnect                 |

### Endpoint detail — `POST /2/files/list_folder` (api)

Provider defaults (`dropbox_provider.list_files`):

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

Success (`200`):

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

| Param       | Type | Required | Default | Notes                                            |
| ----------- | ---- | -------- | ------- | ------------------------------------------------ |
| `path`      | str  | yes      | —       | `""` for root (**never `"/"`**); else `/Sub/Dir` |
| `recursive` | bool | no       | false   | true = whole subtree across `continue` pages     |
| `limit`     | int  | no       | (none)  | provider sends `min(page_size, 2000)`; max 2000  |

### Endpoint detail — `POST /2/files/download` (content)

No JSON request body — the argument goes in a header.

```http
POST /2/files/download HTTP/1.1
Host: content.dropboxapi.com
Authorization: Bearer <token>
Dropbox-API-Arg: {"path":"/Reports/Q1 Report.pdf"}
```

- **Response:** raw file bytes in the body; the file's metadata JSON echoed in the
  **`Dropbox-API-Result`** response header. The provider returns `response.content`.
- **Gotcha:** `Dropbox-API-Arg` must be **HTTP-header-safe JSON** — ASCII only; any non-ASCII
  character must be `\uXXXX`-escaped or the request is rejected.

### Endpoint detail — `POST /2/files/search_v2` (api)

```json
{
  "query": "quarterly report",
  "options": { "path": "", "max_results": 100, "file_status": "active", "filename_only": false }
}
```

Success (`200`) — note the **double-nested** match shape:

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

The real entry is at `matches[i].metadata.metadata`. `options.max_results` is capped by the
provider at `min(page_size, 1000)`; Dropbox max is 1000.

---

## Data Models

Dropbox is a flat-namespace, **path-addressed** store. Two metadata types plus a search wrapper.

### FileMetadata (`.tag = "file"`)

| Field             | Type     | Required | Writable | Description                                              |
| ----------------- | -------- | -------- | -------- | -------------------------------------------------------- |
| `.tag`            | string   | yes      | no       | Always `"file"` (union discriminator)                    |
| `name`            | string   | yes      | no       | File name (last path segment)                            |
| `id`              | string   | yes      | no       | Stable id `id:...` — survives rename/move                |
| `path_lower`      | string   | yes      | no       | Lower-cased full path (use for matching)                 |
| `path_display`    | string   | yes      | no       | Display-cased path — used as connector `file_id`         |
| `client_modified` | datetime | yes      | no       | Client mtime (ISO 8601 `...Z`) → connector `created_at`  |
| `server_modified` | datetime | yes      | no       | Server mtime (ISO 8601 `...Z`) → connector `modified_at` |
| `rev`             | string   | yes      | no       | Revision id → connector `version`                        |
| `size`            | int      | yes      | no       | Bytes                                                    |
| `content_hash`    | string   | yes      | no       | 64-char Dropbox block-hash → connector `checksum`        |
| `media_info`      | object   | no       | no       | Photo/video EXIF — only if `include_media_info=true`     |
| `is_downloadable` | bool     | no       | no       | `false` for some Paper/cloud-native docs                 |

### FolderMetadata (`.tag = "folder"`)

| Field                     | Type   | Required | Writable | Description                                  |
| ------------------------- | ------ | -------- | -------- | -------------------------------------------- |
| `.tag`                    | string | yes      | no       | Always `"folder"`                            |
| `name`                    | string | yes      | no       | Folder name                                  |
| `id`                      | string | yes      | no       | Stable id `id:...`                           |
| `path_lower`              | string | yes      | no       | Lower-cased path                             |
| `path_display`            | string | yes      | no       | Display path — used as connector `folder_id` |
| `parent_shared_folder_id` | string | no       | no       | Set when inside a shared folder              |

> A third `.tag = "deleted"` (`DeletedMetadata`) appears only when `include_deleted=true` (the
> connector sets it `false`, so tombstones are hidden).

**Relationships:**

- Hierarchy is expressed purely by the **path string** — there are no IDs-as-foreign-keys.
  Parent = `path_display` minus the last segment (the provider derives it by string-splitting).
- `id:...` values are stable across rename/move; **paths are not**. The connector currently uses
  `path_display` as the id (human-readable, but path-fragile — re-list the parent to recover).

**Field formats:**

| Format       | Pattern                                   | Example                       |
| ------------ | ----------------------------------------- | ----------------------------- |
| DateTime     | ISO 8601 UTC `YYYY-MM-DDTHH:MM:SSZ`       | `2026-01-15T09:31:12Z`        |
| Path id      | `/Display/Cased/Path.ext`                 | `/Reports/Q1 Report.pdf`      |
| Stable id    | `id:` + opaque string                     | `id:a4ayc_80_OEAAAAAAAAAYa`   |
| Revision     | hex string                                | `0153e6a1f2c0b00000002a1c2f3` |
| Content hash | 64-char hex (block-hash, **not** SHA-256) | `599f9c00...`                 |
| Cursor       | opaque base64 string                      | `AAH4f99T0taNz...`            |

---

## Pagination

- **Type:** opaque **cursor** + `has_more` boolean (same model for listing and search).
- **Default page size:** listing 100 (provider default), search 100. **Max:** listing **2000**,
  search **1000**.
- **Total count:** **not available** — enumerate to count.

**Parameters:**

| Parameter             | Type | Default | Description                                             |
| --------------------- | ---- | ------- | ------------------------------------------------------- |
| `limit` (list)        | int  | (none)  | Page size; provider sends `min(page_size, 2000)`        |
| `options.max_results` | int  | 100     | Search page size; provider sends `min(page_size, 1000)` |
| `cursor`              | str  | —       | From the previous page → `/continue` endpoint           |

**Response structure:**

```json
{ "entries": [], "cursor": "AAH...", "has_more": true }
```

**Last page detection:** `has_more == false`. After that, the final `cursor` becomes a **delta
token** — replay it later against `/list_folder/continue` to fetch only changes since (Dropbox's
"detecting changes" model; useful for incremental KB re-sync).

---

## Rate Limits

| Scope        | Limit                                       | Window  |
| ------------ | ------------------------------------------- | ------- |
| Per-app/user | Not publicly fixed; dynamic/namespace-based | rolling |

**Headers:**

| Header                 | Meaning                                    |
| ---------------------- | ------------------------------------------ |
| `Retry-After`          | Seconds to wait before retrying (on `429`) |
| `X-Dropbox-Request-Id` | Support correlation id (on every response) |

**When exceeded:** `429` with a `Retry-After` header and a body
`{"error":{".tag":"too_many_requests"},"error_summary":"too_many_requests/...","retry_after":N}`.
🔬 Confirm the exact body shape on a live call.

**Recommended strategy:** honor `Retry-After`, then exponential backoff with jitter. The provider
routes all calls through `_make_request_with_retry`, which is the single place to enforce this.

---

## Error Handling

**Standard error format (HTTP `409` with a typed union):**

```json
{
  "error_summary": "path/not_found/...",
  "error": { ".tag": "path", "path": { ".tag": "not_found" } }
}
```

- `error_summary` is a string you can **prefix-match** (e.g. startswith `"path/not_found"`).
  Prefix-matching is officially acceptable.
- `error` is a nested tagged union — walk `.tag` for programmatic handling.

**Status codes (Dropbox is non-standard — read carefully):**

| Status | Meaning                                                         | Retryable     | Recovery                              |
| ------ | --------------------------------------------------------------- | ------------- | ------------------------------------- |
| 200    | Success                                                         | —             | —                                     |
| 400    | Malformed request / bad JSON syntax (not a routed app error)    | No            | Fix request                           |
| 401    | Invalid / expired / insufficient-scope token                    | After refresh | Refresh access token, retry once      |
| 403    | Account / team lacks access to a feature                        | Maybe         | Needs account-side action             |
| 409    | **Endpoint-specific app error** — body carries the `.tag` union | Depends       | Inspect `.tag`; usually not retryable |
| 429    | Rate limited                                                    | Yes           | Honor `Retry-After`, then backoff     |
| 5xx    | Server error                                                    | Yes           | Exponential backoff                   |

> **Critical quirk:** expected application errors come back as HTTP **`409`**, NOT `404`/`422`.
> Branch on `error.tag` / the `error_summary` prefix, never on a bare status code.

**Common `409` tags for this connector:** `path/not_found` (stale path/id — re-list the parent),
`path/not_file` / `path/not_folder` (wrong type), `path/restricted_content` (policy block — skip),
`unsupported_file` (Paper/cloud doc — skip or use `/2/files/export`), `too_many_requests` (also
surfaces as `429`).

---

## Webhooks / Events

Dropbox **does** support events, but this connector is **pull-based** and does not use them.

- **Webhooks:** app-level URL set in the App Console (not per-call). Initial GET carries
  `?challenge=…` to echo back verbatim; each POST carries `X-Dropbox-Signature` =
  **HMAC-SHA256** of the raw body keyed by the app secret. Payload is thin —
  `{ "list_folder": { "accounts": ["dbid:..."] } }` — telling you _which_ accounts changed, not
  _what_; you then call `list_folder/continue` per account.
- **Longpoll:** `/2/files/list_folder/longpoll` blocks on a cursor until changes exist.
- **Polling fallback (what to use here):** cursor delta via `list_folder/continue`. Change-detection
  fields: `server_modified`, `rev`, `content_hash`.

---

## Known Limitations

1. **Read-only:** no upload / move / rename / delete (no `files.content.write`), no shared-link
   creation (no `sharing.write`), no permissions/account read.
2. **Connector ids are `path_display`** — they break on rename/move; stable `id:...` exists but
   isn't used as the id today. Re-list the parent to recover a stale path.
3. **No total count** and **no native date-range filter** in search (filter client-side).
4. `has_subfolders` is hard-coded `false` by the provider (skips an extra call); `web_view_link`
   and `permissions` are always empty (no `sharing.read`).
5. Some files (Dropbox Paper / cloud-native docs) are **non-downloadable** → `409 unsupported_file`;
   they require `/2/files/export`.

---

## SDKs & Tooling

| SDK              | Language | Repository                            | Quality | Notes                                                          |
| ---------------- | -------- | ------------------------------------- | ------- | -------------------------------------------------------------- |
| `dropbox`        | Python   | github.com/dropbox/dropbox-sdk-python | good    | Reference only — provider uses raw httpx for streaming control |
| `dropbox`        | Node     | github.com/dropbox/dropbox-sdk-js     | good    | Reference                                                      |
| dropbox-sdk-java | Java     | github.com/dropbox/dropbox-sdk-java   | good    | Reference                                                      |

**Postman collection:** Not officially published.
**OpenAPI spec:** Not available — Stone schema at github.com/dropbox/dropbox-api-spec.

---

## Integration Path Assessment

**Recommended path:** **Data Connector (Files) + selective API.**

**Justification:** Dropbox is a canonical cloud file store whose primary surface is browse / search
/ download — exactly the Files-Remote shape. The registry marks it `surfaces: ['files', 'chat']`
and `category: 'Cloud Storage'`, and a **production backend provider already exists**
(`lib/oauth-providers/oauth_providers/dropbox_provider.py`) implementing the four standard connector
methods. This mirrors Google Drive / OneDrive / Box — a `lib/oauth-providers/` provider class
surfaced in Files > Remote, **not** a spec-driven chat-only connector (that pattern is for
action-oriented APIs like NetSuite / simPRO / Actionstep). This `ext-api-doc/dropbox/` package
documents the API for reference/agent-context; the executable integration lives in the provider.

**Connector compatibility:**

| Connector Method  | API Endpoint                                   | Feasibility |
| ----------------- | ---------------------------------------------- | ----------- |
| list_files        | `/2/files/list_folder` (+ `/continue`)         | good        |
| download_file     | `/2/files/download` (content host, header arg) | good        |
| search_files      | `/2/files/search_v2` (+ `/search/continue_v2`) | good        |
| get_file_metadata | `/2/files/get_metadata`                        | good        |

---

_Researched 2026-05-29 (documentation + provider-code based; live smoke test pending). Source:
investigation questionnaire `00-api-investigation-questionnaire.md`._
