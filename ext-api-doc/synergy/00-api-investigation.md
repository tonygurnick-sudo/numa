# 12d Synergy API Investigation

> **Source:** Swagger UI at `{instance}/swagger` (200 OK, verified 2026-05-19); JSON at `{instance}/api-docs/api/v1` is only reachable from inside an authenticated browser session. The companion file `02-api-spec-investigation.md` reports **359 paths / 369 operations** from a spec dump — the "369 endpoints / 274 models" claim in earlier drafts conflated _operations_ with _endpoints_, and the 274 model count is not independently verifiable. Treat raw counts as [INFERRED].
> **Investigation date:** 2026-03-30 (counts re-checked 2026-05-19)
> **Status:** Most claims [DOCUMENTED] from spec dump in 02; live re-probe of `/auth/getPersonalAccessTokens` (401), `/auth/delete-pat` (411), `/health` ({"status":"Healthy"}) confirms those exist. `[UNKNOWN]` markers stand where noted.

---

## Phase 1 — Identity & Purpose

| #   | Question                   | Answer                                                                                                                                                                                                             |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1 | What does the product do?  | 12d Synergy is a construction/engineering project collaboration platform. It manages files, jobs (projects), tasks, workflows, issue tracking, contacts, 12d Model projects, clash detection, web forms, and more. |
| 1.2 | Who are the users?         | Civil engineering firms, construction companies, infrastructure project teams.                                                                                                                                     |
| 1.3 | What is the API's purpose? | Full CRUD over all platform entities: files, jobs, tasks, contacts, workflows, issues, 12d projects, forums, maps, reports, admin, and more.                                                                       |
| 1.4 | API style                  | REST (OpenAPI 3.0 Swagger spec)                                                                                                                                                                                    |
| 1.5 | Base URL                   | `https://{instance}/api/v1/`                                                                                                                                                                                       |
| 1.6 | API version prefix         | `/api/v1/` for all endpoints EXCEPT: `GET /health` (no prefix), `POST /api/Tasks` (no version)                                                                                                                     |
| 1.7 | Spec URL                   | `{instance}/api-docs/api/v1`                                                                                                                                                                                       |

---

## Phase 2 — Authentication & Authorization

| #   | Question               | Answer                                                                                            |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------- |
| 2.1 | Auth mechanism         | Personal Access Token (PAT) via `Authorization: Bearer {PAT}` header                              |
| 2.2 | Token lifetime         | PAT max 180 days from creation                                                                    |
| 2.3 | Token refresh          | No refresh flow. Must generate a new PAT before expiry.                                           |
| 2.4 | OAuth?                 | No. Token-based only.                                                                             |
| 2.5 | Scopes/permissions?    | [UNKNOWN] — Not documented in Swagger spec. Likely inherited from the user's role in 12d Synergy. |
| 2.6 | Multi-tenant auth      | Each client has their own 12d Synergy instance with its own URL and PATs.                         |
| 2.7 | Rate limiting          | [UNKNOWN] — Not documented in spec.                                                               |
| 2.8 | Health check (no auth) | `GET /health` — no auth required, no version prefix                                               |

---

## Phase 3 — Pagination

| #   | Question               | Answer                                                                                                                                                                                 |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | Pagination style       | **Mixed — see 01-llm-api-rules.md §Pagination.** Search endpoints use body pagination; content-listing endpoints use path pagination; `/items` endpoints are non-paginated composites. |
| 3.2 | Body-paginated pattern | `POST /api/v1/{resource}/search` with `{Page, PageSize}` in body. Jobs, files, contacts, tasks.                                                                                        |
| 3.3 | Path-paginated pattern | `GET /api/v1/folders/{id}/files/{retrieve_attributes}/{page}/{page_size}/{filter}/{show_deleted_files}` — content listings often take filters and flags as path segments too.          |
| 3.4 | Response wrapper       | `PagedResultModel[T]`                                                                                                                                                                  |
| 3.5 | Response fields        | `PageNumber` (int32), `PageSize` (int32), `TotalPages` (int32), `TotalRows` (int32), `Result` (T[])                                                                                    |
| 3.6 | Page numbering         | 1-based                                                                                                                                                                                |
| 3.7 | Default page size      | [UNKNOWN] — Not documented. Use explicit page_size always.                                                                                                                             |
| 3.8 | Max page size          | [UNKNOWN] — Not documented. Test with 100 or 200.                                                                                                                                      |
| 3.9 | Cursor-based?          | No. Offset-based only.                                                                                                                                                                 |

