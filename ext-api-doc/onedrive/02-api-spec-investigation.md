---
api_name: 'OneDrive (Microsoft Graph)'
api_slug: 'onedrive'
base_url: 'https://graph.microsoft.com/v1.0'
version: 'v1.0 (stable)'
spec_format: 'OpenAPI 3.x + CSDL ($metadata)'
spec_url: 'https://graph.microsoft.com/v1.0/$metadata (CSDL); https://github.com/microsoftgraph/msgraph-metadata (OpenAPI)'
docs_url: 'https://learn.microsoft.com/graph/api/resources/onedrive'
date_researched: '2026-05-29'
---

# OneDrive (Microsoft Graph) — API Specification & Investigation

> Clean developer reference for the Files / OneDrive surface of Microsoft Graph. Condensed from
> the investigation questionnaire. **Doc-based, but corroborated by shipped code** — Numa already
> runs `lib/oauth-providers/oauth_providers/onedrive_provider.py` against this API in production
> (`list_files`, `download_file`, `get_file_metadata`, `search_files`). Endpoint shapes, paging,
> and the 302-download flow below are exercised by that provider, not just read from docs.

---

## Overview

- **Vendor:** Microsoft.
- **API version:** `v1.0` (stable). A `beta` host exists but **must not** be used in production.
- **Base URL:** `https://graph.microsoft.com/v1.0`. All paths here are scoped to the signed-in
  user's drive via `/me/drive`.
- **Sandbox URL:** None. Graph has no separate sandbox host — test against a real M365 tenant via
  [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer).
