---
api_name: OneDrive (Microsoft Graph)
api_slug: onedrive
companion_of: 01-llm-api-rules.md
scope: read ops — browse children, full-text search, field selection, sort, cursor pagination
base_url: https://graph.microsoft.com/v1.0
confidence: confirmed against docs + shipped provider unless tagged [DOCUMENTED] / [INFERRED]
---

# OneDrive — Query Patterns Reference

Discovery rule: to **browse** a known location → list `children`; to **find** a file by name/content → `search(q='…')`. **Prefer `search()` over `$filter`** — `$filter` on driveItem collections is patchy (`name` is the only reliably filterable field). The shipped connector uses `children` + `search()` and **never** `$filter`.

## Query capabilities

| Capability                 | Supported?     | Syntax                                                           | Conf         |
| -------------------------- | -------------- | ---------------------------------------------------------------- | ------------ |
| List children of a folder  | Yes            | `GET /me/drive/root/children` or `/me/drive/items/{id}/children` | confirmed    |
| Get item by id             | Yes            | `GET /me/drive/items/{id}`                                       | confirmed    |
| Get item by path           | Yes            | `GET /me/drive/root:/path/to/item`                               | [DOCUMENTED] |
| Full-text search (primary) | Yes            | `search(q='text')` over name/metadata/content                    | confirmed    |
| Field selection (sparse)   | Yes            | `$select=id,name,size,…`                                         | confirmed    |
| Sort by field              | Yes            | `$orderby=name asc` / `lastModifiedDateTime desc`                | [DOCUMENTED] |
| Include related (sideload) | Yes            | `$expand=children,thumbnails`                                    | [DOCUMENTED] |
| Filter by field value      | Limited/patchy | `$filter=name eq 'x'`                                            | [DOCUMENTED] |
| Pattern matching           | Limited        | `$filter=startswith(name,'B')`                                   | [INFERRED]   |
| Total count                | Not by default | `$count` unreliable on driveItems                                | [INFERRED]   |

## Pattern 1: Browse a folder (default)

```
GET /me/drive/root/children?$top=100&$select=id,name,size,createdDateTime,lastModifiedDateTime,parentReference,webUrl,folder,file
```

Drill into a folder by id (provider validates `{id}` against path traversal first):

```
GET /me/drive/items/01ABC...XYZ/children?$top=100&$select=id,name,size,folder,file,lastModifiedDateTime
```

Response = array under `value` + optional `@odata.nextLink`:

```json
{
  "value": [
    {
      "id": "01ABC...XYZ",
      "name": "Quarterly Reports",
      "parentReference": { "id": "01ROOT..." },
      "folder": { "childCount": 8 }
    },
    {
      "id": "01ABC...123",
      "name": "Budget.xlsx",
      "size": 84213,
      "lastModifiedDateTime": "2026-05-28T08:22:10Z",
      "file": { "mimeType": "application/vnd...sheet" }
    }
  ],
  "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/drive/root/children?$top=100&$skiptoken=UGFnZTI"
}
```

Folder vs file: branch on facet — `"folder" in item` → folder, `"file" in item` → file.

## Pattern 2: Search by keyword (discovery path)

```
GET /me/drive/root/search(q='quarterly%20budget')?$top=50
```

- `q` matches **filename, metadata, AND file content** (Bing/SharePoint backend).
- **URL-encode `q`** before placing inside `(q='…')` — provider uses `quote(query, safe="")`.
- Folder-scoped subtree search: `GET /me/drive/items/{folder-id}/search(q='…')`.
- Including items **shared** with the user: `GET /me/drive/search(q='…')` — shared results carry a `remoteItem` facet.

```json
{
  "value": [
    {
      "id": "0123456789abc!123",
      "name": "Quarterly Budget.xlsx",
      "size": 84213,
      "file": { "mimeType": "application/vnd...sheet" },
      "searchResult": { "onClickTelemetryUrl": "https://bing.com/0123456789abc!123" }
    }
  ],
  "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/drive/root/search(q='quarterly budget')?$skiptoken=1asd..."
}
```

