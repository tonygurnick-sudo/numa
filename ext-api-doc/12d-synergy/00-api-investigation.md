# 12d Synergy API Investigation

> **Source:** Swagger spec at `{instance}/api-docs/api/v1` (369 endpoints, 274 models)
> **Investigation date:** 2026-03-30
> **Status:** CONFIRMED from spec unless marked [UNKNOWN]

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

| #   | Question          | Answer                                                                                              |
| --- | ----------------- | --------------------------------------------------------------------------------------------------- |
| 3.1 | Pagination style  | **Path-based** — page and page_size are URL path segments, NOT query parameters                     |
| 3.2 | Path pattern      | `/{page}/{page_size}` appended to list endpoints                                                    |
| 3.3 | Example           | `GET /api/v1/jobs/1/50` returns page 1 with 50 items                                                |
| 3.4 | Response wrapper  | `PagedResultModel[T]`                                                                               |
| 3.5 | Response fields   | `PageNumber` (int32), `PageSize` (int32), `TotalPages` (int32), `TotalRows` (int32), `Result` (T[]) |
| 3.6 | Page numbering    | 1-based                                                                                             |
| 3.7 | Default page size | [UNKNOWN] — Not documented. Use explicit page_size always.                                          |
| 3.8 | Max page size     | [UNKNOWN] — Not documented. Test with 100 or 200.                                                   |
| 3.9 | Cursor-based?     | No. Offset-based only.                                                                              |

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

| Operation               | Method | Path                                     |
| ----------------------- | ------ | ---------------------------------------- |
| List jobs (paged)       | GET    | `/api/v1/jobs/{page}/{page_size}`        |
| Get job by ID           | GET    | `/api/v1/jobs/{id}`                      |
| Create job              | POST   | `/api/v1/jobs`                           |
| Update job              | PUT    | `/api/v1/jobs`                           |
| Delete job              | DELETE | `/api/v1/jobs/{id}`                      |
| Search jobs             | POST   | `/api/v1/jobs/search/{page}/{page_size}` |
| Get job attributes      | GET    | `/api/v1/jobs/{id}/attributes`           |
| Get required attributes | GET    | `/api/v1/attributes/required/jobs`       |

**GOTCHA:** Job search uses `POST` with a request body, NOT `GET` with query params.
**GOTCHA:** Must fetch required attributes (`GET /api/v1/attributes/required/jobs`) BEFORE creating a job — creation will fail if required attributes are missing.

### 6.3 Tasks

| Operation          | Method | Path                                    |
| ------------------ | ------ | --------------------------------------- |
| List tasks (paged) | GET    | `/api/v1/tasks/{page}/{page_size}`      |
| Get task by ID     | GET    | `/api/v1/tasks/{id}`                    |
| Create task        | POST   | `/api/Tasks`                            |
| Update task        | PUT    | `/api/Tasks`                            |
| Delete task        | DELETE | `/api/v1/tasks/{task_id}/{description}` |

**GOTCHA:** Create/Update use `POST /api/Tasks` — NO version prefix. This is the only endpoint in the entire API that omits `/v1/`.
**GOTCHA:** Delete requires the task description in the path: `DELETE /api/v1/tasks/{task_id}/{description}`.

### 6.4 Files

| Operation          | Method | Path                                      |
| ------------------ | ------ | ----------------------------------------- |
| List files (paged) | GET    | `/api/v1/files/{page}/{page_size}`        |
| Get file by ID     | GET    | `/api/v1/files/{id}`                      |
| Upload file        | POST   | `/api/v1/files`                           |
| Download file      | GET    | `/api/v1/files/{id}/download`             |
| Check out file     | POST   | `/api/v1/files/{id}/checkout`             |
| Check in file      | POST   | `/api/v1/files/{id}/checkin`              |
| Get file versions  | GET    | `/api/v1/files/{id}/versions`             |
| Search files       | POST   | `/api/v1/files/search/{page}/{page_size}` |

### 6.5 Folders

