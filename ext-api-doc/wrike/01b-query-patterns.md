---
api_name: 'Wrike'
api_slug: 'wrike'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# Wrike -- Query Patterns Reference

> Read operations: list, filter, get-by-id, date ranges, field selection, pagination, bulk read.
> Companion to `01-llm-api-rules.md`. All reads work under the current `wsReadOnly` scope.
> Confidence: DOCUMENTED (developers.wrike.com), not yet live-verified.

---

## Query Capabilities Summary

| Capability               | Supported | Syntax / Where                               | Notes                                    |
| ------------------------ | --------- | -------------------------------------------- | ---------------------------------------- |
| Filter by field value    | yes       | `?status=Active&importance=High`             | Per-field query params; AND-combined     |
| Filter by date range     | yes       | `?updatedDate={"start":"…","end":"…"}`       | URL-encoded JSON object                  |
| Full-text search         | partial   | `?title=<substring>`                         | Title contains-match — NOT body/comment  |
| Sort by field            | yes       | `?sortField=UpdatedDate`                     | Fixed allowed set; one field at a time   |
| Sort direction           | yes       | `?sortOrder=Asc\|Desc`                       | Default `Asc`                            |
| Field selection (sparse) | partial   | `?fields=["description","subTaskIds"]`       | OPT-IN extras — does NOT trim defaults   |
| Include related records  | partial   | via `fields` (`subTaskIds`, `superTaskIds`)  | No generic expansion                     |
| Aggregate / count        | no        | use `responseSize` or count client-side      | No count endpoint                        |
| Logical AND / OR         | partial   | distinct params = AND; CSV in one param = OR | No nested boolean grouping               |
| Comparison operators     | partial   | only via date-range `{start,end}`            | No generic `gt`/`lt` on arbitrary fields |
| Null checks              | no        | —                                            |                                          |
| Regex / pattern          | no        | `title` is literal substring only            |                                          |

---

## Common Patterns

### Pattern 1: List & Filter

Multiple distinct params are AND-combined. A CSV inside one enum param is OR within that field.

**Base list (account-wide):**

```http
GET /api/v4/tasks?status=Active&pageSize=1000&sortField=UpdatedDate&sortOrder=Desc
```

**Scoped to a project (preferred when you have the folder ID):**

```http
GET /api/v4/folders/IEAAALZ4I4AAAAB/tasks?status=Active,Deferred&fields=["responsibleIds"]
```

**Combining filters (AND across params, OR within `status`):**

```http
GET /api/v4/tasks?status=Active,Deferred&importance=High&responsibles=["KUAAAAAA"]
```

There is no nested boolean grouping. For "(A or B) and C" you express A,B as a CSV inside one param and C as a separate param. Anything more complex must be filtered client-side.

---

### Pattern 2: Search (title substring only)

Wrike has **no global search endpoint** and **no full-text body/comment search**. The only search is a `title` substring match on tasks and folders.

```http
GET /api/v4/tasks?title=spec&pageSize=1000
GET /api/v4/folders?title=Launch
```

- **Searchable fields:** `title` only (literal contains-match).
- **Fuzzy matching:** none.
- **Minimum query length:** not documented. [UNKNOWN]
- To "search comments" you must list a task's comments and filter client-side — there is no comment search.

---

### Pattern 3: Get by ID (single and bulk)

Single:

```http
GET /api/v4/tasks/IEAAALZ4KQAAAAAK
```

Returns the entity wrapped in `data` (an array of length 1).

**Bulk read by comma-separated IDs** — the primary "bulk" affordance (no batch write exists):

```http
GET /api/v4/tasks/IEAAALZ4KQAAAAAK,IEAAALZ4KRAAAAAL,IEAAALZ4KSAAAAAM?fields=["description"]
GET /api/v4/folders/IEAAALZ4I4AAAAB,IEAAALZ4I5AAAAC
```

- Keep batches to roughly ≤100 IDs (URL length limit).
- **Missing / forbidden IDs are silently omitted** from `data` — there is no per-ID error array. Compare requested vs returned IDs to detect gaps.

---

### Pattern 4: Related Records

Wrike exposes children as scoped sub-resources rather than generic expansion.

**Tasks in a folder/project:**

```http
GET /api/v4/folders/IEAAALZ4I4AAAAB/tasks
```

**Comments on a task (plain text):**

```http
GET /api/v4/tasks/IEAAALZ4KQAAAAAK/comments?plainText=true
```

**Timelogs on a task / by a user:**

```http
GET /api/v4/tasks/IEAAALZ4KQAAAAAK/timelogs
GET /api/v4/contacts/KUAAAAAA/timelogs
```