---

## Phase 4 — Data Model Overview

| #   | Question             | Answer                                                                                              |
| --- | -------------------- | --------------------------------------------------------------------------------------------------- |
| 4.1 | Total models in spec | 274                                                                                                 |
| 4.2 | Primary ID type      | `EntityID` composite object (NOT a simple integer or UUID)                                          |
| 4.3 | EntityID structure   | `{ _id: int64, _server_id: int32, _server_guid: uuid, IDString: string }`                           |
| 4.4 | Casing convention    | **MIXED** — JobModel uses PascalCase, TaskItemModel uses snake_case. Check each model individually. |
| 4.5 | Date format          | [UNKNOWN from spec] — likely ISO 8601 UTC strings based on field names like `due_date_utc`          |
| 4.6 | Nullable fields      | Many models have nullable/optional fields. Check spec per model.                                    |
| 4.7 | Enum representation  | Integer enums (e.g., Job Type: 0=Job, 1=Template)                                                   |

### Core Entity Models

| Model                 | Casing     | Key Fields                                                                                    |
| --------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| `JobModel`            | PascalCase | ID, Name, Description, Path, Attributes[], ParentJobID, CreatedDate, Type (0=Job, 1=Template) |
| `TaskItemModel`       | snake_case | id, name, description, due_date_utc, is_closed, item_owner, children[]                        |
| `FileModel`           | PascalCase | ID, FileName, Path, FolderID, LatestVersion, LastModified, IsCheckedOut                       |
| `ContactModel`        | [CONFIRM]  | ID, Name, Email, Company, Phone — verify exact fields                                         |
| `FolderModel`         | PascalCase | ID, Name, Path, ParentFolderID                                                                |
| `WorkflowModel`       | [CONFIRM]  | ID, Name, Status, Steps                                                                       |
| `IssueModel`          | [CONFIRM]  | ID, Title, Status, Priority, AssignedTo                                                       |
| `WebFormModel`        | [CONFIRM]  | ID, Name, Fields, Status                                                                      |
| `EntityID`            | mixed      | \_id (int64), \_server_id (int32), \_server_guid (uuid), IDString (string)                    |
| `PagedResultModel[T]` | PascalCase | PageNumber, PageSize, TotalPages, TotalRows, Result (T[])                                     |

---

## Phase 5 — Endpoint Inventory

| #   | Question        | Answer                |
| --- | --------------- | --------------------- |
| 5.1 | Total endpoints | 369                   |
| 5.2 | Spec format     | OpenAPI 3.0 (Swagger) |

### Endpoint Count by Category

| Category       | Count   | Notes                                                             |
| -------------- | ------- | ----------------------------------------------------------------- |
| Files          | 70      | Upload, download, checkout, checkin, versioning, metadata, search |
| WebForms       | 30      | Form definitions, submissions, fields                             |
| Jobs           | 27      | CRUD, search (POST body), attributes, templates                   |
| Issued Files   | 21      | File distribution/transmittal tracking                            |
| Contacts       | 21      | Contact and address management                                    |
| Folders        | 20      | Folder tree operations                                            |
| 12d Projects   | 19      | 12d Model project integration                                     |
| Issue-tracking | 18      | Issue CRUD, comments, status                                      |
| Administration | 17      | Server config, settings, license                                  |
| Authorisation  | 17      | Role/permission management                                        |
| Forums         | 13      | Discussion forums, posts                                          |
| Tasks          | 12      | Task tree CRUD, assignment, status                                |
| Attributes     | 11      | Custom attribute definitions and values                           |
| Workflows      | 10      | Workflow definitions and execution                                |
| Maps           | 9       | Spatial/map features                                              |
| Companies      | 8       | Company registry                                                  |
| Types          | 8       | Type definitions                                                  |
| Reports        | 6       | Report generation                                                 |
| ClashDetection | 6       | 3D clash detection                                                |
| Users          | 6       | User management                                                   |
| Notes          | 5       | Notes/annotations                                                 |
| Associations   | 4       | Entity relationships                                              |
| Teams          | 3       | Team management                                                   |
| Documents      | 3       | Document metadata                                                 |
| Server         | 2       | Server info/status                                                |
| HealthCheck    | 1       | `GET /health`                                                     |
| Gadgets        | 1       | Dashboard gadgets                                                 |
| Categories     | 1       | Category management                                               |
| **TOTAL**      | **369** |                                                                   |

