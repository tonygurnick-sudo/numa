---
api_name: Wrike
api_slug: wrike
base_url: https://{host}/api/v4 ({host} from OAuth token response; never hardcode www.wrike.com)
path_version_segment: /api/v4 (real path segment — v4 is path-versioned)
call_surface: HTTP GET via `numa integrations request` (connector wrike). NOT file-browse, NOT MCP.
companion_of: 01-llm-api-rules.md
doc: read operations — list, filter, get-by-id, date ranges, field selection, pagination, bulk read. All reads work under wsReadOnly.
confidence: DOCUMENTED (developers.wrike.com), not live-verified
---

# Wrike — Query Patterns Reference

## Query Capabilities

| Capability               | Supported | Syntax / Where                               | Notes                                   |
| ------------------------ | --------- | -------------------------------------------- | --------------------------------------- |
| Filter by field value    | yes       | `?status=Active&importance=High`             | per-field params; AND-combined          |
| Filter by date range     | yes       | `?updatedDate={"start":"…","end":"…"}`       | URL-encoded JSON object                 |
| Full-text search         | partial   | `?title=<substring>`                         | title contains-match — NOT body/comment |
| Sort by field            | yes       | `?sortField=UpdatedDate`                     | fixed allowed set; one field at a time  |
| Sort direction           | yes       | `?sortOrder=Asc\|Desc`                       | default `Asc`                           |
| Field selection (sparse) | partial   | `?fields=["description","subTaskIds"]`       | OPT-IN extras — does NOT trim defaults  |
| Include related records  | partial   | via `fields` (`subTaskIds`,`superTaskIds`)   | no generic expansion                    |
| Aggregate / count        | no        | use `responseSize` or count client-side      | no count endpoint                       |
| Logical AND / OR         | partial   | distinct params = AND; CSV in one param = OR | no nested boolean grouping              |
| Comparison operators     | partial   | only via date-range `{start,end}`            | no generic `gt`/`lt`                    |
| Null checks              | no        | —                                            |                                         |
| Regex / pattern          | no        | `title` is literal substring only            |                                         |

## Pattern 1: List & Filter

Distinct params AND-combine; a CSV inside one enum param is OR within that field. No nested boolean grouping — for "(A or B) and C" express A,B as a CSV in one param and C as a separate param; anything more complex must be filtered client-side.

```http
GET /api/v4/tasks?status=Active&pageSize=1000&sortField=UpdatedDate&sortOrder=Desc          # account-wide
GET /api/v4/folders/IEAAALZ4I4AAAAB/tasks?status=Active,Deferred&fields=["responsibleIds"]  # scoped to a project (preferred when you have the folder ID)
GET /api/v4/tasks?status=Active,Deferred&importance=High&responsibles=["KUAAAAAA"]          # AND across params, OR within status
```

## Pattern 2: Search (title substring only)

No global search endpoint, no full-text body/comment search. Only a `title` substring (literal contains-match) on tasks and folders. No fuzzy matching. Minimum query length not documented [UNKNOWN]. To "search comments" you must list a task's comments and filter client-side.

```http
GET /api/v4/tasks?title=spec&pageSize=1000
GET /api/v4/folders?title=Launch
```

## Pattern 3: Get by ID (single and bulk)

Single returns the entity wrapped in `data` (array of length 1):

```http
GET /api/v4/tasks/IEAAALZ4KQAAAAAK
```

**Bulk read by comma-separated IDs** — the primary "bulk" affordance (no batch write exists):

```http
GET /api/v4/tasks/IEAAALZ4KQAAAAAK,IEAAALZ4KRAAAAAL,IEAAALZ4KSAAAAAM?fields=["description"]
GET /api/v4/folders/IEAAALZ4I4AAAAB,IEAAALZ4I5AAAAC
```

Keep batches ≤~100 IDs (URL length). **Missing/forbidden IDs are silently omitted** from `data` — no per-ID error array. Diff requested vs returned IDs to detect gaps.

## Pattern 4: Related Records

Children are scoped sub-resources, not generic expansion (request `subTaskIds` via `fields`, then bulk-read).

