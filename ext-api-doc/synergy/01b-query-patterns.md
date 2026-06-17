---
api_name: 12d Synergy
api_slug: synergy
doc: read-side / query patterns (on-demand companion to 01-llm-api-rules.md)
ground_truth: live Swagger at {instance}/api-docs/api/v1. Full catalogue in 02-api-spec-investigation.md.
pagination_rule: three styles, NEVER a `?page=N&page_size=M` query string. Pages are 1-based. Empty set → TotalPages:0, TotalRows:0, Result:[] (not an error). Default/max page size undocumented — always specify (50 safe, 100 common, 200 maybe).
id_rule: IDString "N_N" (underscore). Dash → "Invalid ID format".
confidence: verified against live Swagger / instances where tagged; else [INFERRED].
---

# 12d Synergy — Query Patterns

## Pagination: three styles

### Style 1 — body (`/search` endpoints)

`POST /api/v1/{resource}/search`, body `{...,"Page":N,"PageSize":M}`.
Used by: `/jobs/search`, `/files/search`, `/Contacts/search`, `/tasks/search` (no Page/PageSize — full set in one call), `/web-forms/form-fills/search`. EXCEPTION: `/folders/search/{page}/{page_size}` takes pagination in the PATH.

### Style 2 — path with extra params (content listings)

```
GET /api/v1/folders/{id}/files/{retrieve_attributes}/{page}/{page_size}/{filter}/{show_deleted_files}
GET /api/v1/files/{id}/history/{retrieve_attributes}/{page}/{page_size}
GET /api/v1/folders/{id}/changelog/{page}/{page_size}
```

Up to six required path segments — fill every one.

### Style 3 — single-shot composite (`/items`)

```
GET /api/v1/jobs/{id}/items    → JobItemsModel (SubJobs + SubFolders + Sub12dProjects + Forums)
GET /api/v1/folders/{id}/items → FolderItemsModel (SubFolders + TDJobs + Files=PagedResultModel)
```

Not paginated. For `/folders/{id}/items`, `Files` is itself a PagedResultModel — page 1 free; page 2+ via the Style 2 endpoint.

Response wrapper: `{"PageNumber":1,"PageSize":50,"TotalPages":3,"TotalRows":142,"Result":[...]}`.

## Entity listing — no generic pattern

There is NO `GET /api/v1/{resource}/{page}/{page_size}`. Each resource has its own shape; check Swagger before calling.

Jobs: `POST /api/v1/jobs/search`
`{"Page":1,"PageSize":50,"QuickSearchTerm":"","Name":"","Attributes":[{"Attribute":{"Name":"TopLevel","DisplayName":"Restrict to top level?"},"Type":"SynergyServerWeb.API.Models.SelectableProgrammaticAttribute","Value":false,"SearchQueryType":4,"Operation":0,"Name":"Restrict to top level?","OperationName":"="}]}`
→ PagedResultModel[JobModel]. `TopLevel=false` = all jobs; `true` = root jobs only.

Files (in a folder):

```
GET /api/v1/folders/{folder_id}/items                       # page 1 of files + all subfolders
GET /api/v1/folders/{folder_id}/files/true/1/50/%25/false   # paginated: retrieve_attrs=true,page=1,size=50,filter=%25,show_deleted=false
```

No "list all files" endpoint not scoped to a folder. ⚠️ `{filter}` is a SQL `LIKE` pattern, not a glob. Match-all = `%` (URL-encoded `%25`). A literal `*` matches NOTHING → `TotalRows:0` + HTTP 200, silently looking like an empty folder. [VERIFIED 2026-06-03 synergy.cuttriss.co.nz]

Folders (in a job):

```
GET /api/v1/jobs/{job_id}/items   # JobItemsModel.SubFolders + SubJobs
GET /api/v1/folders/{id}/items    # drill into a folder's subfolders
```

Tasks:

```
GET /api/v1/tasks/getTaskList/{job_id}   # tasks for one job — no cross-job list
POST /api/v1/tasks/search                # body {JobId, AssigneeId, IncludeClosedTasks}
```

