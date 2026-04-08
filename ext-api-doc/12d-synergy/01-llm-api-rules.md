# 12d Synergy — LLM API Rules

> Concise agent integration prompt. Feed this to the workspace agent when a user connects 12d Synergy.
> This is the single source of truth for how to talk to the API. When in doubt, defer to this file.

---

## Quick Reference

```
Base URL:       https://{instance}/api/v1/
Auth:           Authorization: Bearer {PAT}
Pagination:     Mixed — some endpoints use path params, search uses body {Page, PageSize}
Search:         POST /api/v1/{resource}/search  (Page/PageSize in body, not path)
IDs:            Composite EntityID — use IDString (e.g. "1_1") in URL paths. Note: underscore separator.
Health check:   GET /health  (no auth, no /api/v1/ prefix)
Swagger UI:     {instance}/api-docs/ui/index
```

---

## Connection

| Field        | Value                                                        |
| ------------ | ------------------------------------------------------------ |
| Base URL     | `https://{instance}/api/v1/`                                 |
| Auth header  | `Authorization: Bearer {PAT}`                                |
| Content-Type | `application/json` for all non-file requests                 |
| PAT lifetime | Max 180 days, no refresh — must rotate proactively           |
| Health check | `GET https://{instance}/health` (no auth, no version prefix) |
| Spec URL     | `{instance}/api-docs/api/v1`                                 |
| Swagger UI   | `{instance}/api-docs/ui/index`                               |

### Standard Request Headers

```
Authorization: Bearer {PAT}
Content-Type: application/json
Accept: application/json
```

---

## Critical Rules (Memorize These)

1. **NO `/s12d/` prefix.** Correct: `/api/v1/jobs`. Wrong: `/s12d/api/v1/jobs`.
2. **Pagination is inconsistent.** List endpoints use path params (`/list/{page}/{size}/...`). Search endpoints use `Page`/`PageSize` in the POST body. `simpleSearch` endpoints hard-return 20 results with no pagination.
3. **Search is always POST** with criteria in the body: `POST /api/v1/jobs/search`. Page/PageSize go in the body: `{"Page": 1, "PageSize": 50, "Name": "..."}`.
4. **Task create/update has NO version prefix**: `POST /api/Tasks`, `PUT /api/Tasks`. Every other endpoint uses `/api/v1/`.
5. **Delete task requires description in path**: `DELETE /api/v1/tasks/{task_id}/{URL-encoded-description}`.
6. **Mixed casing across models**: JobModel = PascalCase top-level, ContactModel = snake_case, EntityID fields use underscore prefix (`_id`). Never assume — check each model.
7. **EntityID is a composite object**. Use `IDString` in URL paths. Format is `N_N` (underscore, e.g. `"1_1"`), **NOT** `N-N` (dash).
8. **Fetch required attributes before creating a job**: `GET /api/v1/attributes/required/jobs`. Creation fails without them. Errors come back as plain strings: `"Job Type is required but not defined!"`.
9. **Files use checkout/checkin locking.** Must check out before modifying, check in after. Only one user at a time.
10. **No webhooks.** Change detection is polling only.
11. **Errors are plain strings**, not JSON objects. Swagger only documents 200 responses — no error schemas. Handle defensively: check status code, try parsing as JSON, fall back to raw text.

---

## Pagination

All list endpoints use path-based pagination. Response wrapper:

```json
{
  "PageNumber": 1,
  "PageSize": 50,
  "TotalPages": 3,
  "TotalRows": 142,
  "Result": [ ... ]
}
```

Pattern: `GET /api/v1/{resource}/{page}/{page_size}`

### Iteration

```
page = 1
while page <= TotalPages:
    fetch /api/v1/{resource}/{page}/{page_size}
    process Result
    page += 1
```

### Edge Cases

- Empty collection: `TotalPages: 0`, `TotalRows: 0`, `Result: []` — not an error
- Page beyond range: returns empty `Result` — not an error
- Default/max page sizes are undocumented — always specify explicitly. 50 is safe, 100 is fine.
- Page 0 is invalid — always start at 1

---

## Core Models

### EntityID (the universal identifier)

```json
{
  "_id": 12345,
  "_server_id": 1,
  "_server_guid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "IDString": "12345_1"
}
```

When an endpoint requires `{id}` in the path, use `IDString` (e.g. `12345_1`). Note the **underscore** separator.

### JobModel (PascalCase)