- **API type:** REST, OData v4.
- **Data format:** JSON for metadata; binary `application/octet-stream` for file content.
- **Documentation:** [learn.microsoft.com/graph/api/resources/onedrive](https://learn.microsoft.com/graph/api/resources/onedrive)
- **API reference:** [driveItem resource](https://learn.microsoft.com/graph/api/resources/driveitem)
- **OpenAPI spec:** CSDL at `https://graph.microsoft.com/v1.0/$metadata`; OpenAPI in
  [microsoftgraph/msgraph-metadata](https://github.com/microsoftgraph/msgraph-metadata).
- **Status page:** [Microsoft 365 Service health](https://admin.microsoft.com/) / `status.office365.com`.

**Summary:** Microsoft Graph exposes OneDrive (and SharePoint document libraries) through a single,
deliberately small model: **everything is a `driveItem`** living inside a **`drive`**. The Files
surface is browse, search, metadata, and content download — exactly what a file connector needs.

---

## Authentication

### Method: OAuth 2.0 (Authorization Code grant, Microsoft Entra)

User-context OAuth via the Microsoft Entra (Azure AD) `/common` multi-tenant endpoint. The
connector requests **read-only** `Files.Read.All`. Token handling is owned by Numa's connector
layer; callers just attach the bearer token.

**Header format:**

```
Authorization: Bearer <access_token>
Accept: application/json
```

**OAuth 2.0** (values copied verbatim from the shipped registry entry — see `03-connector-setup.md`):

| Parameter         | Value                                                                            |
| ----------------- | -------------------------------------------------------------------------------- |
| Grant type        | `authorization_code` (refresh via `refresh_token`)                               |
| Authorization URL | `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`                 |
| Token URL         | `https://login.microsoftonline.com/common/oauth2/v2.0/token`                     |
| Discovery URL     | `https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration` |
| Revocation URL    | None used — tokens are revoked in Entra; the connector relies on refresh failure |
| Token lifetime    | access ~60–90 min (Entra default, variable); refresh ~90-day inactivity, rotates |
| Refresh mechanism | `offline_access` issues a refresh token; standard `grant_type=refresh_token`     |
| PKCE required     | Recommended by Entra; confidential web-app flow (client secret) is used here     |

**Required scopes:**

| Scope                                        | Purpose                                         | Required for Integration? |
| -------------------------------------------- | ----------------------------------------------- | ------------------------- |
| `https://graph.microsoft.com/Files.Read.All` | Read all files the signed-in user can access    | Yes (registry)            |
| `offline_access`                             | Issue a refresh token for long-lived sessions   | Yes (registry)            |
| `openid` / `profile`                         | Implicit identity scopes from the v2.0 endpoint | Implicit                  |
| `Sites.Read.All`                             | Reach SharePoint-backed document libraries      | No — out of scope         |
| `Files.ReadWrite.All`                        | Write/upload/delete                             | No — read-only connector  |

> The `/common` tenant means the same app works for any work/school **or** personal Microsoft
> account. National clouds (US Gov `graph.microsoft.us`, China `microsoftgraph.chinacloudapi.cn`)
> use different hosts — Numa targets the **global** cloud only.

---

## Endpoint Catalog

### Drive & DriveItem (read-only, scoped to `/me/drive`)

| Method | Path                                 | Purpose                   | Auth | Paginated | Idempotent |
| ------ | ------------------------------------ | ------------------------- | ---- | --------- | ---------- |
| GET    | `/me/drive`                          | Get default drive         | Yes  | No        | Yes        |
| GET    | `/me/drive/root/children`            | List root items           | Yes  | Yes       | Yes        |
| GET    | `/me/drive/items/{id}/children`      | List a folder's children  | Yes  | Yes       | Yes        |
| GET    | `/me/drive/items/{id}`               | Get one item's metadata   | Yes  | No        | Yes        |
| GET    | `/me/drive/items/{id}/content`       | Download file bytes (302) | Yes  | No        | Yes        |
| GET    | `/me/drive/root/search(q='…')`       | Search the whole drive    | Yes  | Yes       | Yes        |
| GET    | `/me/drive/items/{id}/search(q='…')` | Search a folder subtree   | Yes  | Yes       | Yes        |

### Full Endpoint Index

| #   | Method | Path                                                        | Purpose               | Notes                                           |
| --- | ------ | ----------------------------------------------------------- | --------------------- | ----------------------------------------------- |
| 1   | GET    | `/me/drive`                                                 | Get default drive     | quota + `driveType`                             |
| 2   | GET    | `/me/drives`                                                | Enumerate user drives | multi-drive accounts                            |
| 3   | GET    | `/me/drive/root/children`                                   | List root             | `list_files` (no folder id) ✅ shipped          |
| 4   | GET    | `/me/drive/items/{id}/children`                             | List folder           | `list_files` (folder id) ✅ shipped             |
| 5   | GET    | `/me/drive/root:/{path}:/children`                          | List by path          | path-addressing alternative                     |
| 6   | GET    | `/me/drive/items/{id}`                                      | Get item metadata     | `get_file_metadata` ✅ shipped                  |
| 7   | GET    | `/me/drive/items/{id}/content`                              | Download bytes        | `302` → preauth URL; `download_file` ✅ shipped |
| 8   | GET    | `/me/drive/items/{id}?$select=@microsoft.graph.downloadUrl` | Get preauth URL only  | JS/CORS-safe download alt                       |
| 9   | GET    | `/me/drive/root/search(q='…')`                              | Search drive          | `search_files` (no folder) ✅ shipped           |
| 10  | GET    | `/me/drive/items/{id}/search(q='…')`                        | Search subtree        | `search_files` (folder) ✅ shipped              |
| 11  | GET    | `/me/drive/search(q='…')`                                   | Search incl. shared   | adds `remoteItem` results                       |
| 12  | GET    | `/me/drive/root/delta`                                      | Track changes         | not wired (efficient re-sync layer)             |
| 13  | GET    | `/me/drive/items/{id}/versions`                             | List versions         | out of scope                                    |
| 14  | POST   | `/subscriptions`                                            | Create change webhook | out of scope (see Webhooks)                     |

> Items can be addressed two ways: by id (`/me/drive/items/{id}`) or by path
> (`/me/drive/root:/Reports/Q1.xlsx`). The shipped provider always uses **id** addressing and
> rejects ids containing `/`, `\`, or `..` before interpolating them (path-traversal guard).

---

## Data Models

### drive

A logical container of files — a user's OneDrive or a SharePoint document library.

| Field     | Type        | Required | Writable | Description                                 |
| --------- | ----------- | -------- | -------- | ------------------------------------------- |
| id        | string      | yes      | no       | Drive identifier                            |
| driveType | string      | yes      | no       | `personal` / `business` / `documentLibrary` |
| owner     | identitySet | no       | no       | Owning user/group                           |
| quota     | quota       | no       | no       | `total` / `used` / `remaining` bytes        |
| root      | driveItem   | no       | no       | The root folder driveItem                   |

**Relationships:** a `drive` has one `root` driveItem; every driveItem belongs to exactly one drive.

### driveItem (the central entity)

A file, folder, or other item. **Type is determined by which facet is present** — there is no
`type` field. A folder has a `folder` facet; a file has a `file` facet.

| Field                          | Type           | Required | Writable | Description                                                |
| ------------------------------ | -------------- | -------- | -------- | ---------------------------------------------------------- |
| id                             | string         | yes      | no       | Unique item id within the drive (opaque)                   |
| name                           | string         | yes      | rw       | Filename + extension                                       |
| size                           | Int64          | no       | no       | Size in bytes (0 for folders)                              |
| folder                         | folder facet   | no       | no       | Present ⇒ folder; has `childCount`                         |
| file                           | file facet     | no       | no       | Present ⇒ file; has `mimeType`, `hashes`                   |
| createdDateTime                | DateTimeOffset | no       | no       | ISO 8601 creation timestamp                                |
| lastModifiedDateTime           | DateTimeOffset | no       | no       | ISO 8601 last-modified timestamp                           |
| parentReference                | itemReference  | no       | rw       | `{ driveId, id, path }` of the parent                      |
| webUrl                         | string         | no       | no       | Browser URL to view the item                               |
| eTag                           | string         | no       | no       | eTag for the whole item (metadata + content)               |
| cTag                           | string         | no       | no       | eTag for content only; **omitted for folders**             |
| file.hashes                    | hashes         | no       | no       | `quickXorHash` (business) or `sha1Hash` (personal)         |
| `@microsoft.graph.downloadUrl` | string         | no       | no       | Short-lived (~1 hr) preauth download URL; `$select` to get |
| remoteItem                     | remoteItem     | no       | no       | Present ⇒ item lives in another (shared) drive             |
| deleted                        | deleted facet  | no       | no       | Present in delta responses ⇒ item removed                  |

**Relationships:**

- An item belongs to one `drive` (`parentReference.driveId`).
- A folder-facet item has many children (`/items/{id}/children`); a non-root item has one parent
  (`parentReference.id`). The root item carries a `root` facet and has no parent.
- A `remoteItem` facet means the real item lives in another drive (shared with the user).

**Field formats:**

| Format   | Example                | Notes                                         |
| -------- | ---------------------- | --------------------------------------------- |
| DateTime | `2026-05-28T08:22:10Z` | ISO 8601 UTC `DateTimeOffset`                 |
| ID       | `01ABCDEF!123`         | Opaque — never parse; treat as a black box    |
| Size     | `84213`                | Int64 bytes; `0` for folders                  |
| eTag     | `"aRDQ...0"`           | Quoted opaque string; use for `if-none-match` |

---

## Pagination

- **Type:** opaque cursor — `@odata.nextLink` (which carries a `$skiptoken`).
- **Default page size:** 200 (Graph default).
- **Max page size:** 999 (`$top` cap the provider enforces; Graph's documented max).
- **Total count:** not returned by default; `$count` is unreliable on driveItem collections.

**Parameters:**

| Parameter    | Type | Default | Description                                          |
| ------------ | ---- | ------- | ---------------------------------------------------- |
| `$top`       | int  | 200     | Items per page (provider caps at 999)                |
| `$skiptoken` | str  | —       | Cursor extracted from the previous `@odata.nextLink` |

**Response structure:**

```json
{
  "value": [
    /* driveItems */
  ],
  "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/drive/root/children?$top=100&$skiptoken=UGFnZTI"
}
```

**Last page detection:** `@odata.nextLink` is **absent** from the response.

> The shipped provider follows pagination by URL-parsing `@odata.nextLink` and reading its
> `$skiptoken` query param, then re-issuing the request with `$skiptoken=…`. You can equally
> follow the `@odata.nextLink` URL verbatim.

---

## Rate Limits

| Scope                       | Limit                                          | Window  |
| --------------------------- | ---------------------------------------------- | ------- |
| Per app + tenant            | Variable; Graph does not publish fixed numbers | rolling |
| SharePoint/OneDrive backend | Additional per-resource limits apply           | rolling |

**Headers:**

| Header        | Meaning                                      |
| ------------- | -------------------------------------------- |
| `Retry-After` | Seconds to wait before retrying (on 429/503) |

**When exceeded:** `429 TooManyRequests` (sometimes `503 serviceNotAvailable`) with a `Retry-After`
header.

**Recommended strategy:** honor `Retry-After`; if absent, exponential backoff. The shipped provider
retries up to **3 times** (`max_retries = 3`), sleeping the `Retry-After` value or an exponential
fallback before each retry.

---

## Error Handling

**Standard error format (all Graph errors):**

```json
{
  "error": {
    "code": "itemNotFound",
    "message": "The resource could not be found.",
    "innerError": {
      "code": "itemNotFound",
      "request-id": "94fb…3aa2",
      "date": "2026-05-29T12:51:51"
    }
  }
}
```

**Status codes:**

| Status | Meaning (`error.code`)                     | Retryable | Recovery                         |
| ------ | ------------------------------------------ | --------- | -------------------------------- |
| 400    | `invalidRequest`                           | No        | Fix request                      |
| 401    | `InvalidAuthenticationToken`               | Yes       | Refresh token, retry             |
| 403    | `accessDenied`                             | No        | Re-consent / add scope           |
| 404    | `itemNotFound`                             | No        | Verify the item/folder id        |
| 409    | `nameAlreadyExists`                        | Maybe     | Backoff (N/A for reads)          |
| 410    | `resyncRequired`                           | Yes       | Stale delta token — restart      |
| 422    | (validation)                               | No        | Fix fields (N/A for reads)       |
| 429    | `TooManyRequests` / `activityLimitReached` | Yes       | Honor `Retry-After`              |
| 5xx    | `generalException` / `serviceNotAvailable` | Yes       | Honor `Retry-After` else backoff |

> **Support tip:** capture `request-id` / `client-request-id` from the response — Microsoft support
> needs these to trace a failed call.

---

## Webhooks / Events

OneDrive supports change notifications **and** a pull-based delta feed, but **neither is wired into
this connector**.

- **Webhooks (`POST /subscriptions`):** subscribe to `/me/drive/root` with a `notificationUrl`,
  `changeType`, and `expirationDateTime` (max ~3-day TTL, must renew). On creation Graph sends a
  `validationToken` query param that the endpoint must echo back as `200 text/plain` within 10s.
  Notifications are **change hints, not the changed data** — on receipt you call `delta` to learn
  what actually changed.
- **Delta (`/me/drive/root/delta`):** pull-based incremental sync. Returns pages with
  `@odata.nextLink`, then a final `@odata.deltaLink` to persist. `?token=latest` returns just the
  current deltaLink without enumerating everything. Deleted items carry a `deleted` facet.

**Polling fallback:** use **delta** with a stored `@odata.deltaLink` — never re-list `children`
(paging can miss items written mid-enumeration). delta is far cheaper than repeated full listings.

---

## Known Limitations

1. **Read-only.** `Files.Read.All` only — no upload/modify/move/copy/delete, no sharing/permissions.
2. **`/me/drive` only.** No `Sites.Read.All`, so SharePoint document libraries and other users'
   drives are not reachable.
3. **Per-tenant throttling thresholds are unpublished** — always honor `Retry-After`.
4. **`$filter` support on driveItems is patchy** — use the full-text `search(q='…')` function for
   discovery, not `$filter`. The shipped connector never uses `$filter`.
5. **Download is a 302 to a third-party host** — the bearer token must not be forwarded to the
   redirect target (token-leak risk).

---

## SDKs & Tooling

| SDK          | Language | Repository                                       | Quality | Notes                                             |
| ------------ | -------- | ------------------------------------------------ | ------- | ------------------------------------------------- |
| msgraph-sdk  | Python   | github.com/microsoftgraph/msgraph-sdk-python     | good    | Numa calls Graph via raw `httpx`; SDK adds weight |
| graph-client | Node     | github.com/microsoftgraph/msgraph-sdk-javascript | good    | Useful if a Node lambda ever needs Graph          |
| MSAL         | Py/Node  | github.com/AzureAD (msal-python, msal-node)      | good    | Auth only — token handling is Numa's wizard       |

**Postman collection:** Microsoft Graph Postman collection (published by Microsoft).
**OpenAPI spec:** CSDL `$metadata` + msgraph-metadata repo (see Overview).

---

## Integration Path Assessment

**Recommended path:** **Data Connector (Files)** — Files Remote + selective Graph API.

**Justification:** OneDrive is a pure file/folder store, and Numa **already ships** a file-browsing
backend for it: `lib/oauth-providers/oauth_providers/onedrive_provider.py` subclasses `OAuthProvider`
and implements `list_files`, `download_file`, `get_file_metadata`, and `search_files` against Graph.
The registry sets `surfaces: ['files', 'chat']` and `cachingPolicy: CACHING_PRESETS.cloudStorage` —
the same pattern as Google Drive and Dropbox. This is **not** the spec-driven, chat-only "Direct API
via connect_request" path used by NetSuite / Actionstep / simPRO (those have no `lib/oauth-providers/`
class). OneDrive sits in the **file-browsing layer**, surfaced through Files Remote, with the same
selective Graph endpoints also reachable from chat.

**Connector compatibility:**

| Connector Method  | API Endpoint                                              | Feasibility | Status          |
| ----------------- | --------------------------------------------------------- | ----------- | --------------- |
| list_files        | `GET /me/drive/root/children` · `/items/{id}/children`    | good        | ✅ shipped      |
| download_file     | `GET /me/drive/items/{id}/content` (302 → preauth URL)    | good        | ✅ shipped      |
| search_files      | `GET /me/drive/root/search(q='…')` · `/items/{id}/search` | good        | ✅ shipped      |
| get_file_metadata | `GET /me/drive/items/{id}?$select=…,cTag,eTag,…`          | good        | ✅ shipped      |
| upload_file       | `PUT /me/drive/items/{id}/content` / upload session       | n/a         | ❌ out of scope |
| delete_file       | `DELETE /me/drive/items/{id}`                             | n/a         | ❌ out of scope |

---

_Researched 2026-05-29 (documentation + shipped-provider corroboration). Source: investigation
questionnaire. Companion files: `01-llm-api-rules.md` (+ 01a–01d), `03-connector-setup.md`,
`04-connection-and-reauth.md`._
