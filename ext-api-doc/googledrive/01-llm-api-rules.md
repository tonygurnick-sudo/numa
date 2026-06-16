---
api_name: Google Drive
api_slug: googledrive
underlying_api: Google Drive API v3 (REST, JSON)
base_url: https://www.googleapis.com/drive/v3
path_version_segment: /drive/v3 is a REAL path segment in the base URL (part of the host path). No further version segment. "v3" is both label and path.
auth: OAuth2 Bearer (oauthPlatform=google); connector manages token + refresh
field_casing: camelCase
id_format: opaque string — never parse or construct
rate_limit: quota-unit model (no request count); 403/429 on exhaustion; Retry-After NOT reliably sent → truncated exponential backoff
call_surface: FILE-STORE connector. Use `numa integrations list-files / search-files / download-file`. Does NOT support `numa integrations request` (no HTTP-passthrough). Backend = python provider lib/oauth-providers/oauth_providers/google_drive_provider.py.
access: READ-ONLY (scope drive.readonly) — browse, search, download/export only
confidence: doc-based [DOCUMENTED] against Google docs + existing provider; nothing live-traced; tags [INFERRED] / 🔬 (needs live consent) mark non-default
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-boundary(read-only), 01d=events+errors
---

# Google Drive — API Rules

## Call surface (read first)

- This is a **file-store connector**, not an HTTP connector. Do NOT call `numa integrations request`. Use the file tools: `list-files`, `search-files`, `download-file`. The platform provider builds the actual Drive HTTP calls; this doc is context for what it does + its constraints.
- The HTTP shapes below describe what the provider issues — for your understanding, not for hand-calling.

## Paths

- Base `https://www.googleapis.com/drive/v3`. `/drive/v3` IS a real path segment (host path), not a connector-injected prefix. Endpoints are appended: `/files`, `/files/{id}`, `/files/{id}/export`, `/drives`, `/changes`, `/about`.
- Ids are opaque strings — never parse or construct them.

## Auth

`Authorization: Bearer <access_token>` + `Accept: application/json`. Connector manages the OAuth dance, token storage, refresh — you never see client id/secret and never run refresh.

- OAuth2 (Google, `oauthPlatform=google`). Scope `https://www.googleapis.com/auth/drive.readonly` (Google **RESTRICTED** scope — see gotcha 1).
- Access token ~1h (`expires_in:3599`); connector auto-refreshes with long-lived non-rotating `refresh_token`. `401` → connector refreshes + retries.

## CAN

1. Browse Drive — list folders/files in My Drive, "Shared with me", shared drives.
2. Search by **filename** (`name contains`, not content).
3. Download binary files (PDF/XLSX/images), and **export** Google-native Docs/Sheets/Slides to Office/PDF.
4. Read metadata: `size`, `modifiedTime`, `createdTime`, `parents`, `md5Checksum`, `version`, `permissions` (ACL).

## CANNOT

1. Create/rename/move/trash/delete files — `drive.readonly` grants no write. A formed write call returns `403 insufficientPermissions`.
2. Modify/grant permissions or sharing.
3. Export Google-native files > **10 MB** inline (falls back to `exportLinks`).
4. Full-text **content** search via connector — `search-files` matches `name` only, not `fullText` (raw API supports `fullText contains`; provider does not use it).
5. Webhooks/push (none wired — pull only).

## Gotchas

1. **Restricted scope = onboarding blocker.** `drive.readonly` is RESTRICTED. A production client's own OAuth app must pass **OAuth verification AND an annual CASA security assessment** before Drive works for non-test users. Per-client prerequisite, not a code gap — flag early. 🔬
2. **Root = virtual folders, not real items.** Provider top level returns `virtual:my-drive`, `virtual:shared-with-me`, and one `shared-drive:<driveId>` per shared drive. Drill-in maps: `virtual:my-drive` → `q='root' in parents` (`corpora=user`); "Shared with me" → `q=sharedWithMe=true` (`corpora=user`); shared-drive → `q='<driveId>' in parents` (`corpora=drive&driveId=<id>`). Never pass virtual ids to `/files/{id}`.
3. **Folders are files.** A folder is a File with `mimeType='application/vnd.google-apps.folder'`. No folder endpoint — detect by mimeType.
4. **Google-native docs have no bytes and no `size`.** Docs/Sheets/Slides must be **exported** via `/files/{id}/export?mimeType=...`. `?alt=media` on a native doc → `403 fileNotDownloadable`. Provider auto-branches on the `application/vnd.google-apps.` prefix: Doc→DOCX, Sheet→XLSX, Slides→PPTX, Drawing→PDF, Form→ZIP, Script→JSON, else→PDF.
5. **Shared-drive content is silently hidden** unless `supportsAllDrives=true` AND `includeItemsFromAllDrives=true` (provider sets both). Omit → files vanish, no error.
6. **`q` quoting:** values single-quoted; escape `\` and `'` inside (`\\`, `\'`). Provider escapes user input before building `name contains '<q>'`.

## Defaults (override only if user specifies)

| Param                       | Default                                                                                   | Reason                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `q` base clause             | `trashed=false`                                                                           | Hide trash                                                   |
| `pageSize`                  | 100 (≤1000; provider clamps `min(n,1000)`)                                                | API max 1000                                                 |
| `supportsAllDrives`         | `true`                                                                                    | Don't hide shared-drive content                              |
| `includeItemsFromAllDrives` | `true`                                                                                    | Same                                                         |
| `orderBy`                   | `folder,modifiedTime desc`                                                                | Folders first, newest first                                  |
| `fields` (list)             | `nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime,parents,webViewLink)` | Trim payload — ALWAYS set `fields`; default resource is huge |

