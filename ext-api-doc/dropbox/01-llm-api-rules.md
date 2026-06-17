---
api_name: Dropbox
api_slug: dropbox
api_style: HTTP-RPC (Dropbox API v2) — EVERY call is POST + JSON body, even reads. No GET/PUT/DELETE verbs.
base_url_metadata: https://api.dropboxapi.com/2
base_url_content: https://content.dropboxapi.com/2
path_version_segment: /2 is a REAL path segment on both hosts (NOT a label). Full path = host + /2/files/<op>.
auth: OAuth2 Bearer (offline refresh). Scopes files.metadata.read files.content.read — READ-ONLY.
field_casing: snake_case
id_format: path string (path_display, e.g. /Reports/Q1.pdf) — breaks on rename/move. Stable id:... exists but NOT used as connector id.
root_path: "" (empty string) — NEVER "/"
error_channel: app errors are HTTP 409 + typed .tag union (NOT 404/422). 200=success, no error union on 200.
rate_limit: 429 + Retry-After header; thresholds unpublished; reads rarely throttled
call_surface: FILE-STORE connector. Use numa integrations list-files / search-files / download-file. Does NOT support `numa integrations request` — you never hand-craft Dropbox HTTP. Endpoints below are reference for underlying behavior/constraints.
confidence: every fact is documentation+provider-code based 2026-05-29 unless tagged [INFERRED]/[UNKNOWN]/🔬(needs live capture). No live HTTP transcript captured.
companions: 01a=domain-model, 01b=query-patterns, 01c=mutations(none-read-only), 01d=events+errors
---

# Dropbox — API Rules

Cloud file store. This connector is **read-only**: browse, search, download. Surfaced in **Files > Remote** and chat. Executable integration = `dropbox_provider.py`; you drive it through the connector's file-browse/search/download tools, not raw HTTP.

## Hosts & paths (read first)

- Metadata/JSON-RPC: `https://api.dropboxapi.com/2` — e.g. `/2/files/list_folder`.
- Binary download: `https://content.dropboxapi.com/2` — e.g. `/2/files/download`.
- `/2` is a real path segment on BOTH hosts. Every op is `POST host/2/files/<op>`.
- Everything is `POST` with a JSON body — even reads. No GET/PUT/DELETE.

## Auth

`Authorization: Bearer <access_token>` + `Content-Type: application/json` (JSON-RPC on api host).

- OAuth2 authorization-code, offline refresh. Connector manages the dance, storage, and refresh — you never see App key/secret. Access token ~4h; refresh token long-lived, **non-rotating**.
- `401` = access token expired/invalid/insufficient-scope → connector refreshes and retries once. If `missing_scope`, refresh won't help (scope never granted).

## CAN

1. Browse folders — list direct children of a path (paginated). 2. Search by filename or **full-text content**, account-wide or in a subtree (`search_v2`). 3. Download file bytes. 4. Read file/folder metadata: `size`, `server_modified`, `client_modified`, `rev`, `content_hash`.

## CANNOT

1. Upload/move/rename/delete — no `files.content.write`. 2. Create/manage shared links or permissions — no `sharing.write`/`sharing.read`. 3. Read account profile/team/other namespaces — no `account_info.read`. 4. Download non-downloadable cloud-native docs (Dropbox Paper) → `409 unsupported_file`. A write attempt returns `401 missing_scope` — do NOT retry-after-refresh; report read-only.

## Gotchas

1. **Root is `""`, NOT `"/"`.** `"/"` errors. Connector maps `root`/null → `""`. Subpaths: leading `/`, no trailing `/`, e.g. `/Reports/Q1.pdf`.
2. **App errors are HTTP `409`, not `404`/`422`.** `200`=success. Path-missing / unsupported-file / wrong-type return `409` with a typed `.tag` union. Branch on `.tag` / `error_summary` prefix, never on a bare status code.
3. **Download is a different host with a header arg, no JSON body.** `POST content.dropboxapi.com/2/files/download` with path in the **`Dropbox-API-Arg`** header (ASCII-only JSON; non-ASCII must be `\uXXXX`-escaped). Bytes in body; metadata in `Dropbox-API-Result` response header.
4. **Paths case-insensitive but case-preserving.** `path_lower` for matching, `path_display` for display. Connector uses `path_display` as the file/folder id → **ids break on rename/move** (re-list parent to recover). Two files differing only in case cannot coexist.
5. **`search_v2` results are double-nested:** real entry at `match.metadata.metadata` (a `.tag:"metadata"` wrapper). Continue endpoint is `files/search/continue_v2`, NOT `search_v2/continue`.
6. **No total count** (enumerate to count). `has_subfolders` always reported `false` (provider skips the extra call — drill in to learn). `web_view_link`/`permissions` always empty (no `sharing.read`).

## Defaults (override only if the user specifies)

| Param                  | Default     | Note                          |
| ---------------------- | ----------- | ----------------------------- |
| `path` (root)          | `""`        | never `"/"`                   |
| `recursive`            | `false`     | one level; recurse on demand  |
| `include_deleted`      | `false`     | hide tombstones               |
| `limit` (list)         | 100 (≤2000) | provider clamps `min(n,2000)` |
| `max_results` (search) | 100 (≤1000) | provider clamps `min(n,1000)` |
| `file_status` (search) | `active`    | live files only               |
| `filename_only`        | `false`     | search content too            |

