---
api_name: Dropbox
api_slug: dropbox
doc: query-patterns (companion to 01-llm-api-rules.md) — read ops: browse, recurse, search, cursor pagination, delta sync
confidence: facts [DOCUMENTED] AND 🛠️ provider-verified unless tagged [INFERRED]/🔬(needs live capture). All calls are POST + JSON body; connector exposes file-browse/search/download tools (you don't hand-craft HTTP).
---

# Dropbox — Query Patterns

## Query Capabilities

| Capability                      | Supported   | Syntax / Notes                                           |
| ------------------------------- | ----------- | -------------------------------------------------------- |
| List a folder's children        | Yes         | `list_folder {"path":"<path>"}` (`""`=root)              |
| Recursive subtree listing       | Yes         | `list_folder {"recursive":true}` + continue loop         |
| Get one item's metadata         | Yes         | `get_metadata {"path":"<path-or-id>"}`                   |
| Filename search                 | Yes         | `search_v2` with `filename_only:true`                    |
| Full-text content search        | Yes         | `search_v2` (default — indexes file content)             |
| Scope search to a subtree       | Yes         | `search_v2 options.path="/Folder"`                       |
| Filter by file category         | Yes         | `options.file_categories[]` (unused by connector)        |
| Filter by active/deleted        | Yes         | `options.file_status`                                    |
| Sort                            | Search only | `options.order_by` = `relevance` \| `last_modified_time` |
| Filter by date range            | No (native) | no date-range filter — filter client-side [INFERRED] 🔬  |
| Field selection / sparse fields | No          | fixed metadata shape                                     |
| Aggregate / count               | No          | no count endpoint — enumerate to count                   |
| Boolean operators (AND/OR)      | Limited     | keyword query, not a boolean DSL [INFERRED]              |

## Patterns

**1. Browse one level** — `POST api/2/files/list_folder {"path":"/Reports","recursive":false,"limit":100}`. Returns direct children (files+folders) of `/Reports`; `path:""` for root. Response `{entries:[...],cursor,has_more}`; discriminate entries by `.tag`.

**2. Walk a subtree (recursive)** — `POST api/2/files/list_folder {"path":"/Reports","recursive":true,"limit":2000}`, then loop `POST api/2/files/list_folder/continue {"cursor":"<cursor>"}` until `has_more=false`. Always drain the cursor.

**3. Find a file by name account-wide** — `POST api/2/files/search_v2 {"query":"invoice 2026","options":{"path":"","filename_only":true,"max_results":100,"file_status":"active"}}`. `filename_only:true` matches name only (faster, fewer false positives); account-wide because `options.path=""`.

**4. Full-text content search in a subtree** — `POST api/2/files/search_v2 {"query":"termination clause","options":{"path":"/Contracts","filename_only":false,"max_results":100}}`. `filename_only:false` (connector default) searches inside indexed docs (PDFs, Office, text), scoped to `/Contracts`. Mind index lag — very recent files may not match yet.

**5. Get metadata for one item** — `POST api/2/files/get_metadata {"path":"/Reports/Q1 Report.pdf","include_media_info":false,"include_deleted":false}`. Returns one `FileMetadata`/`FolderMetadata` top-level (not in `entries`). Accepts a path or a stable `id:...`. Useful before download to confirm size/`rev`.

## Pagination

Opaque **cursor** + `has_more` boolean — identical model for listing and search. First-page param: `limit` (listing) / `options.max_results` (search). Next page: pass `cursor` to the matching `/continue`. **No total count** — enumerate to count.

| Surface | Param                 | Provider default | Hard max |
| ------- | --------------------- | ---------------- | -------- |
| Listing | `limit`               | 100              | **2000** |
| Search  | `options.max_results` | 100              | **1000** |

Provider clamps `min(page_size,2000)` (list) / `min(page_size,1000)` (search).

**Continue endpoints (naming asymmetry):** list → `files/list_folder/continue`; search → `files/search/continue_v2` (NOT `search_v2/continue` — easy to get wrong; different match shape).

Response: `{entries|matches:[...], cursor:"AAH...", has_more:true}`. Last page when `has_more===false`; final `cursor` still useful (delta sync below).

Full loop:

```
cursor = null
loop:
  if cursor == null: resp = POST api/2/files/list_folder          {"path":P,"recursive":R,"limit":2000}
  else:              resp = POST api/2/files/list_folder/continue {"cursor":cursor}
  process resp.entries          # discriminate by .tag
  if resp.has_more == false: stop
  cursor = resp.cursor
```

## Incremental Delta Sync

The cursor doubles as a **change token** — the efficient path for KB re-indexing:

1. Full `list_folder` (`recursive:true`) walk, draining cursors until `has_more=false`.
2. **Persist the final `cursor`.**
3. Later, `POST api/2/files/list_folder/continue {"cursor":"<saved>"}` returns ONLY entries changed since (new/modified files + `.tag:"deleted"` tombstones).
4. Continue draining; persist the new final cursor for next time.

Change-detection fields on returned entries: `server_modified`, `rev`, `content_hash` — compare `rev`/`content_hash` to stored value to detect actual content changes.

Optional accelerators (not wired up): `POST api/2/files/list_folder/longpoll {"cursor":"<saved>","timeout":30}` blocks until changes exist (poll only when something's new); `list_folder/get_latest_cursor` seeds an empty-folder change token without downloading all entries first.

## Bulk Reads

| Operation         | Endpoint                         | Notes                                      |
| ----------------- | -------------------------------- | ------------------------------------------ |
| Subtree bulk read | `list_folder` (`recursive:true`) | effectively bulk-reads a whole subtree     |
| Folder as zip     | `content/2/files/download_zip`   | folder ≤20 GB / 10k files; not wired up 🔬 |

No batched read-by-id — `get_metadata` is one path per call. For many items, prefer a recursive `list_folder` over N `get_metadata` calls.

## Worked Examples

**1. List everything under a folder, paginated:**

```
POST api/2/files/list_folder          {"path":"/Reports","recursive":true,"limit":2000}
→ {entries:[...up to 2000...], cursor:"C1", has_more:true}
POST api/2/files/list_folder/continue {"cursor":"C1"}
→ {entries:[...], cursor:"C2", has_more:false}     ← stop; save C2 for delta sync
```

Drain the cursor; no total — count by accumulating `entries`.

**2. Search a subtree by content, then download a hit:**

```
POST api/2/files/search_v2 {"query":"non-compete","options":{"path":"/Contracts","filename_only":false}}
→ {matches:[{metadata:{metadata:{".tag":"file","path_display":"/Contracts/Acme MSA.pdf",...}}}], has_more:false}
POST content/2/files/download   Dropbox-API-Arg: {"path":"/Contracts/Acme MSA.pdf"}
→ <bytes>   (metadata echoed in Dropbox-API-Result header)
```

Real entry = `matches[i].metadata.metadata`; use its `path_display` as the download `path`. Download is a different host with a header arg.

**3. Detect what changed since last sync:**

```
POST api/2/files/list_folder/continue {"cursor":"<saved last run>"}
→ {entries:[{".tag":"file","path_display":"/Reports/Q2.pdf","rev":"016...","server_modified":"2026-04-02T11:00:00Z"},
            {".tag":"deleted","path_display":"/Reports/old.pdf"}], cursor:"Cn", has_more:false}
```

Only changes return; `.tag:"deleted"` marks removals; compare `rev` to decide re-download; persist the new `cursor`.

## Gotchas

1. Root is `""`, not `"/"` — a leading `/` is required for any non-root path.
2. Files and folders share one `entries` array — branch on `.tag`.
3. Search results double-nested — `match.metadata.metadata`, not `match.metadata`.
4. Continue endpoints differ — `list_folder/continue` vs `search/continue_v2`.
5. No total count and no date-range filter — enumerate to count; filter dates client-side.
6. `has_subfolders` always `false` from the connector — drill in for the real answer.
7. Search index lag — a just-uploaded file may not appear in `search_v2` for a while; if a user "knows it's there", fall back to `list_folder` on the expected path.