| Operation            | Method | Path                                            |
| -------------------- | ------ | ----------------------------------------------- |
| List folders (paged) | GET    | `/api/v1/folders/{page}/{page_size}`            |
| Get folder by ID     | GET    | `/api/v1/folders/{id}`                          |
| Get folder contents  | GET    | `/api/v1/folders/{id}/files/{page}/{page_size}` |
| Create folder        | POST   | `/api/v1/folders`                               |

### 6.6 Contacts

| Operation             | Method | Path                                         |
| --------------------- | ------ | -------------------------------------------- |
| List contacts (paged) | GET    | `/api/v1/contacts/{page}/{page_size}`        |
| Get contact by ID     | GET    | `/api/v1/contacts/{id}`                      |
| Create contact        | POST   | `/api/v1/contacts`                           |
| Search contacts       | POST   | `/api/v1/contacts/search/{page}/{page_size}` |

### 6.7 Attributes

| Operation                          | Method | Path                                        |
| ---------------------------------- | ------ | ------------------------------------------- |
| Get required attributes for entity | GET    | `/api/v1/attributes/required/{entity_type}` |
| Get attribute definitions          | GET    | `/api/v1/attributes/{page}/{page_size}`     |
| Get entity attributes              | GET    | `/api/v1/{entity_type}/{id}/attributes`     |
| Set entity attributes              | POST   | `/api/v1/{entity_type}/{id}/attributes`     |

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

| #    | Gotcha                                    | Impact                                                                                                                               |
| ---- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 9.1  | **NO `/s12d/` prefix**                    | Previous documentation incorrectly included `/s12d/` in URLs. The correct base is `https://{instance}/api/v1/`.                      |
| 9.2  | **Pagination in PATH**                    | Unlike most APIs, page/page_size are path segments, not query parameters. `GET /api/v1/jobs/1/50` NOT `?page=1&page_size=50`.        |
| 9.3  | **Job search is POST**                    | `POST /api/v1/jobs/search/{page}/{page_size}` with search criteria in the request body.                                              |
| 9.4  | **Task create has no version prefix**     | `POST /api/Tasks` — the ONLY endpoint that omits `/v1/`.                                                                             |
| 9.5  | **Delete task needs description**         | `DELETE /api/v1/tasks/{task_id}/{description}` — description is a path parameter.                                                    |
| 9.6  | **Mixed casing across models**            | JobModel=PascalCase, TaskItemModel=snake_case. Never assume casing — check each model.                                               |
| 9.7  | **EntityID is composite**                 | IDs are NOT simple integers. `EntityID = { _id, _server_id, _server_guid, IDString }`. Many endpoints accept `IDString` in the path. |
| 9.8  | **Required attributes before job create** | Must call `GET /api/v1/attributes/required/jobs` and include all required attributes in the create payload.                          |
| 9.9  | **File checkout/checkin**                 | Files have a locking model. Must check out before editing, check in after. `IsCheckedOut` flag on FileModel.                         |
| 9.10 | **PAT expiry at 180 days**                | No refresh mechanism. Must proactively rotate tokens before expiry.                                                                  |

---

## Phase 10 — Integration Assessment

| #    | Question                  | Answer                                                                                                      |
| ---- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 10.1 | Integration path          | **Data Connector** (token-based auth) — NOT Pipedream                                                       |
| 10.2 | Auth type                 | Token auth (PAT in Bearer header)                                                                           |
| 10.3 | Per-client config needed  | Instance URL (unique per client) + PAT                                                                      |
| 10.4 | Test connection endpoints | 1. `GET /health` (no auth) 2. `GET /api/v1/attributes/1/1` (auth check)                                     |
| 10.5 | Primary data to sync      | Jobs, Files, Folders, Tasks, Contacts                                                                       |
| 10.6 | Complexity rating         | **Medium-High** — 369 endpoints, composite IDs, mixed casing, path-based pagination, no webhooks            |
| 10.7 | Key risks                 | PAT expiry management, mixed casing bugs, pagination implementation errors, no error format docs            |
| 10.8 | Webhook gap impact        | Must implement polling for change detection. Consider LastModified/CreatedDate fields for incremental sync. |