## Operations (underlying endpoints — `(api)`=api host, `(content)`=content host)

| Operation        | Path (host)                           | Key params                 | Notes                             |
| ---------------- | ------------------------------------- | -------------------------- | --------------------------------- |
| List folder      | `/2/files/list_folder` (api)          | `path`,`recursive`,`limit` | `path:""`=root                    |
| List next page   | `/2/files/list_folder/continue` (api) | `cursor`                   | same shape; also delta replay     |
| Get metadata     | `/2/files/get_metadata` (api)         | `path` or `id:...`         | single object, not in `entries`   |
| Search           | `/2/files/search_v2` (api)            | `query`,`options.*`        | name+content; double-nested match |
| Search next page | `/2/files/search/continue_v2` (api)   | `cursor`                   | NOT `search_v2/continue`          |
| Download         | `/2/files/download` (content)         | `Dropbox-API-Arg` header   | bytes in body; no JSON body       |

## Pagination

Opaque **cursor** + `has_more` boolean (same model for listing and search). First page: `limit` (list) / `options.max_results` (search). Next: pass `cursor` to the matching `/continue`. **No total count.** Last page when `has_more == false`. Response shape: `{entries|matches:[...], cursor, has_more}`. The final `cursor` doubles as a **delta token** — replay against `/list_folder/continue` later to fetch only changes since (Dropbox "detecting changes").

## Errors

409 body: `{"error_summary":"path/not_found/...","error":{".tag":"path","path":{".tag":"not_found"}}}`. `error_summary` prefix-match (e.g. `startswith("path/not_found")`) is officially supported; walk `error.tag` for deeper logic.
Common 409 tags: `path/not_found` (stale path/id → re-list parent) · `path/not_file`/`path/not_folder` (wrong type) · `path/restricted_content` (policy/DMCA → skip) · `unsupported_file` (Paper/cloud doc → skip or `/2/files/export`) · `too_many_requests` (also surfaces as 429) · `missing_scope` (don't retry; read-only).
Recovery: 400 fix request · 401 connector refreshes + retries once (if `missing_scope`, don't retry) · 403 account/team lacks feature, surface · 409 branch on `.tag` (usually not retryable) · 429 honor `Retry-After` then exponential backoff+jitter · 5xx exponential backoff (≤3).

## Examples

1. List a folder (`POST api/2/files/list_folder`):
   `{"path":"/Reports","recursive":false,"limit":100}`
   → `{"entries":[{".tag":"folder","name":"2026","id":"id:a4ayc_80_OEAAAAAAAAAYa","path_lower":"/reports/2026","path_display":"/Reports/2026"},{".tag":"file","name":"Q1 Report.pdf","id":"id:a4ayc_80_OEAAAAAAAAAYb","path_lower":"/reports/q1 report.pdf","path_display":"/Reports/Q1 Report.pdf","client_modified":"2026-01-15T09:30:00Z","server_modified":"2026-01-15T09:31:12Z","rev":"0153e6a1f2c0b00000002a1c2f3","size":482113,"content_hash":"599f9c00..."}],"cursor":"AAH4f99T0taNz...","has_more":true}`
   Root: send `{"path":""}`. Files+folders mixed in `entries` — discriminate by `.tag`.

2. Next page (`POST api/2/files/list_folder/continue`): `{"cursor":"AAH4f99T0taNz..."}` → `{"entries":[...],"cursor":"AAH8kq2...","has_more":false}`.

3. Search name+content (`POST api/2/files/search_v2`):
   `{"query":"quarterly report","options":{"path":"","max_results":100,"file_status":"active","filename_only":false}}`
   → `{"matches":[{"metadata":{".tag":"metadata","metadata":{".tag":"file","name":"Q1 Report.pdf","path_display":"/Reports/Q1 Report.pdf","size":482113,"server_modified":"2026-01-15T09:31:12Z","rev":"0153e6a1f2c0b00000002a1c2f3"}}}],"has_more":false,"cursor":"AAH..."}`
   Real entry = `matches[i].metadata.metadata`. Continue with `/files/search/continue_v2`.

4. Download bytes (`POST content/2/files/download`):
   Header `Dropbox-API-Arg: {"path":"/Reports/Q1 Report.pdf"}`, no body → raw bytes in body; metadata in `Dropbox-API-Result: {"name":"Q1 Report.pdf","size":482113,"rev":"0153e6a1f2c0b00000002a1c2f3",...}`.

5. Get metadata (`POST api/2/files/get_metadata`):
   `{"path":"/Reports/Q1 Report.pdf","include_media_info":false,"include_deleted":false}`
   → `{".tag":"file","name":"Q1 Report.pdf","id":"id:a4ayc_80_OEAAAAAAAAAYb","path_display":"/Reports/Q1 Report.pdf","size":482113,"server_modified":"2026-01-15T09:31:12Z","client_modified":"2026-01-15T09:30:00Z","rev":"0153e6a1f2c0b00000002a1c2f3","content_hash":"599f9c00..."}`
