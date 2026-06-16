---
api_name: OneDrive (Microsoft Graph)
api_slug: onedrive
base_url: https://graph.microsoft.com/v1.0
graph_version: v1.0 (stable; version is the host suffix, NOT an extra path segment)
spec_format: OpenAPI 3.x + CSDL ($metadata)
spec_url: https://graph.microsoft.com/v1.0/$metadata (CSDL); https://github.com/microsoftgraph/msgraph-metadata (OpenAPI)
docs_url: https://learn.microsoft.com/graph/api/resources/onedrive
call_surface: Data Connector (Files) — file-browse CLI (list-files/search-files/download-file/get-file-metadata), NOT chat-action `request`
integration_path: data-connector-files
date_researched: 2026-05-29
---

# OneDrive (Microsoft Graph) — API Specification & Investigation

Developer reference for the Files/OneDrive surface of Microsoft Graph. Doc-based but corroborated by shipped code: Numa runs `lib/oauth-providers/oauth_providers/onedrive_provider.py` against this API in production (`list_files`, `download_file`, `get_file_metadata`, `search_files`). Endpoint shapes, paging, and the 302-download flow below are exercised by that provider, not just read from docs.

## Overview

- **Vendor:** Microsoft. **API type:** REST, OData v4. **Data format:** JSON for metadata; binary `application/octet-stream` for file content.
- **API version:** `v1.0` (stable). `v1.0` is the **host suffix** (`https://graph.microsoft.com/v1.0`), the version — there is no additional version segment in the resource path. A `beta` host exists but **must not** be used in production.
- **Base URL:** `https://graph.microsoft.com/v1.0`. All paths here scoped to the signed-in user's drive via `/me/drive`.
- **Sandbox:** none. Graph has no separate sandbox host — test against a real M365 tenant via [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer).
- **Docs:** [learn.microsoft.com/graph/api/resources/onedrive](https://learn.microsoft.com/graph/api/resources/onedrive); ref [driveItem resource](https://learn.microsoft.com/graph/api/resources/driveitem).
- **OpenAPI:** CSDL at `https://graph.microsoft.com/v1.0/$metadata`; OpenAPI in [microsoftgraph/msgraph-metadata](https://github.com/microsoftgraph/msgraph-metadata).
- **Status:** [M365 Service health](https://admin.microsoft.com/) / `status.office365.com`.

Model: Graph exposes OneDrive (and SharePoint document libraries) through a deliberately small model — **everything is a `driveItem`** inside a **`drive`**. The Files surface is browse, search, metadata, content download.

## Authentication

OAuth 2.0 (Authorization Code grant, Microsoft Entra `/common` multi-tenant). User-context. Connector requests **read-only** `Files.Read.All`. Token handling owned by Numa's connector layer; callers attach the bearer.

```
Authorization: Bearer <access_token>
Accept: application/json
```

OAuth values (verbatim from the shipped registry — see `03-connector-setup.md`):
| Parameter | Value |
| --- | --- |
| Grant type | `authorization_code` (refresh via `refresh_token`) |
| Authorization URL | `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` |
| Token URL | `https://login.microsoftonline.com/common/oauth2/v2.0/token` |
| Discovery URL | `https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration` |
| Revocation URL | none — revoked in Entra; connector relies on refresh failure |
| Token lifetime | access ~60–90 min (Entra default, variable); refresh ~90-day inactivity, rotates |
| Refresh | `offline_access` issues refresh token; standard `grant_type=refresh_token` |
| PKCE | recommended by Entra; confidential web-app flow (client secret) used here |

Scopes:
| Scope | Purpose | Required? |
| --- | --- | --- |
| `https://graph.microsoft.com/Files.Read.All` | read all files the user can access | Yes (registry) |
| `offline_access` | issue refresh token | Yes (registry) |
| `openid` / `profile` | implicit identity from v2.0 endpoint | Implicit |
| `Sites.Read.All` | reach SharePoint document libraries | No — out of scope |
| `Files.ReadWrite.All` | write/upload/delete | No — read-only connector |

`/common` tenant → the app works for any work/school **or** personal Microsoft account. National clouds (US Gov `graph.microsoft.us`, China `microsoftgraph.chinacloudapi.cn`) use different hosts — Numa targets the **global** cloud only.

## Endpoint Catalog (read-only, scoped to `/me/drive`)

| #   | Method | Path                                                        | Purpose               | Paginated | Notes                                           |
| --- | ------ | ----------------------------------------------------------- | --------------------- | --------- | ----------------------------------------------- |
| 1   | GET    | `/me/drive`                                                 | get default drive     | No        | quota + `driveType`                             |
| 2   | GET    | `/me/drives`                                                | enumerate user drives | No        | multi-drive accounts                            |
| 3   | GET    | `/me/drive/root/children`                                   | list root             | Yes       | `list_files` (no folder id) ✅ shipped          |
| 4   | GET    | `/me/drive/items/{id}/children`                             | list folder           | Yes       | `list_files` (folder id) ✅ shipped             |
| 5   | GET    | `/me/drive/root:/{path}:/children`                          | list by path          | Yes       | path-addressing alternative                     |
| 6   | GET    | `/me/drive/items/{id}`                                      | get item metadata     | No        | `get_file_metadata` ✅ shipped                  |
| 7   | GET    | `/me/drive/items/{id}/content`                              | download bytes        | No        | `302` → preauth URL; `download_file` ✅ shipped |
| 8   | GET    | `/me/drive/items/{id}?$select=@microsoft.graph.downloadUrl` | get preauth URL only  | No        | JS/CORS-safe download alt                       |
| 9   | GET    | `/me/drive/root/search(q='…')`                              | search drive          | Yes       | `search_files` (no folder) ✅ shipped           |
| 10  | GET    | `/me/drive/items/{id}/search(q='…')`                        | search subtree        | Yes       | `search_files` (folder) ✅ shipped              |
| 11  | GET    | `/me/drive/search(q='…')`                                   | search incl. shared   | Yes       | adds `remoteItem` results                       |
| 12  | GET    | `/me/drive/root/delta`                                      | track changes         | Yes       | not wired (efficient re-sync)                   |
| 13  | GET    | `/me/drive/items/{id}/versions`                             | list versions         | —         | out of scope                                    |
| 14  | POST   | `/subscriptions`                                            | create change webhook | —         | out of scope (see Webhooks)                     |

All ops Auth=Yes, idempotent (GET). Items addressed by id (`/me/drive/items/{id}`) or path (`/me/drive/root:/Reports/Q1.xlsx`); shipped provider always uses **id** and rejects ids containing `/`, `\`, or `..` before interpolating (path-traversal guard).

## Data Models

### drive

A user's OneDrive or a SharePoint document library.
| Field | Type | Req | Writable | Description |
| --- | --- | --- | --- | --- |
| id | string | yes | no | drive id |
| driveType | string | yes | no | `personal` / `business` / `documentLibrary` |
| owner | identitySet | no | no | owning user/group |
| quota | quota | no | no | `total`/`used`/`remaining` bytes |
| root | driveItem | no | no | root folder driveItem |

A `drive` has one `root` driveItem; every driveItem belongs to exactly one drive.

### driveItem (central entity)

A file, folder, or other item. **Type = which facet is present** — no `type` field. Folder = `folder` facet; file = `file` facet.
| Field | Type | Req | Writable | Description |
| --- | --- | --- | --- | --- |
| id | string | yes | no | unique item id within drive (opaque) |
| name | string | yes | rw | filename + extension |
| size | Int64 | no | no | bytes (0 for folders) |
| folder | folder facet | no | no | present ⇒ folder; has `childCount` |
| file | file facet | no | no | present ⇒ file; has `mimeType`, `hashes` |
| createdDateTime | DateTimeOffset | no | no | ISO 8601 creation ts |
| lastModifiedDateTime | DateTimeOffset | no | no | ISO 8601 last-modified ts |
| parentReference | itemReference | no | rw | `{driveId,id,path}` of parent |
| webUrl | string | no | no | browser URL to view item |
| eTag | string | no | no | eTag for whole item (metadata + content) |
| cTag | string | no | no | eTag for content only; **omitted for folders** |
| file.hashes | hashes | no | no | `quickXorHash` (business) or `sha1Hash` (personal) |
| `@microsoft.graph.downloadUrl` | string | no | no | short-lived (~1 hr) preauth URL; `$select` to get |
| remoteItem | remoteItem | no | no | present ⇒ item lives in another (shared) drive |
| deleted | deleted facet | no | no | present in delta responses ⇒ item removed |

Relationships: item belongs to one `drive` (`parentReference.driveId`); a folder-facet item has many children (`/items/{id}/children`); a non-root item has one parent (`parentReference.id`); the root item carries a `root` facet and has no parent; a `remoteItem` facet means the real item lives in another drive (shared).

Field formats: DateTime `2026-05-28T08:22:10Z` (ISO 8601 UTC `DateTimeOffset`); ID `01ABCDEF!123` (opaque — never parse); Size `84213` (Int64 bytes, `0` for folders); eTag `"aRDQ...0"` (quoted opaque, use for `if-none-match`).

## Pagination

Opaque cursor `@odata.nextLink` (carries a `$skiptoken`). Graph default page 200; max 999 (`$top` cap the provider enforces). No total count (`$count` unreliable on driveItems).
| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `$top` | int | 200 | items/page (provider caps at 999) |
| `$skiptoken` | str | — | cursor from previous `@odata.nextLink` |

```json
{
  "value": [
    /* driveItems */
  ],
  "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/drive/root/children?$top=100&$skiptoken=UGFnZTI"
}
```

Last page = `@odata.nextLink` absent. Provider URL-parses `@odata.nextLink`, reads its `$skiptoken`, re-issues with `$skiptoken=…`; you can equally follow the `@odata.nextLink` URL verbatim.

## Rate Limits

Per app+tenant: variable, Graph publishes no fixed numbers. SharePoint/OneDrive backend adds per-resource limits. Window: rolling. When exceeded: `429 TooManyRequests` (sometimes `503 serviceNotAvailable`) with a `Retry-After` header (seconds to wait). Strategy: honor `Retry-After`; if absent, exponential backoff. Provider retries up to **3 times** (`max_retries = 3`), sleeping `Retry-After` or an exponential fallback before each retry.

## Error Handling

```json
{
  "error": {
    "code": "itemNotFound",
    "message": "The resource could not be found.",
    "innerError": { "code": "itemNotFound", "request-id": "94fb…3aa2", "date": "2026-05-29T12:51:51" }
  }
}
```

| Status | `error.code`                               | Retryable | Recovery                         |
| ------ | ------------------------------------------ | --------- | -------------------------------- |
| 400    | `invalidRequest`                           | No        | fix request                      |
| 401    | `InvalidAuthenticationToken`               | Yes       | refresh token, retry             |
| 403    | `accessDenied`                             | No        | re-consent / add scope           |
| 404    | `itemNotFound`                             | No        | verify item/folder id            |
| 409    | `nameAlreadyExists`                        | Maybe     | backoff (N/A for reads)          |
| 410    | `resyncRequired`                           | Yes       | stale delta token — restart      |
| 422    | (validation)                               | No        | fix fields (N/A for reads)       |
| 429    | `TooManyRequests` / `activityLimitReached` | Yes       | honor `Retry-After`              |
| 5xx    | `generalException` / `serviceNotAvailable` | Yes       | honor `Retry-After` else backoff |

Capture `request-id` / `client-request-id` — Microsoft support needs these to trace a failed call.

## Webhooks / Events

Change notifications **and** a pull-based delta feed exist, but **neither is wired into this connector**.

- **Webhooks (`POST /subscriptions`):** subscribe to `/me/drive/root` with `notificationUrl`, `changeType`, `expirationDateTime` (max ~3-day TTL, must renew). On creation Graph sends a `validationToken` query param the endpoint must echo back as `200 text/plain` within 10s. Notifications are **change hints, not the data** — on receipt call `delta` to learn what changed.
- **Delta (`/me/drive/root/delta`):** pull-based incremental sync. Returns pages with `@odata.nextLink`, then a final `@odata.deltaLink` to persist. `?token=latest` returns just the current deltaLink without enumerating everything. Deleted items carry a `deleted` facet.
- **Polling fallback:** use **delta** with a stored `@odata.deltaLink` — never re-list `children` (paging can miss items written mid-enumeration); delta is far cheaper.

## Limitations

1. **Read-only.** `Files.Read.All` only — no upload/modify/move/copy/delete, no sharing/permissions.
2. **`/me/drive` only.** No `Sites.Read.All` → SharePoint document libraries and other users' drives unreachable.
3. **Per-tenant throttling thresholds unpublished** — always honor `Retry-After`.
4. **`$filter` patchy on driveItems** — use full-text `search(q='…')` for discovery; connector never uses `$filter`.
5. **Download is a 302 to a third-party host** — bearer token must not be forwarded to the redirect target (token-leak risk).

## SDKs & Tooling

| SDK          | Language | Repo                                             | Notes                                             |
| ------------ | -------- | ------------------------------------------------ | ------------------------------------------------- |
| msgraph-sdk  | Python   | github.com/microsoftgraph/msgraph-sdk-python     | Numa calls Graph via raw `httpx`; SDK adds weight |
| graph-client | Node     | github.com/microsoftgraph/msgraph-sdk-javascript | useful if a Node lambda needs Graph               |
| MSAL         | Py/Node  | github.com/AzureAD (msal-python, msal-node)      | auth only — token handling is Numa's wizard       |

Postman: Microsoft Graph collection (published by Microsoft). OpenAPI: CSDL `$metadata` + msgraph-metadata repo.

## Integration Path Assessment

**Recommended: Data Connector (Files)** — Files Remote + selective Graph API. OneDrive is a pure file/folder store and Numa **already ships** a file-browsing backend: `lib/oauth-providers/oauth_providers/onedrive_provider.py` subclasses `OAuthProvider` and implements `list_files`, `download_file`, `get_file_metadata`, `search_files` against Graph. Registry sets `surfaces: ['files', 'chat']` and `cachingPolicy: CACHING_PRESETS.cloudStorage` — same pattern as Google Drive and Dropbox. This is **NOT** the spec-driven chat-only "Direct API via connect_request" path used by NetSuite/Actionstep/simPRO (those have no `lib/oauth-providers/` class). OneDrive sits in the **file-browsing layer**, surfaced through Files Remote, with the same Graph endpoints also reachable from chat.

| Connector method  | Graph endpoint                                            | Status          |
| ----------------- | --------------------------------------------------------- | --------------- |
| list_files        | `GET /me/drive/root/children` · `/items/{id}/children`    | ✅ shipped      |
| download_file     | `GET /me/drive/items/{id}/content` (302 → preauth URL)    | ✅ shipped      |
| search_files      | `GET /me/drive/root/search(q='…')` · `/items/{id}/search` | ✅ shipped      |
| get_file_metadata | `GET /me/drive/items/{id}?$select=…,cTag,eTag,…`          | ✅ shipped      |
| upload_file       | `PUT /me/drive/items/{id}/content` / upload session       | ❌ out of scope |
| delete_file       | `DELETE /me/drive/items/{id}`                             | ❌ out of scope |

Companion files: `01-llm-api-rules.md` (+ 01a–01d), `03-connector-setup.md`, `04-connection-and-reauth.md`.
