# 12d Synergy — LLM API Rules

> Agent integration prompt for 12d Synergy v1 REST API. Every endpoint in
> this file is verified against the live Swagger JSON at
> `{instance}/api-docs/api/v1`. If you find a contradiction, trust the
> Swagger. Do not invent endpoints. Do not copy patterns from sibling
> resources without confirming the exact path.

---

## Terminology Map (read this first)

| User says…        | Synergy concept | Primary endpoint                                         |
| ----------------- | --------------- | -------------------------------------------------------- |
| projects          | Job             | `POST /api/v1/jobs/search`                               |
| jobs              | Job             | same as projects                                         |
| tasks / to-dos    | Task            | `POST /api/v1/tasks/search` and `/api/Tasks`             |
| folders           | Folder          | `GET /api/v1/folders/{id}/items`                         |
| files / documents | File            | `GET /api/v1/folders/{id}/items` (files live in folders) |
| contacts / people | Contact         | `POST /api/v1/Contacts/search`                           |
| issues            | Issue           | `GET /api/v1/issue-tracking/...`                         |
| users             | User            | `GET /api/v1/users/...`                                  |
| teams             | Team            | `GET /api/v1/teams/...`                                  |
| companies / orgs  | Company         | `GET /api/v1/companies/...`                              |

**Jobs ARE projects in Synergy.** When the user asks for "projects" or
"top-level projects", search jobs — there is no `/api/v1/projects`
endpoint for the main project concept. (There's a `/api/v1/12dProjects/`
— that's the 12d model-project embedded inside a Job/Folder, which is
different.)

---

## First-Call Playbook (run this every new session)

Execute in order. Stop at the first failure.

```
1. GET /health                  (no auth, no /api/v1/ prefix)
   Expect: 200.
   Fails → instance URL is wrong. Check admin config.

2. GET /api/v1/auth/getPersonalAccessTokens
   Expect: 200 with a list of PAT entries (at minimum your own).
   401 → PAT invalid or expired. Ask user to rotate.
   403 → PAT is valid but scoped too narrowly. Ask user to regenerate
         with broader scopes.

3. POST /api/v1/jobs/search
   Body: {"Page": 1, "PageSize": 5, "QuickSearchTerm": "", "Name": "",
          "Attributes": [{"Attribute":{"Name":"TopLevel","DisplayName":"Restrict to top level?"},
                           "Type":"SynergyServerWeb.API.Models.SelectableProgrammaticAttribute",
                           "Value": false, "SearchQueryType":4, "Operation":0,
                           "Name":"Restrict to top level?","OperationName":"="}]}
   Expect: 200 with PagedResultModel[JobModel].
   Empty Result with TotalRows: 0 → user's PAT sees no jobs (permission
         or genuinely empty). NOT an API error.
```

**Why step 3 uses `Value: false`.** The `TopLevel` attribute is a filter.
`true` restricts results to root jobs only — which on most instances
hides the majority of the data. `false` returns all jobs the PAT user
can see.

There is **no `GET /api/v1/auth/me`** endpoint. There is **no
`GET /api/v1/jobs/{page}/{page_size}`** endpoint. Earlier versions of
this doc were wrong about both. If you see these in older notes, ignore
them.

---

## Quick Reference

```
Base URL:       https://{instance}/api/v1/
Auth:           Authorization: Bearer {PAT}
List jobs:      POST /api/v1/jobs/search     (body-paginated)
Search files:   POST /api/v1/files/search    (body-paginated)
Folder/job contents: GET /api/v1/{jobs|folders}/{id}/items (single page, not paginated)
Paginated files in folder: GET /api/v1/folders/{id}/files/{retrieve_attributes}/{page}/{page_size}/{filter}/{show_deleted_files}
File download:  POST /api/v1/files/{id}/download/{version}/{with_references}   (all path params)
File metadata:  GET /api/v1/files/{id}/{retrieve_attributes}                   (retrieve_attributes = "true" or "false")
IDs:            Composite EntityID — use IDString (e.g. "1_1") in URL paths (underscore, not dash)
Health:         GET /health                  (no auth, no /api/v1/ prefix)
Swagger UI:     {instance}/api-docs/ui/index
Spec JSON:      {instance}/api-docs/api/v1
```

