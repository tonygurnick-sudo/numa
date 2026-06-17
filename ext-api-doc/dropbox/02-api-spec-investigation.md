---
api_name: Dropbox
api_slug: dropbox
base_url_metadata: https://api.dropboxapi.com/2
base_url_content: https://content.dropboxapi.com/2
path_version_segment: /2 is a REAL path segment on both hosts (NOT a label). v1 fully retired.
api_style: HTTP-RPC v2 — every call is POST + JSON body, even reads; no GET/PUT/DELETE
spec_format: Stone schema (github.com/dropbox/dropbox-api-spec); no public OpenAPI/Swagger
docs_url: https://www.dropbox.com/developers/documentation/http/documentation
sdk_ref: https://dropbox-sdk-python.readthedocs.io/en/latest/api/dropbox.html
status_page: https://status.dropbox.com/
confidence: documentation + provider-code based 2026-05-29 (no live HTTP transcript — no app key at research time); every endpoint/payload verified against production lib/oauth-providers/oauth_providers/dropbox_provider.py. Items needing a live response tagged 🔬.
---

# Dropbox — API Spec & Investigation (developer reference)

**Vendor:** Dropbox, Inc. (consumer + business cloud file storage). Path-addressed cloud file store; this connector uses the read surface only — browse a folder, search by name/content, read metadata, download bytes.

- **Two hosts:** metadata/JSON-RPC `https://api.dropboxapi.com/2`; binary content (download/upload) `https://content.dropboxapi.com/2`. `/2` is a real path segment on both.
- **API style:** HTTP-RPC — **every call is `POST`**, even reads. No `GET`/`PUT`/`DELETE`; the operation is the URL path, the argument is a JSON body. JSON data; tagged unions use a `.tag` discriminator.
- **Sandbox:** none — no separate sandbox host. Use a real (free) account; a dev app in **Development** mode is auto-limited to the developer's own account.
- **OpenAPI:** not available — Dropbox publishes a **Stone** schema (github.com/dropbox/dropbox-api-spec) the SDKs/docs are generated from. The HTTP doc page is a JS-rendered SPA; SDK docs + Stone spec are the reliable field-level sources.

## Authentication — OAuth 2.0 (Authorization Code, offline refresh)

Bearer token on every call. Numa's connector layer runs the full OAuth dance, stores tokens, auto-refreshes — developer/agent never handles App key/secret or the refresh flow.
Header: `Authorization: Bearer <access_token>` + `Content-Type: application/json` (JSON-RPC on api host; the content-host download has no JSON body).

| Parameter         | Value                                                                           |
| ----------------- | ------------------------------------------------------------------------------- |
| Grant type        | `authorization_code` (refresh via `refresh_token`)                              |
| Authorization URL | `https://www.dropbox.com/oauth2/authorize` _(matches registry)_                 |
| Token URL         | `https://api.dropboxapi.com/oauth2/token` _(matches registry)_                  |
| Revocation URL    | `https://api.dropboxapi.com/2/auth/token/revoke`                                |
| Token lifetime    | access ~4h (`expires_in`≈14400s 🔬); refresh token long-lived, **non-rotating** |
| Refresh           | `grant_type=refresh_token` → new short-lived access token; same refresh token   |
| PKCE              | No (confidential client with secret); supported for public clients              |

Offline refresh tokens are issued only when `token_access_type=offline` is sent on the authorize request — registry sets exactly this via `extraAuthParams`. Without it: short-lived access token only, **no** refresh token.

**Scopes:**
| Scope | Purpose | In registry? |
| --- | --- | --- |
| `files.metadata.read` | list folders, read metadata, search | **Yes** |
| `files.content.read` | download file content (`/2/files/download`) | **Yes** |
| `account_info.read` | read account profile (`/2/users/get_current_account`) | No — not requested |
| `files.content.write` | upload/move/delete | No — read-only connector |
| `sharing.read` | shared-link/permission info (`web_view_link`) | No — would extend connector |

Connector requests only the two **read** scopes. Because `sharing.read` is absent, `web_view_link` and `permissions` come back empty.

## Endpoint Catalog

`(api)`=api host, `(content)`=content host, `(notify)`=notify host. **Everything is `POST`.**

### Files (used by this connector)

| Path                                  | Purpose                     | Paginated    |
| ------------------------------------- | --------------------------- | ------------ |
| `/2/files/list_folder` (api)          | list a folder's children    | Yes (cursor) |
| `/2/files/list_folder/continue` (api) | next page / delta replay    | Yes (cursor) |
| `/2/files/get_metadata` (api)         | single file/folder metadata | No           |
| `/2/files/search_v2` (api)            | search names + content      | Yes (cursor) |
| `/2/files/search/continue_v2` (api)   | search next page            | Yes (cursor) |
| `/2/files/download` (content)         | download raw bytes          | No           |

