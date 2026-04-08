# 12d Synergy — Query Patterns

> Real endpoint paths, pagination handling, and worked examples for read operations.

---

## Pagination Pattern

All list/search endpoints use **path-based pagination**. The page number and page size are URL path segments.

### URL Pattern

```
GET /api/v1/{resource}/{page}/{page_size}
```

### Response Wrapper

Every paginated response returns `PagedResultModel[T]`:

```json
{
  "PageNumber": 1,
  "PageSize": 50,
  "TotalPages": 3,
  "TotalRows": 142,
  "Result": [ ... ]
}
```

### Iteration Pattern

```python
page = 1
page_size = 50
all_results = []

while True:
    response = GET(f"/api/v1/jobs/{page}/{page_size}")
    data = response.json()
    all_results.extend(data["Result"])

    if page >= data["TotalPages"]:
        break
    page += 1
```

### Key Rules

- Pages are **1-based** (first page is `1`, not `0`)
- `TotalPages` and `TotalRows` are always returned — use `TotalPages` for loop termination
- An empty result set returns `TotalPages: 0`, `TotalRows: 0`, `Result: []`
- Default/max page sizes are not documented — use explicit values (50 is safe)

---

## List Endpoints by Category

### Jobs

```
GET /api/v1/jobs/{page}/{page_size}
```

Returns `PagedResultModel[JobModel]`.

### Tasks

```
GET /api/v1/tasks/{page}/{page_size}
```

Returns `PagedResultModel[TaskItemModel]`.

### Files

```
GET /api/v1/files/{page}/{page_size}
```

Returns `PagedResultModel[FileModel]`.

### Folders

```
GET /api/v1/folders/{page}/{page_size}
```

Returns `PagedResultModel[FolderModel]`.

### Folder Contents (Files in a Folder)

```
GET /api/v1/folders/{folder_id}/files/{page}/{page_size}
```

Returns `PagedResultModel[FileModel]` — files within a specific folder.

### Contacts

```
GET /api/v1/contacts/{page}/{page_size}
```

Returns `PagedResultModel[ContactModel]`.

### Workflows

```
GET /api/v1/workflows/{page}/{page_size}
```

### Issues

```
GET /api/v1/issues/{page}/{page_size}
```

### Users

```
GET /api/v1/users/{page}/{page_size}
```

### Teams

```
GET /api/v1/teams/{page}/{page_size}
```

### Companies

```
GET /api/v1/companies/{page}/{page_size}
```

### Issued Files

```
GET /api/v1/issuedfiles/{page}/{page_size}
```

### Attributes

```
GET /api/v1/attributes/{page}/{page_size}
```

### Forums

```
GET /api/v1/forums/{page}/{page_size}
```

### Notes

```
GET /api/v1/notes/{page}/{page_size}
```

### WebForms

```
GET /api/v1/webforms/{page}/{page_size}
```

### Reports

```
GET /api/v1/reports/{page}/{page_size}
```

---

## Single-Entity Fetch

### Get by ID

All entities can be fetched by their `IDString`:

```
GET /api/v1/jobs/{id}
GET /api/v1/tasks/{id}
GET /api/v1/files/{id}
GET /api/v1/folders/{id}
GET /api/v1/contacts/{id}
```

**Remember:** `{id}` is the `IDString` from the `EntityID` composite (e.g., `100-1`).

### Get Entity Attributes

```
GET /api/v1/jobs/{id}/attributes
GET /api/v1/files/{id}/attributes
```

### Get Required Attributes

```
GET /api/v1/attributes/required/jobs
GET /api/v1/attributes/required/files
GET /api/v1/attributes/required/contacts
```

### File-Specific Queries

```
GET /api/v1/files/{id}/versions        # Version history
GET /api/v1/files/{id}/download         # Download file content
```

---

## Search Endpoints

Search endpoints use `POST` with criteria in the request body. Pagination is still path-based.

### Job Search

```
POST /api/v1/jobs/search
Content-Type: application/json

{
  "Name": "Highway"
}
```

### File Search

```
POST /api/v1/files/search
Content-Type: application/json

{
  "FileName": "drainage"
}
```

### Contact Search

```
POST /api/v1/contacts/search
Content-Type: application/json

{
  "Name": "Smith"
}
```

**Note:** Search request body schemas vary by entity. Check the Swagger spec for available search fields per entity. Common patterns include searching by Name, Path, and date ranges.

---

## Worked Examples

### Example 1: List All Jobs (Multi-Page)

**Goal:** Retrieve all jobs from the system.

```
# Step 1: Fetch first page
GET /api/v1/jobs/1/50
Authorization: Bearer {PAT}

# Response:
{
  "PageNumber": 1,
  "PageSize": 50,
  "TotalPages": 3,
  "TotalRows": 142,
  "Result": [
    {
      "ID": { "_id": 100, "_server_id": 1, "IDString": "100_1" },
      "Name": "Highway Upgrade Stage 2",
      "Path": "/Projects/Infrastructure",
      "Type": 0
    },
    ...  # 49 more items
  ]
}

# Step 2: Fetch page 2
GET /api/v1/jobs/2/50
Authorization: Bearer {PAT}

# Step 3: Fetch page 3 (final)
GET /api/v1/jobs/3/50
Authorization: Bearer {PAT}

# Response for final page:
{
  "PageNumber": 3,
  "PageSize": 50,
  "TotalPages": 3,
  "TotalRows": 142,
  "Result": [
    ...  # 42 items (142 - 100 from first two pages)
  ]
}
```