---

## Critical Rules (Memorize These)

1. **Jobs listing is POST search, not GET list.** No plain `GET /api/v1/jobs/{page}/{page_size}` endpoint exists. Use `POST /api/v1/jobs/search` with `{Page, PageSize}` in the body.
2. **Pagination style depends on the endpoint.** Search-style endpoints (`/search`) take pagination in the body. Content-listing endpoints (`/files/{retrieve_attributes}/{page}/{page_size}/{filter}/{show_deleted_files}`) take everything in the path. There is no query-string pagination anywhere.
3. **"Get items" endpoints are single-shot, not paginated.** `GET /api/v1/jobs/{id}/items` returns a `JobItemsModel` — a single blob containing `SubJobs`, `SubFolders`, `Sub12dProjects`, `Forums`. No pagination. For files inside a folder, call `/folders/{id}/items` which returns `SubFolders`, `TDJobs`, and `Files: PagedResultModel[FileModel]` (pre-paginated page 1). To get subsequent pages of files, use `/folders/{id}/files/{retrieve_attributes}/{page}/{page_size}/{filter}/{show_deleted_files}`.
4. **Task create/update is `POST /api/Tasks`** — no `/v1/` prefix. Same endpoint for both create and update (differentiated by whether the ID is set). **There is no `PUT /api/Tasks`.** Do not call that.
5. **Delete task requires description in the path, URL-encoded**: `DELETE /api/v1/tasks/{task_id}/{URL-encoded-description}`.
6. **IDString uses an underscore, not a dash.** Format: `"N_N"` (e.g. `"12345_1"`). Using a dash will return `"Invalid ID format"`.
7. **Mixed casing across models.** JobModel/FileModel/FolderModel = PascalCase. ContactModel / TaskItemModel = snake_case. Check each response.
8. **Fetch required attributes before creating a job**: `GET /api/v1/jobs/getStandardAttributes` and `GET /api/v1/jobs/getDefaultAttributes`. (There is no `GET /api/v1/attributes/required/jobs`.) Creation fails otherwise with a plain-string error like `"Job Type is required but not defined!"`.
9. **Files use checkout/checkin locking.** Check out before modifying, check in after. Only one user at a time.
10. **No webhooks.** Polling only.
11. **Errors are plain strings, not JSON objects.** Swagger only documents 200 responses — no error schemas. Check status code first; don't assume a JSON body.

---

## Core Models (response shapes — verified against Swagger)

### EntityID (universal identifier)

```json
{ "_id": 12345, "_server_id": 1, "_server_guid": "...", "IDString": "12345_1" }
```

`IDString` is what goes in URL paths. Underscore separator.

### PagedResultModel[T]

```json
{ "PageNumber": 1, "PageSize": 50, "TotalPages": 3, "TotalRows": 142, "Result": [ ... ] }
```

### JobItemsModel (what `/api/v1/jobs/{id}/items` returns)

```json
{
  "HasTeam": true,
  "HasIssuedFilesRegistry": false,
  "HasForms": false,
  "HasIssues": true,
  "SubJobs": [ { JobModel }, ... ],
  "SubFolders": [ { FolderModel }, ... ],
  "Sub12dProjects": [ { TDProjectModel }, ... ],
  "Forums": [ { ForumModel }, ... ]
}
```

**`SubJobs` are NOT the same as `SubFolders`.** A job can contain other jobs as children (a parent project with sub-projects). When presenting "folders under this job", include both — SubFolders and SubJobs should both be navigable.

### FolderItemsModel (what `/api/v1/folders/{id}/items` returns)

```json
{
  "FolderID": { "IDString": "300_1" },
  "ParentFolderID": { "IDString": "200_1" },
  "JobID": { "IDString": "100_1" },
  "SubFolders": [ { FolderModel }, ... ],
  "TDJobs": [ { TDProjectModel }, ... ],
  "Files": {
    "PageNumber": 1, "PageSize": N, "TotalPages": M, "TotalRows": X,
    "Result": [ { FileModel }, ... ]
  }
}
```

`Files` is **pre-paginated inside the response** — the endpoint itself is not paginated but gives you page 1 of files free. For page 2+ use the dedicated files-in-folder endpoint.

### JobModel (PascalCase)

