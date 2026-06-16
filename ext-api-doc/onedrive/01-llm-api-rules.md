---
api_name: OneDrive (Microsoft Graph)
api_slug: onedrive
graph_version: v1.0 (stable; label only — NOT a path prefix, it IS the host suffix below)
base_url: https://graph.microsoft.com/v1.0
path_scope: /me/drive (signed-in user's drive only; no SharePoint, no other users)
path_construction: base_url + literal path (e.g. /me/drive/root/children); NO extra version segment
auth: OAuth2 Bearer (Files.Read.All offline_access, read-only); token managed by Numa connector layer
field_casing: camelCase
id_format: opaque string (e.g. 01ABC...123, D4648F06C91D9D3D!54927) — never parse/interpolate raw
rate_limit: 429 + Retry-After; per app+tenant, unpublished — back off
call_surface: file-browse CLI — `numa integrations list-files|search-files|download-file|get-file-metadata`. NOT `numa integrations request`. Read-only Files-Remote connector backed by lib/oauth-providers/oauth_providers/onedrive_provider.py.
confidence: facts confirmed against docs + shipped provider 2026-05-29 unless tagged [INFERRED]/[DOCUMENTED]
companions: 01a=domain-model, 01b=query-patterns, 01c=mutations(N/A read-only), 01d=events+errors
---

# OneDrive (Microsoft Graph) — API Rules

## Call surface (read first)

- **File-browse data connector** (Files Remote), NOT a chat-action API. Drive it via the file CLI: `list-files`, `search-files`, `download-file`, `get-file-metadata`. Do **NOT** use `numa integrations request`.
- Model is tiny: **everything is a `driveItem`** inside a **`drive`**. Folder = item with a `folder` facet; file = item with a `file` facet. **There is no `type` field** — branch on `'folder' in item`.

## Paths

- Base host: `https://graph.microsoft.com/v1.0`. Append the literal path: `/me/drive/root/children` → `https://graph.microsoft.com/v1.0/me/drive/root/children`.
- `v1.0` is the **host suffix**, the stable API version. There is **no additional version segment** in the resource path. Never use the `beta` host in production.
- All paths scoped to `/me/drive` (signed-in user). No `Sites.Read.All` → SharePoint document libraries and other users' drives are unreachable.
- Items addressed by id (`/me/drive/items/{id}`) — the provider always uses id addressing. Path addressing (`/me/drive/root:/Reports/Q1.xlsx`) exists but is unused.

## Auth

`Authorization: Bearer <access_token>` + `Accept: application/json`. Token managed by Numa's connector layer — you do not run the OAuth dance.

- OAuth2 authorization-code, Microsoft Entra `/common` multi-tenant. Scope `https://graph.microsoft.com/Files.Read.All offline_access` — **read-only**, plus refresh token.
- Access token ~60–90 min; auto-refreshed via `offline_access` (rotating refresh token).

## CAN

1. Browse the user's OneDrive — root (`/me/drive/root/children`) and any folder by id, paged.
2. Search by keyword across **filename, metadata, AND file content** (`search(q='…')`).
3. Download file content (≤ 100 MB) for analysis/summarization.
4. Fetch item metadata (size, hashes, timestamps, `eTag`, `webUrl`).

## CANNOT

1. Upload/modify/move/copy/delete files — read-only `Files.Read.All`, no write methods wired. Any write → `403 accessDenied` (expected, not a bug; don't retry).
2. Manage sharing/permissions (`/permissions`, `/invite`, `/createLink`).
3. Reach SharePoint libraries or other users' drives — `/me/drive` only.
4. `$filter` reliably (patchy on driveItems) — use `search()` for discovery; the connector never sends `$filter`.

## Gotchas

1. **Facet defines type:** folder has `folder` facet, file has `file` facet. No `type` field. Branch on `'folder' in item`.
2. **Download is a 302 — strip the token:** `GET …/content` → `302 Found` with `Location:` to a short-lived preauth host (`*.1drv.com` / SharePoint). Re-request `Location` with **NO `Authorization` header** (provider: `follow_redirects=False`, then re-request with only `User-Agent`). Forwarding the bearer leaks it to a third party.
3. **Item IDs opaque — never parse:** provider rejects ids containing `/`, `\`, or `..` (regex `[/\\\.]{2,}|[/\\]`) before building URLs (`OAuthError INVALID_ID`, path-traversal guard). Treat as black boxes.
4. **`@microsoft.graph.downloadUrl` is short-lived (~1 hr) and preauth:** fetch per-download, never cache.
5. **`cTag` omitted for folders** — don't rely on it for directory items.
6. **Hash algo differs by account:** `quickXorHash` for Business/SharePoint, `sha1Hash` for personal. Provider prefers `sha1Hash`, falls back to `quickXorHash`.
7. **Results under `value`**, not top-level. Errors under top-level `error` key — detect by its presence, not status alone.
8. **No total count** — page until `@odata.nextLink` is absent; say "and more" when paging continues.
9. **Size guard:** downloads > 100 MB (`MAX_DOWNLOAD_SIZE`) rejected (`FILE_TOO_LARGE`), checked via `Content-Length` on both the 302 redirect and the final response.

## Defaults (override only if the user specifies)

| Param        | Default                                                                                | Reason                          |
| ------------ | -------------------------------------------------------------------------------------- | ------------------------------- |
| `$top`       | 100 (provider caps at 999, Graph max)                                                  | latency vs round-trips          |
| `$select`    | `id,name,size,createdDateTime,lastModifiedDateTime,parentReference,webUrl,folder,file` | minimal listing payload         |
| folder scope | root (`/me/drive/root/children`) when no folder id                                     | start at drive root             |
| max download | 100 MB (`MAX_DOWNLOAD_SIZE`)                                                           | size guard via `Content-Length` |

## Operations

| Operation           | Method | Path                                 | CLI / Notes                             |
| ------------------- | ------ | ------------------------------------ | --------------------------------------- |
| Get default drive   | GET    | `/me/drive`                          | quota, `driveType`                      |
| List root           | GET    | `/me/drive/root/children`            | `list-files` (no folder id)             |
| List folder         | GET    | `/me/drive/items/{id}/children`      | `list-files` (folder id)                |
| Get item metadata   | GET    | `/me/drive/items/{id}`               | `get-file-metadata`                     |
| Download bytes      | GET    | `/me/drive/items/{id}/content`       | `302` → preauth URL; `download-file`    |
| Search drive        | GET    | `/me/drive/root/search(q='…')`       | `search-files` (no folder)              |
| Search subtree      | GET    | `/me/drive/items/{id}/search(q='…')` | `search-files` (folder)                 |
| Search incl. shared | GET    | `/me/drive/search(q='…')`            | adds `remoteItem` results               |
| Track changes       | GET    | `/me/drive/root/delta`               | not wired (efficient re-sync — see 01d) |

`$top`, `$select`, `$skiptoken` apply to all list/search ops. URL-encode `q` (provider: `quote(query, safe="")`) before placing it inside `(q='…')`.

## Pagination

Opaque cursor `@odata.nextLink` (embeds a `$skiptoken`). Graph default page 200; provider caps `$top` at 999. Follow `@odata.nextLink` verbatim, OR extract its `$skiptoken` and re-send: `?$top=100&$skiptoken=UGFnZTI`. Last page = `@odata.nextLink` **absent**. No total count.

## Webhooks / delta

Change notifications (`POST /subscriptions`) and pull-based **delta** (`/me/drive/root/delta`) both exist but are **NOT wired** here. For future incremental sync, use **delta** with a stored `@odata.deltaLink` — never re-list `children` (paging can miss items written mid-enumeration). Notifications are change **hints, not the data** — then call `delta`. See 01d.

## Errors

Format: `{error:{code,message,innerError:{code,request-id,date}}}`. Capture `request-id`/`client-request-id` for Microsoft support.

| Status | `error.code`                               | Action                                                               |
| ------ | ------------------------------------------ | -------------------------------------------------------------------- |
| 400    | `invalidRequest`                           | fix params (e.g. bad `$filter`)                                      |
| 401    | `InvalidAuthenticationToken`               | refresh token, retry once                                            |
| 403    | `accessDenied`                             | insufficient scope/license — re-consent / explain read-only boundary |
| 404    | `itemNotFound`                             | verify item/folder id                                                |
| 410    | `resyncRequired`                           | stale delta token — restart delta from scratch                       |
| 429    | `TooManyRequests` / `activityLimitReached` | honor `Retry-After` (provider retries up to 3×)                      |
| 5xx    | `generalException` / `serviceNotAvailable` | honor `Retry-After`, else exponential backoff                        |

## Examples

1. **List root (paged):** `GET /me/drive/root/children?$top=100&$select=id,name,size,createdDateTime,lastModifiedDateTime,parentReference,webUrl,folder,file`
   → `{"@odata.context":"…#users('me')/drive/root/children","value":[{"id":"01ABC...XYZ","name":"Quarterly Reports","parentReference":{"driveId":"b!xyz","id":"01ROOT..."},"folder":{"childCount":8}},{"id":"01ABC...123","name":"Budget.xlsx","size":84213,"lastModifiedDateTime":"2026-05-28T08:22:10Z","webUrl":"https://contoso-my.sharepoint.com/.../Budget.xlsx","file":{"mimeType":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","hashes":{"quickXorHash":"AbC123..."}}}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/me/drive/root/children?$top=100&$skiptoken=UGFnZTI"}`

2. **Search whole drive:** `GET /me/drive/root/search(q='invoice%202026')?$top=50`
   → `{"value":[{"id":"0123456789abc!123","name":"Invoice 2026-04.pdf","size":20481,"lastModifiedDateTime":"2026-04-30T10:02:11Z","file":{"mimeType":"application/pdf"},"parentReference":{"id":"01ROOT..."}}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/me/drive/root/search(q='invoice 2026')?$skiptoken=1asd..."}`

3. **Get item metadata:** `GET /me/drive/items/01ABC...123?$select=id,name,size,createdDateTime,lastModifiedDateTime,parentReference,file,cTag,eTag,webUrl`
   → `{"id":"01ABC...123","name":"Budget.xlsx","size":84213,"lastModifiedDateTime":"2026-05-28T08:22:10Z","eTag":"\"aRDQ...0\"","cTag":"\"aYzp...256\"","file":{"mimeType":"application/vnd...sheet","hashes":{"quickXorHash":"AbC123..."}},"parentReference":{"driveId":"b!xyz","id":"01ROOT..."},"webUrl":"https://contoso-my.sharepoint.com/.../Budget.xlsx"}`

4. **Download (note the 302):** `GET /me/drive/items/01ABC...123/content`
   → `HTTP/1.1 302 Found` / `Location: https://b0mpua-by3301.files.1drv.com/y23vmagahszhxz...` — re-request `Location` **without** `Authorization`.
