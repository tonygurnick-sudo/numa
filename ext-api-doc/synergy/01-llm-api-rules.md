---
api_name: 12d Synergy
api_slug: synergy
deployment: per-instance, customer-hosted (or 12d-hosted). No central API; instance hostname is part of every URL.
base_url: https://{instance}/api/v1/
path_version_segment: /api/v1 in path on ALL endpoints EXCEPT two — GET /health and POST /api/Tasks (both skip /v1/). "v1" is a real path segment here, not just a label.
auth: Bearer {PAT} (Personal Access Token). No OAuth, no refresh. Max 180-day lifetime.
field_casing: MIXED per model — JobModel/FileModel/FolderModel/PagedResultModel/AttributeValue = PascalCase; TaskItemModel/ContactModel = snake_case. EntityID uses underscore-prefixed keys (_id,_server_id,_server_guid). Never assume — check each response.
id_format: composite EntityID object; use IDString in URL paths. Format "N_N" UNDERSCORE (e.g. "12345_1"). Dash ("12345-1") → "Invalid ID format".
call_surface: FILE-BROWSE connector. The agent reaches Synergy via `numa integrations list-files|search-files|download-file synergy ...` — NOT via `numa integrations request`. `numa integrations request` is NOT wired for synergy. The REST endpoints below are what the connector BACKEND (synergy_provider.py) calls on the agent's behalf — backend-dev reference, preserved for completeness.
rate_limit: undocumented (12d publishes none). Be conservative: ≥100ms between calls; never poll <2min.
errors: plain-text strings, NOT JSON. Swagger documents only 200 responses (no error schema). Key off HTTP status; treat error bodies as opaque text. Show the user the raw response string verbatim.
swagger_ui: {instance}/swagger (NOT /api-docs/ui/index — that 404s). Spec JSON: {instance}/api-docs/api/v1 (only reachable inside an authed browser session; 404 from outside).
ground_truth: the live Swagger at {instance}/api-docs/api/v1. On any contradiction, trust the Swagger. Do not invent endpoints. Do not copy sibling-resource path shapes without confirming.
confidence: facts below verified against the live demo synergy.12dsynergycloud.com 2026-05-19 (and synergy.cuttriss.co.nz 2026-06-03 where noted) unless tagged [INFERRED].
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors, 02=full-spec-dump, 03=connector-setup, 04=reauth.
---

# 12d Synergy — LLM API Rules

## Agent call surface (file-browse — read first)

Synergy is exposed to chat as a FILE-BROWSE connector. Use these `numa integrations` verbs, NOT `request`:

| Verb      | CLI                                                                                                           | Backend tool             | Notes                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| List      | `numa integrations list-files synergy [--folder-id job:<id>\|folder:<id>] [--query <name>] [--page-size <n>]` | connect_synergy_list     | No `--folder-id` → root = top-level JOBS. `--query` filters jobs by name. Synergy ignores `--page-token`. |
| Search    | `numa integrations search-files synergy <query> [--page-size <n>]`                                            | connect_synergy_search   | Cross-instance file search. Synergy ignores `--folder-id`.                                                |
| Download  | `numa integrations download-file synergy <file-id> [-o <path>]`                                               | connect_synergy_download | `<file-id>` from a prior list/search.                                                                     |
| File info | NOT supported                                                                                                 | —                        | Use `list-files synergy --folder-id folder:<id>` to see file details.                                     |

Folder/job ids are prefixed: `job:<IDString>` (e.g. `job:100_1`) and `folder:<IDString>` (e.g. `folder:300_1`), surfaced by a prior list. Jobs ARE the top-level folders. The backend maps Synergy's job→folder→file tree onto the generic folder/file model.

## Terminology Map

| User says         | Synergy concept | Backend endpoint                                       |
| ----------------- | --------------- | ------------------------------------------------------ |
| projects / jobs   | Job             | POST /api/v1/jobs/search                               |
| tasks / to-dos    | Task            | POST /api/v1/tasks/search and POST /api/Tasks          |
| folders           | Folder          | GET /api/v1/folders/{id}/items                         |
| files / documents | File            | GET /api/v1/folders/{id}/items (files live in folders) |
| contacts / people | Contact         | POST /api/v1/Contacts/search                           |
| issues            | Issue           | /api/v1/issue-tracking/...                             |
| users             | User            | /api/v1/users/...                                      |
| teams             | Team            | /api/v1/teams/...                                      |
| companies / orgs  | Company         | /api/v1/companies/...                                  |