Contacts (capital C):

```
GET /api/v1/Contacts/list/{page}/{size}/{get_attrs}/{sort_col}/{sort_dir}/{filter}
POST /api/v1/Contacts/search                            # body ContactSearchModel
GET /api/v1/Contacts/simpleSearch/{term}/{users_only}   # max 20, no paging
```

Users / Teams / Companies / Issues / WebForms: no generic list endpoints. Fetch by id, or scope to a job/company (e.g. `/api/v1/jobs/{id}/tasks`, `/api/v1/Companies/{id}/jobs`). Check Swagger per resource.

## Single-entity fetches

Most require a `retrieve_attributes` path segment (`"true"`/`"false"`):

```
GET /api/v1/jobs/{id}/{retrieve_attributes}
GET /api/v1/files/{id}/{retrieve_attributes}
GET /api/v1/folders/{id}/{retrieve_attributes}
GET /api/v1/Contacts/{id}/{retrieve_attributes}/{retrieve_companies}
GET /api/v1/users/{id}/{retrieve_attributes}
```

There is NO plain `GET /api/v1/jobs/{id}` or `GET /api/v1/files/{id}` — `retrieve_attributes` is required.

Other variants:

```
GET /api/v1/jobs/{id}/items                    # folders + child jobs inside a job
GET /api/v1/jobs/{id}/permission               # user's permission on this job
GET /api/v1/jobs/{id}/notes
GET /api/v1/jobs/{id}/getForums
GET /api/v1/jobs/{id}/map
GET /api/v1/tasks/getTask/{task_id}/{children}/{history}/{reminders}/{cc}
GET /api/v1/files/{id}/versions/{version}/{retrieve_attributes}
GET /api/v1/files/{id}/history/{retrieve_attributes}/{page}/{page_size}
GET /api/v1/files/{id}/download/{version}/{with_references}      # binary (GET variant)
GET /api/v1/folders/{id}/download?recursive=true                # folder as zip (query param here)
```

## Search endpoints (all POST; body shapes vary)

Job search — `QuickSearchTerm` (prefix match) and `Name` (contains) both target the job name; use one, not both with differing values (they AND):
`POST /api/v1/jobs/search` `{"QuickSearchTerm":"Highway","Name":"","Page":1,"PageSize":50,"Attributes":[]}`

File search (content search supported via `Contents`) — always job-scoped:
`POST /api/v1/files/search` `{"FileName":"drainage","Contents":"","Page":1,"PageSize":50,"ShowDeletedFiles":false,"Attributes":[],"LimitSearchTo":2,"LimitID":{"IDString":"100_1","_id":100,"_server_id":1}}`
`LimitSearchTo:2` (job + sub-jobs) and `LimitID` (with `_server_id`) are **required** — `LimitSearchTo:0` / missing `LimitID` returns HTTP 500. No global/all-jobs search.

Contact search: `POST /api/v1/Contacts/search` `{"FirstName":"","LastName":"Smith","Email":"","UsersOnly":false,"Page":1,"PageSize":50}`

Task search (no Page/PageSize — full set in one call): `POST /api/v1/tasks/search` `{"JobId":{"IDString":"100_1"},"AssigneeId":{"IDString":"10_1"},"IncludeClosedTasks":false}`

File search is **ALWAYS job-scoped — there is no global / all-jobs search.** `LimitSearchTo`+`LimitID` are **required**; omitting `LimitID` (or `LimitSearchTo:0`) returns **HTTP 500**. `LimitID` must include `_server_id` (the `_N` half of the `N_N` IDString) — `{IDString}` alone 500s. `LimitSearchTo:2` = the job AND its sub-jobs (scope to the job, not a folder). `FileName` and `Contents` AND in one body — run them as separate calls and merge for an OR match. Content search IS supported (not limited by indexing/file type). To "find files about X", resolve the job first (`POST /api/v1/jobs/search` `{Name:"..."}`), then search inside it; if the job is unclear, ask the user — don't loop job-name searches or claim no files exist:
`POST /api/v1/files/search` `{"FileName":"drainage","Contents":"","Page":1,"PageSize":50,"ShowDeletedFiles":false,"Attributes":[],"LimitSearchTo":2,"LimitID":{"IDString":"100_1","_id":100,"_server_id":1}}`

