---
api_name: 'Google Drive'
api_slug: 'googledrive'
base_url: 'https://www.googleapis.com/drive/v3'
version: 'API v3 (REST, JSON)'
spec_format: 'Google Discovery Document (OpenAPI-equivalent)'
spec_url: 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'
docs_url: 'https://developers.google.com/workspace/drive/api'
date_researched: '2026-05-29'
---

# Google Drive — API Specification & Investigation

> Clean developer reference for the Google Drive API v3. Condensed from
> `00-api-investigation-questionnaire.md`. **Doc-based** — no live OAuth round-trip was captured
> at research time, so auth/format claims are `[DOCUMENTED]` against Google's docs, not
> `[CONFIRMED]`. Items needing a real consent are tagged 🔬. Confidence is nonetheless **high**:
> Google's docs are excellent and a working backend provider already exercises this surface
> (`lib/oauth-providers/oauth_providers/google_drive_provider.py`).

---

## Overview

- **Vendor:** Google LLC (Google Workspace).
- **API version:** v3 (stable for years; v2 is legacy and not used here).
- **Base URL:** `https://www.googleapis.com/drive/v3` (matches the provider's `BASE_URL`).
- **Sandbox URL:** None — there is no separate Drive sandbox host. You test against a real Google
  account with a test OAuth client. Use `GET /about` as a safe read-only smoke test.
- **API type:** REST. **Data format:** JSON (`application/json; charset=UTF-8`) for metadata; raw
  binary stream for `?alt=media` downloads and `/export` conversions.
- **Documentation:** [developers.google.com/workspace/drive/api](https://developers.google.com/workspace/drive/api)
- **API reference (v3):** [reference/rest/v3](https://developers.google.com/workspace/drive/api/reference/rest/v3)
- **OpenAPI spec:** Google publishes a **Discovery Document** (OpenAPI-equivalent) at
  `https://www.googleapis.com/discovery/v1/apis/drive/v3/rest`. No first-party OpenAPI 3 file; an
  unofficial mirror lives in `googleapis/google-api-go-client` (`drive/v3/drive-api.json`).
- **Status page:** [Google Workspace Status Dashboard](https://www.google.com/appsstatus/dashboard/).

**Summary:** Google Drive API v3 is a REST API over a user's Drive — files, folders, shared
drives, permissions, and a change feed. In Numa it is wired as a **read-only file-browsing
connector** (browse / search / download / export), not an action API.

---

## Authentication

### Method: OAuth 2.0 (Authorization Code grant, web-server flow)

User-context only. Every call carries a bearer access token. The connector layer (Numa's OAuth
wizard + relay) runs the authorize/token/refresh dance; the API itself just validates the bearer.

**Header format:**

```
Authorization: Bearer <access_token>
Accept: application/json
```

**OAuth 2.0:** (values taken verbatim from the registry entry — see `03-connector-setup.md`)

| Parameter         | Value                                                                |
| ----------------- | -------------------------------------------------------------------- |
| Grant type        | `authorization_code` (refresh via `refresh_token`)                   |
| Authorization URL | `https://accounts.google.com/o/oauth2/v2/auth`                       |
| Token URL         | `https://oauth2.googleapis.com/token`                                |
| Revocation URL    | `https://oauth2.googleapis.com/revoke`                               |
| Discovery URL     | `https://accounts.google.com/.well-known/openid-configuration`       |
| Token lifetime    | access ~3600s (1h); refresh long-lived, **does not rotate** per call |
| Refresh mechanism | `POST` `grant_type=refresh_token` to the token URL                   |
| PKCE required     | No (supported by Google; not required for confidential web clients)  |

**Extra authorize params:** `{"access_type":"offline","prompt":"consent"}` — this is what
guarantees a `refresh_token` is issued. Google omits the refresh token on re-consent unless
`prompt=consent` is sent. [DOCUMENTED]

**Required scopes:**

| Scope                                            | Purpose                                         | Required for Integration?            |
| ------------------------------------------------ | ----------------------------------------------- | ------------------------------------ |
| `https://www.googleapis.com/auth/drive.readonly` | Read all of the user's Drive metadata + content | Yes (the only scope in the registry) |

> ⚠️ **`drive.readonly` is a Google RESTRICTED scope.** A production OAuth app using it must pass
> **OAuth app verification AND an annual third-party CASA security assessment** before non-test
> users can consent. This is a real per-client onboarding cost — flag it early. 🔬 (verification is
> per-Google-Cloud-project; each client's own OAuth client must be verified). [DOCUMENTED]

**Documented token response shape:**

```json
{
  "access_token": "ya29.a0Af...",
  "expires_in": 3599,
  "refresh_token": "1//0gFp...",
  "scope": "https://www.googleapis.com/auth/drive.readonly",
  "token_type": "Bearer"
}
```

---

## Endpoint Catalog

All paths are relative to `https://www.googleapis.com/drive/v3`. The connector uses the read-only
subset; write verbs exist in the API but are **out of scope** under `drive.readonly`.

### Files (`/files`)

| Method | Path                    | Purpose                      | Auth | Paginated         | Idempotent |
| ------ | ----------------------- | ---------------------------- | ---- | ----------------- | ---------- |
| GET    | `/files`                | List / search / browse       | Yes  | Yes (`pageToken`) | Yes        |
| GET    | `/files/{id}`           | Get single file metadata     | Yes  | No                | Yes        |
| GET    | `/files/{id}?alt=media` | Download binary file content | Yes  | No                | Yes        |
| GET    | `/files/{id}/export`    | Export a Google-native doc   | Yes  | No                | Yes        |
| POST   | `/files`                | Create file (out of scope)   | Yes  | No                | No         |
| PATCH  | `/files/{id}`           | Update file (out of scope)   | Yes  | No                | No         |
| DELETE | `/files/{id}`           | Delete file (out of scope)   | Yes  | No                | Yes        |

### Permissions (`/files/{id}/permissions`)

| Method | Path                               | Purpose            | Auth | Paginated | Idempotent |
| ------ | ---------------------------------- | ------------------ | ---- | --------- | ---------- |
| GET    | `/files/{id}/permissions`          | List ACL on a file | Yes  | Yes       | Yes        |
| GET    | `/files/{id}/permissions/{permId}` | Get one permission | Yes  | No        | Yes        |

> The provider does not call `/permissions` directly — it requests `permissions` as a sub-field of
> `GET /files/{id}` via `fields=...,permissions`. Same data, one round-trip. [DOCUMENTED]

### Shared drives (`/drives`)

| Method | Path           | Purpose                          | Auth | Paginated | Idempotent |
| ------ | -------------- | -------------------------------- | ---- | --------- | ---------- |
| GET    | `/drives`      | List shared drives the user sees | Yes  | Yes       | Yes        |
| GET    | `/drives/{id}` | Get one shared drive             | Yes  | No        | Yes        |

### Changes (`/changes`) — incremental sync (not wired up in the connector)

| Method | Path                      | Purpose                                | Auth | Paginated | Idempotent |
| ------ | ------------------------- | -------------------------------------- | ---- | --------- | ---------- |
| GET    | `/changes/startPageToken` | Get the current change cursor (seed)   | Yes  | No        | Yes        |
| GET    | `/changes`                | List changes since a saved token       | Yes  | Yes       | Yes        |
| POST   | `/changes/watch`          | Register a push channel (out of scope) | Yes  | No        | No         |

### Full Endpoint Index (connector-relevant subset)

| #   | Method | Path                              | Purpose                 | Notes                                        |
| --- | ------ | --------------------------------- | ----------------------- | -------------------------------------------- |
| 1   | GET    | `/files`                          | List / browse / search  | Core endpoint; `q` DSL + `pageToken`         |
| 2   | GET    | `/files/{id}`                     | Metadata                | Use `fields` selector to control payload     |
| 3   | GET    | `/files/{id}?alt=media`           | Download binary bytes   | 403 `fileNotDownloadable` on native docs     |
| 4   | GET    | `/files/{id}/export`              | Export native doc       | Hard 10 MB cap on inline export              |
| 5   | GET    | `/files/{id}/permissions`         | List ACL                | Or via `fields=permissions` on `/files/{id}` |
| 6   | GET    | `/drives`                         | List shared drives      | Shown as top-level "folders" by the provider |
| 7   | GET    | `/changes/startPageToken`         | Change cursor seed      | Polling sync only; not used by connector     |
| 8   | GET    | `/changes`                        | Incremental change feed | Polling sync only; not used by connector     |
| 9   | GET    | `/about?fields=user,storageQuota` | Authed user + quota     | Recommended smoke test                       |

---

## Data Models

Google Drive is a **flat file store with a folder graph overlaid via `parents`**. There is no true
directory tree: folders are themselves File resources (`mimeType =
application/vnd.google-apps.folder`).

### File

| Field            | Type     | Required | Writable | Description                                                   |
| ---------------- | -------- | -------- | -------- | ------------------------------------------------------------- |
| `id`             | string   | —        | no       | Opaque file identifier — **never parse or construct it**      |
| `name`           | string   | —        | (yes)    | Display name (file or folder)                                 |
| `mimeType`       | string   | —        | no       | `...google-apps.folder` = folder; `...google-apps.*` = native |
| `parents`        | string[] | —        | (yes)    | Parent folder ID(s) — the folder graph                        |
| `size`           | string   | —        | no       | Byte size as a **string**; **absent for Google-native docs**  |
| `md5Checksum`    | string   | —        | no       | MD5 of binary content (binary files only)                     |
| `version`        | string   | —        | no       | Monotonic internal version; useful for change detection       |
| `modifiedTime`   | RFC 3339 | —        | (yes)    | Last modification time (UTC)                                  |
| `createdTime`    | RFC 3339 | —        | no       | Creation time (UTC)                                           |
| `trashed`        | boolean  | —        | (yes)    | In trash; auto-purges ~30 days after trashing                 |
| `webViewLink`    | string   | —        | no       | Browser URL to view the file                                  |
| `webContentLink` | string   | —        | no       | Direct download URL (binary files only)                       |
| `exportLinks`    | map      | —        | no       | mimeType → export URL map (Google-native files only)          |
| `owners`         | object[] | —        | no       | Owner User objects (`displayName`, `emailAddress`)            |
| `driveId`        | string   | —        | no       | Shared-drive ID, if the file lives on a shared drive          |
| `capabilities`   | object   | —        | no       | Per-user permissions (`canDownload`, `canEdit`, …)            |
| `permissions`    | object[] | —        | no       | Embedded ACL when requested via `fields=permissions`          |

(Writable columns are parenthesised because the connector is **read-only** — writes are out of
scope under `drive.readonly`.)

**Relationships:**

- **File → File (folder):** N:1 graph via `parents[]`. Folders are Files; build the tree from
  `parents` and `mimeType = application/vnd.google-apps.folder`.
- **File → Permission:** 1:N sub-resource at `/files/{id}/permissions` (or embedded `permissions`).
- **File → Drive:** N:1 via `driveId` (only set for shared-drive items).
- **File → User (owner):** N:1 embedded `owners[]` objects (not separately fetchable).

### Permission

| Field          | Type    | Required | Writable | Description                                                                 |
| -------------- | ------- | -------- | -------- | --------------------------------------------------------------------------- |
| `id`           | string  | —        | no       | Opaque permission ID                                                        |
| `type`         | enum    | —        | (yes)    | `user` / `group` / `domain` / `anyone`                                      |
| `role`         | enum    | —        | (yes)    | `owner` / `organizer` / `fileOrganizer` / `writer` / `commenter` / `reader` |
| `emailAddress` | string  | —        | no       | Grantee email (user/group)                                                  |
| `domain`       | string  | —        | no       | Grantee domain (domain type)                                                |
| `displayName`  | string  | —        | no       | Human-readable grantee name                                                 |
| `deleted`      | boolean | —        | no       | Whether the grantee account was deleted                                     |

### Change (sync feed — not used by the connector)

`changeType` (`file` / `drive`), `time`, `removed` (boolean), `fileId`, `file` (embedded File),
`driveId`. [DOCUMENTED]

### Drive (shared drive)

`id`, `name`, `kind`. The provider lists these as top-level browsable "folders" with a
`shared-drive:<driveId>` virtual id. [DOCUMENTED]

### Key Google-native MIME types → connector export format

| Native mimeType                            | Meaning       | Connector export (`_get_export_mime_type`) |
| ------------------------------------------ | ------------- | ------------------------------------------ |
| `application/vnd.google-apps.folder`       | Folder        | n/a (not a file)                           |
| `application/vnd.google-apps.document`     | Google Doc    | DOCX (`...wordprocessingml.document`)      |
| `application/vnd.google-apps.spreadsheet`  | Google Sheet  | XLSX (`...spreadsheetml.sheet`)            |
| `application/vnd.google-apps.presentation` | Google Slides | PPTX (`...presentationml.presentation`)    |
| `application/vnd.google-apps.drawing`      | Drawing       | PDF                                        |
| `application/vnd.google-apps.form`         | Form          | ZIP                                        |
| `application/vnd.google-apps.script`       | Apps Script   | JSON (`...google-apps.script+json`)        |
| anything else `vnd.google-apps.*`          | other native  | PDF (provider default)                     |

(Mapping verified against `_get_export_mime_type` in `google_drive_provider.py`.) [DOCUMENTED]

---

## Pagination

- **Type:** cursor / opaque page token.
- **Default page size:** 100. **Max page size:** 1000 (the provider clamps with
  `min(page_size, 1000)`; the Drive docs describe the practical max as 1000 for `files.list`).
- **Total count:** **Not available** — there is no total; iterate until the token is absent.

**Parameters:**

| Parameter   | Type   | Default | Description                                   |
| ----------- | ------ | ------- | --------------------------------------------- |
| `pageSize`  | int    | 100     | Files per page (≤ 1000)                       |
| `pageToken` | string | —       | Continuation token from the previous response |

**Response structure:**

```json
{
  "kind": "drive#fileList",
  "incompleteSearch": false,
  "nextPageToken": "~!!~AI9F...",
  "files": [{ "id": "...", "name": "...", "mimeType": "..." }]
}
```

**Last page detection:** `nextPageToken` is **absent** in the response. Send the **identical**
`q` / `orderBy` on every page — the token encodes the query context. `incompleteSearch: true`
means cross-drive results are incomplete; narrow the corpus or retry. [DOCUMENTED]

---

## Rate Limits

Google uses a **quota-unit** model rather than a simple request count.

| Scope                | Limit           | Window     |
| -------------------- | --------------- | ---------- |
| Per project          | 1,000,000 units | per minute |
| Per user per project | 325,000 units   | per minute |
| Per project (egress) | 1 TB            | per day    |

**Per-method cost (approx):** read ≈ 5 units · **list ≈ 100 units** · **download ≈ 200 units** ·
edit ≈ 50 · other ≈ 5. A browse-then-download session is dominated by list/download cost.

**Headers:** Google does **not** reliably send a `Retry-After` header on quota errors.

**When exceeded:** HTTP **403** (`userRateLimitExceeded` / `rateLimitExceeded`) or **429**
(`rateLimitExceeded`).

**Recommended strategy:** truncated exponential backoff with jitter — `min((2^n) + random_ms, 64s)`.
The provider already retries via `_make_request_with_retry`. [DOCUMENTED]

```json
{
  "error": {
    "code": 403,
    "message": "User Rate Limit Exceeded",
    "errors": [{ "domain": "usageLimits", "reason": "userRateLimitExceeded", "message": "User Rate Limit Exceeded" }]
  }
}
```

---

## Error Handling

**Standard Google error envelope:**

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
        "location": "fileId",
        "locationType": "parameter"
      }
    ]
  }
}
```

**Status codes:**

| Status | Meaning (example `reason`)                         | Retryable | Recovery                             |
| ------ | -------------------------------------------------- | --------- | ------------------------------------ |
| 400    | `badRequest` / `invalidQuery` / `invalidParameter` | No        | Fix the `q`/params                   |
| 401    | `authError` / `invalidCredentials`                 | Yes       | Refresh access token, retry          |
| 403    | `insufficientPermissions`                          | No        | Re-consent with the needed scope     |
| 403    | `userRateLimitExceeded` / `rateLimitExceeded`      | Yes       | Backoff + retry                      |
| 403    | `fileNotDownloadable`                              | No        | Use `/files/{id}/export` instead     |
| 403    | `cannotDownloadAbusiveFile`                        | No        | `acknowledgeAbuse=true` (owner only) |
| 404    | `notFound`                                         | No        | Verify ID / access; re-list parent   |
| 429    | `rateLimitExceeded`                                | Yes       | Backoff + retry                      |
| 5xx    | `internalError` / `backendError`                   | Yes       | Retry with backoff                   |

> **Branch on the `reason` field, not just the HTTP code** — `403` spans both permission and
> rate-limit cases, which have completely different recovery paths. [DOCUMENTED]

---

## Webhooks / Events

Drive **does** support push notifications, but the connector is **pull-based** and does not wire
them up.

- **Push channels:** `POST /changes/watch` or `POST /files/{id}/watch` register a channel. The
  callback is **header-only (no body)** — key headers: `X-Goog-Channel-ID`,
  `X-Goog-Resource-State` (`sync` / `add` / `remove` / `update` / `trash` / `untrash` / `change`),
  `X-Goog-Resource-ID`, `X-Goog-Message-Number`, `X-Goog-Channel-Token`, `X-Goog-Changed`.
- **Expiration:** max ~1 day for `files`, ~1 week for `changes`. No auto-renew.
- **Verification:** **no HMAC** — security relies on the secret `token` you supply + HTTPS with a
  valid (non-self-signed) cert. **At-least-once** delivery; dedupe on `X-Goog-Message-Number`.

**Polling alternative (recommended for sync):** `GET /changes/startPageToken` → save the token →
`GET /changes?pageToken=<saved>&includeRemoved=true&includeItemsFromAllDrives=true&supportsAllDrives=true`
→ follow `nextPageToken`, then store `newStartPageToken` for the next poll. Or filter
`modifiedTime > '...'` on `files.list`. Change-detection fields: `modifiedTime`, `md5Checksum`,
`version`. See `01d-event-and-error-handling.md`. [DOCUMENTED]

---

## Known Limitations

1. **Read-only:** no create / rename / move / trash / delete; no permission/sharing writes
   (`drive.readonly` grants none).
2. **Google-native docs have no bytes and no `size`** — Docs/Sheets/Slides must be **exported**;
   `?alt=media` on a native doc returns `403 fileNotDownloadable`.
3. **Inline export capped at 10 MB** — larger native files must use the per-format `exportLinks`.
4. **Connector search matches filenames only** (`name contains '...'`), not file content — the raw
   API supports `fullText contains`, but the provider does not use it.
5. **Shared-drive content is silently hidden** unless both `supportsAllDrives=true` and
   `includeItemsFromAllDrives=true` are sent (the provider sets both).
6. **No total count** — enumerate to count; `has_subfolders` is reported `false` by the provider
   (it skips the extra probe).
7. **`drive.readonly` restricted-scope verification + CASA** is a per-client production
   prerequisite. 🔬

---

## SDKs & Tooling

| SDK                                     | Language         | Repository                            | Quality | Notes                                                                            |
| --------------------------------------- | ---------------- | ------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| `google-api-python-client` (googleapis) | Python           | `googleapis/google-api-python-client` | good    | First-party; the provider uses raw `httpx` instead — fine for this small surface |
| `googleapis`                            | Node.js          | `googleapis/google-api-nodejs-client` | good    | First-party                                                                      |
| googleapis                              | Go/Java/.NET/PHP | various                               | good    | First-party in 6+ languages                                                      |

**Postman collection:** None first-party. **OpenAPI spec:** Discovery Document at
`https://www.googleapis.com/discovery/v1/apis/drive/v3/rest`.

---

## Integration Path Assessment

**Recommended path:** **Data Connector (Files) + selective API.**

**Justification:** Google Drive is a browsable file/document store with a folder graph, search, and
metadata — the textbook Files-Remote provider. It is wired exactly like Dropbox / OneDrive / Gmail:
`surfaces: ['files', 'chat']`, `category: 'Cloud Storage'`, OAuth2 (`oauthPlatform: 'google'`), and
backed by a Python `OAuthProvider` subclass — **not** a spec-driven `connect_request` chat-only
connector (the Actionstep / NetSuite / Zoho pattern). The "selective API" part means the connector
exposes Drive's _file_ surface (list / get / export / download) plus read-only _permissions_; the
write surface stays out of scope under `drive.readonly`. The backend provider already exists at
`lib/oauth-providers/oauth_providers/google_drive_provider.py`.

**Connector compatibility:**

| Connector Method  | API Endpoint                                                             | Feasibility                        |
| ----------------- | ------------------------------------------------------------------------ | ---------------------------------- |
| list_files        | `GET /files?q='<parent>' in parents&...` (folders = folder mimeType)     | good                               |
| download_file     | `GET /files/{id}?alt=media` **or** `GET /files/{id}/export?mimeType=...` | good                               |
| search_files      | `GET /files?q=name contains '...'`                                       | partial — name-only, not full-text |
| get_file_metadata | `GET /files/{id}?fields=...,permissions`                                 | good                               |

---

_Researched 2026-05-29 (documentation-based; live smoke test pending). Source: investigation
questionnaire + the existing `google_drive_provider.py`._