Jobs ARE projects. "Projects"/"top-level projects" → search jobs. There is NO `/api/v1/projects` for the main project concept. (`/api/v1/12dProjects/` is the embedded 12d model-project inside a Job/Folder — different thing.)

## Critical Rules (memorize)

1. Jobs listing is POST search, not GET list. No `GET /api/v1/jobs/{page}/{page_size}`. Use `POST /api/v1/jobs/search` with `{Page,PageSize}` in BODY.
2. Three pagination styles, NEVER query string: (a) `/search` endpoints take `{Page,PageSize}` in the BODY; (b) content-listing endpoints take page/size/filter/flags as PATH segments; (c) `/items` endpoints are single-shot, not paginated.
3. `/items` endpoints are single-shot composites. `GET /api/v1/jobs/{id}/items` → JobItemsModel (`SubJobs`,`SubFolders`,`Sub12dProjects`,`Forums`). `GET /api/v1/folders/{id}/items` → FolderItemsModel (`SubFolders`,`TDJobs`,`Files`=PagedResultModel page 1 free). For files page 2+ use the dedicated folder-files endpoint.
4. Task create/update = `POST /api/Tasks` — NO `/v1/` prefix. Same endpoint for both (update = `id` set). There is NO `PUT /api/Tasks`.
5. Delete task requires description in path, URL-encoded: `DELETE /api/v1/tasks/{task_id}/{URL-encoded-description}`.
6. IDString uses UNDERSCORE: `"N_N"` (e.g. `"12345_1"`). Dash → `"Invalid ID format"`.
7. Mixed casing. JobModel/FileModel/FolderModel = PascalCase; ContactModel/TaskItemModel = snake_case. Check each response.
8. Before creating a job, fetch required attrs: `GET /api/v1/jobs/getStandardAttributes` AND `GET /api/v1/jobs/getDefaultAttributes`. (No `/api/v1/attributes/required/jobs`.) Else fails: `"Job Type is required but not defined!"`.
9. Files use checkout/checkin locking. Check out before modifying, check in after. One user at a time.
10. No webhooks. Polling only.
11. Errors are plain strings, not JSON. Check status code first; don't assume a JSON body.
12. `{filter}` segment on folder-files is a SQL `LIKE` pattern, NOT a glob. Match-all = `%` (URL-encoded `%25`). Literal `*` matches NOTHING → returns `TotalRows:0` + HTTP 200, silently looking like an empty folder. [VERIFIED 2026-06-03 synergy.cuttriss.co.nz]
13. No `GET /api/v1/auth/me` and no `GET /api/v1/jobs/{page}/{page_size}` — older docs invented both.

## Core Models (verified shapes)

EntityID (universal id; `IDString` goes in paths, underscore sep):
`{"_id":12345,"_server_id":1,"_server_guid":"...","IDString":"12345_1"}`

PagedResultModel[T] (every paginated list; PascalCase, PageNumber 1-based):
`{"PageNumber":1,"PageSize":50,"TotalPages":3,"TotalRows":142,"Result":[...]}`

JobItemsModel (`GET /api/v1/jobs/{id}/items`):
`{"HasTeam":true,"HasIssuedFilesRegistry":false,"HasForms":false,"HasIssues":true,"SubJobs":[{JobModel}],"SubFolders":[{FolderModel}],"Sub12dProjects":[{TDProjectModel}],"Forums":[{ForumModel}]}`
`SubJobs` ≠ `SubFolders`: a job can contain child jobs (sub-projects). When listing "folders under this job", render BOTH SubFolders and SubJobs as navigable.

FolderItemsModel (`GET /api/v1/folders/{id}/items`):
`{"FolderID":{"IDString":"300_1"},"ParentFolderID":{"IDString":"200_1"},"JobID":{"IDString":"100_1"},"SubFolders":[{FolderModel}],"TDJobs":[{TDProjectModel}],"Files":{"PageNumber":1,"PageSize":N,"TotalPages":M,"TotalRows":X,"Result":[{FileModel}]}}`
`Files` is pre-paginated (page 1 free). For page 2+ use the folder-files endpoint.

JobModel (PascalCase): `ID, Name, Description, Path, ParentJobID(EntityID|null), NoOfChildren, NoOfFolders, NoOfTDJobs, NoOfNotes, CreatedDate, JobCreatorName, Type(0=Job,1=Template), Attributes:[AttributeInfo]`

