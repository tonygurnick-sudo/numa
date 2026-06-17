---
api_name: Google Drive
api_slug: googledrive
base_url: https://www.googleapis.com/drive/v3
path_version_segment: /drive/v3 is a REAL host-path segment, not a connector-injected prefix. No further version segment.
underlying_api: Google Drive API v3 (REST, JSON)
call_surface: file-store connector (list-files/search-files/download-file); NOT `numa integrations request`. Backend = lib/oauth-providers/oauth_providers/google_drive_provider.py.
spec_format: Google Discovery Document (OpenAPI-equivalent)
spec_url: https://www.googleapis.com/discovery/v1/apis/drive/v3/rest
docs_url: https://developers.google.com/workspace/drive/api
confidence: doc-based — auth/format claims [DOCUMENTED] against Google docs, not live-traced; items needing a real consent tagged 🔬. High confidence (excellent docs + working provider).
date_researched: 2026-05-29
---

# Google Drive — API Specification & Investigation

Dev reference for Google Drive API v3, condensed from the questionnaire. In Numa it is wired as a **read-only file-browsing connector** (browse/search/download/export), NOT an action API.

## Overview

- **Vendor:** Google LLC (Google Workspace).
- **Version:** v3 (stable; v2 is legacy, not used). `/drive/v3` IS a real path segment of the base URL.
- **Base URL:** `https://www.googleapis.com/drive/v3` (matches provider's `BASE_URL`).
- **Sandbox:** None — no separate Drive sandbox host. Test against a real Google account with a test OAuth client; use `GET /about` as a safe read-only smoke test.
- **Type/format:** REST; JSON (`application/json; charset=UTF-8`) for metadata; raw binary stream for `?alt=media` downloads and `/export` conversions.
- **Docs:** developers.google.com/workspace/drive/api · ref v3: `.../reference/rest/v3`.
- **OpenAPI:** Google publishes a **Discovery Document** (OpenAPI-equivalent) at `https://www.googleapis.com/discovery/v1/apis/drive/v3/rest`. No first-party OpenAPI 3 file; unofficial mirror in `googleapis/google-api-go-client` (`drive/v3/drive-api.json`).
- **Status:** Google Workspace Status Dashboard (`google.com/appsstatus/dashboard`).

## Authentication — OAuth 2.0 (Authorization Code, web-server flow)

User-context only; every call carries a bearer access token. The connector layer (Numa OAuth wizard + relay) runs authorize/token/refresh; the API just validates the bearer.
Header: `Authorization: Bearer <access_token>` + `Accept: application/json`.

| Parameter         | Value                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| Grant type        | `authorization_code` (refresh via `refresh_token`)                         |
| Authorization URL | `https://accounts.google.com/o/oauth2/v2/auth`                             |
| Token URL         | `https://oauth2.googleapis.com/token`                                      |
| Revocation URL    | `https://oauth2.googleapis.com/revoke`                                     |
| Discovery URL     | `https://accounts.google.com/.well-known/openid-configuration`             |
| Token lifetime    | access ~3600s (1h); refresh long-lived, **does not rotate** per call       |
| Refresh           | `POST grant_type=refresh_token` to the token URL                           |
| PKCE              | Not required (Google supports it; not needed for confidential web clients) |

**Extra authorize params:** `{"access_type":"offline","prompt":"consent"}` — this is what guarantees a `refresh_token`; Google omits it on re-consent unless `prompt=consent` is sent.

**Scopes:**
| Scope | Purpose | Required? |
| --- | --- | --- |
| `https://www.googleapis.com/auth/drive.readonly` | Read all of user's Drive metadata + content | Yes (only scope in registry) |

⚠️ **`drive.readonly` is a Google RESTRICTED scope.** A production External OAuth app using it must pass **OAuth app verification AND an annual third-party CASA security assessment** before non-test users can consent (verification is per-Google-Cloud-project; each client's own OAuth client must be verified). Real per-client onboarding cost — flag early. 🔬

Token response: `{"access_token":"ya29.a0Af...","expires_in":3599,"refresh_token":"1//0gFp...","scope":"https://www.googleapis.com/auth/drive.readonly","token_type":"Bearer"}`

## Endpoint Catalog

All paths relative to `https://www.googleapis.com/drive/v3`. Connector uses the read-only subset; write verbs exist but are out of scope under `drive.readonly`.

| #   | Method | Path                               | Purpose                 | Paginated         | Idempotent | Notes                                        |
| --- | ------ | ---------------------------------- | ----------------------- | ----------------- | ---------- | -------------------------------------------- |
| 1   | GET    | `/files`                           | List / browse / search  | Yes (`pageToken`) | Yes        | Core; `q` DSL + `pageToken`                  |
| 2   | GET    | `/files/{id}`                      | Single file metadata    | No                | Yes        | Use `fields` selector                        |
| 3   | GET    | `/files/{id}?alt=media`            | Download binary bytes   | No                | Yes        | 403 `fileNotDownloadable` on native docs     |
| 4   | GET    | `/files/{id}/export`               | Export native doc       | No                | Yes        | Hard 10 MB inline cap                        |
| 5   | GET    | `/files/{id}/permissions`          | List ACL                | Yes               | Yes        | Or via `fields=permissions` on `/files/{id}` |
| —   | GET    | `/files/{id}/permissions/{permId}` | Get one permission      | No                | Yes        |                                              |
| 6   | GET    | `/drives`                          | List shared drives      | Yes               | Yes        | Shown as top-level "folders" by provider     |
| —   | GET    | `/drives/{id}`                     | Get one shared drive    | No                | Yes        |                                              |
| 7   | GET    | `/changes/startPageToken`          | Change cursor seed      | No                | Yes        | Polling sync only; not used by connector     |
| 8   | GET    | `/changes`                         | Incremental change feed | Yes               | Yes        | Polling sync only; not used by connector     |
| 9   | GET    | `/about?fields=user,storageQuota`  | Authed user + quota     | No                | Yes        | Recommended smoke test                       |
| —   | POST   | `/files`                           | Create file             | No                | No         | OUT OF SCOPE                                 |
| —   | PATCH  | `/files/{id}`                      | Update file             | No                | No         | OUT OF SCOPE                                 |
| —   | DELETE | `/files/{id}`                      | Delete file             | No                | Yes        | OUT OF SCOPE                                 |
| —   | POST   | `/changes/watch`                   | Register push channel   | No                | No         | OUT OF SCOPE                                 |

Provider does NOT call `/permissions` directly — it requests `permissions` as a sub-field of `GET /files/{id}` via `fields=...,permissions` (same data, one round-trip).

## Data Models

Drive = **flat file store with a folder graph overlaid via `parents`**. No true directory tree: folders are File resources (`mimeType=application/vnd.google-apps.folder`). Full field tables + enums + relationships in **01a**. Connector is read-only — "writable" fields are out of scope under `drive.readonly`.

**File (key fields):** `id` (opaque, never parse), `name`, `mimeType` (`...folder`=folder, `...google-apps.*`=native), `parents[]` (folder graph), `size` (byte **string**, absent for native docs), `md5Checksum` (binary only), `version` (monotonic, change-detection), `modifiedTime`/`createdTime` (RFC 3339 UTC), `trashed` (auto-purges ~30 days after trashing), `webViewLink`, `webContentLink` (binary only), `exportLinks` (native only), `owners[]`, `driveId` (shared-drive items only), `capabilities`, `permissions` (embedded when `fields=permissions`).

**Relationships:** File→File (folder) N:1 graph via `parents[]` (`mimeType=...folder`); File→Permission 1:N at `/files/{id}/permissions` (or embedded); File→Drive N:1 via `driveId`; File→User (owner) N:1 embedded `owners[]`.

**Permission:** `id` (opaque), `type` (`user`/`group`/`domain`/`anyone`), `role` (`owner`/`organizer`/`fileOrganizer`/`writer`/`commenter`/`reader`), `emailAddress`, `domain`, `displayName`, `deleted`.

**Change** (sync feed, not used by connector): `changeType` (`file`/`drive`), `time`, `removed` (boolean), `fileId`, `file` (embedded File), `driveId`.

**Drive** (shared drive): `id`, `name`, `kind`. Provider lists these as top-level browsable "folders" with `shared-drive:<driveId>` virtual ids.

**Native MIME → connector export** (verified against `_get_export_mime_type` in `google_drive_provider.py`): Doc→DOCX (`...wordprocessingml.document`); Sheet→XLSX (`...spreadsheetml.sheet`); Slides→PPTX (`...presentationml.presentation`); Drawing→PDF; Form→ZIP; Script→JSON (`...google-apps.script+json`); folder→n/a; any other `vnd.google-apps.*`→PDF (default). Full table in 01a.

## Pagination

Cursor / opaque **page token**. Default size 100, max 1000 (provider clamps `min(page_size,1000)`). **No total count** — iterate until token absent.
| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `pageSize` | int | 100 | Files per page (≤1000) |
| `pageToken` | string | — | Continuation token from previous response |

Response: `{"kind":"drive#fileList","incompleteSearch":false,"nextPageToken":"~!!~AI9F...","files":[{"id":"...","name":"...","mimeType":"..."}]}`. Last page = `nextPageToken` absent. Send **identical** `q`/`orderBy` on every page. `incompleteSearch:true` = cross-drive results incomplete; narrow corpus or retry.

## Rate Limits (quota-unit model)

| Scope                | Limit           | Window     |
| -------------------- | --------------- | ---------- |
| Per project          | 1,000,000 units | per minute |
| Per user per project | 325,000 units   | per minute |
| Per project (egress) | 1 TB            | per day    |

Per-method cost (approx): read ~5 · **list ~100** · **download ~200** · edit ~50 · other ~5. Browse-then-download is dominated by list/download. **No** reliable `Retry-After` on quota errors. Exceeded → **403** (`userRateLimitExceeded`/`rateLimitExceeded`) or **429** (`rateLimitExceeded`). Strategy: truncated exponential backoff with jitter `min((2^n) + random_ms, 64s)`. Provider already retries via `_make_request_with_retry`.
Rate-limit body: `{"error":{"code":403,"message":"User Rate Limit Exceeded","errors":[{"domain":"usageLimits","reason":"userRateLimitExceeded","message":"User Rate Limit Exceeded"}]}}`

## Error Handling

Standard Google envelope: `{"error":{"code":404,"message":"File not found: 1aBcD3eFgH.","errors":[{"domain":"global","reason":"notFound","message":"File not found: 1aBcD3eFgH.","location":"fileId","locationType":"parameter"}]}}`
**Branch on the `reason` field, NOT just the HTTP code** — `403` spans permission AND rate-limit, opposite recovery paths.

| Status | reason (example)                               | Retryable | Recovery                             |
| ------ | ---------------------------------------------- | --------- | ------------------------------------ |
| 400    | `badRequest`/`invalidQuery`/`invalidParameter` | No        | Fix `q`/params                       |
| 401    | `authError`/`invalidCredentials`               | Yes       | Refresh access token, retry          |
| 403    | `insufficientPermissions`                      | No        | Re-consent with needed scope         |
| 403    | `userRateLimitExceeded`/`rateLimitExceeded`    | Yes       | Backoff + retry                      |
| 403    | `fileNotDownloadable`                          | No        | Use `/files/{id}/export`             |
| 403    | `cannotDownloadAbusiveFile`                    | No        | `acknowledgeAbuse=true` (owner only) |
| 404    | `notFound`                                     | No        | Verify id/access; re-list parent     |
| 429    | `rateLimitExceeded`                            | Yes       | Backoff + retry                      |
| 5xx    | `internalError`/`backendError`                 | Yes       | Retry with backoff                   |

## Webhooks / Events

Drive supports push, but the connector is **pull-based** and does not wire it up. (Full detail in 01d.)

- **Push channels:** `POST /changes/watch` or `POST /files/{id}/watch`. Callback is **header-only (no body)** — `X-Goog-Channel-ID`, `X-Goog-Resource-State` (`sync`/`add`/`remove`/`update`/`trash`/`untrash`/`change`), `X-Goog-Resource-ID`, `X-Goog-Message-Number`, `X-Goog-Channel-Token`, `X-Goog-Changed`. Expiration max ~1 day (`files`) / ~1 week (`changes`); no auto-renew. **No HMAC** — secured by the secret `token` + HTTPS valid cert. At-least-once; dedupe on `X-Goog-Message-Number`.
- **Polling (recommended for sync):** `GET /changes/startPageToken` → save → `GET /changes?pageToken=<saved>&includeRemoved=true&includeItemsFromAllDrives=true&supportsAllDrives=true` → follow `nextPageToken`, store `newStartPageToken` for next poll. Or filter `modifiedTime > '...'` on `files.list`. Change-detection fields: `modifiedTime`, `md5Checksum`, `version`.

## SDKs & Tooling

| SDK                        | Language         | Repository                            | Notes                                                                        |
| -------------------------- | ---------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| `google-api-python-client` | Python           | `googleapis/google-api-python-client` | First-party; provider uses raw `httpx` instead — fine for this small surface |
| `googleapis`               | Node.js          | `googleapis/google-api-nodejs-client` | First-party                                                                  |
| googleapis                 | Go/Java/.NET/PHP | various                               | First-party in 6+ languages                                                  |

No first-party Postman collection. OpenAPI = Discovery Document (`https://www.googleapis.com/discovery/v1/apis/drive/v3/rest`).

## Integration Path Assessment

**Recommended: Data Connector (Files) + selective API.** Drive is a browsable file/document store with a folder graph, search, and metadata — the textbook Files-Remote provider, wired like Dropbox/OneDrive/Gmail: `surfaces:['files','chat']`, `category:'Cloud Storage'`, OAuth2 (`oauthPlatform:'google'`), backed by a Python `OAuthProvider` subclass — **not** a spec-driven `connect_request` chat-only connector (Actionstep/NetSuite/Zoho pattern). "Selective API" = the connector exposes Drive's _file_ surface (list/get/export/download) + read-only _permissions_; the write surface stays out of scope under `drive.readonly`. Backend exists at `lib/oauth-providers/oauth_providers/google_drive_provider.py`.

| Connector method  | API endpoint                                                         | Feasibility                        |
| ----------------- | -------------------------------------------------------------------- | ---------------------------------- |
| list_files        | `GET /files?q='<parent>' in parents&...` (folders = folder mimeType) | good                               |
| download_file     | `GET /files/{id}?alt=media` OR `GET /files/{id}/export?mimeType=...` | good                               |
| search_files      | `GET /files?q=name contains '...'`                                   | partial — name-only, not full-text |
| get_file_metadata | `GET /files/{id}?fields=...,permissions`                             | good                               |

## Limitations (consolidated)

1. **Read-only:** no create/rename/move/trash/delete; no permission/sharing writes (`drive.readonly` grants none).
2. **Native docs have no bytes and no `size`** — Docs/Sheets/Slides must be **exported**; `?alt=media` on a native doc → `403 fileNotDownloadable`.
3. **Inline export capped at 10 MB** — larger native files need per-format `exportLinks`.
4. **Connector search matches filenames only** (`name contains '...'`), not content — raw API supports `fullText contains`, provider does not use it.
5. **Shared-drive content silently hidden** unless both `supportsAllDrives=true` and `includeItemsFromAllDrives=true` (provider sets both).
6. **No total count** — enumerate to count; `has_subfolders` reported `false` by provider (skips the extra probe).
7. **`drive.readonly` restricted-scope verification + CASA** is a per-client production prerequisite. 🔬

_Source: investigation questionnaire + existing `google_drive_provider.py`; live smoke test pending._