Folder search (pagination in PATH — the odd one out): `POST /api/v1/folders/search/{page}/{page_size}`, body FolderSearchModel.

## Worked Examples

Ex 1 — List all jobs visible to the PAT:

```
page=1; all=[]
while True:
  body={"Page":page,"PageSize":100,"QuickSearchTerm":"","Name":"","Attributes":[{"Attribute":{"Name":"TopLevel","DisplayName":"Restrict to top level?"},"Type":"SynergyServerWeb.API.Models.SelectableProgrammaticAttribute","Value":False,"SearchQueryType":4,"Operation":0,"Name":"Restrict to top level?","OperationName":"="}]}
  data=POST("/api/v1/jobs/search", json=body).json()
  all.extend(data["Result"])
  if page>=data["TotalPages"]: break
  page+=1
```

Ex 2 — Search jobs by name: `POST /api/v1/jobs/search` `{"Name":"Bridge","QuickSearchTerm":"","Page":1,"PageSize":50}` → PagedResultModel[JobModel].

Ex 3 — Browse folder contents:

```
GET /api/v1/folders/300_1/items
→ {"FolderID":{"IDString":"300_1"},"SubFolders":[{"ID":{"IDString":"301_1"},"Name":"Drawings v2"}],"TDJobs":[],"Files":{"PageNumber":1,"PageSize":50,"TotalPages":2,"TotalRows":73,"Result":[{"ID":{"IDString":"2000_1"},"FileName":"plan.dwg","LatestVersion":3}]}}
# page 2 of files (filter %25 = SQL LIKE %; * matches nothing):
GET /api/v1/folders/300_1/files/true/2/50/%25/false
```

Ex 4 — Job → folders → a specific file:

```
POST /api/v1/jobs/search  {"Name":"Highway","Page":1,"PageSize":5}   # capture Result[0].ID.IDString = "100_1"
GET /api/v1/jobs/100_1/items                                          # render SubFolders + SubJobs
GET /api/v1/folders/300_1/items                                       # capture Files.Result[N].ID.IDString = "2000_1"
GET /api/v1/files/2000_1/true                                         # capture LatestVersion, FileName, Size
POST /api/v1/files/2000_1/download/3/false                           # version 3, with_references=false; empty body; raw bytes
```

Ex 5 — Full-text search inside files (always job-scoped; resolve the job first, `LimitSearchTo`+`LimitID` with `_server_id` required or HTTP 500): `POST /api/v1/files/search` `{"FileName":"","Contents":"drainage","Page":1,"PageSize":20,"ShowDeletedFiles":false,"Attributes":[],"LimitSearchTo":2,"LimitID":{"IDString":"100_1","_id":100,"_server_id":1}}`

Ex 6 — Required attrs before create: `GET /api/v1/jobs/getStandardAttributes`, then use returned attrs in `POST /api/v1/jobs/create`.

Ex 7 — File version history: `GET /api/v1/files/2000_1/true` (LatestVersion) then `GET /api/v1/files/2000_1/history/true/1/50`.

## Polling for changes (no webhooks)

- Strategy 1 — date filter on search: `FileSearchModel`/`JobSearchModel` allow date filters via the `Attributes` array; check Swagger for the exact attribute name per resource (server-configurable).
- Strategy 2 — poll `/items` and diff locally: `GET /api/v1/jobs/{id}/items` and `/folders/{id}/items` are cheapest for additions/removals in a known scope; cache `{ID.IDString, UpdatedOn}` and compare.
- Intervals: active 5–15 min; background 30–60 min; never <2 min (rate limiting undocumented — be conservative).