FolderModel (PascalCase): `ID, Name, ParentFolderID, JobID, HasSubFolders, NoOfSubFolders, Has12dProjects, NumberOf12dProjects, FolderType(int), FolderState(int), IsManagedFolder, InheritsPermissions, InheritsFileNamingRules, CreatedOn, UpdatedOn, Path, ActiveCheckout(CheckOutInfo|null), Attributes, FileAttributes, FileChangeAttributes`

FileModel (PascalCase): `ID, FileName, DisplayName, FolderID, Size(int bytes), SizeReadable(string), LastModified, CreatedOn, LatestVersion, Path, State, LastChangeType, LastChangedBy, LastChangedTime, IsCheckedOut, ActiveCheckout(CheckOutInfo|null), FileType, FileIcon, HasReferences, IsReferenced, IsLinked, LinkedPath, Attributes, ChangeAttributes`

TaskItemModel (snake_case): `id, name, description, due_date_utc, is_closed, item_owner(EntityID), job_id(EntityID), children:[]`

## Endpoint Reference (backend; verified)

### Jobs

| Action                  | Method | Path                                    | Notes                                                                      |
| ----------------------- | ------ | --------------------------------------- | -------------------------------------------------------------------------- |
| Search/list jobs        | POST   | /api/v1/jobs/search                     | Body JobSearchModel: `Page,PageSize,Name,QuickSearchTerm,Attributes`       |
| Get job items           | GET    | /api/v1/jobs/{id}/items                 | JobItemsModel (not paginated)                                              |
| Get job permission      | GET    | /api/v1/jobs/{id}/permission            |                                                                            |
| Get job + attributes    | GET    | /api/v1/jobs/{id}/{retrieve_attributes} | `retrieve_attributes` = `"true"`/`"false"` in path. No plain `/jobs/{id}`. |
| Notes for job           | GET    | /api/v1/jobs/{id}/notes                 |                                                                            |
| Forums for job          | GET    | /api/v1/jobs/{id}/getForums             |                                                                            |
| Map for job             | GET    | /api/v1/jobs/{id}/map                   |                                                                            |
| Create job              | POST   | /api/v1/jobs/create                     | Fetch getStandardAttributes + getDefaultAttributes first                   |
| Calculate job name      | POST   | /api/v1/jobs/calculateJobName           | naming-rule helper                                                         |
| Find matched template   | POST   | /api/v1/jobs/findMatchedTemplate        |                                                                            |
| Update job attrs (bulk) | POST   | /api/v1/jobs/updateAttributes           |                                                                            |
| Announce job change     | POST   | /api/v1/jobs/{id}/announceJobChange     |                                                                            |
| Map-filtered search     | POST   | /api/v1/jobs/searchFromMap              |                                                                            |
| Standard attrs catalog  | GET    | /api/v1/jobs/getStandardAttributes      |                                                                            |
| Default attrs catalog   | GET    | /api/v1/jobs/getDefaultAttributes       |                                                                            |
| Job display attrs       | GET    | /api/v1/jobs/getJobDisplayAttributes    |                                                                            |
| Job naming rule         | GET    | /api/v1/jobs/getJobNamingRule           |                                                                            |
| All categories          | GET    | /api/v1/jobs/getAllCategories           |                                                                            |
| Defined search attrs    | GET    | /api/v1/jobs/getDefinedSearchAttributes |                                                                            |

### Folders

| Action                                   | Method   | Path                                                                                              | Notes                                                    |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Folder items (subfolders + page 1 files) | GET      | /api/v1/folders/{id}/items                                                                        | FolderItemsModel                                         |
| Folder info + attributes                 | GET      | /api/v1/folders/{id}/{retrieve_attributes}                                                        | bool in path                                             |
| Folder change log                        | GET      | /api/v1/folders/{id}/changelog/{page}/{page_size}                                                 |                                                          |
| Paginated files in folder                | GET      | /api/v1/folders/{id}/files/{retrieve_attributes}/{page}/{page_size}/{filter}/{show_deleted_files} | page 2+ of files; `{filter}` is SQL LIKE (see rule 12)   |
| Folder permissions                       | GET      | /api/v1/folders/{id}/permission                                                                   |                                                          |
| Folder web path                          | GET      | /api/v1/folders/{id}/getWebPath/{job_id}                                                          |                                                          |
| Allowed extensions                       | GET      | /api/v1/folders/{id}/getAllowedExtensions                                                         |                                                          |
| Download folder as zip                   | GET/POST | /api/v1/folders/{id}/download?recursive={bool}                                                    | `recursive` is QUERY param here                          |
| Create folder                            | POST     | /api/v1/folders/create                                                                            | no plain `/folders` POST                                 |
| Create from template                     | POST     | /api/v1/folders/createFromTemplate                                                                |                                                          |
| Copy / Move / Rename                     | POST     | /api/v1/folders/{copy\|move\|rename}                                                              |                                                          |
| Search folders                           | POST     | /api/v1/folders/search/{page}/{page_size}                                                         | Body FolderSearchModel; pagination in PATH (odd one out) |

