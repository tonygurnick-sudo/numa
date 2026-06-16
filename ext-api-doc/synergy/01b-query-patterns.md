# 12d Synergy — Query Patterns

> Read-side endpoint reference. Every endpoint here is verified against the
> live Swagger at `{instance}/api-docs/api/v1`. For the full endpoint
> catalogue see `02-api-spec-investigation.md`; for the LLM-facing rules
> see `01-llm-api-rules.md`.

---

## Pagination: three styles, never query string

Synergy uses three distinct pagination patterns depending on the endpoint:

### Style 1 — body pagination (`/search` endpoints)

```
POST /api/v1/{resource}/search
Body: { ..., "Page": N, "PageSize": M }
```

Used by: `/jobs/search`, `/files/search`, `/Contacts/search`,
`/tasks/search`, `/folders/search/{page}/{page_size}` (exception: folder
search takes pagination in the path), `/web-forms/form-fills/search`.

### Style 2 — path pagination with extra params (content listings)

```
GET /api/v1/folders/{id}/files/{retrieve_attributes}/{page}/{page_size}/{filter}/{show_deleted_files}
GET /api/v1/files/{id}/history/{retrieve_attributes}/{page}/{page_size}
GET /api/v1/folders/{id}/changelog/{page}/{page_size}
```

Some endpoints need up to six path segments. Fill every one — they're
all required.

### Style 3 — single-shot composite (`/items`)

```
GET /api/v1/jobs/{id}/items        → JobItemsModel (SubJobs + SubFolders + Sub12dProjects + Forums)
GET /api/v1/folders/{id}/items     → FolderItemsModel (SubFolders + TDJobs + Files PagedResultModel)
```

Non-paginated. Returns everything at that level in one call. For
`/folders/{id}/items` the `Files` field is itself a `PagedResultModel` —
you get page 1 for free; use the Style 2 endpoint for page 2+.

### Response wrapper for paginated endpoints

```json
{
  "PageNumber": 1,
  "PageSize": 50,
  "TotalPages": 3,
  "TotalRows": 142,
  "Result": [ ... ]
}
```

### Key rules

- Pages are **1-based**.
- Empty result set returns `TotalPages: 0`, `TotalRows: 0`, `Result: []` — not an error.
- Default and max page sizes are undocumented — always specify explicitly (50 is safe, 100 is common, 200 might work).
- Never use `?page=N&page_size=M` query strings — no Synergy endpoint uses that.

---

## Entity Listing — do not assume a standard pattern

There is **no `GET /api/v1/{resource}/{page}/{page_size}`** generic
pattern. Each resource has its own listing shape. Check the Swagger
before you call.

### Jobs

```
POST /api/v1/jobs/search
Body: {"Page": 1, "PageSize": 50, "QuickSearchTerm": "", "Name": "",
       "Attributes": [{"Attribute":{"Name":"TopLevel","DisplayName":"Restrict to top level?"},
                        "Type":"SynergyServerWeb.API.Models.SelectableProgrammaticAttribute",
                        "Value": false, "SearchQueryType":4, "Operation":0,
                        "Name":"Restrict to top level?","OperationName":"="}]}
```

Returns `PagedResultModel[JobModel]`. `TopLevel` attribute `false`
returns all jobs; `true` restricts to root jobs only.

### Files (in a folder)

```
GET /api/v1/folders/{folder_id}/items              # page 1 of files + all subfolders
GET /api/v1/folders/{folder_id}/files/true/1/50/%25/false   # paginated: retrieve_attrs=true, page=1, size=50, filter=%25, show_deleted=false
```

There is no "list all files" endpoint that isn't scoped to a folder.

> ⚠️ The `{filter}` segment is a **SQL `LIKE` pattern**, not a glob. To match
> all files use `%` (URL-encoded as `%25` in the path). A literal `*` matches
> **nothing** and the endpoint returns `TotalRows: 0` with HTTP 200 — which
> silently looks like an empty folder. Verified against the live
> `synergy.cuttriss.co.nz` instance 2026-06-03.

### Folders (in a job)

```
GET /api/v1/jobs/{job_id}/items      # returns JobItemsModel.SubFolders + SubJobs
GET /api/v1/folders/{id}/items       # drill into a specific folder's subfolders
```

### Tasks

```
GET /api/v1/tasks/getTaskList/{job_id}   # tasks for a single job
POST /api/v1/tasks/search                # body: {JobId, AssigneeId, IncludeClosedTasks}
```

No cross-job "list all tasks" endpoint.

### Contacts

```
GET /api/v1/Contacts/list/{page}/{size}/{get_attrs}/{sort_col}/{sort_dir}/{filter}
POST /api/v1/Contacts/search             # body: ContactSearchModel
GET /api/v1/Contacts/simpleSearch/{term}/{users_only}   # returns max 20, no paging
```

Note capital `C`.

### Users / Teams / Companies / Issues / WebForms

