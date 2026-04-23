# 12d Synergy — Mutation Patterns

> Create, update, delete operations. State transitions. Multi-step workflows.

---

## Job CRUD

Jobs use specialized endpoints for each operation. There is **no plain
`POST /api/v1/jobs`, no `PUT /api/v1/jobs`, and no delete endpoint at all**.
The `/jobs/create`, `/jobs/updateAttributes`, `/jobs/{id}/announceJobChange`
paths are used instead.

### Create Job

**PREREQUISITE:** Fetch standard and default attributes first so you
know which ones are required and what types they take.

```
# Step 1: Get standard attributes (includes required flags)
GET /api/v1/jobs/getStandardAttributes
Authorization: Bearer {PAT}

# Step 2: Get default attribute values (tenant-specific)
GET /api/v1/jobs/getDefaultAttributes
Authorization: Bearer {PAT}

# Step 3: Create job with all required attributes included
POST /api/v1/jobs/create
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "Name": "New Motorway Extension",
  "Description": "Phase 1 design for the northern motorway extension",
  "Path": "/Projects/Infrastructure",
  "Type": 0,
  "Attributes": [
    { "Name": "ProjectManager", "Value": "Jane Smith" },
    { "Name": "Region", "Value": "Auckland" }
  ]
}
```

**If required attributes are missing, the create fails with a plain-string error** like `"Job Type is required but not defined!"`. Always fetch the standard attributes and include them.

### Update Job (attribute patch)

Synergy doesn't have a top-level `PUT /api/v1/jobs`. To update a job,
use the attribute endpoints:

```
# Bulk attribute update across jobs
POST /api/v1/jobs/updateAttributes
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "EntityIDs": [{ "IDString": "100_1" }],
  "Attributes": [
    { "Name": "ProjectManager", "Value": "John Doe" },
    { "Name": "Region", "Value": "Waikato" }
  ]
}

# Announce a change on a single job (notifies watchers, applies workflow)
POST /api/v1/jobs/{id}/announceJobChange
Body: { ...model or change payload... }
```

Verify the exact request shapes against `JobAttributeUpdateModel` /
`JobChangeAnnouncementModel` in Swagger.

### Delete Job

**There is no delete-job endpoint.** Jobs cannot be deleted via the v1
REST API. Use archiving attributes (e.g. `Status = Archived`) through
`updateAttributes` instead. If your workflow requires true deletion,
it has to happen through the 12d Synergy client app or admin console.

### Get Job Attributes

```
GET /api/v1/jobs/{id}/true
```

The `true` path segment is `retrieve_attributes` — pass `true` to
include attributes in the `JobModel` response. There is no separate
`/jobs/{id}/attributes` endpoint.

---

## Task CRUD

### Create Task

**CRITICAL:** Uses `POST /api/Tasks` — NO `/v1/` prefix. This is the ONLY endpoint in the entire API without the version prefix.

```
POST /api/Tasks
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "name": "Review site survey data",
  "description": "Cross-reference latest survey data with design requirements",
  "due_date_utc": "2026-04-15T00:00:00Z"
}
```

**Note:** TaskItemModel uses **snake_case** field names.

### Update Task

```
POST /api/Tasks  # same endpoint as create — include "id" for update
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "id": { "IDString": "500_1" },
  "name": "Review site survey data - URGENT",
  "description": "Cross-reference latest survey data with design requirements",
  "due_date_utc": "2026-04-10T00:00:00Z",
  "is_closed": false
}
```

**CRITICAL:** Same endpoint as create. No `/v1/` prefix. No `PUT` variant — `POST /api/Tasks` with `id` set performs the update.

### Close Task (Update)

```
POST /api/Tasks  # same endpoint as create — include "id" for update
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "id": { "IDString": "500_1" },
  "is_closed": true
}
```

### Reopen Task (Update)

```
POST /api/Tasks  # same endpoint as create — include "id" for update
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "id": { "IDString": "500_1" },
  "is_closed": false
}
```

### Delete Task

**CRITICAL:** Requires description as a path parameter.

```
DELETE /api/v1/tasks/{task_id}/{description}
Authorization: Bearer {PAT}
```

Example:

```
DELETE /api/v1/tasks/500_1/Review%20site%20survey%20data
Authorization: Bearer {PAT}
```

**Note:** The description must be URL-encoded. Spaces become `%20`.

---

## File Operations

### Upload File

