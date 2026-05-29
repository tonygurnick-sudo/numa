---
api_name: 'Google Drive'
api_slug: 'googledrive'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# Google Drive — Query Patterns Reference

> Companion to `01-llm-api-rules.md`. Read operations: browsing the folder graph, the `q` filter
> DSL, search, field selection, and pagination.
>
> **Connector reality:** the platform provider drives `files.list` for both browsing and search. Its
> **search tool matches `name contains '<query>'` only** — it does **not** use Drive's `fullText`
> content search. The raw API _can_ do full-text; the connector currently does not. Examples below
> show both the connector behaviour and the raw API capability, labelled accordingly.

---

## Query Capabilities Summary

| Capability                      | Supported | Syntax                                 | Notes                                           |
| ------------------------------- | --------- | -------------------------------------- | ----------------------------------------------- |
| Filter by field value           | Yes       | `name = 'report.pdf'`                  | Single-quoted values                            |
| Filter by date range            | Yes       | `modifiedTime > '2026-01-01T00:00:00'` | Quoted RFC-3339, UTC                            |
| Full-text search (content+meta) | Yes (API) | `fullText contains 'merger agreement'` | **Not used by the connector** — name match only |
| Filter by MIME / type           | Yes       | `mimeType = 'application/pdf'`         | Folder detection too                            |
| Folder scoping                  | Yes       | `'<folderId>' in parents`              | The browse primitive                            |
| Owner / sharing                 | Yes       | `'me' in owners`, `sharedWithMe`       | "Shared with me" virtual folder                 |
| Trashed / starred               | Yes       | `trashed = false`, `starred = true`    | Connector always appends `trashed=false`        |
| Sort by field                   | Yes       | `orderBy=modifiedTime desc`            | Provider uses `folder,modifiedTime desc`        |
| Field selection (partial resp.) | Yes       | `fields=files(id,name,...)`            | Always set one — huge payload savings           |
| Logical operators (and/or/not)  | Yes       | `... and (... or ...)`                 |                                                 |
| Comparison operators            | Yes       | `=`, `!=`, `<`, `<=`, `>`, `>=`        |                                                 |
| Membership / contains           | Yes       | `in`, `contains`                       | `contains` is **prefix/token**, not substring   |
| Aggregation / count             | No        | —                                      | No count endpoint; page to count                |
| Regex / pattern matching        | No        | —                                      | `contains` only                                 |

---

## The `q` Filter DSL

`q` is a small expression language: `<term> <operator> <value>`, combinable with `and` / `or` /
`not` and parentheses. Values are **single-quoted**; escape `\` and `'` inside a value
(`\\`, `\'`). The whole `q` string must be URL-encoded.

```
GET /drive/v3/files?q=<url-encoded expression>
```

**Operators by term:**

| Term           | Operators                       | Example                                  |
| -------------- | ------------------------------- | ---------------------------------------- |
| `name`         | `=`, `!=`, `contains`           | `name contains 'Q2'`                     |
| `fullText`     | `contains`                      | `fullText contains 'revenue'` (API only) |
| `mimeType`     | `=`, `!=`, `contains`           | `mimeType = 'application/pdf'`           |
| `modifiedTime` | `<=`, `<`, `=`, `!=`, `>`, `>=` | `modifiedTime > '2026-01-01T00:00:00'`   |
| `createdTime`  | `<=`, `<`, `=`, `!=`, `>`, `>=` | `createdTime >= '2026-01-01T00:00:00'`   |
| `parents`      | `in`                            | `'1aBcFolderId' in parents`              |
| `owners`       | `in`                            | `'me' in owners`                         |
| `trashed`      | `=`, `!=`                       | `trashed = false`                        |
| `starred`      | `=`, `!=`                       | `starred = true`                         |
| `sharedWithMe` | (bare boolean term)             | `sharedWithMe = true`                    |