No generic list endpoints. Fetch individual resources by ID, or scope
to a job/company via endpoints like `/api/v1/jobs/{id}/tasks` or
`/api/v1/Companies/{id}/jobs`. Check the Swagger per resource.

---

## Single-entity fetches

Most individual-entity endpoints require a `retrieve_attributes` path
segment (boolean, `"true"` or `"false"`):

```
GET /api/v1/jobs/{id}/{retrieve_attributes}
GET /api/v1/files/{id}/{retrieve_attributes}
GET /api/v1/folders/{id}/{retrieve_attributes}
GET /api/v1/Contacts/{id}/{retrieve_attributes}/{retrieve_companies}
GET /api/v1/users/{id}/{retrieve_attributes}
```

**There is no plain `GET /api/v1/jobs/{id}` or `GET /api/v1/files/{id}`.**
`retrieve_attributes` is required.

### Other single-entity variants

```
GET /api/v1/jobs/{id}/items                    # folders + child jobs inside a job
GET /api/v1/jobs/{id}/permission               # user's permission on this job
GET /api/v1/jobs/{id}/notes                    # notes
GET /api/v1/jobs/{id}/getForums                # forums
GET /api/v1/jobs/{id}/map                      # job map
GET /api/v1/tasks/getTask/{task_id}/{children}/{history}/{reminders}/{cc}    # single task with flags
GET /api/v1/files/{id}/versions/{version}/{retrieve_attributes}              # file version
GET /api/v1/files/{id}/history/{retrieve_attributes}/{page}/{page_size}      # version history
GET /api/v1/files/{id}/download/{version}/{with_references}                  # binary download (GET variant)
GET /api/v1/folders/{id}/download?recursive=true                             # folder as zip (query param here)
```

IDString format is `"N_N"` (underscore). Using `"N-N"` (dash) returns
`"Invalid ID format"`.

---

## Search endpoints

All use `POST`. Body shapes vary per resource.

### Job search

```
POST /api/v1/jobs/search
{
  "QuickSearchTerm": "Highway",       // prefix match
  "Name": "",                         // contains match (optional)
  "Page": 1,
  "PageSize": 50,
  "Attributes": []                    // optional filters; see TopLevel example above
}
```

`QuickSearchTerm` and `Name` both target the job name. Use one or the
other, not both with different values (they get AND-ed).

### File search (includes content search)

**File search is ALWAYS job-scoped — there is no global / all-jobs search.**
`LimitSearchTo` + `LimitID` are **required**. Omitting `LimitID` (or using
`LimitSearchTo: 0`) returns **HTTP 500** ("Object reference not set..."). The
12d web client behaves the same way: you pick a project, then search inside it.
(Verified live: an instance can have >13,000 projects and none of the
no-scope/`LimitSearchTo:0` variants return results.)

```
POST /api/v1/files/search
{
  "FileName": "drainage",            // matches file names
  "Contents": "",                    // full-text content search — supported, runs separately
  "Page": 1,
  "PageSize": 50,
  "ShowDeletedFiles": false,
  "Attributes": [],
  "LimitSearchTo": 2,                // REQUIRED. 2 = the job AND its sub-jobs (verified
                                     //   against the web client; this is the value to use)
  "LimitID": {                       // REQUIRED. The JOB's full ID object.
    "IDString": "100_1",
    "_id": 100,                      // the part before "_" in the IDString
    "_server_id": 1                  // the part after "_" — MANDATORY; {IDString} alone 500s
  }
}
```

Rules that matter:

- **`LimitID` must include `_server_id`.** Parse the `N_N` IDString: `"8_1"` →
  `{ "IDString": "8_1", "_id": 8, "_server_id": 1 }`. Sending just
  `{ "IDString": "8_1" }` returns HTTP 500. (`_server_guid` is optional.)
- **`LimitSearchTo: 2`** = the job and its sub-jobs. Scope to the **job**
  (not a folder) using the job's ID. Folder-level file search is not reliable
  via this endpoint — scope to the parent job and filter results yourself.
- **`FileName` and `Contents` are separate searches.** To match a term in
  either a filename or document body, run both (one with `FileName`, one with
  `Contents`) and merge the results — `FileName` + `Contents` in one body ANDs
  them.
- **No global search.** To "find files about X" you must first resolve a job:
  `POST /api/v1/jobs/search` with `{Name:"..."}` → `Result[i].ID.IDString`,
  then file-search inside it. If you can't determine the job, ask the user
  which project — do not loop job-name searches or claim no files exist.

**File content search IS supported** via `Contents` (verified live — a content
query returns documents by their body text). It is NOT limited by indexing or
file type; never tell the user otherwise.

### Contact search

```
POST /api/v1/Contacts/search
{
  "FirstName": "",
  "LastName": "Smith",
  "Email": "",
  "UsersOnly": false,
  "Page": 1,
  "PageSize": 50
}
```

### Task search