Synergy exposes two upload paths — a simple one-shot upload and a
chunked upload for large files. **There is no `POST /api/v1/files`**
root endpoint.

#### Simple upload

```
POST /api/v1/files/upload
Authorization: Bearer {PAT}
Content-Type: multipart/form-data

# FileUploadModel fields (see Swagger for exact shape):
# - file: (binary file data)
# - FolderID: { "IDString": "300_1" }
# - FileName: "new-design.dwg"
# - Attributes: [...]
```

#### Create a file record (no content)

```
POST /api/v1/files/createFile
Body: FileModel with FolderID, FileName, Attributes
```

#### Chunked upload (large files)

```
POST /api/v1/files/initiateChunkUpload      → returns { session_id }
POST /api/v1/files/uploadChunk/{session_id}/{chunk_number}
POST /api/v1/files/finalizeChunkUpload/{session_id}
```

`GET /api/v1/files/getChunkUploadStatus/{session_id}` polls progress.

### Checkout → Edit → Checkin Workflow

This is the standard file modification workflow:

```
# Step 1: Check out the file (locks it)
POST /api/v1/files/2000_1/checkout
Authorization: Bearer {PAT}

# Step 2: Get file metadata to discover LatestVersion
GET /api/v1/files/2000_1/true
Authorization: Bearer {PAT}
# -> Returns FileModel with LatestVersion (e.g. 3)

# Step 3: Download the current version
POST /api/v1/files/2000_1/download/3/false
Authorization: Bearer {PAT}
Content-Type: application/octet-stream
# (empty body)
# -> Returns file binary

# Step 3: (User edits the file locally)

# Step 4: Check in with new version
POST /api/v1/files/2000_1/checkin
Authorization: Bearer {PAT}
Content-Type: multipart/form-data

# Form fields:
# - file: (updated binary file data)
# - Comment: "Updated drainage calculations"
```

### State Transitions

```
Available ──[checkout]──► Checked Out ──[checkin]──► Available (version incremented)
    │                                                      │
    │                                                      │
    └──────────────── Cannot modify without checkout ──────┘
```

**Rules:**

- Only one user can check out a file at a time
- Check-in increments `LatestVersion`
- `IsCheckedOut` flag reflects current state
- If a file is checked out by another user, checkout will fail

### Download File

```
# Step 1: Get metadata to discover LatestVersion
GET /api/v1/files/{id}/true       # "true" = retrieve_attributes path param
Authorization: Bearer {PAT}

# Step 2: Download a specific version (path params, not query string)
POST /api/v1/files/{id}/download/{version}/{with_references}
Authorization: Bearer {PAT}
Content-Type: application/octet-stream
(empty body)
```

Three path params: `{version}` integer, `{with_references}` boolean (`true`/`false`). Returns binary file content.

---

## Folder Operations

### Create Folder

```
POST /api/v1/folders/create
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "Name": "Site Photos",
  "ParentFolderID": { "IDString": "300_1" }
}
```

Note the `/create` suffix — `POST /api/v1/folders` (plain) does not exist.

### Move / Rename / Copy

```
POST /api/v1/folders/move      Body: { FolderID, NewParentFolderID }
POST /api/v1/folders/rename    Body: { FolderID, NewName }
POST /api/v1/folders/copy      Body: { FolderID, TargetParentFolderID }
```

### Delete Folder

**Folder deletion via the REST API is not exposed in v1.** There is no
`DELETE /api/v1/folders/{id}` endpoint. Folder lifecycle happens through
the 12d Synergy client application. If your workflow depends on
programmatic folder deletion, it's not achievable through this API.

---

## Contact Operations

### Create or Update Contact

Contacts use a single `saveContact` endpoint for both create and update.
Note the **capital `C`** in the path. There is no plain `/api/v1/contacts`
or `PUT` variant.

```
POST /api/v1/Contacts/saveContact
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "ID": { "IDString": "800_1" },    // omit for create; include for update
  "first_name": "John",
  "last_name": "Smith",
  "email": "john.smith@example.com",
  "phone": "+64 21 555 0123",
  "company_id": { "IDString": "50_1" }
}
```

**Note:** `ContactModel` uses snake_case field names (unlike the
PascalCase JobModel). Verify the exact shape against `ContactModel` in
the Swagger spec.

---

## Workflow Operations

Workflows in Synergy are not "started" by a generic POST — they're
attached to entities (jobs, issues, tasks) and transition through
states. There is **no `POST /api/v1/workflows`** endpoint.

