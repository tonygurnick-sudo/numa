---
api_name: Google Drive
api_slug: googledrive
companion_of: 01-llm-api-rules.md
base_url: https://www.googleapis.com/drive/v3
call_surface: file-store connector (list-files/search-files/download-file); NOT `numa integrations request`. Provider drives `files.list` for both browse and search.
confidence: doc-based [DOCUMENTED] unless tagged [INFERRED]
source_phases: Phase 5 (Query/Filter), Phase 6 (Pagination/Bulk)
---

# Google Drive — Query Patterns Reference

Read operations: browsing the folder graph, the `q` filter DSL, search, field selection, pagination. The connector's **search tool matches `name contains '<query>'` only** — it does NOT use Drive's `fullText` content search (raw API can; connector does not). Examples below label connector behaviour vs raw-API capability.

## Query Capabilities

Supported: filter by field value, date range, MIME/type, folder scoping, owner/sharing, trashed/starred; sort; field selection; logical operators (`and`/`or`/`not` + parens); comparison `=`,`!=`,`<`,`<=`,`>`,`>=`; membership/`contains`. **Full-text (content) is supported by the API (`fullText contains`) but NOT used by the connector** — name match only.
NOT supported: aggregation/count (no count endpoint — page to count); regex/pattern (`contains` only).

## The `q` Filter DSL (term operator value tables below give all syntax + examples)

`q` = `<term> <operator> <value>`, combinable with `and`/`or`/`not` + parentheses. Values **single-quoted**; escape `\` and `'` inside (`\\`, `\'`). Whole `q` string must be URL-encoded. `GET /drive/v3/files?q=<expression>`.

| Term           | Operators                       | Example                                                      |
| -------------- | ------------------------------- | ------------------------------------------------------------ |
| `name`         | `=`, `!=`, `contains`           | `name contains 'Q2'`                                         |
| `fullText`     | `contains`                      | `fullText contains 'revenue'` (API only, not connector)      |
| `mimeType`     | `=`, `!=`, `contains`           | `mimeType = 'application/pdf'`                               |
| `modifiedTime` | `<=`, `<`, `=`, `!=`, `>`, `>=` | `modifiedTime > '2026-01-01T00:00:00'` (quoted RFC-3339 UTC) |
| `createdTime`  | `<=`, `<`, `=`, `!=`, `>`, `>=` | `createdTime >= '2026-01-01T00:00:00'`                       |
| `parents`      | `in`                            | `'1aBcFolderId' in parents` (the browse primitive)           |
| `owners`       | `in`                            | `'me' in owners`                                             |
| `trashed`      | `=`, `!=`                       | `trashed = false` (connector always appends this)            |
| `starred`      | `=`, `!=`                       | `starred = true`                                             |
| `sharedWithMe` | (bare boolean)                  | `sharedWithMe = true` ("Shared with me" virtual folder)      |

**`contains` footgun:** on `name`/`fullText` it matches **whole tokens/prefixes**, not arbitrary substrings. `name contains 'port'` will NOT match "Report".

## Common Patterns

**1. Browse a folder (children):** browse primitive is `'<folderId>' in parents`; `orderBy=folder,...` puts folders first.
`GET /drive/v3/files?q='1aBcFolderId' in parents and trashed=false&orderBy=folder,modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,webViewLink)`

**2. My Drive root vs "Shared with me":** literal `'root'` aliases the user's My-Drive root; connector exposes these as `virtual:my-drive` / `virtual:shared-with-me` (see 01a).
`GET /drive/v3/files?q='root' in parents and trashed=false&corpora=user`
`GET /drive/v3/files?q=sharedWithMe=true and trashed=false&corpora=user`