```
ID, Name, Description, Path, ParentJobID (EntityID | null),
NoOfChildren, NoOfFolders, NoOfTDJobs, NoOfNotes,
CreatedDate, JobCreatorName, Type (0=Job, 1=Template),
Attributes: [AttributeInfo]
```

### FolderModel (PascalCase)

```
ID, Name, ParentFolderID, JobID,
HasSubFolders, NoOfSubFolders, Has12dProjects, NumberOf12dProjects,
FolderType (int), FolderState (int),
IsManagedFolder, InheritsPermissions, InheritsFileNamingRules,
CreatedOn, UpdatedOn, Path,
ActiveCheckout (CheckOutInfo | null),
Attributes, FileAttributes, FileChangeAttributes
```

### FileModel (PascalCase)

```
ID, FileName, DisplayName, FolderID,
Size (int bytes), SizeReadable (string),
LastModified, CreatedOn, LatestVersion, Path,
State, LastChangeType, LastChangedBy, LastChangedTime,
IsCheckedOut, ActiveCheckout (CheckOutInfo | null),
FileType, FileIcon,
HasReferences, IsReferenced, IsLinked, LinkedPath,
Attributes, ChangeAttributes
```

### TaskItemModel (snake_case — different from all other models)

```
id, name, description, due_date_utc, is_closed,
item_owner (EntityID), job_id (EntityID), children: []
```

---

## Endpoint Reference (verified)

### Jobs

| Action                          | Method | Path                                      | Notes                                                                                   |
| ------------------------------- | ------ | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Search / list jobs              | POST   | `/api/v1/jobs/search`                     | Body: JobSearchModel with `Page`, `PageSize`, `Name`, `QuickSearchTerm`, `Attributes`   |
| Get job items (folders+subjobs) | GET    | `/api/v1/jobs/{id}/items`                 | Returns JobItemsModel (not paginated)                                                   |
| Get job permission              | GET    | `/api/v1/jobs/{id}/permission`            |                                                                                         |
| Get job attributes              | GET    | `/api/v1/jobs/{id}/{retrieve_attributes}` | `retrieve_attributes` is `"true"` or `"false"` in path                                  |
| Get notes for job               | GET    | `/api/v1/jobs/{id}/notes`                 |                                                                                         |
| Get forums for job              | GET    | `/api/v1/jobs/{id}/getForums`             |                                                                                         |
| Get map for job                 | GET    | `/api/v1/jobs/{id}/map`                   |                                                                                         |
| Create job                      | POST   | `/api/v1/jobs/create`                     | Call `/api/v1/jobs/getStandardAttributes` and `/api/v1/jobs/getDefaultAttributes` first |
| Calculate job name              | POST   | `/api/v1/jobs/calculateJobName`           | Naming-rule helper                                                                      |
| Find matched template           | POST   | `/api/v1/jobs/findMatchedTemplate`        |                                                                                         |
| Update job attributes (bulk)    | POST   | `/api/v1/jobs/updateAttributes`           |                                                                                         |
| Set job attributes              | POST   | `/api/v1/jobs/{id}/announceJobChange`     |                                                                                         |
| Map-filtered search             | POST   | `/api/v1/jobs/searchFromMap`              |                                                                                         |
| Standard attributes catalog     | GET    | `/api/v1/jobs/getStandardAttributes`      |                                                                                         |
| Default attributes catalog      | GET    | `/api/v1/jobs/getDefaultAttributes`       |                                                                                         |
| Job display attributes          | GET    | `/api/v1/jobs/getJobDisplayAttributes`    |                                                                                         |
| Job naming rule                 | GET    | `/api/v1/jobs/getJobNamingRule`           |                                                                                         |
| All job categories              | GET    | `/api/v1/jobs/getAllCategories`           |                                                                                         |
| Defined search attributes       | GET    | `/api/v1/jobs/getDefinedSearchAttributes` |                                                                                         |

### Folders