**Subtasks** — request `subTaskIds` via `fields`, then bulk-read them:

```http
GET /api/v4/tasks/IEAAALZ4KQAAAAAK?fields=["subTaskIds"]
→ data[0].subTaskIds = ["IEAAALZ4KBAAAAA","IEAAALZ4KCAAAAB"]
GET /api/v4/tasks/IEAAALZ4KBAAAAA,IEAAALZ4KCAAAAB
```

---

### Pattern 5: Date Range Query

Date-range filters take a **URL-encoded JSON object** with `start` and/or `end`.

```http
GET /api/v4/tasks?updatedDate={"start":"2026-05-01T00:00:00Z","end":"2026-05-31T23:59:59Z"}&sortField=UpdatedDate&sortOrder=Desc
```

URL-encoded form of the param value:

```
updatedDate=%7B%22start%22%3A%222026-05-01T00%3A00%3A00Z%22%2C%22end%22%3A%222026-05-31T23%3A59%3A59Z%22%7D
```

- Either `start` or `end` may be omitted (open-ended range).
- **Datetimes** use ISO 8601 with `Z`; **dates** (e.g. `dueDate` day-granularity) use `YYYY-MM-DD`.
- Common range filters on `/tasks`: `createdDate`, `updatedDate`, `completedDate`, `scheduledDate`, `dueDate`.
- `GET /comments` range is **capped at 7 days** (`createdDate` window). Wider → `invalid_parameter`.

---

### Pattern 6: Field Selection (`fields`)

`fields` is **additive opt-in** — it pulls expensive optional fields, it does NOT trim the default payload.

```http
GET /api/v4/tasks?fields=["description","subTaskIds","superTaskIds","customFields","attachmentCount","dependencyIds"]
```

- Value is a URL-encoded JSON array of strings.
- Only request what you'll use — each extra field costs server work and response size.
- Common opt-ins: `description`, `subTaskIds`, `superTaskIds`, `customFields`, `attachmentCount`, `recurrent`, `briefDescription` (folders).

---

### Pattern 7: Discovery (workflows, custom fields, contacts)

Before setting workflow statuses or custom fields, discover the tenant-defined IDs.

```http
GET /api/v4/workflows          # → customStatuses[] {id, name, group}
GET /api/v4/customfields       # → custom field definitions {id, title, type}
GET /api/v4/spaces             # → top-level spaces
GET /api/v4/contacts?me=true   # → the current user's contact id
```

---

## Pagination Handling

### Model

- **Type:** cursor — `pageSize` + `nextPageToken`, both returned **in the JSON response body**.
- **Default page size:** unbounded for small scoped lists; supply `pageSize` to opt into paging on `/tasks` and `/folders`.
- **Max page size:** `1000`.
- **Total count:** `responseSize` (count of all matching items, including hidden) is present on `/tasks` responses. There is no separate count endpoint.

### Request Parameters

| Parameter       | Type   | Default | Description                                                     |
| --------------- | ------ | ------- | --------------------------------------------------------------- |
| `pageSize`      | int    | —       | Items per page; max 1000.                                       |
| `nextPageToken` | string | —       | Cursor from the previous response body. Omit on the first call. |

### Response Structure

```json
{
  "kind": "tasks",
  "nextPageToken": "eyJvZmZzZXQiOjEwMDB9",
  "responseSize": 2450,
  "data": [
    /* up to pageSize items */
  ]
}
```

### Last Page Detection

- Primary: `nextPageToken` is **absent** in the final response → stop.
- **Belt-and-braces** (known Wrike quirk): a `nextPageToken` can be returned even when `data` is `[]` / `responseSize` is 0. Also stop if `data.length === 0` OR the token is identical to the previous page's token.

### Full Pagination Loop

```
Page 1: GET /api/v4/tasks?status=Active&pageSize=1000
        → body { nextPageToken: "eyJ...A", data: [...1000] }

Page 2: GET /api/v4/tasks?status=Active&pageSize=1000&nextPageToken=eyJ...A
        → body { nextPageToken: "eyJ...B", data: [...1000] }

Page 3: GET /api/v4/tasks?status=Active&pageSize=1000&nextPageToken=eyJ...B
        → body { data: [...450] }   (no nextPageToken) → STOP
```

**Critical:** re-send ALL original filter/sort params on every paged request (`status`, `sortField`, etc.) alongside `nextPageToken`. Unlike some APIs, the Wrike token does NOT carry the query context — dropping the filters on page 2 changes the result set. Do not change filters mid-iteration.

---

## Bulk Read