---

## Phase 6 — Key Endpoint Details

### 6.1 Health Check

```
GET /health
```

- No auth required
- No `/api/v1/` prefix
- Returns server health status

### 6.2 Jobs (Projects)

| Operation                               | Method | Path                                                              | Notes                                                         |
| --------------------------------------- | ------ | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| List/search jobs                        | POST   | `/api/v1/jobs/search`                                             | Body-paginated; `TopLevel` attribute `false` returns all jobs |
| Get job metadata (by ID)                | GET    | `/api/v1/jobs/{id}/{retrieve_attributes}`                         | `retrieve_attributes` is `"true"`/`"false"` in the path       |
| Get job items (subfolders + child jobs) | GET    | `/api/v1/jobs/{id}/items`                                         | Returns `JobItemsModel`                                       |
| Create job                              | POST   | `/api/v1/jobs/create`                                             | Not a plain `POST /api/v1/jobs`                               |
| Update attributes (bulk)                | POST   | `/api/v1/jobs/updateAttributes`                                   | Attribute patching, not a PUT                                 |
| Set attributes (on a job)               | POST   | `/api/v1/jobs/{id}/announceJobChange`                             |                                                               |
| Search from map                         | POST   | `/api/v1/jobs/searchFromMap`                                      | Map-aware variant                                             |
| Required/system attributes              | GET    | `/api/v1/jobs/getStandardAttributes` + `.../getDefaultAttributes` | Call before create                                            |

**GOTCHA:** Jobs have **no plain `GET /api/v1/jobs/{id}`**, **no `PUT /api/v1/jobs`**, and **no delete endpoint at all**. The API uses specialized method paths.
**GOTCHA:** Job search uses `POST` with a request body, pagination in the body. Not a GET, not path-paginated.
**GOTCHA:** Fetch `getStandardAttributes` / `getDefaultAttributes` before creating a job — creation will fail if required attributes are missing (error is a plain string like `"Job Type is required but not defined!"`).

### 6.3 Tasks

| Operation             | Method | Path                                                               |
| --------------------- | ------ | ------------------------------------------------------------------ |
| List tasks for a job  | GET    | `/api/v1/tasks/getTaskList/{job_id}`                               |
| Get single task       | GET    | `/api/v1/tasks/getTask/{id}/{children}/{history}/{reminders}/{cc}` |
| Create or update task | POST   | `/api/Tasks`                                                       |
| Delete task           | DELETE | `/api/v1/tasks/{task_id}/{description}`                            |
| Search tasks          | POST   | `/api/v1/tasks/search`                                             |

**GOTCHA:** Create/Update both use `POST /api/Tasks` — NO `/v1/` version prefix. Same endpoint handles both operations (include `id` for update). There is no `PUT /api/Tasks`. No plain `GET /api/v1/tasks/{id}` or list endpoint either.
**GOTCHA:** Delete requires the task description in the path, URL-encoded: `DELETE /api/v1/tasks/{task_id}/{description}`.

### 6.4 Files