**3. Search by filename (connector's `search_files`):** scope to a folder by appending `and '<folderId>' in parents`.
`GET /drive/v3/files?q=name contains 'quarterly' and trashed=false&orderBy=folder,modifiedTime desc&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)`
→ `{"files":[{"id":"9kLmN","name":"Quarterly Revenue.pdf","mimeType":"application/pdf","modifiedTime":"2026-04-01T08:00:00.000Z"}]}`

**4. Full-text content search (raw API — NOT via connector):** searches content + metadata; connector does not issue this. Note as a capability if content search requested.
`GET /drive/v3/files?q=fullText contains 'merger agreement' and trashed=false`

**5. Type/date filters:**
`GET /drive/v3/files?q=mimeType='application/pdf' and modifiedTime > '2026-01-01T00:00:00'` (PDFs modified this year)
`GET /drive/v3/files?q=mimeType='application/vnd.google-apps.folder' and trashed=false` (folders only, to map the tree)

**6. Get one file's metadata (with permissions):** `fields=*` returns full resource — prefer a narrow selector. Connector's metadata tool requests the set below (incl. `permissions`).
`GET /drive/v3/files/1aBcD3eFgH?fields=id,name,mimeType,size,modifiedTime,createdTime,parents,md5Checksum,version,permissions&supportsAllDrives=true`

## Field Selection (`fields`) — always set it

Drive returns a huge File resource by default. `fields` is a partial-response selector, mandatory for sane payloads:

- list: `fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,webViewLink)`
- single file: `fields=id,name,mimeType,size,modifiedTime,parents,exportLinks,capabilities`

Wrap list fields in `files(...)`; include `nextPageToken` or you lose pagination. Omitting `fields` on `files.list` defaults to a minimal set (`kind,id,name,mimeType`) — request exactly what you need.

## Sort

`orderBy=folder,modifiedTime desc,name`. Sort keys: `createdTime`, `folder`, `modifiedByMeTime`, `modifiedTime`, `name`, `name_natural`, `quotaBytesUsed`, `recency`, `sharedWithMeTime`, `starred`, `viewedByMeTime`. Append ` desc` to reverse. Provider default: `folder,modifiedTime desc`.

## Pagination

Opaque **page token**. Default size 100, max 1000 (provider clamps `min(page_size,1000)`). **No total count** — enumerate until token absent.
| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `pageSize` | int | 100 | Files per page; max 1000 |
| `pageToken` | string | — | Continuation token from previous `nextPageToken` |

Response: `{"kind":"drive#fileList","incompleteSearch":false,"nextPageToken":"~!!~AI9F...","files":[/* up to pageSize File objects */]}`. Last page = `nextPageToken` **absent**.

Loop:

```
token = null
loop:
  GET /files?q=<same q>&orderBy=<same orderBy>&pageSize=1000[&pageToken=token]
  process response.files
  token = response.nextPageToken
  if token absent: stop
```

**Send identical `q` and `orderBy` on every page** — the token encodes the query context; changing them mid-iteration corrupts paging.

## Bulk Reads

Drive supports **HTTP batch** (`POST https://www.googleapis.com/batch/drive/v3`, `multipart/mixed`, ≤100 sub-requests) to fetch metadata for many ids in one round-trip; each sub-request returns its own status (failures isolated). **Not required** for the Files surface and not used by the connector. For Google-native files **> 10 MB**, the inline `files.export` cap is exceeded — use the per-format URLs in `exportLinks` (authenticated GET).

## Worked Examples

**1. List everything modified since a date** (incremental "what changed" without the changes feed): quote the timestamp inside `q` (UTC), loop on `nextPageToken`. For true sync prefer the `changes` feed (01d) — this misses deletions.
`GET /drive/v3/files?q=modifiedTime > '2026-05-01T00:00:00' and trashed=false&orderBy=modifiedTime desc&pageSize=1000&fields=nextPageToken,files(id,name,mimeType,modifiedTime)`

**2. All spreadsheets in a folder** — match BOTH native Sheets and uploaded XLSX with `or` (native Sheets have no `size`; XLSX do):
`GET /drive/v3/files?q='1aBcFolderId' in parents and (mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') and trashed=false&fields=files(id,name,mimeType,size)`

**3. List shared drives (top-level navigation)** — provider shows each shared drive as a root-level folder (`shared-drive:<id>`); browsing into one sets `corpora=drive` + `driveId=<id>` on the `files.list` call:
`GET /drive/v3/drives?pageSize=100&fields=drives(id,name)`
→ `{"drives":[{"id":"0AHkAbc","name":"Finance Team"},{"id":"0AHkDef","name":"Legal"}]}`