| Action                                            | Method   | Path                                                                                                | Notes                                 |
| ------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Get folder items (subfolders + 1st page of files) | GET      | `/api/v1/folders/{id}/items`                                                                        | Returns FolderItemsModel              |
| Get folder info + attributes                      | GET      | `/api/v1/folders/{id}/{retrieve_attributes}`                                                        | `retrieve_attributes` is bool in path |
| Get folder change log                             | GET      | `/api/v1/folders/{id}/changelog/{page}/{page_size}`                                                 |                                       |
| Get paginated files in folder                     | GET      | `/api/v1/folders/{id}/files/{retrieve_attributes}/{page}/{page_size}/{filter}/{show_deleted_files}` | Use for page 2+ of a folder's files   |
| Get folder permissions                            | GET      | `/api/v1/folders/{id}/permission`                                                                   |                                       |
| Get folder web path                               | GET      | `/api/v1/folders/{id}/getWebPath/{job_id}`                                                          |                                       |
| Get allowed extensions                            | GET      | `/api/v1/folders/{id}/getAllowedExtensions`                                                         |                                       |
| Download folder as zip                            | GET/POST | `/api/v1/folders/{id}/download?recursive={bool}`                                                    | `recursive` is query param here       |
| Create folder                                     | POST     | `/api/v1/folders/create`                                                                            |                                       |
| Create from template                              | POST     | `/api/v1/folders/createFromTemplate`                                                                |                                       |
| Copy folder                                       | POST     | `/api/v1/folders/copy`                                                                              |                                       |
| Move folder                                       | POST     | `/api/v1/folders/move`                                                                              |                                       |
| Rename folder                                     | POST     | `/api/v1/folders/rename`                                                                            |                                       |
| Search folders                                    | POST     | `/api/v1/folders/search/{page}/{page_size}`                                                         | Body is FolderSearchModel             |

### Files

| Action            | Method | Path                                                                      | Notes                                                                               |
| ----------------- | ------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Get file metadata | GET    | `/api/v1/files/{id}/{retrieve_attributes}`                                | `retrieve_attributes` is `"true"`/`"false"` in the path                             |
| Get versions      | GET    | `/api/v1/files/{id}/versions/{version}/{retrieve_attributes}`             |                                                                                     |
| History           | GET    | `/api/v1/files/{id}/history/{retrieve_attributes}/{page}/{page_size}`     |                                                                                     |
| Download          | POST   | `/api/v1/files/{id}/download/{version}/{with_references}`                 | All three are path params; `version` integer, `with_references` boolean; empty body |
| Download (GET)    | GET    | `/api/v1/files/{id}/download/{version}/{with_references}`                 | Alternative to POST                                                                 |
| Thumbnail         | GET    | `/api/v1/files/{id}/thumbnail`                                            |                                                                                     |
| Preview           | GET    | `/api/v1/files/{id}/preview/{version}`                                    |                                                                                     |
| Search files      | POST   | `/api/v1/files/search`                                                    | Body: FileSearchModel (FileName, Contents, Page, PageSize, LimitSearchTo, LimitID)  |
| Checkout          | POST   | `/api/v1/files/{id}/checkout`                                             |                                                                                     |
| Cancel checkout   | POST   | `/api/v1/files/{id}/cancelCheckout`                                       |                                                                                     |
| Associations      | GET    | `/api/v1/files/{id}/associations`                                         |                                                                                     |
| References        | GET    | `/api/v1/files/{id}/getReferenceGraph/{version}/{show_referencing_files}` |                                                                                     |
| Notes             | GET    | `/api/v1/files/{id}/notes`                                                |                                                                                     |
| Permission        | GET    | `/api/v1/files/{id}/permission`                                           |                                                                                     |
| Weblink           | GET    | `/api/v1/files/{id}/weblink/{include_web_root_path}`                      |                                                                                     |

`POST /api/v1/files/search` supports **file content search** via the `Contents` field in the body — don't just search by filename.

### Tasks

Task endpoints are idiosyncratic — several don't follow the standard pattern.