| Operation         | Method | Path                                                                  |
| ----------------- | ------ | --------------------------------------------------------------------- |
| Get file metadata | GET    | `/api/v1/files/{id}/{retrieve_attributes}`                            |
| Download file     | POST   | `/api/v1/files/{id}/download/{version}/{with_references}`             |
| Checkout          | POST   | `/api/v1/files/{id}/checkout`                                         |
| Cancel checkout   | POST   | `/api/v1/files/{id}/cancelCheckout`                                   |
| Version history   | GET    | `/api/v1/files/{id}/history/{retrieve_attributes}/{page}/{page_size}` |
| Search files      | POST   | `/api/v1/files/search`                                                |

**GOTCHA:** No plain `/files/{id}` — metadata requires the `{retrieve_attributes}` path segment (`"true"` or `"false"`). Download requires three path params, NOT query string.

### 6.5 Folders

| Operation                                         | Method | Path                                                                                                |
| ------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| Get folder items (subfolders + 1st page of files) | GET    | `/api/v1/folders/{id}/items`                                                                        |
| Get folder metadata                               | GET    | `/api/v1/folders/{id}/{retrieve_attributes}`                                                        |
| Paginated files in folder                         | GET    | `/api/v1/folders/{id}/files/{retrieve_attributes}/{page}/{page_size}/{filter}/{show_deleted_files}` |
| Download folder as zip                            | GET    | `/api/v1/folders/{id}/download?recursive={bool}`                                                    |
| Create folder                                     | POST   | `/api/v1/folders/create`                                                                            |
| Search folders                                    | POST   | `/api/v1/folders/search/{page}/{page_size}`                                                         |

`GET /api/v1/folders/{id}/items` returns `FolderItemsModel` with `SubFolders`, `TDJobs`, and `Files` (`PagedResultModel[FileModel]`, pre-paginated page 1).

### 6.6 Contacts (note capital `C`)

| Operation            | Method | Path                                                                             |
| -------------------- | ------ | -------------------------------------------------------------------------------- |
| List contacts        | GET    | `/api/v1/Contacts/list/{page}/{size}/{get_attrs}/{sort_col}/{sort_dir}/{filter}` |
| Get contact          | GET    | `/api/v1/Contacts/{id}/{retrieve_attributes}/{retrieve_companies}`               |
| Save (create/update) | POST   | `/api/v1/Contacts/saveContact`                                                   |
| Simple search        | GET    | `/api/v1/Contacts/simpleSearch/{term}/{users_only}` (max 20, no paging)          |
| Search contacts      | POST   | `/api/v1/Contacts/search`                                                        |

### 6.7 Attributes (capital `A` — `/api/v1/Attributes/...`)

| Operation                                 | Method | Path                                                                                         |
| ----------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| Standard attributes for a resource        | GET    | `/api/v1/jobs/getStandardAttributes` / `...getDefaultAttributes`                             |
| System attributes (configured per tenant) | GET    | `/api/v1/Attributes/getSystemJobAttributes/{get_initial}` (and siblings for Files, Contacts) |
| Standard search attributes                | GET    | `/api/v1/Attributes/getStandardJobSearchAttributes` (and siblings)                           |
| Find by name + context                    | GET    | `/api/v1/Attributes/findAttributeByNameAndContext/{name}/{search_context}`                   |
| Update attributes (bulk)                  | POST   | `/api/v1/Attributes/updateAttributes`                                                        |

**No `/api/v1/attributes/{page}/{page_size}` generic list endpoint exists.** Use the resource-specific helpers above (`getSystemJobAttributes`, etc.).

---

## Phase 7 — Webhooks & Events

| #   | Question                  | Answer                                                                                               |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| 7.1 | Webhook support?          | **NO.** No webhook/callback endpoints in the Swagger spec.                                           |
| 7.2 | Event subscription?       | **NO.** No event subscription mechanism documented.                                                  |
| 7.3 | Change detection strategy | **Polling only.** Must poll list/search endpoints with date filters or pagination to detect changes. |
| 7.4 | Audit log endpoint?       | [UNKNOWN] — Not clearly documented. Check Administration endpoints.                                  |

---

## Phase 8 — Error Handling