### Discover workflows

```
GET /api/v1/workflows/all                                  # list workflow definitions
GET /api/v1/workflows/{workflow_id}/{return_all}           # workflow detail
GET /api/v1/workflows/getWorkflowInstance/{workflow_id}/{entity_id}/{entity_type}   # instance attached to a given entity
```

### Transition a workflow

Transitions happen via attribute changes on the owning entity (issue
status, task state, job attribute). See:

```
GET /api/v1/workflows/getRequiredDataCaptureForAttributeWorkflowTransition/{target_type}/{target_id}/{owner_job_id}/{attribute_id}/{next_value_id}
GET /api/v1/workflows/getRequiredWorkflowDataCaptureForTaskStateWorkflowTransition/{task_id}/{next_state_id}/{job_id}
```

Then submit the transition by updating the attribute on the target entity (e.g. `POST /api/v1/tasks/{id}/attributes`).

---

## Issue Operations

Issues use the `/issue-tracking/` sub-path, NOT `/issues`. There is
**no `POST /api/v1/issues`** endpoint.

### Create or update an issue

```
POST /api/v1/issue-tracking/set-issue
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "issue": {
    "title": "Clash detected at chainage 1450",
    "description": "Stormwater pipe clashes with foundation beam at CH1450",
    "priority": 2,
    "job_id": { "IDString": "100_1" }
  }
}
```

Verify `IssueTicketModel` shape in the Swagger — exact field names may
differ.

### Get issues for a job

```
POST /api/v1/issue-tracking/issues/get
Body: { "job_id": { "IDString": "100_1" }, "page": 1, "page_size": 50, ... }
```

### Delete an issue

```
POST /api/v1/issue-tracking/delete-issue
Body: { "issue_id": { "IDString": "42_1" } }
```

---

## Multi-Step Workflow: Complete Job Setup

A typical job setup involves multiple sequential API calls. Note the
specific endpoint names — generic `/api/v1/jobs` or `/api/v1/folders`
root POSTs do NOT exist.

```
# 1. Fetch the standard and default attributes (read required fields)
GET /api/v1/jobs/getStandardAttributes
GET /api/v1/jobs/getDefaultAttributes

# 2. Create the job
POST /api/v1/jobs/create
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

# 3. Create folder structure for the job
POST /api/v1/folders/create
{ "Name": "Drawings",       "ParentFolderID": { "IDString": "{job_root_folder}" } }

POST /api/v1/folders/create
{ "Name": "Reports",        "ParentFolderID": { "IDString": "{job_root_folder}" } }

POST /api/v1/folders/create
{ "Name": "Correspondence", "ParentFolderID": { "IDString": "{job_root_folder}" } }

# 4. Create initial tasks (same POST /api/Tasks for create or update)
POST /api/Tasks
{ "name": "Site survey",           "job_id": {"IDString":"100_1"}, "due_date_utc": "2026-04-15T00:00:00Z" }

POST /api/Tasks
{ "name": "Concept design review", "job_id": {"IDString":"100_1"}, "due_date_utc": "2026-05-01T00:00:00Z" }

# 5. Upload initial documents — file upload is multipart via folder checkout/checkin,
#    not a generic POST /api/v1/files. See Files section in the LLM rules doc.
```

---

## Mutation Response Patterns

### Successful Create

Typically returns the created entity with its new `EntityID`:

```json
{
  "ID": {
    "_id": 999,
    "_server_id": 1,
    "_server_guid": "...",
    "IDString": "999_1"
  },
  "Name": "...",
  ...
}
```

### Successful Update

Typically returns the updated entity.

### Successful Delete

Typically returns `200 OK` or `204 No Content`.

### Error Responses

**[UNKNOWN]** — Error response format is not documented in the Swagger spec. Do not fabricate error schemas. Handle non-2xx responses generically:

- Check HTTP status code
- Attempt to parse response body as JSON
- Log the raw response for debugging
- Present a user-friendly error message

---

## Idempotency Notes

- **POST (create):** NOT idempotent. Duplicate calls create duplicate entities. Implement client-side deduplication.
- **PUT (update):** Idempotent. Same update can be applied multiple times safely.
- **DELETE:** Idempotent in practice — deleting an already-deleted entity should return 404 or similar.
- **File checkout:** NOT idempotent — checking out an already checked-out file will fail.
- **File checkin:** NOT idempotent — creates a new version each time.