```
POST /api/v1/tasks/search
{
  "JobId": { "IDString": "100_1" },
  "AssigneeId": { "IDString": "10_1" },
  "IncludeClosedTasks": false
}
```

Task search has no `Page`/`PageSize` in its model — the full result set
comes back in one call.

### Folder search

```
POST /api/v1/folders/search/{page}/{page_size}
Body: FolderSearchModel
```

Pagination is **in the path** here, not the body. The odd one out among
search endpoints.

---

## Worked Examples

### Example 1: List all jobs visible to the PAT user

```
page = 1
all = []
while True:
    body = {
      "Page": page, "PageSize": 100,
      "QuickSearchTerm": "", "Name": "",
      "Attributes": [{ "Attribute":{"Name":"TopLevel","DisplayName":"Restrict to top level?"},
                       "Type":"SynergyServerWeb.API.Models.SelectableProgrammaticAttribute",
                       "Value": False, "SearchQueryType":4, "Operation":0,
                       "Name":"Restrict to top level?","OperationName":"=" }]
    }
    resp = POST("/api/v1/jobs/search", json=body)
    data = resp.json()
    all.extend(data["Result"])
    if page >= data["TotalPages"]:
        break
    page += 1
```

### Example 2: Search jobs by name

```
POST /api/v1/jobs/search
{ "Name": "Bridge", "QuickSearchTerm": "", "Page": 1, "PageSize": 50 }
```

Returns `PagedResultModel[JobModel]`.

### Example 3: Browse folder contents

```
# Step 1 — drill into a folder to get subfolders + page 1 of files
GET /api/v1/folders/300_1/items

# Response:
{
  "FolderID": { "IDString": "300_1" },
  "SubFolders": [ { "ID": {"IDString":"301_1"}, "Name": "Drawings v2" } ],
  "TDJobs": [],
  "Files": {
    "PageNumber": 1, "PageSize": 50, "TotalPages": 2, "TotalRows": 73,
    "Result": [ { "ID": {"IDString":"2000_1"}, "FileName": "plan.dwg", "LatestVersion": 3, ... } ]
  }
}

# Step 2 — fetch page 2 of files if Files.TotalPages > 1
# filter = %25 (URL-encoded SQL LIKE `%` = match all; `*` matches nothing)
GET /api/v1/folders/300_1/files/true/2/50/%25/false
```

### Example 4: Get job → its folders → a specific file

```
# Step 1 — find the job
POST /api/v1/jobs/search     Body: { "Name": "Highway", "Page": 1, "PageSize": 5 }
# Capture Result[0].ID.IDString, e.g. "100_1"

# Step 2 — what's inside that job?
GET /api/v1/jobs/100_1/items
# Render SubFolders (drill to /folders/{id}/items) and SubJobs (drill to /jobs/{id}/items)

# Step 3 — drill into a folder
GET /api/v1/folders/300_1/items
# Capture Files.Result[N].ID.IDString, e.g. "2000_1"

# Step 4 — get file metadata (for version)
GET /api/v1/files/2000_1/true
# Capture LatestVersion, FileName, Size

# Step 5 — download
POST /api/v1/files/2000_1/download/3/false     # version 3, with_references=false
# Body empty. Response is raw bytes.
```

### Example 5: Full-text search inside files (job-scoped)

File search is always job-scoped — resolve the job first (`/jobs/search`), then:

```
POST /api/v1/files/search
{
  "FileName": "",
  "Contents": "drainage",
  "Page": 1, "PageSize": 20,
  "ShowDeletedFiles": false,
  "Attributes": [],
  "LimitSearchTo": 2,
  "LimitID": { "IDString": "100_1", "_id": 100, "_server_id": 1 }
}
```

`LimitSearchTo` + `LimitID` (with `_server_id`) are **required** — omitting them
returns HTTP 500. There is no global content search across all jobs.

### Example 6: Fetch required attributes before creating a job

```
GET /api/v1/jobs/getStandardAttributes
```

Then use the attributes returned when posting to `/api/v1/jobs/create`.

### Example 7: Check file version history

```
# Metadata (for LatestVersion)
GET /api/v1/files/2000_1/true

# Full history
GET /api/v1/files/2000_1/history/true/1/50
```

---

## Polling for Changes

Synergy has **no webhooks**. Change detection requires polling.

### Strategy 1 — Poll by date filter on search

`FileSearchModel` / `JobSearchModel` allow date filters via the
`Attributes` array. Check the Swagger for the exact attribute name per
resource — they're server-configurable.

### Strategy 2 — Poll /items and diff locally

`GET /api/v1/jobs/{id}/items` and `/api/v1/folders/{id}/items` are the
cheapest way to detect additions/removals within a known scope. Keep a
local cache of `{ID.IDString, UpdatedOn}` and compare.

### Recommended poll interval

- Active sync: every 5–15 minutes
- Background sync: every 30–60 minutes
- Never more frequently than every 2 minutes (rate limiting is
  undocumented — be conservative)