| #   | Question               | Answer                                                                                         |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| 8.1 | Error response format  | [UNKNOWN] — Swagger spec does not document error response schemas in detail.                   |
| 8.2 | HTTP status codes used | [UNKNOWN] — Standard REST codes assumed (400, 401, 403, 404, 500) but not confirmed from spec. |
| 8.3 | Error body structure   | [UNKNOWN] — Do NOT fabricate. Test with invalid requests to discover actual error format.      |
| 8.4 | Validation errors      | [UNKNOWN] — Likely returned as 400 with details but format unconfirmed.                        |
| 8.5 | Rate limit errors      | [UNKNOWN] — No rate limiting documented.                                                       |

---

## Phase 9 — Special Behaviors & Gotchas

| #    | Gotcha                                      | Impact                                                                                                                                                                                                                                                       |
| ---- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 9.1  | **NO `/s12d/` prefix**                      | Previous documentation incorrectly included `/s12d/` in URLs. The correct base is `https://{instance}/api/v1/`.                                                                                                                                              |
| 9.2  | **Pagination is mixed, never query string** | Search endpoints (`/jobs/search`, `/files/search`, `/Contacts/search`, `/tasks/search`) take `{Page, PageSize}` in the body. Content-listing endpoints (`/folders/{id}/files/...`) take pagination as path segments. Never as `?page=N&size=N` query params. |
| 9.3  | **Job search is POST, body-paginated**      | `POST /api/v1/jobs/search` with `{Page, PageSize, Name, QuickSearchTerm, Attributes}` in the body. The `/search/{page}/{page_size}` path variant does NOT exist.                                                                                             |
| 9.4  | **Task create has no version prefix**       | `POST /api/Tasks` — the ONLY endpoint that omits `/v1/`.                                                                                                                                                                                                     |
| 9.5  | **Delete task needs description**           | `DELETE /api/v1/tasks/{task_id}/{description}` — description is a path parameter.                                                                                                                                                                            |
| 9.6  | **Mixed casing across models**              | JobModel=PascalCase, TaskItemModel=snake_case. Never assume casing — check each model.                                                                                                                                                                       |
| 9.7  | **EntityID is composite**                   | IDs are NOT simple integers. `EntityID = { _id, _server_id, _server_guid, IDString }`. Many endpoints accept `IDString` in the path.                                                                                                                         |
| 9.8  | **Required attributes before job create**   | Must call `GET /api/v1/jobs/getStandardAttributes` + `/jobs/getDefaultAttributes` and include all required attributes in the create payload. There is no `/attributes/required/jobs` endpoint.                                                               |
| 9.9  | **File checkout/checkin**                   | Files have a locking model. Must check out before editing, check in after. `IsCheckedOut` flag on FileModel.                                                                                                                                                 |
| 9.10 | **PAT expiry at 180 days**                  | No refresh mechanism. Must proactively rotate tokens before expiry.                                                                                                                                                                                          |

---

## Phase 10 — Integration Assessment

| #    | Question                  | Answer                                                                                                                                    |
| ---- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 10.1 | Integration path          | **Data Connector** (token-based auth) — NOT Pipedream                                                                                     |
| 10.2 | Auth type                 | Token auth (PAT in Bearer header)                                                                                                         |
| 10.3 | Per-client config needed  | Instance URL (unique per client) + PAT                                                                                                    |
| 10.4 | Test connection endpoints | 1. `GET /health` (no auth) 2. `GET /api/v1/auth/getPersonalAccessTokens` (auth check)                                                     |
| 10.5 | Primary data to sync      | Jobs, Files, Folders, Tasks, Contacts                                                                                                     |
| 10.6 | Complexity rating         | **Medium-High** — ~359 paths / ~369 operations [INFERRED from spec dump], composite IDs, mixed casing, path-based pagination, no webhooks |
| 10.7 | Key risks                 | PAT expiry management, mixed casing bugs, pagination implementation errors, no error format docs                                          |
| 10.8 | Webhook gap impact        | Must implement polling for change detection. Consider LastModified/CreatedDate fields for incremental sync.                               |