```json
{
  "ID": { "_id": 100, "_server_id": 1, "_server_guid": "...", "IDString": "100_1" },
  "Name": "Highway Upgrade Stage 2",
  "Description": "...",
  "Path": "/Projects/Infrastructure",
  "ParentJobID": { "IDString": "50_1" },
  "Attributes": [{ "Name": "ProjectManager", "Value": "Jane Smith" }],
  "CreatedDate": "2026-01-15T00:00:00Z",
  "Type": 0
}
```

Type: `0` = Job, `1` = Template.

### TaskItemModel (snake_case — different from all other models)

```json
{
  "id": { "IDString": "500_1" },
  "name": "Review drainage design",
  "description": "...",
  "due_date_utc": "2026-04-01T00:00:00Z",
  "is_closed": false,
  "item_owner": { "IDString": "10_1" },
  "children": []
}
```

### FileModel (PascalCase)

```json
{
  "ID": { "IDString": "2000_1" },
  "FileName": "drainage-plan-v3.dwg",
  "Path": "/Projects/Infrastructure/Drawings",
  "FolderID": { "IDString": "300_1" },
  "LatestVersion": 3,
  "LastModified": "2026-03-28T14:30:00Z",
  "IsCheckedOut": false
}
```

### PagedResultModel (PascalCase — always)

```json
{
  "PageNumber": 1,
  "PageSize": 50,
  "TotalPages": 1,
  "TotalRows": 12,
  "Result": [ ... ]
}
```

---

## Endpoint Reference

### Jobs

| Action             | Method | Path                               | Notes                       |
| ------------------ | ------ | ---------------------------------- | --------------------------- |
| List jobs          | GET    | `/api/v1/jobs/{page}/{page_size}`  |                             |
| Get job            | GET    | `/api/v1/jobs/{id}`                |                             |
| Create job         | POST   | `/api/v1/jobs`                     | Include required attributes |
| Update job         | PUT    | `/api/v1/jobs`                     |                             |
| Delete job         | DELETE | `/api/v1/jobs/{id}`                |                             |
| Search jobs        | POST   | `/api/v1/jobs/search`              | Page/PageSize in body       |
| Get job attributes | GET    | `/api/v1/jobs/{id}/attributes`     |                             |
| Set job attributes | POST   | `/api/v1/jobs/{id}/attributes`     |                             |
| Get required attrs | GET    | `/api/v1/attributes/required/jobs` | Call before job create      |

### Tasks (note the version prefix exceptions)

| Action      | Method | Path                                    | Notes                  |
| ----------- | ------ | --------------------------------------- | ---------------------- |
| List tasks  | GET    | `/api/v1/tasks/{page}/{page_size}`      |                        |
| Get task    | GET    | `/api/v1/tasks/{id}`                    |                        |
| Create task | POST   | `/api/Tasks`                            | **NO `/v1/` prefix**   |
| Update task | PUT    | `/api/Tasks`                            | **NO `/v1/` prefix**   |
| Delete task | DELETE | `/api/v1/tasks/{task_id}/{description}` | URL-encode description |

### Files

| Action        | Method | Path                               | Notes                 |
| ------------- | ------ | ---------------------------------- | --------------------- |
| List files    | GET    | `/api/v1/files/{page}/{page_size}` |                       |
| Get file      | GET    | `/api/v1/files/{id}`               |                       |
| Upload file   | POST   | `/api/v1/files`                    | multipart/form-data   |
| Download file | GET    | `/api/v1/files/{id}/download`      | Returns binary        |
| Checkout file | POST   | `/api/v1/files/{id}/checkout`      | Locks the file        |
| Checkin file  | POST   | `/api/v1/files/{id}/checkin`       | Unlocks + versions    |
| File versions | GET    | `/api/v1/files/{id}/versions`      |                       |
| Search files  | POST   | `/api/v1/files/search`             | Page/PageSize in body |

### Folders

| Action          | Method | Path                                            |
| --------------- | ------ | ----------------------------------------------- |
| List folders    | GET    | `/api/v1/folders/{page}/{page_size}`            |
| Get folder      | GET    | `/api/v1/folders/{id}`                          |
| Folder contents | GET    | `/api/v1/folders/{id}/files/{page}/{page_size}` |
| Create folder   | POST   | `/api/v1/folders`                               |

### Contacts (snake_case model, different endpoint patterns)

| Action          | Method | Path                                                                             | Notes                     |
| --------------- | ------ | -------------------------------------------------------------------------------- | ------------------------- |
| List contacts   | GET    | `/api/v1/Contacts/list/{page}/{size}/{get_attrs}/{sort_col}/{sort_dir}/{filter}` | All params in path        |
| Get contact     | GET    | `/api/v1/Contacts/{id}/{retrieve_attributes}/{retrieve_companies}`               | Boolean path params       |
| Search contacts | POST   | `/api/v1/Contacts/search`                                                        | Page/PageSize in body     |
| Simple search   | GET    | `/api/v1/Contacts/simpleSearch/{term}/{users_only}`                              | Returns max 20, no paging |
| Create/update   | POST   | `/api/v1/Contacts/saveContact`                                                   |                           |
| Can edit?       | GET    | `/api/v1/Contacts/canEdit`                                                       | Permission check          |