### Files

| Action                 | Method | Path                                                                    | Notes                                                                                                                             |
| ---------------------- | ------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| File metadata          | GET    | /api/v1/files/{id}/{retrieve_attributes}                                | `"true"`/`"false"` in path. No plain `/files/{id}`.                                                                               |
| Versions               | GET    | /api/v1/files/{id}/versions/{version}/{retrieve_attributes}             |                                                                                                                                   |
| History                | GET    | /api/v1/files/{id}/history/{retrieve_attributes}/{page}/{page_size}     |                                                                                                                                   |
| Download               | POST   | /api/v1/files/{id}/download/{version}/{with_references}                 | all PATH params; `version` int, `with_references` bool; empty body                                                                |
| Download (GET variant) | GET    | /api/v1/files/{id}/download/{version}/{with_references}                 | alternative to POST                                                                                                               |
| Thumbnail              | GET    | /api/v1/files/{id}/thumbnail                                            |                                                                                                                                   |
| Preview                | GET    | /api/v1/files/{id}/preview/{version}                                    |                                                                                                                                   |
| Search files           | POST   | /api/v1/files/search                                                    | Body FileSearchModel: `FileName,Contents,Page,PageSize,LimitSearchTo,LimitID`. `Contents` = full-text content search — supported. |
| Checkout               | POST   | /api/v1/files/{id}/checkout                                             |                                                                                                                                   |
| Cancel checkout        | POST   | /api/v1/files/{id}/cancelCheckout                                       |                                                                                                                                   |
| Associations           | GET    | /api/v1/files/{id}/associations                                         |                                                                                                                                   |
| References             | GET    | /api/v1/files/{id}/getReferenceGraph/{version}/{show_referencing_files} |                                                                                                                                   |
| Notes                  | GET    | /api/v1/files/{id}/notes                                                |                                                                                                                                   |
| Permission             | GET    | /api/v1/files/{id}/permission                                           |                                                                                                                                   |
| Weblink                | GET    | /api/v1/files/{id}/weblink/{include_web_root_path}                      |                                                                                                                                   |

`POST /api/v1/files/search` supports **file content search** via the `Contents` field in the body — don't just search by filename. It is **always job-scoped**: `LimitSearchTo:2` + the job's `LimitID` (with `_server_id`) are required, and there is no global/all-jobs search.

### Tasks (idiosyncratic)

| Action               | Method | Path                                                                                  | Notes                                                                                                 |
| -------------------- | ------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| List tasks for a job | GET    | /api/v1/tasks/getTaskList/{job_id}                                                    | only list path; requires a job id                                                                     |
| Get single task      | GET    | /api/v1/tasks/getTask/{task_id}/{get_children}/{get_history}/{get_reminders}/{get_cc} | all four bools required path params                                                                   |
| Create/update task   | POST   | /api/Tasks                                                                            | NO `/v1/`. One endpoint for both (update = `id` set).                                                 |
| Delete task          | DELETE | /api/v1/tasks/{task_id}/{description}                                                 | description URL-encoded in path                                                                       |
| Search tasks         | POST   | /api/v1/tasks/search                                                                  | Body TaskSearchModel `{JobId,AssigneeId,IncludeClosedTasks}`; no Page/PageSize — full set in one call |
| Task states          | GET    | /api/v1/tasks/getTaskStates/{task_type_id}                                            |                                                                                                       |
| Task types           | GET    | /api/v1/tasks/getTaskTypes/{get_attributes}                                           |                                                                                                       |
| Permission           | GET    | /api/v1/tasks/getPermission/{job_id}                                                  |                                                                                                       |
| Next states          | GET    | /api/v1/tasks/{task_id}/getNextTaskStates/{state_id}                                  |                                                                                                       |