All authed; all idempotent (reads).

### Full Endpoint Index

| #   | Path (host)                                         | Purpose                             | Notes                                    |
| --- | --------------------------------------------------- | ----------------------------------- | ---------------------------------------- |
| 1   | `/2/files/list_folder` (api)                        | list children                       | `path:""`=root; `recursive` flag         |
| 2   | `/2/files/list_folder/continue` (api)               | next page / delta                   | takes `cursor`; same response shape      |
| 3   | `/2/files/list_folder/get_latest_cursor` (api)      | cursor without entries (delta seed) | candidate for incremental sync           |
| 4   | `/2/files/list_folder/longpoll` (notify)            | block until changes on a cursor     | not used (pull-based)                    |
| 5   | `/2/files/get_metadata` (api)                       | single item metadata                | `path` or `id:...`                       |
| 6   | `/2/files/search_v2` (api)                          | search                              | `query`+`options`; double-nested match   |
| 7   | `/2/files/search/continue_v2` (api)                 | search next page                    | takes `cursor`                           |
| 8   | `/2/files/download` (content)                       | download bytes                      | arg in `Dropbox-API-Arg` header; no body |
| 9   | `/2/files/get_temporary_link` (api)                 | short-lived direct URL              | candidate for `web_view_link`            |
| 10  | `/2/files/export` (content)                         | export non-downloadable docs        | Paper / cloud-native files               |
| 11  | `/2/files/upload` (content)                         | upload bytes                        | out of scope (no write scope)            |
| 12  | `/2/sharing/create_shared_link_with_settings` (api) | shareable link                      | needs `sharing.write`                    |
| 13  | `/2/users/get_current_account` (api)                | account profile                     | needs `account_info.read`                |
| 14  | `/2/auth/token/revoke` (api)                        | revoke current token                | candidate for disconnect                 |

### Detail — `POST /2/files/list_folder` (api)

Provider defaults (`dropbox_provider.list_files`):
`{"path":"","recursive":false,"include_media_info":false,"include_deleted":false,"include_has_explicit_shared_members":false,"include_mounted_folders":true,"limit":100}`
Success `200`:
`{"entries":[{".tag":"folder","name":"2026","id":"id:a4ayc_80_OEAAAAAAAAAYa","path_lower":"/reports/2026","path_display":"/Reports/2026"},{".tag":"file","name":"Q1 Report.pdf","id":"id:a4ayc_80_OEAAAAAAAAAYb","path_lower":"/reports/q1 report.pdf","path_display":"/Reports/Q1 Report.pdf","client_modified":"2026-01-15T09:30:00Z","server_modified":"2026-01-15T09:31:12Z","rev":"0153e6a1f2c0b00000002a1c2f3","size":482113,"content_hash":"599f9c00..."}],"cursor":"AAH4f99T0taNz...","has_more":true}`

| Param       | Type | Required | Default | Notes                                          |
| ----------- | ---- | -------- | ------- | ---------------------------------------------- |
| `path`      | str  | yes      | —       | `""`=root (**never `"/"`**); else `/Sub/Dir`   |
| `recursive` | bool | no       | false   | true = whole subtree across `continue` pages   |
| `limit`     | int  | no       | (none)  | provider sends `min(page_size,2000)`; max 2000 |

### Detail — `POST /2/files/download` (content)

No JSON body — the argument goes in a header:
`POST content.dropboxapi.com/2/files/download` · `Authorization: Bearer <token>` · `Dropbox-API-Arg: {"path":"/Reports/Q1 Report.pdf"}`

- **Response:** raw file bytes in body; metadata JSON echoed in the **`Dropbox-API-Result`** response header. Provider returns `response.content`.
- **Gotcha:** `Dropbox-API-Arg` must be **HTTP-header-safe JSON** — ASCII only; any non-ASCII must be `\uXXXX`-escaped or the request is rejected.

### Detail — `POST /2/files/search_v2` (api)

`{"query":"quarterly report","options":{"path":"","max_results":100,"file_status":"active","filename_only":false}}`
Success `200` — **double-nested** match shape:
`{"matches":[{"metadata":{".tag":"metadata","metadata":{".tag":"file","name":"Q1 Report.pdf","path_display":"/Reports/Q1 Report.pdf","size":482113,"server_modified":"2026-01-15T09:31:12Z","rev":"0153e6a1f2c0b00000002a1c2f3"}}}],"has_more":false,"cursor":"AAH..."}`
Real entry at `matches[i].metadata.metadata`. `options.max_results` capped by provider at `min(page_size,1000)`; Dropbox max 1000.

