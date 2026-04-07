# 12d Synergy — Mutation Patterns

> Create, update, delete operations. State transitions. Multi-step workflows.

---

## Job CRUD

### Create Job

**PREREQUISITE:** Fetch required attributes first.

```
# Step 1: Get required attributes
GET /api/v1/attributes/required/jobs
Authorization: Bearer {PAT}

# Response:
[
  { "Name": "ProjectManager", "Type": "string", "Required": true },
  { "Name": "Region", "Type": "string", "Required": true }
]

# Step 2: Create job with required attributes included
POST /api/v1/jobs
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

**If required attributes are missing, the create will fail.** Always fetch and include them.

### Update Job

```
PUT /api/v1/jobs
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "ID": { "IDString": "100_1" },
  "Name": "Highway Upgrade Stage 2 - Updated",
  "Description": "Updated scope to include interchange",
  "Path": "/Projects/Infrastructure",
  "Type": 0,
  "Attributes": [
    { "Name": "ProjectManager", "Value": "John Doe" },
    { "Name": "Region", "Value": "Waikato" }
  ]
}
```

### Delete Job

```
DELETE /api/v1/jobs/{id}
Authorization: Bearer {PAT}
```

Example: `DELETE /api/v1/jobs/100_1`

### Set Job Attributes

```
POST /api/v1/jobs/{id}/attributes
Authorization: Bearer {PAT}
Content-Type: application/json

[
  { "Name": "Budget", "Value": "3500000" },
  { "Name": "Status", "Value": "Active" }
]
```

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
PUT /api/Tasks
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

**CRITICAL:** Also uses `/api/Tasks` — no `/v1/` prefix.

### Close Task (Update)

```
PUT /api/Tasks
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "id": { "IDString": "500_1" },
  "is_closed": true
}
```

### Reopen Task (Update)

```
PUT /api/Tasks
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

```
POST /api/v1/files
Authorization: Bearer {PAT}
Content-Type: multipart/form-data

# Form fields:
# - file: (binary file data)
# - FolderID: "300-1"
# - FileName: "new-design.dwg"
```

**Note:** Exact upload format should be verified against the spec. May require multipart form data or a specific upload model.

### Checkout → Edit → Checkin Workflow

This is the standard file modification workflow:

```
# Step 1: Check out the file (locks it)
POST /api/v1/files/2000_1/checkout
Authorization: Bearer {PAT}

# Step 2: Download the current version
GET /api/v1/files/2000_1/download
Authorization: Bearer {PAT}
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
GET /api/v1/files/{id}/download
Authorization: Bearer {PAT}
```

Returns binary file content. Set appropriate response handling for the file type.

---

## Folder Operations

### Create Folder

```
POST /api/v1/folders
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "Name": "Site Photos",
  "ParentFolderID": { "IDString": "300_1" }
}
```

### Delete Folder

```
DELETE /api/v1/folders/{id}
Authorization: Bearer {PAT}
```

---

## Contact Operations

### Create Contact

```
POST /api/v1/contacts
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "Name": "John Smith",
  "Email": "john.smith@example.com",
  "Phone": "+64 21 555 0123",
  "Company": { "IDString": "50_1" }
}
```

**Note:** Verify exact field names and required fields against the spec.

### Update Contact

```
PUT /api/v1/contacts
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "ID": { "IDString": "800_1" },
  "Name": "John Smith",
  "Email": "john.smith@newcompany.com"
}
```

---

## Workflow Operations

### Start Workflow

```
POST /api/v1/workflows
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "Name": "Document Review",
  "EntityID": { "IDString": "2000_1" }
}
```

**Note:** Workflow creation and execution patterns should be verified against the spec. Workflows likely have multi-step definitions and status transitions.

---

## Issue Operations

### Create Issue

```
POST /api/v1/issues
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "Title": "Clash detected at chainage 1450",
  "Description": "Stormwater pipe clashes with foundation beam at CH1450",
  "Priority": "High"
}
```

---

## Multi-Step Workflow: Complete Job Setup

A typical job setup involves multiple sequential API calls:

```
# 1. Fetch required attributes
GET /api/v1/attributes/required/jobs
Authorization: Bearer {PAT}

# 2. Create the job (with required attributes)
POST /api/v1/jobs
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
POST /api/v1/folders
{ "Name": "Drawings", "ParentFolderID": { "IDString": "{job_root_folder}" } }

POST /api/v1/folders
{ "Name": "Reports", "ParentFolderID": { "IDString": "{job_root_folder}" } }

POST /api/v1/folders
{ "Name": "Correspondence", "ParentFolderID": { "IDString": "{job_root_folder}" } }

# 4. Create initial tasks
POST /api/Tasks
{ "name": "Site survey", "due_date_utc": "2026-04-15T00:00:00Z" }

POST /api/Tasks
{ "name": "Concept design review", "due_date_utc": "2026-05-01T00:00:00Z" }

# 5. Upload initial documents
POST /api/v1/files
# Upload project brief to the job's Correspondence folder
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