No `PUT /api/Tasks`, no `GET /api/v1/tasks/{page}/{page_size}`.

### Contacts (snake_case model; capital C in path)

| Action          | Method | Path                                                                           | Notes                   |
| --------------- | ------ | ------------------------------------------------------------------------------ | ----------------------- |
| List contacts   | GET    | /api/v1/Contacts/list/{page}/{size}/{get_attrs}/{sort_col}/{sort_dir}/{filter} | all path params         |
| Get contact     | GET    | /api/v1/Contacts/{id}/{retrieve_attributes}/{retrieve_companies}               |                         |
| Simple search   | GET    | /api/v1/Contacts/simpleSearch/{term}/{users_only}                              | max 20, no paging       |
| Search contacts | POST   | /api/v1/Contacts/search                                                        | Body ContactSearchModel |
| Save contact    | POST   | /api/v1/Contacts/saveContact                                                   | create or update        |

### Auth / Identity / Misc

| Action           | Method | Path                                     | Notes                                                                 |
| ---------------- | ------ | ---------------------------------------- | --------------------------------------------------------------------- |
| Verify PAT valid | GET    | /api/v1/auth/getPersonalAccessTokens     | 200 + PAT list = ok; 401 = invalid                                    |
| Generate PAT     | POST   | /api/v1/auth/generate-pat                | Body `{ClientId,Name,ExpireInDays}` (max 180). Requires existing PAT. |
| Delete PAT       | POST   | /api/v1/auth/delete-pat                  | POST not DELETE; requires body (411 if empty)                         |
| Get user by id   | GET    | /api/v1/users/{id}/{retrieve_attributes} | no "who am I" endpoint                                                |
| Health           | GET    | /health                                  | no auth, no `/api/v1/` prefix; → `{"status":"Healthy"}`               |

Other resources (verify path in Swagger first — most have unusual shapes): Users `GET /api/v1/users/{id}/{retrieve_attributes}` (no plain list); Teams listed by company/job; Companies `GET /api/v1/Companies/{id}/jobs`; Issues `/api/v1/issue-tracking/...`; WebForms `/api/v1/web-forms/...`; Workflows job-scoped `/api/v1/jobs/{id}/workflows`. Do NOT assume `/api/v1/{resource}/{page}/{page_size}` — that generic pattern is not used in v1.

## DO NOT CALL — non-existent endpoints (older docs/training invented these)

| Non-endpoint                                                    | Use instead                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------- |
| GET /api/v1/jobs/{page}/{page_size}                             | POST /api/v1/jobs/search (body-paginated)                            |
| GET /api/v1/jobs/{id}                                           | GET /api/v1/jobs/{id}/{retrieve_attributes}                          |
| GET /api/v1/jobs/{id}/folders/{page}/{page_size}                | GET /api/v1/jobs/{id}/items (returns SubFolders)                     |
| GET /api/v1/folders/{id}/subfolders/{page}/{page_size}          | GET /api/v1/folders/{id}/items                                       |
| GET /api/v1/folders/{id}/files/{page}/{page_size}               | full path has 6 segments — see Folders table                         |
| GET /api/v1/files/{id}                                          | GET /api/v1/files/{id}/{retrieve_attributes}                         |
| GET /api/v1/files/{id}/download (no path params)                | POST /api/v1/files/{id}/download/{version}/{with_references}         |
| GET /api/v1/files/{id}/download?version=N&with_references=false | same — path params, not query string                                 |
| GET /api/v1/tasks/{page}/{page_size}                            | GET /api/v1/tasks/getTaskList/{job_id} OR POST /api/v1/tasks/search  |
| GET /api/v1/tasks/{id}                                          | GET /api/v1/tasks/getTask/{id}/{children}/{history}/{reminders}/{cc} |
| PUT /api/Tasks                                                  | POST /api/Tasks (both create and update)                             |
| GET /api/v1/auth/me                                             | use getPersonalAccessTokens as liveness check                        |
| GET /api/v1/auth/capabilities                                   | scope discovery not exposed                                          |
| POST /api/v1/jobs/search/{page}/{page_size}                     | POST /api/v1/jobs/search (pagination in BODY)                        |

## Cloud vs self-hosted

`{customer}.12dsynergycloud.com` (cloud) and customer-hosted servers run the same v5 REST API — same paths, auth header, response shapes. Only the instance URL changes. If `/health` is 200 but an authed call 404s on a known-good endpoint, suspect a reverse proxy stripping `/api/v1/`; have the admin verify at `{instance}/swagger`.

