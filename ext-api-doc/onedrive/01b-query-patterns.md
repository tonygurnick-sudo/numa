---
api_name: 'OneDrive (Microsoft Graph)'
api_slug: 'onedrive'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# OneDrive (Microsoft Graph) — Query Patterns Reference

> Companion to `01-llm-api-rules.md`. Read operations: browsing children, full-text search, field
> selection, sorting, and cursor pagination.
>
> **Discovery rule of thumb:** to _browse_ a known location, list `children`; to _find_ a file by
> name/content, use `search(q='…')`. **Prefer `search()` over `$filter`** — `$filter` support on
> driveItem collections is patchy and `name` is the only reliably filterable field. The shipped
> connector uses `children` + `search()` and **never** `$filter`. [CONFIRMED]

---

## Query Capabilities Summary

| Capability                 | Supported?         | Syntax                                            | Confidence            |
| -------------------------- | ------------------ | ------------------------------------------------- | --------------------- | ----------- |
| List children of a folder  | Yes                | `GET /me/drive/{root                              | items/{id}}/children` | [CONFIRMED] |
| Get item by id             | Yes                | `GET /me/drive/items/{id}`                        | [CONFIRMED]           |
| Get item by path           | Yes                | `GET /me/drive/root:/path/to/item`                | [DOCUMENTED]          |
| Full-text search           | Yes (primary path) | `search(q='text')` over name/metadata/content     | [CONFIRMED]           |
| Field selection (sparse)   | Yes                | `$select=id,name,size,…`                          | [CONFIRMED]           |
| Sort by field              | Yes                | `$orderby=name asc` / `lastModifiedDateTime desc` | [DOCUMENTED]          |
| Include related (sideload) | Yes                | `$expand=children,thumbnails`                     | [DOCUMENTED]          |
| Filter by field value      | Limited / patchy   | `$filter=name eq 'x'`                             | [DOCUMENTED]          |
| Pattern matching           | Limited            | `$filter=startswith(name,'B')`                    | [INFERRED]            |
| Total count                | Not by default     | `$count` unreliable on driveItems                 | [INFERRED]            |

---

## Common Patterns

### Pattern 1: Browse a folder (the default)

```http
GET /me/drive/root/children?$top=100&$select=id,name,size,createdDateTime,lastModifiedDateTime,parentReference,webUrl,folder,file
Authorization: Bearer <token>
Accept: application/json
```

Drill into a folder by id (the provider validates `{id}` against path traversal first):

```http
GET /me/drive/items/01ABC...XYZ/children?$top=100&$select=id,name,size,folder,file,lastModifiedDateTime
```

The response is an **array under `value`**, with an optional `@odata.nextLink`:

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

> **Folder vs file:** branch on facet presence — `"folder" in item` → folder, `"file" in item` → file.

### Pattern 2: Search by keyword (the discovery path)

```http
GET /me/drive/root/search(q='quarterly%20budget')?$top=50
```

- `q` matches across **filename, metadata, AND file content** (Bing/SharePoint search backend).
- **URL-encode `q`** before placing it inside `(q='…')` — the provider uses `quote(query, safe="")`.
- Folder-scoped variant (search a subtree): `GET /me/drive/items/{folder-id}/search(q='…')`.
- Broader variant including items **shared** with the user: `GET /me/drive/search(q='…')` —
  shared results carry a `remoteItem` facet.

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

### Pattern 3: Get a download URL without the 302 (JS/CORS-safe)

When you want the preauth URL directly instead of following a `302`:

```http
GET /me/drive/items/01ABC...123?$select=id,name,@microsoft.graph.downloadUrl
```

```json
{
  "id": "01ABC...123",
  "name": "Budget.xlsx",
  "@microsoft.graph.downloadUrl": "https://b0mpua-by3301.files.1drv.com/y23vmag..."
}
```

> The URL is short-lived (~1 hr) and preauthenticated — use it immediately, never cache.

### Pattern 4: Field selection & sorting

```http
GET /me/drive/root/children?$select=id,name,size,@microsoft.graph.downloadUrl
GET /me/drive/root/children?$orderby=name asc
GET /me/drive/root/children?$orderby=lastModifiedDateTime desc
```

### Pattern 5: Filtering (last resort — prefer search)

```http
# Where supported (name is the most reliable field):
GET /me/drive/root/children?$filter=name eq 'Budget.xlsx'
GET /me/drive/root/children?$filter=startswith(name,'2026')
```