## Pattern 3: Get a download URL without the 302 (JS/CORS-safe)

```
GET /me/drive/items/01ABC...123?$select=id,name,@microsoft.graph.downloadUrl
```

```json
{
  "id": "01ABC...123",
  "name": "Budget.xlsx",
  "@microsoft.graph.downloadUrl": "https://b0mpua-by3301.files.1drv.com/y23vmag..."
}
```

URL is short-lived (~1 hr), preauthenticated — use immediately, never cache.

## Pattern 4: Field selection & sorting

```
GET /me/drive/root/children?$select=id,name,size,@microsoft.graph.downloadUrl
GET /me/drive/root/children?$orderby=name asc
GET /me/drive/root/children?$orderby=lastModifiedDateTime desc
```

## Pattern 5: Filtering (last resort — prefer search)

```
GET /me/drive/root/children?$filter=name eq 'Budget.xlsx'
GET /me/drive/root/children?$filter=startswith(name,'2026')
```

`$filter` on driveItems is **patchy** — many fields aren't filterable server-side. On `400 invalidRequest` or unexpected results, fall back to `search(q='…')` or page `children` and filter client-side. The connector never sends `$filter`.

## Pagination

- Opaque cursor `@odata.nextLink` (embeds a `$skiptoken`). Graph default page 200; provider caps `$top` at 999 (Graph max). No total count (`$count` unreliable). [INFERRED]

| Param        | Type   | Default | Description                            |
| ------------ | ------ | ------- | -------------------------------------- |
| `$top`       | int    | 200     | items/page (provider caps at 999)      |
| `$skiptoken` | string | —       | cursor from previous `@odata.nextLink` |

Two ways to page: (1) follow `@odata.nextLink` verbatim (fully-formed absolute URL — just GET it; don't re-add `$select`/`$top`); (2) extract its `$skiptoken` and re-send as a query param (what the provider does). Last page = `@odata.nextLink` absent.

Loop:

```
token = null
loop:
  GET /me/drive/root/children?$top=100  (append &$skiptoken={token} if set)
  process response.value
  if "@odata.nextLink" not in response: stop
  token = $skiptoken extracted from response["@odata.nextLink"]
```

Worked: page1 `?$top=100` → 100 items + nextLink(skiptoken=UGFnZTI); page2 `&$skiptoken=UGFnZTI` → 100 + nextLink(UGFnZTM); page3 `&$skiptoken=UGFnZTM` → 37 items, no nextLink (last).

## Bulk

`POST /$batch` — combine up to **20** GETs; each still counts against throttling individually. [DOCUMENTED] Partial failure: outer `/$batch` is `200` even if a sub-request `429`s; each sub-response carries its own status + `Retry-After` — **retry only the failed sub-requests**. Full-drive enumeration at scale: use **delta** (`/me/drive/root/delta`), the only method guaranteed to return every item during concurrent writes. No CSV/JSON export. [DOCUMENTED]

## Worked examples

1. **List whole root, page to end:** `GET /me/drive/root/children?$top=200&$select=id,name,size,folder,file,lastModifiedDateTime` — loop on `@odata.nextLink` until absent; branch each item on `folder`/`file`; no total count, accumulate as you go.
2. **Find a contract anywhere:** `GET /me/drive/root/search(q='master%20services%20agreement')?$top=50` — matches filename + content; URL-encode `q`; page on `@odata.nextLink`.
3. **Search shared-with-me too:** `GET /me/drive/search(q='budget%202026')?$top=50` — may include `remoteItem`-faceted items in other drives; address those via `remoteItem.id` / `remoteItem.parentReference.driveId` (out of scope here).

## Gotchas

1. Results under `value`, not top-level. Read `response["value"]`, not `response[0]`.
2. No total count — page until `@odata.nextLink` disappears; don't promise "N files" up front.
3. `$filter` unreliable on driveItems — use `search(q='…')`; fall back to client-side filtering.
4. `q` must be URL-encoded before going inside `(q='…')`, or the function syntax breaks.
5. `@odata.nextLink` is absolute and already signed — just GET it.