## Operations (underlying endpoints)

| Operation          | Method | Path                              | Key params                                                              | Notes                         |
| ------------------ | ------ | --------------------------------- | ----------------------------------------------------------------------- | ----------------------------- |
| List / browse      | GET    | `/files`                          | `q`, `pageSize`, `pageToken`, `fields`, `orderBy`, `corpora`, `driveId` | Folder = folder mimeType      |
| Search             | GET    | `/files`                          | `q=name contains '...'`                                                 | Name match only via connector |
| Get metadata       | GET    | `/files/{id}`                     | `fields`, `supportsAllDrives`                                           | Includes `permissions`        |
| Download binary    | GET    | `/files/{id}?alt=media`           | `supportsAllDrives`                                                     | NOT for native docs           |
| Export native      | GET    | `/files/{id}/export`              | `mimeType`                                                              | 10 MB cap                     |
| List shared drives | GET    | `/drives`                         | `pageSize`, `fields`                                                    | Shown as top-level folders    |
| Smoke test         | GET    | `/about?fields=user,storageQuota` | —                                                                       | Confirms token + scope        |

## Pagination

Opaque **page token** (`pageToken` → `nextPageToken`). Default size 100, max 1000. **No total count** — enumerate to count. Loop: send SAME `q`/`orderBy` every page plus `pageToken`; stop when `nextPageToken` absent. `incompleteSearch:true` = cross-drive results partial — narrow corpus + retry.

## Errors

Standard Google envelope:
`{"error":{"code":404,"message":"File not found: 1aBcD3eFgH.","errors":[{"domain":"global","reason":"notFound","location":"fileId","locationType":"parameter"}]}}`
**Branch on `errors[].reason`, NOT the HTTP code** — `403` spans permission AND rate-limit AND wrong-download-method, all with different recovery.

| Status | reason                                         | Action                                    |
| ------ | ---------------------------------------------- | ----------------------------------------- |
| 400    | `badRequest`/`invalidQuery`/`invalidParameter` | Fix `q`/params                            |
| 401    | `authError`/`invalidCredentials`               | Connector refreshes token, retry          |
| 403    | `insufficientPermissions`                      | Re-consent / file not shared with user    |
| 403    | `userRateLimitExceeded`/`rateLimitExceeded`    | Exponential backoff + retry               |
| 403    | `fileNotDownloadable`                          | `alt=media` on native doc → use `/export` |
| 403    | `cannotDownloadAbusiveFile`                    | `acknowledgeAbuse=true` (owner only)      |
| 404    | `notFound`                                     | Verify id/access; re-list parent          |
| 429    | `rateLimitExceeded`                            | Backoff + retry                           |
| 5xx    | `internalError`/`backendError`                 | Exponential backoff (≤3)                  |

Connector guard (not a Drive error): provider raises `OAuthError(error_code="FILE_TOO_LARGE")` when `size`/`Content-Length` > `MAX_DOWNLOAD_SIZE` — surface as "file too large to pull into workspace".

## Examples

1. Browse My Drive (folder children):
   `GET /drive/v3/files?q='root' in parents and trashed=false&pageSize=100&orderBy=folder,modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,webViewLink)`
   → `{"kind":"drive#fileList","incompleteSearch":false,"nextPageToken":"~!!~AI9F...","files":[{"id":"1aBcD3eFgH","name":"Q2 Board Deck","mimeType":"application/vnd.google-apps.presentation","modifiedTime":"2026-05-20T09:14:00.000Z","parents":["0AHk...root"],"webViewLink":"https://docs.google.com/presentation/d/1aBcD3eFgH/edit"},{"id":"2xYz9wV","name":"budget.xlsx","mimeType":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","size":"204812","modifiedTime":"2026-05-18T11:02:33.000Z","parents":["0AHk...root"]}]}`
   (A folder is a file with folder mimeType. Native docs carry no `size`; binary files do.)

2. Search by filename (`name contains` = prefix/token match, NOT free substring — `name contains 'port'` does NOT match "Report"):
   `GET /drive/v3/files?q=name contains 'quarterly' and trashed=false&pageSize=100&fields=nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink)`
   → `{"files":[{"id":"9kLmN","name":"Quarterly Revenue.pdf","mimeType":"application/pdf","modifiedTime":"2026-04-01T08:00:00.000Z"}]}`

3. Get metadata + permissions:
   `GET /drive/v3/files/1aBcD3eFgH?fields=id,name,mimeType,size,modifiedTime,createdTime,parents,md5Checksum,version,permissions&supportsAllDrives=true`
   → `{"id":"1aBcD3eFgH","name":"Q2 Board Deck","mimeType":"application/vnd.google-apps.presentation","modifiedTime":"2026-05-20T09:14:00.000Z","createdTime":"2026-01-02T00:00:00.000Z","parents":["0AHk...root"],"version":"417","permissions":[{"id":"0392...","type":"user","role":"writer","emailAddress":"alex@example.com","displayName":"Alex K"}]}`

4. Download binary (non-native only; native doc → `403 fileNotDownloadable`):
   `GET /drive/v3/files/2xYz9wV?alt=media&supportsAllDrives=true` → raw bytes (`Content-Type: application/...spreadsheetml.sheet`).

5. Export native doc (hard 10 MB cap; larger → use `exportLinks`):
   `GET /drive/v3/files/1aBcD3eFgH/export?mimeType=application/vnd.openxmlformats-officedocument.presentationml.presentation` → raw PPTX bytes.