```http
GET /api/v4/folders/IEAAALZ4I4AAAAB/tasks                      # tasks in a folder/project
GET /api/v4/tasks/IEAAALZ4KQAAAAAK/comments?plainText=true     # comments on a task
GET /api/v4/tasks/IEAAALZ4KQAAAAAK/timelogs                    # timelogs on a task
GET /api/v4/contacts/KUAAAAAA/timelogs                         # timelogs by a user
GET /api/v4/tasks/IEAAALZ4KQAAAAAK?fields=["subTaskIds"]       # → data[0].subTaskIds = ["IEAAALZ4KBAAAAA","IEAAALZ4KCAAAAB"]
GET /api/v4/tasks/IEAAALZ4KBAAAAA,IEAAALZ4KCAAAAB              #   then bulk-read them
```

## Pattern 5: Date Range Query

Date-range filters take a URL-encoded JSON object with `start` and/or `end`:

```http
GET /api/v4/tasks?updatedDate={"start":"2026-05-01T00:00:00Z","end":"2026-05-31T23:59:59Z"}&sortField=UpdatedDate&sortOrder=Desc
```

URL-encoded form of the value: `updatedDate=%7B%22start%22%3A%222026-05-01T00%3A00%3A00Z%22%2C%22end%22%3A%222026-05-31T23%3A59%3A59Z%22%7D`

- Either `start` or `end` may be omitted (open-ended range).
- Datetimes use ISO 8601 with `Z`; day-granularity dates use `YYYY-MM-DD`.
- Common range filters on `/tasks`: `createdDate`, `updatedDate`, `completedDate`, `scheduledDate`, `dueDate`.
- `GET /comments` range is capped at 7 days (`createdDate` window); wider → `invalid_parameter`.

## Pattern 6: Field Selection (`fields`)

`fields` is **additive opt-in** — pulls expensive optional fields, does NOT trim the default payload. Value is a URL-encoded JSON array of strings; request only what you'll use (each extra field costs server work + response size).

```http
GET /api/v4/tasks?fields=["description","subTaskIds","superTaskIds","customFields","attachmentCount","dependencyIds"]
```

Common opt-ins: `description`, `subTaskIds`, `superTaskIds`, `customFields`, `attachmentCount`, `recurrent`, `briefDescription` (folders).

## Pattern 7: Discovery (workflows, custom fields, contacts)

Discover tenant-defined IDs before setting workflow statuses or custom fields:

```http
GET /api/v4/workflows          # → customStatuses[] {id,name,group}
GET /api/v4/customfields       # → custom field definitions {id,title,type}
GET /api/v4/spaces             # → top-level spaces
GET /api/v4/contacts?me=true   # → current user's contact id
```

## Pagination

Cursor: `pageSize` + `nextPageToken`, both in the JSON response BODY. Max `pageSize=1000`; default unbounded for small scoped lists — supply `pageSize` to opt into paging on `/tasks` and `/folders`. `responseSize` (count of all matching items incl. hidden) is on `/tasks`; no separate count endpoint.

| Parameter       | Type   | Default | Description                                            |
| --------------- | ------ | ------- | ------------------------------------------------------ |
| `pageSize`      | int    | —       | items per page; max 1000                               |
| `nextPageToken` | string | —       | cursor from previous response body; omit on first call |

Response: `{"kind":"tasks","nextPageToken":"eyJvZmZzZXQiOjEwMDB9","responseSize":2450,"data":[/* up to pageSize items */]}`

**Last page:** `nextPageToken` absent → stop. **Belt-and-braces (Wrike quirk):** a `nextPageToken` can be returned even when `data` is `[]` / `responseSize` is 0 — also stop if `data.length===0` OR the token equals the previous page's token.

Loop:

```
Page 1: GET /api/v4/tasks?status=Active&pageSize=1000                       → {nextPageToken:"eyJ...A", data:[...1000]}
Page 2: GET /api/v4/tasks?status=Active&pageSize=1000&nextPageToken=eyJ...A  → {nextPageToken:"eyJ...B", data:[...1000]}
Page 3: GET /api/v4/tasks?status=Active&pageSize=1000&nextPageToken=eyJ...B  → {data:[...450]} (no token) → STOP
```

**Critical:** re-send ALL original filter/sort params on EVERY paged request alongside `nextPageToken`. The token does NOT carry the query context — dropping filters on page 2 changes the result set. Do not change filters mid-iteration.