| Action                  | Method | Path                                                                                    | Notes                                                           |
| ----------------------- | ------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Get task list for a job | GET    | `/api/v1/tasks/getTaskList/{job_id}`                                                    | Only way to list tasks; requires a job ID                       |
| Get single task         | GET    | `/api/v1/tasks/getTask/{task_id}/{get_children}/{get_history}/{get_reminders}/{get_cc}` | All four booleans are required path params                      |
| Create/update task      | POST   | `/api/Tasks`                                                                            | **NO `/v1/` prefix.** Create or update, one endpoint.           |
| Delete task             | DELETE | `/api/v1/tasks/{task_id}/{description}`                                                 | Description URL-encoded in path                                 |
| Search tasks            | POST   | `/api/v1/tasks/search`                                                                  | Body: TaskSearchModel `{JobId, AssigneeId, IncludeClosedTasks}` |
| Get task states         | GET    | `/api/v1/tasks/getTaskStates/{task_type_id}`                                            |                                                                 |
| Get task types          | GET    | `/api/v1/tasks/getTaskTypes/{get_attributes}`                                           |                                                                 |
| Get permission          | GET    | `/api/v1/tasks/getPermission/{job_id}`                                                  |                                                                 |
| Get next states         | GET    | `/api/v1/tasks/{task_id}/getNextTaskStates/{state_id}`                                  |                                                                 |

**There is no `PUT /api/Tasks` and no `GET /api/v1/tasks/{page}/{page_size}`.** Ignore any older doc that claims otherwise.

### Contacts (snake_case model)

| Action          | Method | Path                                                                             | Notes                           |
| --------------- | ------ | -------------------------------------------------------------------------------- | ------------------------------- |
| List contacts   | GET    | `/api/v1/Contacts/list/{page}/{size}/{get_attrs}/{sort_col}/{sort_dir}/{filter}` | All path params; note capital C |
| Get contact     | GET    | `/api/v1/Contacts/{id}/{retrieve_attributes}/{retrieve_companies}`               |                                 |
| Simple search   | GET    | `/api/v1/Contacts/simpleSearch/{term}/{users_only}`                              | Returns max 20, no paging       |
| Search contacts | POST   | `/api/v1/Contacts/search`                                                        | Body: ContactSearchModel        |
| Save contact    | POST   | `/api/v1/Contacts/saveContact`                                                   | Create or update                |

### Auth / Identity

| Action              | Method | Path                                       | Notes                                                                   |
| ------------------- | ------ | ------------------------------------------ | ----------------------------------------------------------------------- |
| Verify PAT is valid | GET    | `/api/v1/auth/getPersonalAccessTokens`     | Returns 200 with PAT list if authenticated; 401 if not                  |
| Generate new PAT    | POST   | `/api/v1/auth/generate-pat`                | Body: `{ClientId, Name, ExpireInDays}` (max 180). Requires existing PAT |
| Delete PAT          | POST   | `/api/v1/auth/delete-pat`                  |                                                                         |
| Get user by ID      | GET    | `/api/v1/users/{id}/{retrieve_attributes}` | Needs a known user ID. **There is no "who am I" endpoint.**             |
| Health              | GET    | `/health`                                  | No auth, no `/api/v1/` prefix                                           |

### Other resources (verify before calling — most have unusual path shapes)

| Resource  | Listing pattern                                                |
| --------- | -------------------------------------------------------------- |
| Users     | `GET /api/v1/users/{id}/{retrieve_attributes}` (no plain list) |
| Teams     | Listed by company/job; check Swagger per operation             |
| Companies | `GET /api/v1/Companies/{id}/jobs` for company's jobs           |
| Issues    | `GET /api/v1/issue-tracking/...`                               |
| WebForms  | Various `/api/v1/web-forms/...` paths                          |
| Workflows | Job-scoped: `GET /api/v1/jobs/{id}/workflows` etc.             |

When you need one of these, **look up the exact path in the Swagger JSON
first**. Don't assume `/api/v1/{resource}/{page}/{page_size}` — that
pattern is not used for most resources in v1.

---

## DO NOT CALL — endpoints that don't exist

Earlier versions of this doc (and older Numa code) referenced these. They
do not exist in the v1 Swagger. If the LLM has them in training, ignore.