## Common 400s and what they mean

| Response (verbatim)                            | Cause                           | Fix                                                      |
| ---------------------------------------------- | ------------------------------- | -------------------------------------------------------- |
| `"Page must be greater than 0"`                | page 0                          | start at 1                                               |
| `"Invalid ID format"` / `"Could not parse ID"` | dash in IDString                | use `"12345_1"`, not `"12345-1"`                         |
| `"Job Type is required but not defined!"`      | missing required attr on create | GET /api/v1/jobs/getStandardAttributes, include them     |
| `"File is not checked out"`                    | modify without checkout         | POST /api/v1/files/{id}/checkout first                   |
| `"Token expired"` / `"Invalid token"`          | PAT expired/malformed           | user rotates PAT                                         |
| `"Not Authorized"` (401)                       | missing Authorization header    | `Authorization: Bearer {PAT}`                            |
| `"Forbidden"` (403)                            | PAT scope too narrow            | user regenerates PAT with broader scopes                 |
| empty 400 body                                 | malformed request body          | verify Content-Type `application/json` + valid JSON      |
| 404 with HTML page                             | hit web app, not API            | check `/api/v1/` prefix (or `/api/` for POST /api/Tasks) |

Show the user the raw response string on error — don't paraphrase; the error text is usually specific enough to act on.

## Worked Examples (backend REST)

List jobs the user can see — `POST /api/v1/jobs/search` + `Authorization: Bearer {PAT}` + `Content-Type: application/json`:
`{"QuickSearchTerm":"","Name":"","Page":1,"PageSize":50,"Attributes":[{"Attribute":{"Name":"TopLevel","DisplayName":"Restrict to top level?"},"Type":"SynergyServerWeb.API.Models.SelectableProgrammaticAttribute","Value":false,"SearchQueryType":4,"Operation":0,"Name":"Restrict to top level?","OperationName":"="}]}`
Returns PagedResultModel[JobModel]; job id = `Result[].ID.IDString`. `TopLevel=false` returns ALL jobs the PAT can see; `true` restricts to root jobs only (hides most data on most instances).

Search jobs by name — omit `Attributes` to include all matches (top-level or not):
`POST /api/v1/jobs/search` `{"Name":"Highway","QuickSearchTerm":"","Page":1,"PageSize":20}`

Drill into a job — `GET /api/v1/jobs/{job_id}/items` → JobItemsModel:
`{"SubFolders":[{"ID":{"IDString":"300_1"},"Name":"Drawings"}],"SubJobs":[{"ID":{"IDString":"101_1"},"Name":"Stage 2"}],"Sub12dProjects":[],"Forums":[],"HasTeam":true,"HasIssuedFilesRegistry":false,"HasForms":false,"HasIssues":true}`
Render BOTH SubFolders and SubJobs as navigable. SubJob → `/api/v1/jobs/{subjob_id}/items`. SubFolder → `/api/v1/folders/{folder_id}/items`.

List subfolders + files in a folder — `GET /api/v1/folders/{folder_id}/items` (SubFolders, TDJobs, Files page 1). For more file pages:
`GET /api/v1/folders/{folder_id}/files/true/{page}/{page_size}/%25/false`
Six path params `{retrieve_attributes}/{page}/{page_size}/{filter}/{show_deleted_files}`. `%25` (SQL LIKE `%`) matches everything (`*` matches NOTHING); `true`=include attrs; `false`=hide deleted.

Get file metadata (incl. latest version) — `GET /api/v1/files/{file_id}/true` → FileModel (FileName, Size, LatestVersion, LastModified, FileType, Path).

Download a file — `POST /api/v1/files/{file_id}/download/{version}/{with_references}` + `Authorization: Bearer {PAT}` + `Content-Type: application/octet-stream`, empty body. `version` int (use `FileModel.LatestVersion`); `with_references` bool. Response = raw file bytes.

Search files (incl. content) — `POST /api/v1/files/search`:
`{"FileName":"drainage","Contents":"","Page":1,"PageSize":20,"ShowDeletedFiles":false,"RetrieveAttributes":true}`
Scope with `LimitSearchTo`+`LimitID`. Content search: set `Contents`.