### Other Resources

| Resource  | List endpoint                              |
| --------- | ------------------------------------------ |
| Workflows | `GET /api/v1/workflows/{page}/{page_size}` |
| Issues    | `GET /api/v1/issues/{page}/{page_size}`    |
| Users     | `GET /api/v1/users/{page}/{page_size}`     |
| Teams     | `GET /api/v1/teams/{page}/{page_size}`     |
| Companies | `GET /api/v1/companies/{page}/{page_size}` |
| WebForms  | `GET /api/v1/webforms/{page}/{page_size}`  |
| Health    | `GET /health` (no auth, no prefix)         |

---

## Worked Examples

### List first page of jobs

```http
GET /api/v1/jobs/1/50 HTTP/1.1
Host: {instance}
Authorization: Bearer {PAT}
Accept: application/json
```

### Search jobs by name

```http
POST /api/v1/jobs/search HTTP/1.1
Host: {instance}
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "Name": "Highway",
  "QuickSearchTerm": "",
  "Page": 1,
  "PageSize": 50
}
```

### Create a task (note: no /v1/ prefix)

```http
POST /api/Tasks HTTP/1.1
Host: {instance}
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "name": "Review site survey",
  "description": "Check latest survey data against design",
  "due_date_utc": "2026-04-15T00:00:00Z"
}
```

### Delete a task (note: description in path, URL-encoded)

```http
DELETE /api/v1/tasks/500-1/Review%20site%20survey HTTP/1.1
Host: {instance}
Authorization: Bearer {PAT}
```

### Download a file

```http
GET /api/v1/files/2000-1/download HTTP/1.1
Host: {instance}
Authorization: Bearer {PAT}
```

Response is binary file content — handle accordingly.

### Create a job (with required attributes)

```http
GET /api/v1/attributes/required/jobs HTTP/1.1
Host: {instance}
Authorization: Bearer {PAT}
```

Then include all required attributes in the create:

```http
POST /api/v1/jobs HTTP/1.1
Host: {instance}
Authorization: Bearer {PAT}
Content-Type: application/json

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

### Checkout, edit, checkin a file

```http
POST /api/v1/files/2000-1/checkout HTTP/1.1
Authorization: Bearer {PAT}

GET /api/v1/files/2000-1/download HTTP/1.1
Authorization: Bearer {PAT}

POST /api/v1/files/2000-1/checkin HTTP/1.1
Authorization: Bearer {PAT}
Content-Type: multipart/form-data
```

---

## Counter-Exceptions (Looks Wrong But Is Correct)

| Looks wrong                           | Actually correct | Why                                                               |
| ------------------------------------- | ---------------- | ----------------------------------------------------------------- |
| `POST /api/Tasks` (no `/v1/`)         | Yes              | Only endpoint without version prefix                              |
| Pagination in URL path for lists      | Yes              | `/list/{page}/{size}/...` with sort/filter in path too            |
| Pagination in POST body for search    | Yes              | `{Page, PageSize}` in request body, not path                      |
| `DELETE .../tasks/{id}/{description}` | Yes              | Description is a required path param                              |
| Mixed PascalCase and snake_case       | Yes              | JobModel=PascalCase, ContactModel=snake_case, EntityID=underscore |
| EntityID is an object, not a string   | Yes              | Composite ID with `_id`, `_server_id`, `_server_guid`, `IDString` |
| IDString uses underscore (`1_1`)      | Yes              | NOT dash (`1-1`) — underscore is the correct separator            |
| Job search is POST                    | Yes              | Search criteria + pagination in request body                      |
| Error is a plain string               | Yes              | Not JSON — e.g. `"Job Type is required but not defined!"`         |
| `simpleSearch` returns max 20         | Yes              | No pagination — fixed result set of up to 20 items                |

## What This API Cannot Do

- No webhooks or event subscriptions — polling only
- No bulk/batch operations
- No file content search (metadata search only)
- No OAuth — PAT only, 180-day max (but PAT creation is an API call: `POST /api/v1/auth/generate-pat`)
- Errors are plain strings, not JSON — Swagger only documents 200 responses
- Rate limiting is undocumented — be conservative
- `simpleSearch` endpoints return max 20 results with no pagination control
