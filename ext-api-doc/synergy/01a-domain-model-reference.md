# 12d Synergy — Domain Model Reference

> Complete model reference derived from Swagger spec (274 models).
> Covers core entities, relationships, enums, state machines, and business rules.

---

## Entity-Relationship Overview

```
                    ┌──────────────┐
                    │  Companies   │
                    └──────┬───────┘
                           │ has many
                           ▼
┌──────────┐       ┌──────────────┐       ┌──────────────┐
│  Teams   │◄──────│    Users     │──────►│   Contacts   │
└──────────┘       └──────┬───────┘       └──────────────┘
                           │ owns / assigned
              ┌────────────┼────────────┐
              ▼            ▼            ▼
       ┌────────────┐ ┌─────────┐ ┌──────────┐
       │   Tasks    │ │  Jobs   │ │  Issues  │
       └────────────┘ └────┬────┘ └──────────┘
                           │ contains
              ┌────────────┼────────────┐
              ▼            ▼            ▼
       ┌────────────┐ ┌─────────┐ ┌──────────────┐
       │  Folders   │ │  Files  │ │ 12d Projects │
       └─────┬──────┘ └────┬────┘ └──────────────┘
             │ contains     │
             ▼              │
       ┌────────────┐      │
       │   Files    │◄─────┘ (files belong to folders)
       └────────────┘
              │
              ▼
       ┌────────────────┐
       │  Issued Files  │ (transmittals)
       └────────────────┘

Cross-cutting:
- Attributes ──► attach to Jobs, Files, Contacts, etc.
- Workflows  ──► orchestrate Jobs, Files, Issues
- Associations ──► link any two entities
- WebForms   ──► capture structured data input
- Forums     ──► discussion threads on entities
- Notes      ──► annotations on entities
- Maps       ──► spatial/GIS features on Jobs
- Categories ──► classification taxonomy
```

---

## Core Identity Model

### EntityID

The universal identifier for all entities in 12d Synergy. **This is NOT a simple integer or UUID** — it is a composite object.

```json
{
  "_id": 12345,
  "_server_id": 1,
  "_server_guid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "IDString": "12345_1"
}
```

| Field          | Type          | Description                                    |
| -------------- | ------------- | ---------------------------------------------- |
| `_id`          | int64         | Numeric ID within the server                   |
| `_server_id`   | int32         | Server instance identifier                     |
| `_server_guid` | uuid (string) | Globally unique server identifier              |
| `IDString`     | string        | Human-readable composite: `{_id}_{_server_id}` |

**Usage:** When an endpoint path requires `{id}`, use the `IDString` value (e.g., `12345_1`).

---

## Pagination Wrapper

### PagedResultModel[T]

Every list endpoint returns this wrapper.

```json
{
  "PageNumber": 1,
  "PageSize": 50,
  "TotalPages": 3,
  "TotalRows": 142,
  "Result": []
}
```

| Field        | Type  | Description                  |
| ------------ | ----- | ---------------------------- |
| `PageNumber` | int32 | Current page (1-based)       |
| `PageSize`   | int32 | Items per page               |
| `TotalPages` | int32 | Total number of pages        |
| `TotalRows`  | int32 | Total items across all pages |
| `Result`     | T[]   | Array of items for this page |

**Casing:** PascalCase. Always.

---

## Job Domain

### JobModel (PascalCase)

Jobs are the primary organizational unit — equivalent to "projects" in 12d Synergy.

```json
{
  "ID": {
    "_id": 100,
    "_server_id": 1,
    "_server_guid": "...",
    "IDString": "100_1"
  },
  "Name": "Highway Upgrade Stage 2",
  "Description": "Major infrastructure upgrade project",
  "Path": "/Projects/Infrastructure",
  "ParentJobID": {
    "_id": 50,
    "_server_id": 1,
    "_server_guid": "...",
    "IDString": "50_1"
  },
  "Attributes": [
    {
      "Name": "ProjectManager",
      "Value": "Jane Smith"
    }
  ],
  "CreatedDate": "2026-01-15T00:00:00Z",
  "Type": 0
}
```

| Field         | Type                | Description                         |
| ------------- | ------------------- | ----------------------------------- |
| `ID`          | EntityID            | Composite identifier                |
| `Name`        | string              | Job name                            |
| `Description` | string              | Job description                     |
| `Path`        | string              | Hierarchical path in job tree       |
| `ParentJobID` | EntityID (nullable) | Parent job for hierarchical nesting |
| `Attributes`  | AttributeValue[]    | Custom attribute key-value pairs    |
| `CreatedDate` | datetime            | Creation timestamp                  |
| `Type`        | int32               | `0` = Job, `1` = Template           |

### Job Type Enum

| Value | Meaning                      |
| ----- | ---------------------------- |
| 0     | Job (active project)         |
| 1     | Template (reusable template) |

### Job Business Rules

- Jobs can be nested (parent-child hierarchy via `ParentJobID`)
- Must fetch standard attributes via `GET /api/v1/jobs/getStandardAttributes` (and `getDefaultAttributes`) before creating — there is no `/attributes/required/jobs` endpoint
- All required attributes must be included in the create payload
- Jobs contain folders, files, 12d projects, and can have workflows attached

