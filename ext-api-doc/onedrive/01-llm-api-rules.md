---
api_name: 'OneDrive (Microsoft Graph)'
api_slug: 'onedrive'
version: 'Graph v1.0'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
line_count_target: '< 300 lines'
---

# OneDrive (Microsoft Graph) — Workspace Agent API Rules

> **Loaded into the workspace agent's context when the OneDrive integration is active.**
> OneDrive is a **file-browsing data connector** (Files Remote surface), not a chat-only action API.
> The model is tiny: **everything is a `driveItem`** inside a **`drive`**. A folder is "an item with a
> `folder` facet"; a file is "an item with a `file` facet" — there is no `type` field.
> Companion files (01a–01d) hold the detailed reference.

## Context

- **API:** Microsoft Graph `v1.0` (REST, JSON, OData v4). **Never** use the `beta` host in production.
- **Base URL:** `https://graph.microsoft.com/v1.0`. All paths are scoped to the signed-in user's
  drive via `/me/drive`. Item content downloads `302`-redirect to a `*.1drv.com` / SharePoint host.
- **Auth:** OAuth 2.0 (authorization code, Microsoft Entra `/common`), `Files.Read.All` —
  **read-only**. Bearer token, managed by Numa's connector layer.
- **Integration path:** Data Connector (Files) — Files Remote + selective Graph API. Backed by the
  shipped provider `lib/oauth-providers/oauth_providers/onedrive_provider.py`.
- **Rate limits:** HTTP `429` with `Retry-After`; per-tenant thresholds are unpublished — back off.

## Auth Structure

Bearer token in the `Authorization` header. The token is managed by Numa's connector layer;
you do not handle the OAuth dance yourself.

```
Authorization: Bearer <access_token>
Accept: application/json
```

**Token lifecycle:**

- Access token lives ~60–90 min (Entra default, variable). Refresh is automatic via `offline_access`.
- Scope is `https://graph.microsoft.com/Files.Read.All offline_access` — read-only across all files
  the user can access. No `Sites.Read.All`, so SharePoint-backed drives are **not** reachable.

## Capabilities

### CAN

1. Browse the user's OneDrive — root (`/me/drive/root/children`) and any folder by id, with paging.
2. Search files by keyword across **filename, metadata, AND file content** (`search(q='…')`).
3. Download file content (up to 100 MB) for analysis/summarization.
4. Fetch detailed metadata (size, hashes, timestamps, `eTag`, `webUrl`) for a given item.

### CANNOT

1. Upload, modify, move, copy, or delete files — read-only `Files.Read.All`; no write methods wired.
2. Manage sharing/permissions (`/permissions`, `/invite`, `/createLink`).
3. Reach SharePoint document libraries or other users' drives — `/me/drive` only.

## Critical Gotchas

> Things that will cause errors if you get them wrong.

1. **Facet presence defines type:** a folder has a `folder` facet, a file has a `file` facet. Never
   look for a `type` field — there isn't one. Branch on `'folder' in item`.
2. **Download is a 302 — strip the token on the redirect:** `GET …/content` returns `302 Found`
   with a `Location:` to a short-lived preauth URL. **Do NOT forward `Authorization`** to that host
   (the provider uses `follow_redirects=False` and re-requests `Location` with no auth header).