Create a task — `POST /api/Tasks` (NO `/v1/`) + `Content-Type: application/json`:
`{"name":"Review site survey","description":"Check latest survey data against design","due_date_utc":"2026-04-15T00:00:00Z","job_id":{"IDString":"100_1"},"item_owner":{"IDString":"10_1"}}`
Update = same endpoint, include `id`.

Delete a task (description required, URL-encoded): `DELETE /api/v1/tasks/500_1/Review%20site%20survey`

List tasks for a job — `GET /api/v1/tasks/getTaskList/{job_id}`. No cross-job list; iterate per job.

Create a job (with required attrs) — `GET /api/v1/jobs/getStandardAttributes` (read required), then `POST /api/v1/jobs/create`:
`{"Name":"Bridge Replacement - Waikato","Description":"Full bridge replacement design","Type":0,"Attributes":[{"Name":"ProjectManager","Value":"Jane Smith"},{"Name":"Region","Value":"Waikato"}]}`

## Counter-Exceptions (looks wrong, is correct)

| Looks wrong                                                    | Why correct                                                            |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `POST /api/Tasks` (no `/v1/`)                                  | only endpoint without the version prefix                               |
| pagination in path (`/folders/{id}/files/true/1/50/%25/false`) | filter + flags are path params on content listings                     |
| pagination in body (`POST /jobs/search`)                       | `{Page,PageSize}` in body for all `/search` endpoints                  |
| `DELETE /api/v1/tasks/{id}/{description}`                      | description is a required path param                                   |
| mixed PascalCase + snake_case                                  | JobModel=Pascal, ContactModel/TaskItemModel=snake, EntityID uses `_id` |
| EntityID is an object, not a string                            | composite `{_id,_server_id,_server_guid,IDString}`                     |
| IDString underscore                                            | `"1_1"`, not `"1-1"`                                                   |
| one POST endpoint for create AND update                        | `POST /api/Tasks` and `POST /api/v1/Contacts/saveContact` both do both |
| errors are plain strings                                       | not JSON — e.g. `"Job Type is required but not defined!"`              |
| `simpleSearch` returns max 20                                  | no pagination — only on `/api/v1/Contacts/simpleSearch/...`            |
| no "who am I" endpoint                                         | use getPersonalAccessTokens as a liveness check                        |
| JobItemsModel has BOTH SubFolders and SubJobs                  | jobs can contain jobs; render both                                     |
| `{filter}=%25` matches all, `*` matches nothing                | filter is SQL LIKE, not glob (rule 12)                                 |

## Agent Workflows

- "List my projects/jobs": `list-files synergy` (root = jobs). Backend: `POST /api/v1/jobs/search` `{Page:1,PageSize:50,Name:"",QuickSearchTerm:"",Attributes:[TopLevel=false]}`. Render Name, Description, Path.
- "Find the X project": `list-files synergy --query X` → backend `POST /api/v1/jobs/search` `{Name:"X",Page:1,PageSize:20}`. Best exact-name match; show list if ambiguous.
- "What's in the Highway job?": list/search to get `job:<IDString>`, then `list-files synergy --folder-id job:<id>` → backend `GET /api/v1/jobs/{id}/items`; render SubFolders + SubJobs as one navigable list.
- "Show me files in folder X": `list-files synergy --folder-id folder:<id>` → backend `GET /api/v1/folders/{id}/items` (Files page 1 + SubFolders); page 2+ via folder-files endpoint.
- "Download the file X": `search-files synergy X` to get `<file-id>`, then `download-file synergy <file-id>`. Backend: `POST /api/v1/files/search` → `GET /api/v1/files/{id}/true` (version) → `POST /api/v1/files/{id}/download/{version}/false`.
- "Tasks on project Y?": find job id, then backend `GET /api/v1/tasks/getTaskList/{job_id}`.
- "Search inside file contents for 'drainage'": `search-files synergy drainage` → backend `POST /api/v1/files/search` `{Contents:"drainage",Page:1,PageSize:20}`; file search is always job-scoped, so narrow with `LimitSearchTo:2`+`LimitID` (required).

## What this API cannot do

No webhooks/event subscriptions (poll only). No bulk/batch ops. No cross-job task listing (iterate per job). No "who am I" endpoint (cache user identity from setup). No OAuth — PAT only, 180-day max, renew via `POST /api/v1/auth/generate-pat`. Errors are plain strings, not JSON. Rate limiting undocumented — be conservative. `simpleSearch` (Contacts only) hard-returns 20, no pagination.
