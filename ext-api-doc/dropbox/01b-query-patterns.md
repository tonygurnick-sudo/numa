---
api_name: 'Dropbox'
api_slug: 'dropbox'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# Dropbox — Query Patterns Reference

> Companion to `01-llm-api-rules.md`. Read operations: browsing folders, recursive walks, search,
> cursor pagination, and incremental delta sync.
>
> All calls are `POST` with a JSON body. The connector exposes these as file-browse / search /
> download tools — you do not hand-craft HTTP. Patterns here explain the underlying behavior and
> the constraints you must respect. Items needing a live capture are tagged 🔬.

---

## Query Capabilities Summary

| Capability                      | Supported   | Syntax / Notes                                            | Confidence      |
| ------------------------------- | ----------- | --------------------------------------------------------- | --------------- |
| List a folder's children        | Yes         | `list_folder { "path": "<path>" }` (`""` = root)          | [DOCUMENTED] 🛠️ |
| Recursive subtree listing       | Yes         | `list_folder { "recursive": true }` + continue loop       | [DOCUMENTED] 🛠️ |
| Get one item's metadata         | Yes         | `get_metadata { "path": "<path-or-id>" }`                 | [DOCUMENTED] 🛠️ |
| Filename search                 | Yes         | `search_v2` with `filename_only: true`                    | [DOCUMENTED] 🛠️ |
| Full-text content search        | Yes         | `search_v2` (default — indexes file content)              | [DOCUMENTED]    |
| Scope search to a subtree       | Yes         | `search_v2 options.path = "/Folder"`                      | [DOCUMENTED] 🛠️ |
| Filter by file category         | Yes         | `options.file_categories[]` (unused by connector)         | [DOCUMENTED]    |
| Filter by active/deleted        | Yes         | `options.file_status`                                     | [DOCUMENTED] 🛠️ |
| Sort                            | Search only | `options.order_by` = `relevance` \| `last_modified_time`  | [DOCUMENTED]    |
| Filter by date range            | No (native) | `search_v2` has no date-range filter — filter client-side | [INFERRED] 🔬   |
| Field selection / sparse fields | No          | Fixed metadata shape                                      | [DOCUMENTED]    |
| Aggregate / count               | No          | No count endpoint — enumerate to count                    | [DOCUMENTED]    |
| Boolean operators (AND/OR)      | Limited     | Keyword query, not a boolean DSL                          | [INFERRED]      |

---

## Common Patterns

### Pattern 1: Browse a folder (one level)

```http
POST https://api.dropboxapi.com/2/files/list_folder
Authorization: Bearer <token>
Content-Type: application/json

{ "path": "/Reports", "recursive": false, "limit": 100 }
```

Returns the **direct children** (files + folders) of `/Reports`. Use `path: ""` for the root.
Response is `{ entries:[...], cursor, has_more }`. Files and folders are mixed in `entries` —
discriminate by `.tag`. [DOCUMENTED] 🛠️

### Pattern 2: Walk an entire subtree (recursive)

```http
POST https://api.dropboxapi.com/2/files/list_folder
{ "path": "/Reports", "recursive": true, "limit": 2000 }
```

Then loop `POST /2/files/list_folder/continue { "cursor": "<cursor>" }` until `has_more=false`.
Recursive listing of a large tree returns entries across many pages — always drain the cursor.
[DOCUMENTED] 🛠️

### Pattern 3: Find a file by name across the account

```http
POST https://api.dropboxapi.com/2/files/search_v2
{ "query": "invoice 2026",
  "options": { "path": "", "filename_only": true, "max_results": 100, "file_status": "active" } }
```

`filename_only: true` matches the name only (faster, fewer false positives). Account-wide because
`options.path` is `""`. [DOCUMENTED] 🛠️

### Pattern 4: Full-text content search in a subtree

```http
POST https://api.dropboxapi.com/2/files/search_v2
{ "query": "termination clause",
  "options": { "path": "/Contracts", "filename_only": false, "max_results": 100 } }
```

`filename_only: false` (connector default) searches **inside** indexed documents (PDFs, Office
docs, text). Scoped to `/Contracts`. Note index lag — very recent files may not match yet. [DOCUMENTED]

### Pattern 5: Get metadata for a single item

```http
POST https://api.dropboxapi.com/2/files/get_metadata
{ "path": "/Reports/Q1 Report.pdf", "include_media_info": false, "include_deleted": false }
```

Returns one `FileMetadata`/`FolderMetadata` object (top-level, not wrapped in `entries`). Accepts
either a path or a stable `id:...`. Useful before a download to confirm size / `rev`. [DOCUMENTED] 🛠️

---

## Pagination Handling

### Model

- **Type:** opaque **cursor** + `has_more` boolean. Identical model for listing and search.
- **First page param:** `limit` (listing) / `options.max_results` (search).
- **Next page:** pass `cursor` to the matching `/continue` endpoint.
- **Total count:** **not provided** — there is no record-count field. Enumerate to count.

### Page-size limits

| Surface | Param                 | Provider default | Hard max | Confidence      |
| ------- | --------------------- | ---------------- | -------- | --------------- |
| Listing | `limit`               | 100              | **2000** | [DOCUMENTED] 🛠️ |
| Search  | `options.max_results` | 100              | **1000** | [DOCUMENTED] 🛠️ |