3. **Item IDs are opaque — never parse, never interpolate raw:** the provider rejects ids containing
   `/`, `\`, or `..` to block path traversal before building URLs. Treat ids as black boxes.
4. **`@microsoft.graph.downloadUrl` is short-lived (~1 hr) and preauth:** fetch per-download, never
   cache. `cTag` is omitted for folders — don't rely on it for directory items.
5. **Prefer `search()` over `$filter`:** `$filter` support on driveItem collections is patchy; the
   full-text `search(q='…')` function is the canonical discovery path. The connector never uses `$filter`.
6. **Hash algo differs by account:** `quickXorHash` for Business/SharePoint, `sha1Hash` for personal.
   The provider prefers `sha1Hash`, then falls back to `quickXorHash`.

## Default Parameters

| Parameter    | Default                                                                                | Reason                                  |
| ------------ | -------------------------------------------------------------------------------------- | --------------------------------------- |
| `$top`       | 100 (provider caps at 999, Graph max)                                                  | Balance latency vs round-trips          |
| `$select`    | `id,name,size,createdDateTime,lastModifiedDateTime,parentReference,webUrl,folder,file` | Minimal payload for listing             |
| folder scope | root (`/me/drive/root/children`) when no folder id given                               | Start at the drive root                 |
| max download | 100 MB (`MAX_DOWNLOAD_SIZE`)                                                           | Size guard checked via `Content-Length` |

## Working Examples

### Example 1: List the root folder (paged)

```http
GET /me/drive/root/children?$top=100&$select=id,name,size,createdDateTime,lastModifiedDateTime,parentReference,webUrl,folder,file
Authorization: Bearer <token>
Accept: application/json
```

```json
{
  "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users('me')/drive/root/children",
  "value": [
    {
      "id": "01ABC...XYZ",
      "name": "Quarterly Reports",
      "parentReference": { "driveId": "b!xyz", "id": "01ROOT..." },
      "folder": { "childCount": 8 }
    },
    {
      "id": "01ABC...123",
      "name": "Budget.xlsx",
      "size": 84213,
      "lastModifiedDateTime": "2026-05-28T08:22:10Z",
      "webUrl": "https://contoso-my.sharepoint.com/.../Budget.xlsx",
      "file": {
        "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "hashes": { "quickXorHash": "AbC123..." }
      }
    }
  ],
  "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/drive/root/children?$top=100&$skiptoken=UGFnZTI"
}
```

### Example 2: Search the whole drive by keyword

```http
GET /me/drive/root/search(q='invoice%202026')?$top=50
Authorization: Bearer <token>
Accept: application/json
```

```json
{
  "value": [
    {
      "id": "0123456789abc!123",
      "name": "Invoice 2026-04.pdf",
      "size": 20481,
      "lastModifiedDateTime": "2026-04-30T10:02:11Z",
      "file": { "mimeType": "application/pdf" },
      "parentReference": { "id": "01ROOT..." }
    }
  ],
  "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/drive/root/search(q='invoice 2026')?$skiptoken=1asd..."
}
```

> The connector URL-encodes `q` (`quote(query, safe="")`) before placing it inside `(q='…')`.

### Example 3: Get a single item's metadata

```http
GET /me/drive/items/01ABC...123?$select=id,name,size,createdDateTime,lastModifiedDateTime,parentReference,file,cTag,eTag,webUrl
Authorization: Bearer <token>
Accept: application/json
```

```json
{
  "id": "01ABC...123",
  "name": "Budget.xlsx",
  "size": 84213,
  "lastModifiedDateTime": "2026-05-28T08:22:10Z",
  "eTag": "\"aRDQ...0\"",
  "cTag": "\"aYzp...256\"",
  "file": { "mimeType": "application/vnd...sheet", "hashes": { "quickXorHash": "AbC123..." } },
  "parentReference": { "driveId": "b!xyz", "id": "01ROOT..." },
  "webUrl": "https://contoso-my.sharepoint.com/.../Budget.xlsx"
}
```

### Example 4: Download file content (note the 302)

```http
GET /me/drive/items/01ABC...123/content
Authorization: Bearer <token>
```

```http
HTTP/1.1 302 Found
Location: https://b0mpua-by3301.files.1drv.com/y23vmagahszhxz...
```

> Re-request the `Location` URL **without** the `Authorization` header. The preauth URL needs no
> token; forwarding the bearer token leaks it to a third-party host.

## Proxy API Operations

| Operation           | Method | Path                                 | Key Parameters                  | Notes                                |
| ------------------- | ------ | ------------------------------------ | ------------------------------- | ------------------------------------ |
| Get default drive   | GET    | `/me/drive`                          | —                               | quota, `driveType`                   |
| List root           | GET    | `/me/drive/root/children`            | `$top`, `$select`, `$skiptoken` | `list_files` (no folder id)          |
| List folder         | GET    | `/me/drive/items/{id}/children`      | `$top`, `$select`, `$skiptoken` | `list_files` (folder id)             |
| Get item metadata   | GET    | `/me/drive/items/{id}`               | `$select`                       | `get_file_metadata`                  |
| Download bytes      | GET    | `/me/drive/items/{id}/content`       | —                               | `302` → preauth URL; `download_file` |
| Search drive        | GET    | `/me/drive/root/search(q='…')`       | `$top`, `$select`, `$skiptoken` | `search_files` (no folder)           |
| Search subtree      | GET    | `/me/drive/items/{id}/search(q='…')` | `$top`, `$select`, `$skiptoken` | `search_files` (folder)              |
| Search incl. shared | GET    | `/me/drive/search(q='…')`            | `$top`                          | adds `remoteItem` results            |
| Track changes       | GET    | `/me/drive/root/delta`               | `?token=latest`                 | not yet wired (efficient re-sync)    |

## Pagination

- **Type:** opaque cursor — `@odata.nextLink` (carries a `$skiptoken`).
- **Default page size:** 200 (Graph). **Max page size:** 999 (`$top` cap the provider enforces).
- **How to paginate:** follow `@odata.nextLink` verbatim, OR extract its `$skiptoken` and reuse:

```http
GET /me/drive/root/children?$top=100&$skiptoken=UGFnZTI
```

- **Last page detection:** `@odata.nextLink` is **absent** from the response. There is no total count.

## Webhooks / Events

Change notifications (`POST /subscriptions`) and a pull-based **delta** feed (`/me/drive/root/delta`)
both exist but are **not wired** into this connector. For incremental sync, use **delta** with a
stored `@odata.deltaLink` — never re-list `children` (paging can miss items written mid-enumeration).
See 01d. Notifications are **change hints, not the changed data** — you then call `delta` to learn what changed.

## Error Handling

**Standard error format (all Graph errors):**

```json
{
  "error": {
    "code": "itemNotFound",
    "message": "The resource could not be found.",
    "innerError": { "code": "itemNotFound", "request-id": "94fb...3aa2", "date": "2026-05-29T12:51:51" }
  }
}
```

**Recovery by status:**

| Status | Meaning                                    | Action                                          |
| ------ | ------------------------------------------ | ----------------------------------------------- |
| 400    | `invalidRequest`                           | Fix request parameters                          |
| 401    | `InvalidAuthenticationToken`               | Refresh token and retry                         |
| 403    | `accessDenied`                             | Insufficient scope/license — re-consent         |
| 404    | `itemNotFound`                             | Verify the item/folder id                       |
| 409    | `nameAlreadyExists`                        | Concurrency conflict — backoff (N/A for reads)  |
| 410    | `resyncRequired`                           | Stale delta token — restart delta from scratch  |
| 429    | `TooManyRequests`                          | Honor `Retry-After` (provider retries up to 3×) |
| 5xx    | `generalException` / `serviceNotAvailable` | Honor `Retry-After`; else backoff               |

> **Support tip:** capture `request-id` / `client-request-id` from the response — Microsoft needs them to trace a failed call.

## Known Limitations

1. Read-only — no write/upload/delete/permissions; `/me/drive` only (no SharePoint, no other users).
2. Per-tenant throttling thresholds are unpublished — always honor `Retry-After`.
3. `$filter` support on driveItems is patchy — use `search()` for discovery, not `$filter`.

---

_Generated from investigation questionnaire. See companion files:_

- _01a-domain-model-reference.md — drive + driveItem entities, facets, relationships, business rules_
- _01b-query-patterns.md — browse, search, field selection, cursor pagination_
- _01c-mutation-patterns.md — N/A (read-only connector)_
- _01d-event-and-error-handling.md — delta/subscriptions, error envelope, retry, file handling_