| Operation                 | Endpoint                          | Max batch  | Notes                                           |
| ------------------------- | --------------------------------- | ---------- | ----------------------------------------------- |
| Bulk read tasks           | `GET /api/v4/tasks/{id1,id2,…}`   | ~100 (URL) | Comma-separated IDs in the path                 |
| Bulk read folders         | `GET /api/v4/folders/{id1,id2,…}` | ~100 (URL) | Same pattern                                    |
| Bulk create/update/delete | —                                 | —          | NOT supported — one write per request (see 01c) |

> The only "bulk" Wrike offers is reading many entities by comma-separated IDs. Missing/forbidden IDs are silently dropped from `data` (no per-ID error). There is no batch-write or composite endpoint.

---

## Worked Examples

### Example 1: My active tasks due this week, freshest first

```http
GET /api/v4/tasks?status=Active&responsibles=["KUAAAAAA"]&dueDate={"start":"2026-05-25","end":"2026-05-31"}&sortField=DueDate&sortOrder=Asc&pageSize=1000
```

```json
{
  "kind": "tasks",
  "responseSize": 3,
  "data": [
    {
      "id": "IEAAALZ4KQAAAAAK",
      "title": "Write the spec",
      "status": "Active",
      "importance": "High",
      "dates": { "type": "Planned", "due": "2026-05-28" },
      "responsibleIds": ["KUAAAAAA"],
      "parentIds": ["IEAAALZ4I4AAAAB"],
      "permalink": "https://www.wrike.com/open.htm?id=1234567"
    }
  ]
}
```

**Key points:**

- `responsibles` is a JSON array of quoted string IDs.
- `dueDate` is a URL-encoded JSON range with day-granularity dates.
- No `nextPageToken` → last page.

### Example 2: All projects (folders carrying a `project` object) and their status

```http
GET /api/v4/folders?project=true&fields=["briefDescription"]
```

```json
{
  "kind": "folders",
  "data": [
    {
      "id": "IEAAALZ4I4AAAAB",
      "title": "Q3 Launch",
      "scope": "WsFolder",
      "project": { "ownerIds": ["KUAAAAAA"], "status": "Green", "startDate": "2026-06-01", "endDate": "2026-08-31" },
      "briefDescription": "Coordinate the Q3 product launch.",
      "permalink": "https://www.wrike.com/open.htm?id=2345678"
    }
  ]
}
```

**Key points:**

- `project=true` filters to projects only (folders with a `project` object).
- The high-level project state is `project.status` (`Green`/`Yellow`/`Red`/…).

### Example 3: Tasks changed since the last poll (change feed)

```http
GET /api/v4/tasks?updatedDate={"start":"2026-05-29T00:00:00Z"}&sortField=UpdatedDate&sortOrder=Desc&pageSize=1000
```

```json
{
  "kind": "tasks",
  "responseSize": 2,
  "data": [
    {
      "id": "IEAAALZ4KQAAAAAK",
      "title": "Write the spec",
      "status": "Completed",
      "updatedDate": "2026-05-29T03:00:00Z"
    },
    { "id": "IEAAALZ4KRAAAAAL", "title": "Review designs", "status": "Active", "updatedDate": "2026-05-29T02:15:00Z" }
  ]
}
```

**Key points:**

- Open-ended range (`start` only) = everything since the timestamp.
- `updatedDate` is the change-detection field; sort `Desc` to see the freshest first.
- This is the polling pattern (no live webhooks wired) — see `01d`.

---

## Gotchas & Counter-Exceptions

1. **`fields` ADDS, it does not trim.** You can't slim a response with `fields` — you can only opt INTO more. To reduce payload, scope the query (folder-level vs account-wide) and avoid `fields`.
2. **Array params must be quoted JSON arrays.** `responsibles=["KUAAAAAA"]` works; `responsibles=[KUAAAAAA]` and `responsibles=KUAAAAAA` both 400 as `invalid_parameter`.
3. **No global / full-text search.** `?title=` is a literal substring on tasks/folders only — no body, no comments, no fuzzy. For "find anything about X" you must fan out and filter client-side.
4. **Re-send filters on every page.** The cursor doesn't encode the query — drop `status=Active` on page 2 and you'll page through ALL tasks.
5. **`nextPageToken` can appear on an empty page.** Don't trust the token alone; stop when `data` is empty or the token repeats.
6. **`responseSize` includes hidden items.** It is the total matching count, not `data.length`. Don't use it to detect the last page — use the token + empty-data check.
7. **Bulk-read silently drops bad IDs.** Always diff requested IDs against returned IDs to find the missing ones.
8. **Comment date range ≤ 7 days at account level.** For older comments, query per task/folder.

---

_Generated from `00-api-investigation-questionnaire.md` Phases 5–6._