> The provider clamps with `min(page_size, 2000)` (list) and `min(page_size, 1000)` (search). 🛠️

### Continue endpoints (note the naming asymmetry)

| First call          | Continue call                                |
| ------------------- | -------------------------------------------- |
| `files/list_folder` | `files/list_folder/continue`                 |
| `files/search_v2`   | `files/search/continue_v2` ⟵ different shape |

> Search's continue is `search/continue_v2`, **not** `search_v2/continue`. Easy to get wrong. 🛠️

### Response structure

```json
{
  "entries": [
    /* or "matches" for search */
  ],
  "cursor": "AAH...",
  "has_more": true
}
```

### Last-page detection

`has_more === false`. Stop paging. The final `cursor` is still useful (see delta sync below).

### Full pagination loop

```
cursor = null
loop:
  if cursor == null:
    resp = POST /2/files/list_folder         { "path": P, "recursive": R, "limit": 2000 }
  else:
    resp = POST /2/files/list_folder/continue { "cursor": cursor }
  process resp.entries          # discriminate by .tag
  if resp.has_more == false: stop
  cursor = resp.cursor
```

---

## Incremental Delta Sync

Dropbox's cursor doubles as a **change token** — this is the efficient path for KB re-indexing.

1. Do a full `list_folder` (`recursive: true`) walk, draining cursors until `has_more=false`.
2. **Persist the final `cursor`.**
3. Later, call `POST /2/files/list_folder/continue { "cursor": "<saved>" }`. It returns **only the
   entries that changed** since that cursor (new/modified files, and `.tag:"deleted"` tombstones).
4. Continue draining and persist the new final cursor for next time.

Change-detection fields on returned entries: `server_modified`, `rev`, `content_hash` — compare
`rev`/`content_hash` to your stored value to detect actual content changes. [DOCUMENTED]

> Optional accelerator: `POST /2/files/list_folder/longpoll { "cursor": "<saved>", "timeout": 30 }`
> blocks until changes exist (or the timeout elapses), so you poll only when there's something new.
> Seed an empty-folder cursor with `list_folder/get_latest_cursor` if you want a change token
> without first downloading all entries. Neither is wired up today. [DOCUMENTED]

---

## Bulk Reads

| Operation         | Endpoint                               | Notes                                        |
| ----------------- | -------------------------------------- | -------------------------------------------- |
| Subtree bulk read | `list_folder` (`recursive: true`)      | Effectively a bulk read of an entire subtree |
| Folder as zip     | `/2/files/download_zip` (content host) | Folder ≤ 20 GB / 10k files; not wired up 🔬  |

There is no batched **read-by-id** endpoint — `get_metadata` is one path per call. For many items,
prefer a recursive `list_folder` over N `get_metadata` calls.

---

## Worked Examples

### Example 1: List everything under a folder, paginated

```http
POST /2/files/list_folder            { "path": "/Reports", "recursive": true, "limit": 2000 }
→ { entries:[ ...up to 2000... ], cursor:"C1", has_more:true }

POST /2/files/list_folder/continue   { "cursor": "C1" }
→ { entries:[ ... ], cursor:"C2", has_more:false }     ← stop; save C2 for delta sync
```

**Key points:** drain the cursor; there's no total — count by accumulating `entries`.

### Example 2: Search a subtree by content, then download a hit

```http
POST /2/files/search_v2
{ "query": "non-compete", "options": { "path": "/Contracts", "filename_only": false } }
→ { matches:[ { metadata:{ metadata:{ ".tag":"file", "path_display":"/Contracts/Acme MSA.pdf", ... } } } ], has_more:false }

POST https://content.dropboxapi.com/2/files/download
Dropbox-API-Arg: {"path":"/Contracts/Acme MSA.pdf"}
→ <bytes>   (metadata echoed in Dropbox-API-Result header)
```

**Key points:** the real entry is `matches[i].metadata.metadata`; use its `path_display` as the
download `path`. Download is a different host with a header arg.

### Example 3: Detect what changed since last sync

```http
POST /2/files/list_folder/continue   { "cursor": "<cursor saved last run>" }
→ { entries:[ { ".tag":"file", "path_display":"/Reports/Q2.pdf", "rev":"016...", "server_modified":"2026-04-02T11:00:00Z" },
               { ".tag":"deleted", "path_display":"/Reports/old.pdf" } ],
    cursor:"Cn", has_more:false }
```

**Key points:** only changes come back; `.tag:"deleted"` marks removals; compare `rev` to decide
whether to re-download; persist the new `cursor`.

---

## Gotchas & Counter-Exceptions

1. **Root is `""`, not `"/"`** — and a leading `/` is required for any non-root path.
2. **Files and folders share one `entries` array** — always branch on `.tag`.
3. **Search results are double-nested** — `match.metadata.metadata`, not `match.metadata`.
4. **Continue endpoint names differ** — `list_folder/continue` vs `search/continue_v2`.
5. **No total count and no date-range filter** — enumerate to count; filter dates client-side.
6. **`has_subfolders` is always `false`** from the connector — drill in to learn the real answer.
7. **Search index lag** — a file you just uploaded may not appear in `search_v2` for a while; if a
   user "knows it's there", fall back to `list_folder` on the expected path.

---

_Generated from the investigation questionnaire, Phases 5–6, cross-checked against the production
`dropbox_provider.py`._