## Data Models

Flat-namespace, **path-addressed** store. Two metadata types + a search wrapper. (`Required`=present on read; nothing is `Writable` for this connector.)

### FileMetadata (`.tag="file"`)

| Field             | Type     | Description                                                    |
| ----------------- | -------- | -------------------------------------------------------------- |
| `.tag`            | string   | always `"file"` (union discriminator)                          |
| `name`            | string   | file name (last path segment)                                  |
| `id`              | string   | stable `id:...` — survives rename/move                         |
| `path_lower`      | string   | lower-cased full path (use for matching)                       |
| `path_display`    | string   | display-cased path — used as connector `file_id`               |
| `client_modified` | datetime | client mtime (ISO 8601 `...Z`) → connector `created_at`        |
| `server_modified` | datetime | server mtime (ISO 8601 `...Z`) → connector `modified_at`       |
| `rev`             | string   | revision id → connector `version`                              |
| `size`            | int      | bytes                                                          |
| `content_hash`    | string   | 64-char Dropbox block-hash → connector `checksum`              |
| `media_info`      | object   | optional — photo/video EXIF, only if `include_media_info=true` |
| `is_downloadable` | bool     | optional — `false` for some Paper/cloud-native docs            |

### FolderMetadata (`.tag="folder"`)

| Field                     | Type   | Description                                  |
| ------------------------- | ------ | -------------------------------------------- |
| `.tag`                    | string | always `"folder"`                            |
| `name`                    | string | folder name                                  |
| `id`                      | string | stable `id:...`                              |
| `path_lower`              | string | lower-cased path                             |
| `path_display`            | string | display path — used as connector `folder_id` |
| `parent_shared_folder_id` | string | optional — set when inside a shared folder   |

A third `.tag="deleted"` (`DeletedMetadata`) appears only when `include_deleted=true` (connector sets `false`, so tombstones hidden).

**Relationships:** hierarchy is expressed purely by the **path string** — no IDs-as-foreign-keys. Parent = `path_display` minus the last segment (provider string-splits). `id:...` stable across rename/move; **paths are not**. Connector uses `path_display` as id (human-readable but path-fragile — re-list the parent to recover).

**Field formats:**
| Format | Pattern | Example |
| --- | --- | --- |
| DateTime | ISO 8601 UTC `YYYY-MM-DDTHH:MM:SSZ` | `2026-01-15T09:31:12Z` |
| Path id | `/Display/Cased/Path.ext` | `/Reports/Q1 Report.pdf` |
| Stable id | `id:`+opaque string | `id:a4ayc_80_OEAAAAAAAAAYa` |
| Revision | hex string | `0153e6a1f2c0b00000002a1c2f3` |
| Content hash | 64-char hex (block-hash, NOT SHA-256) | `599f9c00...` |
| Cursor | opaque base64 string | `AAH4f99T0taNz...` |

## Pagination

Opaque **cursor** + `has_more` boolean (same model for listing and search). Defaults: listing 100, search 100. Max: listing **2000**, search **1000**. **No total count** — enumerate to count.
| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `limit` (list) | int | (none) | page size; provider sends `min(page_size,2000)` |
| `options.max_results` (search) | int | 100 | provider sends `min(page_size,1000)` |
| `cursor` | str | — | from previous page → matching `/continue` endpoint |
Response: `{"entries":[],"cursor":"AAH...","has_more":true}`. Last page when `has_more==false`; the final `cursor` becomes a **delta token** — replay later against `/list_folder/continue` to fetch only changes since (Dropbox "detecting changes"; useful for incremental KB re-sync). Continue endpoints: `list_folder/continue` (list) vs `search/continue_v2` (search — different shape).

## Rate Limits

Per-app/user, **not publicly fixed** — dynamic/namespace-based, rolling window, concurrency-aware. `429` carries `Retry-After` and a body `{"error":{".tag":"too_many_requests"},"error_summary":"too_many_requests/...","retry_after":N}` (🔬 confirm exact body live). Strategy: honor `Retry-After`, then exponential backoff + jitter; provider routes all calls through `_make_request_with_retry` (the single enforcement point). Headers: `Retry-After`, `X-Dropbox-Request-Id` (support correlation id, on every response).

## Error Handling

**Dropbox is non-standard.** Expected application errors come back as HTTP **`409`** with a typed union — NOT `404`/`422`. Branch on `error.tag` / the `error_summary` prefix, never on a bare status code.
409 body: `{"error_summary":"path/not_found/...","error":{".tag":"path","path":{".tag":"not_found"}}}`. `error_summary` prefix-matching is officially acceptable; walk `error.tag` for programmatic handling.

