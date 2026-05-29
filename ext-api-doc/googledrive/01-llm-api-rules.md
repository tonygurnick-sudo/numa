---
api_name: 'Google Drive'
api_slug: 'googledrive'
version: 'API v3 (REST, JSON)'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
line_count_target: '< 300 lines'
---

# Google Drive — Workspace Agent API Rules

> **Loaded into the workspace agent's context when the Google Drive integration is active.**
> Google Drive is a cloud file store. This connector is **read-only**: browse, search, download.
> Companion files (01a–01d) hold the detailed reference.

## Context

- **API:** Google Drive API v3 (REST, JSON). `developers.google.com/drive/api/reference/rest/v3`.
- **Base URL:** `https://www.googleapis.com/drive/v3` (matches the provider's `BASE_URL`).
- **Auth:** OAuth 2.0 (Google, `oauthPlatform: 'google'`). Scope
  `https://www.googleapis.com/auth/drive.readonly` — a Google **RESTRICTED** scope (see gotchas).
- **Integration path:** Data Connector (Files) + selective API — surfaced in **Files > Remote** and
  chat. The executable integration is the platform provider
  (`lib/oauth-providers/oauth_providers/google_drive_provider.py`); you do **not** hand-call Drive
  HTTP endpoints from chat. Use the connector's file-browse / search / download tools. This doc is
  agent-context for what the underlying API does and its constraints.
- **Rate limits:** quota-unit model. `403`/`429` when exhausted; `Retry-After` not reliably sent →
  truncated exponential backoff.

## Auth Structure

OAuth2 bearer token on every call. The connector layer manages the OAuth dance, token storage, and
refresh — you never see the client ID/secret or run the refresh flow.

```
Authorization: Bearer <access_token>
Accept: application/json
```

**Token lifecycle:**

- Access token lives ~1 hour (`expires_in: 3599`). The connector auto-refreshes with the long-lived
  `refresh_token` (`grant_type=refresh_token`). The refresh token does **not** rotate per refresh.
- `access_type=offline` + `prompt=consent` are set on the authorize URL — that is what guarantees a
  refresh token is issued (Google omits it on re-consent otherwise). A `401` means the access token
  expired; the connector refreshes and retries.

## Capabilities

### CAN

1. Browse the user's Drive — list folders/files in My Drive, "Shared with me", and shared drives.
2. Search by **filename** across Drive (the provider uses `name contains`, not full content search).
3. Download binary files (PDF/XLSX/images/etc.) and **export** Google-native Docs/Sheets/Slides into
   Office/PDF formats for KB ingestion / chat analysis.
4. Read file metadata: `size`, `modifiedTime`, `createdTime`, `parents`, `md5Checksum`, `version`,
   and `permissions` (ACL list).

### CANNOT

1. Create, rename, move, trash, or delete files — `drive.readonly` grants no write access.
2. Modify or grant permissions / sharing.
3. Export Google-native files larger than the **10 MB** inline export cap (falls back to `exportLinks`).
4. Full-text **content** search via the connector today — `search_files` matches `name` only, not
   `fullText` (the raw API supports `fullText contains`, but the provider does not use it).

## Critical Gotchas

> Things that will cause errors if you get them wrong.

1. **Restricted scope = onboarding blocker.** `drive.readonly` is a Google **restricted** scope.
   A production client's own OAuth app must pass **OAuth verification AND an annual CASA security
   assessment** before Drive works for non-test users. This is a real per-client prerequisite, not a
   code gap — flag it early.
2. **Root is virtual folders, not real Drive items.** The provider's top level returns
   `virtual:my-drive` ("My Drive"), `virtual:shared-with-me` ("Shared with me"), and one
   `shared-drive:<driveId>` entry per shared drive. Drilling into `virtual:my-drive` maps to
   `q='root' in parents`; "Shared with me" → `q=sharedWithMe=true`; a shared-drive folder →
   `corpora=drive&driveId=<id>`. Don't treat these virtual ids as real Drive file ids.
3. **Folders are files.** A folder is a File with `mimeType =
'application/vnd.google-apps.folder'`. There is no folder endpoint — detect by mimeType.
4. **Google-native docs have no bytes and no `size`.** Docs/Sheets/Slides must be **exported** via
   `/files/{id}/export?mimeType=...` — `?alt=media` on a native doc returns `403 fileNotDownloadable`.
   The provider auto-branches on the `application/vnd.google-apps.` prefix and maps Doc→DOCX,
   Sheet→XLSX, Slides→PPTX, Drawing→PDF, Form→ZIP, Script→JSON, anything else→PDF.
5. **Shared-drive content is silently hidden** unless you pass `supportsAllDrives=true` **and**
   `includeItemsFromAllDrives=true` (the provider sets both). Omit them and shared-drive files
   vanish with no error.
6. **`q` quoting:** values are single-quoted; escape `\` and `'` inside them. The provider escapes
   user input before building `name contains '<q>'`. Never parse/construct file ids — they're opaque.

## Default Parameters

Use these defaults unless the user specifies otherwise:

| Parameter                   | Default                                                                                   | Reason                          |
| --------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------- |
| `q` base clause             | `trashed=false`                                                                           | Hide trashed items              |
| `pageSize`                  | 100 (≤ 1000)                                                                              | Provider default; API max 1000  |
| `supportsAllDrives`         | `true`                                                                                    | Don't hide shared-drive content |
| `includeItemsFromAllDrives` | `true`                                                                                    | Same                            |
| `orderBy`                   | `folder,modifiedTime desc`                                                                | Folders first, newest first     |
| `fields` (list)             | `nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime,parents,webViewLink)` | Trim payload                    |

## Working Examples

### Example 1: List a folder's contents (browse "My Drive")

```http
GET /drive/v3/files?q='root'%20in%20parents%20and%20trashed%3Dfalse&pageSize=100&orderBy=folder,modifiedTime%20desc&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,webViewLink)
Authorization: Bearer <token>
```

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

> A folder appears as a file with `mimeType: application/vnd.google-apps.folder`. Native docs (the
> deck above) carry **no `size`**; binary files (the xlsx) do.

### Example 2: Search by filename

```http
GET /drive/v3/files?q=name%20contains%20'quarterly'%20and%20trashed%3Dfalse&pageSize=100&fields=nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink)
Authorization: Bearer <token>
```

```json
{
  "files": [
    {
      "id": "9kLmN",
      "name": "Quarterly Revenue.pdf",
      "mimeType": "application/pdf",
      "modifiedTime": "2026-04-01T08:00:00.000Z"
    }
  ]
}
```

> `contains` on `name` is a **prefix/token** match, not free substring — set user expectations.

### Example 3: Get one file's metadata (incl. permissions)

```http
GET /drive/v3/files/1aBcD3eFgH?fields=id,name,mimeType,size,modifiedTime,createdTime,parents,md5Checksum,version,permissions&supportsAllDrives=true
Authorization: Bearer <token>
```

```json
{
  "id": "1aBcD3eFgH",
  "name": "Q2 Board Deck",
  "mimeType": "application/vnd.google-apps.presentation",
  "modifiedTime": "2026-05-20T09:14:00.000Z",
  "createdTime": "2026-01-02T00:00:00.000Z",
  "parents": ["0AHk...root"],
  "version": "417",
  "permissions": [
    { "id": "0392...", "type": "user", "role": "writer", "emailAddress": "alex@example.com", "displayName": "Alex K" }
  ]
}
```

### Example 4: Download a binary file (bytes)

```http
GET /drive/v3/files/2xYz9wV?alt=media&supportsAllDrives=true
Authorization: Bearer <token>
```

```
<raw binary bytes in the response body — Content-Type: application/.../spreadsheetml.sheet>
```

> Only for non-native files. On a Google-native doc this returns `403 fileNotDownloadable`.

### Example 5: Export a Google-native doc

```http
GET /drive/v3/files/1aBcD3eFgH/export?mimeType=application%2Fvnd.openxmlformats-officedocument.presentationml.presentation
Authorization: Bearer <token>
```

```
<raw PPTX bytes — exported representation of the Google Slides deck>
```

> Hard **10 MB** cap on `export`. For larger native files, use the per-format URLs in the file's
> `exportLinks` map instead.

## Proxy API Operations

> The connector exposes these as file-browse / search / download tools. Underlying endpoints:

| Operation          | Method | Path                              | Key Parameters                                                          | Notes                         |
| ------------------ | ------ | --------------------------------- | ----------------------------------------------------------------------- | ----------------------------- |
| List / browse      | GET    | `/files`                          | `q`, `pageSize`, `pageToken`, `fields`, `orderBy`, `corpora`, `driveId` | Folder = folder mimeType      |
| Search             | GET    | `/files`                          | `q=name contains '...'`                                                 | Name match only via connector |
| Get metadata       | GET    | `/files/{id}`                     | `fields`, `supportsAllDrives`                                           | Includes `permissions`        |
| Download binary    | GET    | `/files/{id}?alt=media`           | `supportsAllDrives`                                                     | Not for native docs           |
| Export native      | GET    | `/files/{id}/export`              | `mimeType`                                                              | 10 MB cap                     |
| List shared drives | GET    | `/drives`                         | `pageSize`, `fields`                                                    | Shown as top-level folders    |
| Smoke test         | GET    | `/about?fields=user,storageQuota` | —                                                                       | Confirms token + scope        |

## Pagination

- **Type:** opaque **page token** (`pageToken` → `nextPageToken`).
- **Default page size:** 100. **Max page size:** 1000 (provider clamps with `min(page_size, 1000)`).
- **How to paginate:**

```http
# Page 1
GET /files?q=trashed%3Dfalse&pageSize=100
# → { files:[...], nextPageToken:"TOKEN_A" }
# Page N — send the SAME q/orderBy plus the token
GET /files?q=trashed%3Dfalse&pageSize=100&pageToken=TOKEN_A
# → { files:[...] }   ← no nextPageToken means done
```

- **Last-page detection:** `nextPageToken` **absent**. There is **no total count** — enumerate to
  count. Send identical `q`/`orderBy` on every page; the token encodes the query context.

## Webhooks / Events

The connector is **pull-based** — it does not use webhooks. Drive _does_ support push channels
(`changes.watch`/`files.watch`, header-only notifications, ≤1-day/1-week expiry, no HMAC — secured by
a secret `token` + HTTPS) and a polling `changes` feed (`changes.startPageToken` → `changes.list`),
but neither is wired up here. For incremental re-sync use the `changes` feed or filter
`modifiedTime > '...'` on `files.list`. Change-detection fields: `modifiedTime`, `md5Checksum`,
`version`. See 01d.

## Error Handling

**Standard Google error envelope:**

```json
{
  "error": {
    "code": 404,
    "message": "File not found: 1aBcD3eFgH.",
    "errors": [{ "domain": "global", "reason": "notFound", "location": "fileId", "locationType": "parameter" }]
  }
}
```

> Branch on the **`reason`** field, not just the HTTP code — `403` spans permission _and_ rate-limit
> cases with very different recovery paths.

**Recovery by status:**

| Status | Meaning                                             | Action                                 |
| ------ | --------------------------------------------------- | -------------------------------------- |
| 400    | `badRequest`/`invalidQuery` — malformed `q`/params  | Fix the query/params                   |
| 401    | `authError` — expired/invalid token                 | Connector refreshes token, retries     |
| 403    | `insufficientPermissions` — scope/ACL too narrow    | Re-consent / file not shared with user |
| 403    | `userRateLimitExceeded`/`rateLimitExceeded` — quota | Exponential backoff, retry             |
| 403    | `fileNotDownloadable` — `alt=media` on a native doc | Use `/export` instead                  |
| 404    | `notFound` — missing or no access                   | Verify id / access; re-list parent     |
| 429    | `rateLimitExceeded` — quota                         | Backoff + retry                        |
| 5xx    | `internalError`/`backendError`                      | Retry with exponential backoff         |

## Known Limitations

1. Read-only: no upload/move/rename/delete, no sharing/permission writes.
2. Connector search matches **filenames only** (`name contains`), not file content (`fullText`).
3. Native-doc export capped at 10 MB inline; larger needs `exportLinks`.
4. No total count; `has_subfolders` is reported `false` by the provider (it skips the extra probe).
5. `drive.readonly` restricted-scope verification + CASA is a per-client production prerequisite.

---

_Generated from investigation questionnaire. See companion files for detailed reference:_

- _01a-domain-model-reference.md — File/Folder/Permission/Change/Drive entities, fields, formats_
- _01b-query-patterns.md — list, browse, search, the `q` DSL, pagination_
- _01c-mutation-patterns.md — (read-only connector; no mutations — what writes would need)_
- _01d-event-and-error-handling.md — push channels, changes feed, quota model, error reasons_