| Non-endpoint                                                      | What to use instead                                                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /api/v1/jobs/{page}/{page_size}`                             | `POST /api/v1/jobs/search` (body-paginated)                                                        |
| `GET /api/v1/jobs/{id}`                                           | `GET /api/v1/jobs/{id}/{retrieve_attributes}`                                                      |
| `GET /api/v1/jobs/{id}/folders/{page}/{page_size}`                | `GET /api/v1/jobs/{id}/items` (returns SubFolders)                                                 |
| `GET /api/v1/folders/{id}/subfolders/{page}/{page_size}`          | `GET /api/v1/folders/{id}/items` (returns SubFolders)                                              |
| `GET /api/v1/folders/{id}/files/{page}/{page_size}`               | Full path has 6 segments — see Folders table                                                       |
| `GET /api/v1/files/{id}`                                          | `GET /api/v1/files/{id}/{retrieve_attributes}`                                                     |
| `GET /api/v1/files/{id}/download` (no path params)                | `POST /api/v1/files/{id}/download/{version}/{with_references}`                                     |
| `GET /api/v1/files/{id}/download?version=N&with_references=false` | Same — path params, not query string                                                               |
| `GET /api/v1/tasks/{page}/{page_size}`                            | `GET /api/v1/tasks/getTaskList/{job_id}` OR `POST /api/v1/tasks/search`                            |
| `GET /api/v1/tasks/{id}`                                          | `GET /api/v1/tasks/getTask/{id}/{children}/{history}/{reminders}/{cc}`                             |
| `PUT /api/Tasks`                                                  | `POST /api/Tasks` handles both create and update                                                   |
| `GET /api/v1/auth/me`                                             | Use `getPersonalAccessTokens` to verify PAT works; user identity must be discovered some other way |
| `GET /api/v1/auth/capabilities`                                   | Scope discovery is not exposed in the API                                                          |
| `POST /api/v1/jobs/search/{page}/{page_size}`                     | `POST /api/v1/jobs/search` (pagination in BODY)                                                    |

If the Swagger for the instance is a different version than v1 and shows
additional endpoints, read `/api-docs/api/v1` before assuming anything.

---

## Cloud vs self-hosted

`{customer}.12dsynergycloud.com` (cloud) and customer-hosted servers run
the same v5 REST API. Same paths, same auth header, same response
shapes. Only the Instance URL changes.

If `/health` returns 200 but an authenticated call returns 404 on a
known-good endpoint, suspect a reverse proxy stripping `/api/v1/`. Ask
the admin to browse `{instance}/api-docs/ui/index` to verify.

---

## Common 400s and what they mean

| Response                                       | Cause                                  | Fix                                                         |
| ---------------------------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| `"Page must be greater than 0"`                | Passed page 0                          | Start at 1                                                  |
| `"Invalid ID format"` / `"Could not parse ID"` | Dash instead of underscore in IDString | Use `"12345_1"`, not `"12345-1"`                            |
| `"Job Type is required but not defined!"`      | Missing required attribute on create   | `GET /api/v1/jobs/getStandardAttributes` and include them   |
| `"File is not checked out"`                    | Tried to modify without checkout       | `POST /api/v1/files/{id}/checkout` first                    |
| `"Token expired"` / `"Invalid token"`          | PAT expired or malformed               | User must rotate PAT                                        |
| `"Not Authorized"` (401)                       | Missing Authorization header           | `Authorization: Bearer {PAT}`                               |
| `"Forbidden"` (403)                            | PAT scope too narrow                   | User regenerates PAT with broader scopes                    |
| Empty 400 body                                 | Request body malformed                 | Verify Content-Type is `application/json` and JSON is valid |
| 404 with HTML page                             | Hit the web app instead of the API     | Check `/api/v1/` prefix (or `/api/` for `POST /api/Tasks`)  |

Show the user the **raw response string** on error. Don't paraphrase —
the error text is usually specific enough that they can act on it.

---

## Worked Examples

### List jobs the user can see

```http
POST /api/v1/jobs/search HTTP/1.1
Host: {instance}
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "QuickSearchTerm": "",
  "Name": "",
  "Page": 1,
  "PageSize": 50,
  "Attributes": [
    {
      "Attribute": { "Name": "TopLevel", "DisplayName": "Restrict to top level?" },
      "Type": "SynergyServerWeb.API.Models.SelectableProgrammaticAttribute",
      "Value": false,
      "SearchQueryType": 4,
      "Operation": 0,
      "Name": "Restrict to top level?",
      "OperationName": "="
    }
  ]
}
```

Returns `PagedResultModel[JobModel]`. `Result[].ID.IDString` is the job id.

### Search jobs by name

```http
POST /api/v1/jobs/search
{
  "Name": "Highway",
  "QuickSearchTerm": "",
  "Page": 1,
  "PageSize": 20
}
```

Omit `Attributes` entirely to include all matching jobs (top-level or not).

### Drill into a job — see its folders and child jobs

```http
GET /api/v1/jobs/{job_id}/items
```

Returns `JobItemsModel`:

```json
{
  "SubFolders": [ { "ID":{"IDString":"300_1"}, "Name":"Drawings", ... } ],
  "SubJobs":    [ { "ID":{"IDString":"101_1"}, "Name":"Stage 2", ... } ],
  "Sub12dProjects": [ ... ],
  "Forums": [ ... ],
  "HasTeam": true,
  "HasIssuedFilesRegistry": false,
  "HasForms": false,
  "HasIssues": true
}
```

**Render both `SubFolders` and `SubJobs` as navigable.** Drilling into a
SubJob goes back to `/api/v1/jobs/{subjob_id}/items`. Drilling into a
SubFolder goes to `/api/v1/folders/{folder_id}/items`.

### List subfolders and files in a folder

```http
GET /api/v1/folders/{folder_id}/items
```

Returns `FolderItemsModel` with `SubFolders`, `TDJobs`, `Files` (page 1,
up to server default).

For more file pages:

```http
GET /api/v1/folders/{folder_id}/files/true/{page}/{page_size}/*/false
```

Six path params: `{retrieve_attributes}/{page}/{page_size}/{filter}/{show_deleted_files}`.
`*` as filter matches everything; `true` to include attributes on each
FileModel; `false` to hide deleted files.

### Get a file's metadata (including latest version)

```http
GET /api/v1/files/{file_id}/true
```

`true`/`false` is the `retrieve_attributes` path param. Returns a
FileModel with `FileName`, `Size`, `LatestVersion`, `LastModified`,
`FileType`, `Path`, etc.

### Download a file

```http
POST /api/v1/files/{file_id}/download/{version}/{with_references} HTTP/1.1
Authorization: Bearer {PAT}
Content-Type: application/octet-stream
(empty body)
```

Version is integer (use `FileModel.LatestVersion` from the metadata
call). `with_references` is `true` or `false`. Response body is the raw
file bytes.

### Search files (including content search)

```http
POST /api/v1/files/search
{
  "FileName": "drainage",
  "Contents": "",
  "Page": 1,
  "PageSize": 20,
  "ShowDeletedFiles": false,
  "RetrieveAttributes": true
}
```

Scope to a job/folder with `LimitSearchTo` + `LimitID`. To search by
content, set `Contents` instead of (or in addition to) `FileName`.

### Create a task

```http
POST /api/Tasks HTTP/1.1
Host: {instance}
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "name": "Review site survey",
  "description": "Check latest survey data against design",
  "due_date_utc": "2026-04-15T00:00:00Z",
  "job_id": { "IDString": "100_1" },
  "item_owner": { "IDString": "10_1" }
}
```

Note `/api/Tasks`, no `/v1/`. Same endpoint for update — include the
task `id` field.

### Delete a task

```http
DELETE /api/v1/tasks/500_1/Review%20site%20survey HTTP/1.1
```

Description is required in the URL, URL-encoded.

### List tasks for a job

```http
GET /api/v1/tasks/getTaskList/{job_id}
```

There is no cross-job "list all tasks" endpoint. Iterate per job.

### Create a job (with required attributes)

```http
GET /api/v1/jobs/getStandardAttributes
```

Read what's marked required, then:

```http
POST /api/v1/jobs/create
{
  "Name": "Bridge Replacement - Waikato",
  "Description": "Full bridge replacement design",
  "Type": 0,
  "Attributes": [
    { "Name": "ProjectManager", "Value": "Jane Smith" },
    { "Name": "Region", "Value": "Waikato" }
  ]
}
```

---

## Counter-Exceptions (looks wrong, is correct)

| Looks wrong                                                  | Correct | Why                                                             |
| ------------------------------------------------------------ | ------- | --------------------------------------------------------------- |
| `POST /api/Tasks` (no `/v1/`)                                | Yes     | Only endpoint without version prefix                            |
| Pagination in path (`/folders/{id}/files/true/1/50/*/false`) | Yes     | Filter and flags are path params on content-listing endpoints   |
| Pagination in body (`POST /jobs/search`)                     | Yes     | `{Page, PageSize}` in request body for all `/search` endpoints  |
| `DELETE /api/v1/tasks/{id}/{description}`                    | Yes     | Description is a required path param                            |
| Mixed PascalCase + snake_case in the same API                | Yes     | JobModel=Pascal, ContactModel=snake, EntityID uses `_id` naming |
| EntityID is an object, not a string                          | Yes     | Composite `{_id, _server_id, _server_guid, IDString}`           |
| IDString uses underscore                                     | Yes     | `"1_1"`, not `"1-1"`                                            |
| One POST endpoint for both create and update                 | Yes     | `POST /api/Tasks` handles both                                  |
| Errors are plain strings                                     | Yes     | Not JSON — e.g. `"Job Type is required but not defined!"`       |
| `simpleSearch` returns max 20                                | Yes     | No pagination — only on `/api/v1/Contacts/simpleSearch/...`     |
| No "who am I" endpoint                                       | Yes     | Use `getPersonalAccessTokens` as a liveness check               |
| JobItemsModel has BOTH SubFolders and SubJobs                | Yes     | Jobs can contain jobs; render both as navigable                 |

---

## Agent Workflows (end-to-end)

### "List my projects" / "list my jobs"

`POST /api/v1/jobs/search` with `{Page:1, PageSize:50, Name:"", QuickSearchTerm:"", Attributes:[TopLevel=false]}`.
Render `Result[].Name`, `Description`, `Path`.

### "Find the X project"

`POST /api/v1/jobs/search` with `{Name:"X", QuickSearchTerm:"", Page:1, PageSize:20}`.
Pick best match by exact name; show list if ambiguous.

### "What's in the Highway job?"

1. Search to get the job id: `POST /api/v1/jobs/search` with `Name:"Highway"`. Capture `Result[0].ID.IDString`.
2. `GET /api/v1/jobs/{id}/items` → render `SubFolders` + `SubJobs` as a single navigable list.

### "Show me files in folder X"

1. `GET /api/v1/folders/{folder_id}/items` → use `Files.Result` for page 1, plus `SubFolders`.
2. If `Files.TotalPages > 1` and user wants more: `GET /api/v1/folders/{folder_id}/files/true/{page}/{size}/*/false`.

### "Download the file X"

1. Find file id: `POST /api/v1/files/search` with `{FileName:"X", Page:1, PageSize:5}`. Capture `Result[0].ID.IDString` and `LatestVersion`.
2. Metadata (confirm + get version): `GET /api/v1/files/{id}/true`.
3. Download: `POST /api/v1/files/{id}/download/{version}/false` with empty body.

### "What tasks are on project Y?"

1. Find job id: `POST /api/v1/jobs/search` with `Name:"Y"`.
2. `GET /api/v1/tasks/getTaskList/{job_id}`.

### "Search inside file contents for 'drainage'"

`POST /api/v1/files/search` with `{Contents:"drainage", Page:1, PageSize:20}`.
Use `LimitSearchTo` + `LimitID` to narrow to a job/folder.

---

## What this API cannot do

- No webhooks or event subscriptions — polling only
- No bulk/batch operations
- No cross-job task listing — iterate per job
- No "who am I" endpoint — cache user identity from initial setup
- No OAuth — PAT only, 180-day max; renew via `POST /api/v1/auth/generate-pat`
- Errors are plain strings, not JSON — Swagger only documents 200 responses
- Rate limiting is undocumented — be conservative
- `simpleSearch` endpoints (only on Contacts) hard-return 20 results with no pagination

---

## Checking your work

Before committing to a URL, check:

1. Is the `/api/v1/` prefix there? (Except `/api/Tasks` and `/health`.)
2. Is the ID format `"N_N"` (underscore), not `"N-N"`?
3. For `/search` — is pagination in the **body**?
4. For `/items` — you understand it's a single-shot non-paginated endpoint returning a composite response?
5. For file download — all three path params (`{id}/download/{version}/{with_references}`)?
6. For file metadata — the `{retrieve_attributes}` path segment is there?

When in doubt, pull `/api-docs/api/v1` (JSON Swagger) and grep for the
exact path. That's the ground truth.