---

## Task Domain

### TaskItemModel (snake_case)

Tasks represent work items. They support hierarchical nesting (parent-child).

```json
{
  "id": {
    "_id": 500,
    "_server_id": 1,
    "_server_guid": "...",
    "IDString": "500_1"
  },
  "name": "Review drainage design",
  "description": "Check drainage calculations against AS3500",
  "due_date_utc": "2026-04-01T00:00:00Z",
  "is_closed": false,
  "item_owner": {
    "_id": 10,
    "_server_id": 1,
    "_server_guid": "...",
    "IDString": "10_1"
  },
  "children": [
    {
      "id": { "IDString": "501_1" },
      "name": "Sub-task: Check pipe sizing",
      "is_closed": false
    }
  ]
}
```

| Field          | Type            | Description               |
| -------------- | --------------- | ------------------------- |
| `id`           | EntityID        | Composite identifier      |
| `name`         | string          | Task name                 |
| `description`  | string          | Task description          |
| `due_date_utc` | datetime        | Due date in UTC           |
| `is_closed`    | boolean         | Whether task is completed |
| `item_owner`   | EntityID        | Assigned user/owner       |
| `children`     | TaskItemModel[] | Sub-tasks (hierarchical)  |

### Task State Machine

```
┌──────────┐    close     ┌──────────┐
│   Open   │─────────────►│  Closed  │
│is_closed │              │is_closed │
│ = false  │◄─────────────│ = true   │
└──────────┘    reopen    └──────────┘
```

### Task Business Rules

- **CRITICAL:** Create/update uses `POST /api/Tasks` — no `/v1/` prefix. One endpoint handles both operations (set `id` on the body for update; omit for create). There is no `PUT /api/Tasks` variant.
- Delete requires description in path: `DELETE /api/v1/tasks/{task_id}/{description}`
- Tasks support parent-child hierarchy via `children` array
- `due_date_utc` should be ISO 8601 format
- All field names are snake_case (unlike most other models)

---

## File Domain

### FileModel (PascalCase)

```json
{
  "ID": {
    "_id": 2000,
    "_server_id": 1,
    "_server_guid": "...",
    "IDString": "2000_1"
  },
  "FileName": "drainage-plan-v3.dwg",
  "Path": "/Projects/Infrastructure/Drawings",
  "FolderID": {
    "IDString": "300_1"
  },
  "LatestVersion": 3,
  "LastModified": "2026-03-28T14:30:00Z",
  "IsCheckedOut": false
}
```

| Field           | Type     | Description                        |
| --------------- | -------- | ---------------------------------- |
| `ID`            | EntityID | Composite identifier               |
| `FileName`      | string   | File name with extension           |
| `Path`          | string   | Full path in folder hierarchy      |
| `FolderID`      | EntityID | Parent folder                      |
| `LatestVersion` | int32    | Current version number             |
| `LastModified`  | datetime | Last modification timestamp        |
| `IsCheckedOut`  | boolean  | Whether file is locked for editing |

### File State Machine

```
┌────────────┐   checkout   ┌──────────────┐   checkin   ┌────────────┐
│  Available │──────────────►│ Checked Out  │────────────►│  Available │
│IsCheckedOut│              │IsCheckedOut  │            │IsCheckedOut│
│  = false   │              │  = true      │            │  = false   │
└────────────┘              └──────────────┘            │LatestVer+1│
                                                        └────────────┘
```

### File Business Rules

- Must check out before modifying a file
- Check in increments `LatestVersion`
- Files belong to exactly one folder (`FolderID`)
- File search is POST-based, pagination in body: `POST /api/v1/files/search` with `{FileName, Contents, Page, PageSize, LimitSearchTo, LimitID, ...}`
- Download: `POST /api/v1/files/{id}/download/{version}/{with_references}` — all three path params. Body empty. Get `LatestVersion` first from `GET /api/v1/files/{id}/{retrieve_attributes}`.
- Version history: `GET /api/v1/files/{id}/history/{retrieve_attributes}/{page}/{page_size}`

---

## Folder Domain

### FolderModel (PascalCase)

```json
{
  "ID": {
    "IDString": "300_1"
  },
  "Name": "Drawings",
  "Path": "/Projects/Infrastructure/Drawings",
  "ParentFolderID": {
    "IDString": "200_1"
  }
}
```

| Field            | Type                | Description               |
| ---------------- | ------------------- | ------------------------- |
| `ID`             | EntityID            | Composite identifier      |
| `Name`           | string              | Folder name               |
| `Path`           | string              | Full hierarchical path    |
| `ParentFolderID` | EntityID (nullable) | Parent folder for nesting |

### Folder Business Rules

- Folders form a tree hierarchy
- Folders belong to jobs
- Get folder items (subfolders + first page of files): `GET /api/v1/folders/{id}/items` — returns `FolderItemsModel`
- Paginated files in a folder: `GET /api/v1/folders/{id}/files/{retrieve_attributes}/{page}/{page_size}/{filter}/{show_deleted_files}` (6 path segments)