> **`contains` footgun:** on `name` and `fullText` it matches **whole tokens / prefixes**, not
> arbitrary substrings. `name contains 'port'` will **not** match "Report". Set user expectations
> accordingly. [DOCUMENTED]

---

## Common Patterns

### Pattern 1: Browse a folder (children of a folder)

```http
GET /drive/v3/files?q='1aBcFolderId'%20in%20parents%20and%20trashed%3Dfalse&orderBy=folder,modifiedTime%20desc&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,webViewLink)
```

- The browse primitive is `'<folderId>' in parents`. `orderBy=folder,...` puts folders first.

### Pattern 2: Browse My Drive root vs "Shared with me"

```http
# My Drive root
GET /drive/v3/files?q='root'%20in%20parents%20and%20trashed%3Dfalse&corpora=user
# Shared with me
GET /drive/v3/files?q=sharedWithMe%3Dtrue%20and%20trashed%3Dfalse&corpora=user
```

- The literal `'root'` aliases the user's My-Drive root folder. The connector exposes these as the
  `virtual:my-drive` / `virtual:shared-with-me` root folders (see 01a).

### Pattern 3: Search by filename (the connector's `search_files`)

```http
GET /drive/v3/files?q=name%20contains%20'quarterly'%20and%20trashed%3Dfalse&orderBy=folder,modifiedTime%20desc&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)
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

- This is exactly what the connector does. Scope to a folder by appending
  `and '<folderId>' in parents`.

### Pattern 4: Full-text content search (raw API — not via connector)

```http
GET /drive/v3/files?q=fullText%20contains%20'merger%20agreement'%20and%20trashed%3Dfalse
```

- Searches file **content** + metadata. The connector does not currently issue this; note it as a
  capability if a content search is requested.

### Pattern 5: Type / date filters

```http
# Only PDFs modified this year
GET /drive/v3/files?q=mimeType%3D'application%2Fpdf'%20and%20modifiedTime%20%3E%20'2026-01-01T00%3A00%3A00'
# Folders only (to map the tree)
GET /drive/v3/files?q=mimeType%3D'application%2Fvnd.google-apps.folder'%20and%20trashed%3Dfalse
```

### Pattern 6: Get one file's metadata (with permissions)

```http
GET /drive/v3/files/1aBcD3eFgH?fields=id,name,mimeType,size,modifiedTime,createdTime,parents,md5Checksum,version,permissions&supportsAllDrives=true
```

- `fields=*` returns the full resource; prefer a narrow selector. The connector's metadata tool
  requests the field set above (including `permissions`).

---

## Field Selection (`fields`) — always set it

Drive returns a _huge_ File resource by default. The `fields` parameter is a partial-response
selector and is mandatory for sane payloads:

```
fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,webViewLink)   # list
fields=id,name,mimeType,size,modifiedTime,parents,exportLinks,capabilities            # single file
```

- Wrap list fields in `files(...)`; include `nextPageToken` or you lose pagination.
- Omitting `fields` on `files.list` defaults to a minimal set (`kind,id,name,mimeType`) — but for
  any real use, request exactly what you need.

---

## Sort

```
orderBy=folder,modifiedTime desc,name
```

Sort keys: `createdTime`, `folder`, `modifiedByMeTime`, `modifiedTime`, `name`, `name_natural`,
`quotaBytesUsed`, `recency`, `sharedWithMeTime`, `starred`, `viewedByMeTime`. Append ` desc` to
reverse. The provider defaults to `folder,modifiedTime desc` (folders first, newest first).

---

## Pagination Handling

### Model

- **Type:** opaque **page token**.
- **Default page size:** 100. **Max page size:** 1000 (provider clamps with `min(page_size, 1000)`).
- **Total count available:** **No** — there is no total; enumerate until the token is absent.

### Request Parameters

| Parameter   | Type   | Default | Description                                          |
| ----------- | ------ | ------- | ---------------------------------------------------- |
| `pageSize`  | int    | 100     | Files per page; max 1000                             |
| `pageToken` | string | —       | Continuation token from the previous `nextPageToken` |

### Response Structure

```json
{
  "kind": "drive#fileList",
  "incompleteSearch": false,
  "nextPageToken": "~!!~AI9F...",
  "files": [
    /* up to pageSize File objects */
  ]
}
```

### Last Page Detection

`nextPageToken` is **absent** on the final page.

### Full Pagination Loop

```
token = null
loop:
  GET /files?q=<same q>&orderBy=<same orderBy>&pageSize=1000[&pageToken=token]
  process response.files
  token = response.nextPageToken
  if token is absent: stop          ← done