### Example 2: Search Jobs by Name

**Goal:** Find all jobs containing "Bridge" in the name.

```
POST /api/v1/jobs/search/1/50
Authorization: Bearer {PAT}
Content-Type: application/json

{
  "Name": "Bridge"
}

# Response:
{
  "PageNumber": 1,
  "PageSize": 50,
  "TotalPages": 1,
  "TotalRows": 3,
  "Result": [
    {
      "ID": { "IDString": "105_1" },
      "Name": "Bridge Replacement - Waikato River",
      "Path": "/Projects/Bridges"
    },
    {
      "ID": { "IDString": "210_1" },
      "Name": "Pedestrian Bridge Design",
      "Path": "/Projects/Urban"
    },
    {
      "ID": { "IDString": "315_1" },
      "Name": "Bridge Inspection Report Template",
      "Type": 1
    }
  ]
}
```

### Example 3: Browse Folder Contents

**Goal:** List files in a specific project folder.

```
# Step 1: Get the folder by ID
GET /api/v1/folders/300_1
Authorization: Bearer {PAT}

# Response:
{
  "ID": { "IDString": "300_1" },
  "Name": "Drawings",
  "Path": "/Projects/Infrastructure/Drawings"
}

# Step 2: Get files in that folder (paginated)
GET /api/v1/folders/300_1/files/1/50
Authorization: Bearer {PAT}

# Response:
{
  "PageNumber": 1,
  "PageSize": 50,
  "TotalPages": 1,
  "TotalRows": 8,
  "Result": [
    {
      "ID": { "IDString": "2000_1" },
      "FileName": "drainage-plan-v3.dwg",
      "LatestVersion": 3,
      "LastModified": "2026-03-28T14:30:00Z",
      "IsCheckedOut": false
    },
    ...
  ]
}
```

### Example 4: Get Job with Required Attributes

**Goal:** Understand what attributes a job has and what's required for new jobs.

```
# Step 1: Get required attributes for jobs
GET /api/v1/attributes/required/jobs
Authorization: Bearer {PAT}

# Response (example):
[
  {
    "Name": "ProjectManager",
    "Type": "string",
    "Required": true
  },
  {
    "Name": "Region",
    "Type": "string",
    "Required": true
  }
]

# Step 2: Get a specific job's current attributes
GET /api/v1/jobs/100_1/attributes
Authorization: Bearer {PAT}

# Response:
[
  {
    "Name": "ProjectManager",
    "Value": "Jane Smith"
  },
  {
    "Name": "Region",
    "Value": "Waikato"
  },
  {
    "Name": "Budget",
    "Value": "2500000"
  }
]
```

### Example 5: Check File Version History

**Goal:** See all versions of a specific file.

```
# Step 1: Get the file
GET /api/v1/files/2000_1
Authorization: Bearer {PAT}

# Response:
{
  "ID": { "IDString": "2000_1" },
  "FileName": "drainage-plan-v3.dwg",
  "LatestVersion": 3,
  "LastModified": "2026-03-28T14:30:00Z",
  "IsCheckedOut": false
}

# Step 2: Get version history
GET /api/v1/files/2000_1/versions
Authorization: Bearer {PAT}

# Response (example):
[
  {
    "VersionNumber": 1,
    "ModifiedDate": "2026-01-10T09:00:00Z",
    "ModifiedBy": "John Doe"
  },
  {
    "VersionNumber": 2,
    "ModifiedDate": "2026-02-15T11:30:00Z",
    "ModifiedBy": "Jane Smith"
  },
  {
    "VersionNumber": 3,
    "ModifiedDate": "2026-03-28T14:30:00Z",
    "ModifiedBy": "Jane Smith"
  }
]
```

---

## Polling for Changes

Since 12d Synergy has **no webhooks**, change detection requires polling.

### Strategy 1: Poll by Last Modified

Many models include a `LastModified` or `CreatedDate` field. Fetch pages and filter client-side by date:

```
GET /api/v1/files/1/100
# Filter Result where LastModified > last_poll_time
```

### Strategy 2: Search with Date Filters

If the search endpoint supports date range criteria (verify per entity):

```
POST /api/v1/files/search/1/100
{
  "ModifiedAfter": "2026-03-28T00:00:00Z"
}
```

### Strategy 3: Page Through and Compare

For entities without date fields, maintain a local cache of IDs and compare against paginated results to detect additions/removals.

### Recommended Poll Interval

- Active sync: Every 5-15 minutes
- Background sync: Every 30-60 minutes
- Avoid polling more frequently than every 2 minutes (be respectful of the API)