| Status | Meaning                                                     | Retryable     | Recovery                              |
| ------ | ----------------------------------------------------------- | ------------- | ------------------------------------- |
| 200    | success                                                     | —             | —                                     |
| 400    | malformed request / bad JSON (not a routed app error)       | No            | fix request                           |
| 401    | invalid/expired/insufficient-scope token                    | after refresh | refresh access token, retry once      |
| 403    | account/team lacks access to a feature                      | maybe         | needs account-side action             |
| 409    | endpoint-specific app error — body carries the `.tag` union | depends       | inspect `.tag`; usually not retryable |
| 429    | rate limited                                                | Yes           | honor `Retry-After`, then backoff     |
| 5xx    | server error                                                | Yes           | exponential backoff                   |

Common 409 tags: `path/not_found` (stale path/id — re-list parent) · `path/not_file`/`path/not_folder` (wrong type) · `path/restricted_content` (policy block — skip) · `unsupported_file` (Paper/cloud doc — skip or `/2/files/export`) · `too_many_requests` (also surfaces as `429`).

## Webhooks / Events

Dropbox supports events but this connector is **pull-based** and does not use them.

- **Webhooks:** app-level URL set in the App Console (not per-call). Initial `GET ?challenge=…` to echo back verbatim; each `POST` carries `X-Dropbox-Signature` = **HMAC-SHA256** of the raw body keyed by the app secret. Thin payload `{"list_folder":{"accounts":["dbid:..."]}}` — _which_ accounts changed, not _what_; then call `list_folder/continue` per account.
- **Longpoll:** `/2/files/list_folder/longpoll` (notify host) blocks on a cursor until changes exist.
- **Polling fallback (used here):** cursor delta via `list_folder/continue`. Change-detection: `server_modified`, `rev`, `content_hash`.

## Known Limitations

1. **Read-only:** no upload/move/rename/delete (no `files.content.write`), no shared-link creation (no `sharing.write`), no permissions/account read.
2. **Connector ids are `path_display`** — break on rename/move; stable `id:...` exists but isn't used as the id today. Re-list the parent to recover a stale path.
3. **No total count** and **no native date-range filter** in search (filter client-side).
4. `has_subfolders` hard-coded `false` by the provider (skips an extra call); `web_view_link`/`permissions` always empty (no `sharing.read`).
5. Some files (Dropbox Paper / cloud-native docs) **non-downloadable** → `409 unsupported_file`; require `/2/files/export`.

## SDKs & Tooling

| SDK              | Language | Repository                            | Notes                                                          |
| ---------------- | -------- | ------------------------------------- | -------------------------------------------------------------- |
| `dropbox`        | Python   | github.com/dropbox/dropbox-sdk-python | reference only — provider uses raw httpx for streaming control |
| `dropbox`        | Node     | github.com/dropbox/dropbox-sdk-js     | reference                                                      |
| dropbox-sdk-java | Java     | github.com/dropbox/dropbox-sdk-java   | reference                                                      |

Postman collection: not officially published. OpenAPI: not available — Stone schema at github.com/dropbox/dropbox-api-spec.

## Integration Path Assessment

**Recommended:** Data Connector (Files) + selective API. Dropbox is a canonical cloud file store whose primary surface is browse/search/download — the Files-Remote shape. Registry marks it `surfaces:['files','chat']`, `category:'Cloud Storage'`, and a **production backend provider already exists** (`dropbox_provider.py`) implementing the four standard connector methods. Mirrors Google Drive / OneDrive / Box — a `lib/oauth-providers/` provider class surfaced in Files > Remote, **not** a spec-driven chat-only `request` connector (that pattern is for action-oriented APIs like NetSuite / simPRO / Actionstep). This `ext-api-doc/dropbox/` package documents the API for reference/agent-context; the executable integration lives in the provider.

| Connector method  | API endpoint                                   | Feasibility |
| ----------------- | ---------------------------------------------- | ----------- |
| list_files        | `/2/files/list_folder` (+`/continue`)          | good        |
| download_file     | `/2/files/download` (content host, header arg) | good        |
| search_files      | `/2/files/search_v2` (+`/search/continue_v2`)  | good        |
| get_file_metadata | `/2/files/get_metadata`                        | good        |

**Sources:** HTTP reference, OAuth guide, error-handling guide, detecting-changes guide (links in 03/04). Researched 2026-05-29 (documentation + provider-code based; live smoke test pending — close the Phase 2 gate per 04).