## Bulk Read

| Operation                 | Endpoint                          | Max batch  | Notes                                           |
| ------------------------- | --------------------------------- | ---------- | ----------------------------------------------- |
| Bulk read tasks           | `GET /api/v4/tasks/{id1,id2,…}`   | ~100 (URL) | comma-separated IDs in path                     |
| Bulk read folders         | `GET /api/v4/folders/{id1,id2,…}` | ~100 (URL) | same pattern                                    |
| Bulk create/update/delete | —                                 | —          | NOT supported — one write per request (see 01c) |

The only "bulk" affordance is reading many entities by comma-separated IDs; missing/forbidden IDs are silently dropped from `data` (no per-ID error). No batch-write or composite endpoint.

## Worked Examples

1. My active tasks due this week, freshest first:
   `GET /api/v4/tasks?status=Active&responsibles=["KUAAAAAA"]&dueDate={"start":"2026-05-25","end":"2026-05-31"}&sortField=DueDate&sortOrder=Asc&pageSize=1000`
   → `{"kind":"tasks","responseSize":3,"data":[{"id":"IEAAALZ4KQAAAAAK","title":"Write the spec","status":"Active","importance":"High","dates":{"type":"Planned","due":"2026-05-28"},"responsibleIds":["KUAAAAAA"],"parentIds":["IEAAALZ4I4AAAAB"],"permalink":"https://www.wrike.com/open.htm?id=1234567"}]}`
   `responsibles` = JSON array of quoted IDs; `dueDate` = URL-encoded JSON range with day-granularity dates; no `nextPageToken` → last page.

2. All projects (folders with a `project` object) + status:
   `GET /api/v4/folders?project=true&fields=["briefDescription"]`
   → `{"kind":"folders","data":[{"id":"IEAAALZ4I4AAAAB","title":"Q3 Launch","scope":"WsFolder","project":{"ownerIds":["KUAAAAAA"],"status":"Green","startDate":"2026-06-01","endDate":"2026-08-31"},"briefDescription":"Coordinate the Q3 product launch.","permalink":"https://www.wrike.com/open.htm?id=2345678"}]}`
   `project=true` filters to projects only; high-level project state is `project.status` (`Green`/`Yellow`/`Red`/…).

3. Tasks changed since the last poll (change feed):
   `GET /api/v4/tasks?updatedDate={"start":"2026-05-29T00:00:00Z"}&sortField=UpdatedDate&sortOrder=Desc&pageSize=1000`
   → `{"kind":"tasks","responseSize":2,"data":[{"id":"IEAAALZ4KQAAAAAK","title":"Write the spec","status":"Completed","updatedDate":"2026-05-29T03:00:00Z"},{"id":"IEAAALZ4KRAAAAAL","title":"Review designs","status":"Active","updatedDate":"2026-05-29T02:15:00Z"}]}`
   Open-ended range (`start` only) = everything since the timestamp; `updatedDate` is the change-detection field; sort `Desc` for freshest first. This is the polling pattern (no live webhooks wired) — see 01d.

## Gotchas

1. **`fields` ADDS, it does not trim.** You can't slim a response with `fields`. To reduce payload, scope the query (folder-level vs account-wide) and avoid `fields`.
2. **Array params must be quoted JSON arrays.** `responsibles=["KUAAAAAA"]` works; `responsibles=[KUAAAAAA]` and `responsibles=KUAAAAAA` both 400 as `invalid_parameter`.
3. **No global / full-text search.** `?title=` is a literal substring on tasks/folders only — no body, no comments, no fuzzy. For "find anything about X" fan out and filter client-side.
4. **Re-send filters on every page.** The cursor doesn't encode the query — drop `status=Active` on page 2 and you page through ALL tasks.
5. **`nextPageToken` can appear on an empty page.** Stop when `data` is empty or the token repeats.
6. **`responseSize` includes hidden items.** It is the total matching count, not `data.length`. Don't use it for last-page detection.
7. **Bulk-read silently drops bad IDs.** Diff requested vs returned IDs to find the missing ones.
8. **Comment date range ≤7 days at account level.** Query per task/folder for older comments.