---

## Contact Domain

### ContactModel (snake_case — confirmed from live API)

```json
{
  "id": { "_id": 1, "_server_id": 1, "_server_guid": "...", "IDString": "1_1" },
  "is_user": true,
  "companies": [],
  "first_name": "Test",
  "last_name": "User",
  "email": "Test.User@test.com",
  "active": true,
  "create_date": "2024-12-10T01:48:00.25",
  "attributes": [],
  "image_modified_date_time": "2024-12-10T01:48:03.23"
}
```

| Field                      | Type        | Description                                |
| -------------------------- | ----------- | ------------------------------------------ |
| `id`                       | EntityID    | Composite identifier                       |
| `is_user`                  | boolean     | Whether this contact is also a system user |
| `companies`                | Company[]   | Associated companies                       |
| `first_name`               | string      | First name                                 |
| `last_name`                | string      | Last name                                  |
| `email`                    | string      | Email address                              |
| `active`                   | boolean     | Whether the contact is active              |
| `create_date`              | datetime    | Creation timestamp                         |
| `attributes`               | Attribute[] | Custom attributes                          |
| `image_modified_date_time` | datetime    | Profile image last modified                |

**Fetch with full details:** `GET /api/v1/Contacts/{id}/true/true` (retrieve_attributes=true, retrieve_companies=true)

The spec exposes 21 contact endpoints including contact lists, signatures, thumbnails, mentions, and system attributes — a rich, fully normalized model.

---

## Supporting Models

### AttributeValue

Attached to jobs, files, contacts, and other entities.

```json
{
  "Name": "ProjectManager",
  "Value": "Jane Smith"
}
```

### AttributeDefinition

Defines what attributes exist and which are required.

```json
{
  "Name": "ProjectManager",
  "Type": "string",
  "Required": true,
  "EntityType": "Job"
}
```

### WorkflowModel

```json
{
  "ID": { "IDString": "400_1" },
  "Name": "Document Review Workflow",
  "Status": "Active",
  "Steps": []
}
```

### IssueModel

```json
{
  "ID": { "IDString": "600_1" },
  "Title": "Clash detected at chainage 1450",
  "Status": "Open",
  "Priority": "High",
  "AssignedTo": { "IDString": "10_1" }
}
```

### IssuedFileModel

Represents a file that has been transmitted/issued to external parties.

### WebFormModel

Structured data capture forms with field definitions and submissions.

### ForumModel

Discussion threads attached to entities.

### NoteModel

Annotations/comments on entities.

### MapModel

Spatial/GIS features associated with jobs.

### ClashDetectionModel

3D model clash detection results.

### 12dProjectModel

Integration with 12d Model software projects.

---

## Enum Reference

### Job Type

| Value | Label    |
| ----- | -------- |
| 0     | Job      |
| 1     | Template |

### Additional Enums

Most enum values are integer-based. Specific enum definitions for statuses, priorities, and types across Issue-tracking, Workflows, and other domains should be verified against the live spec, as the Swagger defines them but exact values vary by entity.

---

## Model Casing Summary

| Model            | Casing Convention                                |
| ---------------- | ------------------------------------------------ |
| EntityID         | Mixed (underscore-prefixed: `_id`, `_server_id`) |
| PagedResultModel | PascalCase                                       |
| JobModel         | PascalCase                                       |
| TaskItemModel    | snake_case                                       |
| FileModel        | PascalCase                                       |
| FolderModel      | PascalCase                                       |
| ContactModel     | snake_case (confirmed from live API)             |
| AttributeValue   | PascalCase                                       |
| WorkflowModel    | PascalCase (inferred)                            |
| IssueModel       | PascalCase (inferred)                            |

**Rule:** Never assume casing. Always check the specific model in the spec.

---

## Cross-Entity Relationships

| Relationship       | Type                 | Description                               |
| ------------------ | -------------------- | ----------------------------------------- |
| Job → Folders      | 1:many               | Jobs contain folder hierarchies           |
| Job → Files        | 1:many (via folders) | Files live in job folders                 |
| Job → Tasks        | 1:many               | Tasks assigned within jobs                |
| Job → 12d Projects | 1:many               | 12d Model projects linked to jobs         |
| Job → Attributes   | 1:many               | Custom attributes on jobs                 |
| Job → Workflows    | 1:many               | Workflows attached to jobs                |
| Folder → Files     | 1:many               | Folders contain files                     |
| Folder → Folders   | 1:many               | Nested folder hierarchy                   |
| File → Versions    | 1:many               | File version history                      |
| File → IssuedFiles | 1:many               | File transmittals                         |
| Task → Tasks       | 1:many               | Parent-child task hierarchy               |
| User → Teams       | many:many            | Users belong to teams                     |
| User → Company     | many:1               | Users belong to companies                 |
| Contact → Company  | many:1               | Contacts linked to companies              |
| Entity → Entity    | many:many            | Generic associations between any entities |
| Entity → Notes     | 1:many               | Notes/annotations on any entity           |
| Entity → Forums    | 1:many               | Discussion threads on any entity          |