> `$filter` on driveItem collections is **patchy** — many fields are not filterable server-side.
> If a `$filter` returns `400 invalidRequest` or unexpected results, fall back to `search(q='…')`
> or page `children` and filter client-side. The connector itself never sends `$filter`. [CONFIRMED]

---

## Pagination Handling

### Model

- **Type:** opaque cursor — `@odata.nextLink` (which embeds a `$skiptoken`). [CONFIRMED]
- **Default page size:** 200 (Graph). **Max page size:** 999 (`$top` cap the provider enforces). [CONFIRMED]
- **Total count:** not returned by default; `$count` is unreliable on driveItems. [INFERRED]

### Request Parameters

| Parameter    | Type   | Default | Description                                       |
| ------------ | ------ | ------- | ------------------------------------------------- |
| `$top`       | int    | 200     | Items per page (provider caps at 999, Graph max)  |
| `$skiptoken` | string | —       | Cursor pulled from the previous `@odata.nextLink` |

### Two ways to page

1. **Follow `@odata.nextLink` verbatim** — it is a fully-formed absolute URL; just GET it.
2. **Extract the `$skiptoken`** from `@odata.nextLink` and re-send it as a query param (what the
   provider does: it URL-parses `@odata.nextLink` and reads the `$skiptoken` query value).

### Last Page Detection

`@odata.nextLink` is **absent** from the response → no more pages.

### Full Pagination Loop

```
token = null
loop:
  GET /me/drive/root/children?$top=100  (append &$skiptoken={token} if token set)
  process response.value
  if "@odata.nextLink" not in response: stop
  token = skiptoken extracted from response["@odata.nextLink"]
```

### Worked example

```
Page 1: GET /me/drive/root/children?$top=100
        → 200, value[100], @odata.nextLink (skiptoken=UGFnZTI)
Page 2: GET /me/drive/root/children?$top=100&$skiptoken=UGFnZTI
        → 200, value[100], @odata.nextLink (skiptoken=UGFnZTM)
Page 3: GET /me/drive/root/children?$top=100&$skiptoken=UGFnZTM
        → 200, value[37], (no @odata.nextLink)   ← last page
```

---

## Bulk Operations

| Operation  | Endpoint       | Max Batch | Notes                                                                                 |
| ---------- | -------------- | --------- | ------------------------------------------------------------------------------------- |
| Batch read | `POST /$batch` | 20 reqs   | Combine up to 20 GETs; each still counts against throttling individually [DOCUMENTED] |

- **Partial failure:** the outer `/$batch` response is `200` even if a sub-request fails (e.g. one
  `429`). Each sub-response carries its own status + `Retry-After`. **Retry only the failed
  sub-requests.** [DOCUMENTED]
- **Full-drive enumeration at scale:** use **delta** (`/me/drive/root/delta`), the only method
  guaranteed to return every item even during concurrent writes. There is no CSV/JSON export. [DOCUMENTED]

---

## Worked Examples

### Example 1: List the whole root, paging to the end

```http
GET /me/drive/root/children?$top=200&$select=id,name,size,folder,file,lastModifiedDateTime
```

**Key points:** loop on `@odata.nextLink` until it's absent; branch each item on `folder`/`file`
facet; there is no total count, so accumulate as you go.

### Example 2: Find a contract anywhere in the drive

```http
GET /me/drive/root/search(q='master%20services%20agreement')?$top=50
```

**Key points:** matches filename + content; URL-encode `q`; page on `@odata.nextLink`.

### Example 3: Search shared-with-me items too

```http
GET /me/drive/search(q='budget%202026')?$top=50
```

**Key points:** results may include `remoteItem`-faceted items living in other drives — those need
the `remoteItem.id` / `remoteItem.parentReference.driveId` to address directly (out of scope here).

---

## Gotchas & Counter-Exceptions

1. **Results live under `value`, not at the top level.** Read `response["value"]`, not `response[0]`.
2. **No total count.** Don't promise "N files" up front — page until `@odata.nextLink` disappears.
3. **`$filter` is unreliable on driveItems.** Use `search(q='…')` for discovery; fall back to
   client-side filtering if a server filter misbehaves.
4. **`q` must be URL-encoded** before going inside `(q='…')`, or the function syntax breaks.
5. **`@odata.nextLink` is absolute and already signed** — don't re-add `$select`/`$top`; just GET it.

---

_Generated from the investigation questionnaire, Phases 5–6._