```

> **Send identical `q` and `orderBy` on every page** — the token encodes the query context. Changing
> them mid-iteration corrupts paging. [DOCUMENTED]

---

## Bulk Reads

Drive supports **HTTP batch** (`POST https://www.googleapis.com/batch/drive/v3`, `multipart/mixed`,
up to 100 sub-requests) to fetch metadata for many ids in one round-trip. Each sub-request returns
its own status, so failures are isolated. **Not required** for the Files surface and not used by the
connector. [DOCUMENTED]

For Google-native files **> 10 MB**, the inline `files.export` cap is exceeded — use the per-format
URLs in the file's `exportLinks` map (authenticated GET) instead. [DOCUMENTED]

---

## Worked Examples

### Example 1: List everything modified since a date

> Incremental "what changed" without the changes feed.

```http
GET /drive/v3/files?q=modifiedTime%20%3E%20'2026-05-01T00:00:00'%20and%20trashed%3Dfalse&orderBy=modifiedTime%20desc&pageSize=1000&fields=nextPageToken,files(id,name,mimeType,modifiedTime)
```

**Key points:**

- Quote the timestamp inside `q`; it is UTC. Loop on `nextPageToken`.
- For true sync prefer the `changes` feed (01d) — this misses deletions.

### Example 2: Find all spreadsheets in a specific folder

```http
GET /drive/v3/files?q='1aBcFolderId'%20in%20parents%20and%20(mimeType%3D'application%2Fvnd.google-apps.spreadsheet'%20or%20mimeType%3D'application%2Fvnd.openxmlformats-officedocument.spreadsheetml.sheet')%20and%20trashed%3Dfalse&fields=files(id,name,mimeType,size)
```

**Key points:**

- Match **both** Google-native Sheets and uploaded XLSX with an `or`.
- Native Sheets have no `size`; uploaded XLSX do.

### Example 3: List shared drives (top-level navigation)

```http
GET /drive/v3/drives?pageSize=100&fields=drives(id,name)
```

```json
{
  "drives": [
    { "id": "0AHkAbc", "name": "Finance Team" },
    { "id": "0AHkDef", "name": "Legal" }
  ]
}
```

**Key points:**

- The provider shows each shared drive as a root-level folder (`shared-drive:<id>`). Browsing into
  one sets `corpora=drive` + `driveId=<id>` on the `files.list` call.

---

## Gotchas & Counter-Exceptions

1. **Connector search = filename only.** It issues `name contains '<q>'`, not `fullText contains`.
   If the user wants content search, that's a raw-API capability the connector doesn't expose today.
2. **`contains` is token/prefix, not substring** — `name contains 'port'` won't match "Report".
3. **No total count.** Don't promise "N results found" until you've paged to the end; report
   "at least N" while a `nextPageToken` remains.
4. **Shared-drive items disappear** without `supportsAllDrives=true` + `includeItemsFromAllDrives=true`
   (and the right `corpora`/`driveId`). The provider always sets these.
5. **`incompleteSearch: true`** means cross-drive results are partial — narrow the corpus and retry.
6. **Virtual folder ids are not file ids.** `virtual:my-drive` / `virtual:shared-with-me` /
   `shared-drive:<id>` are connector synthetics; never pass them to `/files/{id}`.

---

_Generated from the investigation questionnaire, Phases 5–6._
